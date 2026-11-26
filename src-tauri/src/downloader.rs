use futures_util::stream::{self, StreamExt};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::error::Error as StdError;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use zip::ZipArchive;

pub struct DownloadTask {
    pub url: String,
    pub dest_path: PathBuf,
    pub size: Option<u64>,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
    pub label: String,
}

static SHARED_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub fn get_http_client() -> reqwest::Client {
    SHARED_HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("HeartLauncher/0.5.0 (Windows NT 10.0; Win64; x64)")
                .danger_accept_invalid_certs(true)
                .tcp_nodelay(true)
                .tcp_keepalive(Duration::from_secs(30))
                .pool_idle_timeout(Duration::from_secs(30))
                .pool_max_idle_per_host(8)
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default()
        })
        .clone()
}

pub fn format_error_chain(err: &dyn StdError) -> String {
    let mut msg = err.to_string();
    let mut current = err.source();
    while let Some(src) = current {
        msg.push_str(": ");
        msg.push_str(&src.to_string());
        current = src.source();
    }
    msg
}

fn part_path_for(dest: &Path) -> PathBuf {
    PathBuf::from(format!("{}.part", dest.display()))
}

pub async fn fetch_text_with_retry(url: &str, label: &str) -> Result<String, String> {
    let client = get_http_client();
    let mut last_err = String::new();

    for attempt in 1..=3u64 {
        match client.get(url).send().await {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    last_err = format!("HTTP {} при запросе {} ({})", status, label, url);
                } else {
                    match resp.text().await {
                        Ok(text) => return Ok(text),
                        Err(e) => {
                            last_err = format!("{} ({}): {}", label, url, format_error_chain(&e));
                        }
                    }
                }
            }
            Err(e) => {
                last_err = format!("{} ({}): {}", label, url, format_error_chain(&e));
            }
        }

        if attempt < 3 {
            tokio::time::sleep(Duration::from_millis(600 * attempt)).await;
        }
    }

    Err(last_err)
}

pub fn verify_file_sha1(path: &Path, expected_sha1: &str) -> bool {
    if !path.exists() {
        return false;
    }
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 32768];
    loop {
        let count = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return false,
        };
        hasher.update(&buffer[..count]);
    }
    let hash = hex::encode(hasher.finalize());
    hash.eq_ignore_ascii_case(expected_sha1)
}

pub fn verify_file_sha256(path: &Path, expected_sha256: &str) -> bool {
    if !path.exists() {
        return false;
    }
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 32768];
    loop {
        let count = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return false,
        };
        hasher.update(&buffer[..count]);
    }
    let hash = hex::encode(hasher.finalize());
    hash.eq_ignore_ascii_case(expected_sha256)
}

pub fn is_valid_existing_file(
    path: &Path,
    expected_size: Option<u64>,
    sha1: Option<&str>,
    sha256: Option<&str>,
) -> bool {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if meta.len() == 0 {
        return false;
    }

    let has_size = expected_size.is_some_and(|sz| sz > 0);
    if let Some(sz) = expected_size {
        if sz > 0 && meta.len() != sz {
            return false;
        }
    }

    let clean_sha256 = sha256.map(str::trim).filter(|s| !s.is_empty());
    if let Some(hash256) = clean_sha256 {
        if !verify_file_sha256(path, hash256) {
            return false;
        }
    }

    let clean_sha1 = sha1.map(str::trim).filter(|s| !s.is_empty());
    if let Some(hash1) = clean_sha1 {
        if !verify_file_sha1(path, hash1) {
            return false;
        }
    }

    has_size || clean_sha1.is_some() || clean_sha256.is_some()
}

async fn download_single_file_once<F>(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_size: Option<u64>,
    expected_sha1: Option<&str>,
    expected_sha256: Option<&str>,
    on_chunk: &F,
) -> Result<(), String>
where
    F: Fn(u64, u64),
{
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let temp_path = part_path_for(dest);
    let _ = fs::remove_file(&temp_path);

    let res = client
        .get(url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("{}: {}", url, format_error_chain(&e)))?;

    if !res.status().is_success() {
        return Err(format!("HTTP {} при загрузке {}", res.status(), url));
    }

    let total = res.content_length().or(expected_size).unwrap_or(0);
    let mut file = File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = match item {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&temp_path);
                return Err(format!("{}: {}", url, format_error_chain(&e)));
            }
        };
        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&temp_path);
            return Err(e.to_string());
        }
        downloaded += chunk.len() as u64;
        on_chunk(downloaded, total);
    }

    drop(file);

    if let Some(sz) = expected_size {
        if sz > 0 && downloaded != sz {
            let _ = fs::remove_file(&temp_path);
            return Err(format!(
                "еполный файл {}: получено {} байт из {}",
                url, downloaded, sz
            ));
        }
    }

    if let Some(hash256) = expected_sha256.map(str::trim).filter(|s| !s.is_empty()) {
        if !verify_file_sha256(&temp_path, hash256) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("онтрольная сумма SHA-256 не совпала для {}", url));
        }
    }

    if let Some(hash) = expected_sha1.map(str::trim).filter(|s| !s.is_empty()) {
        if !verify_file_sha1(&temp_path, hash) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("онтрольная сумма SHA-1 не совпала для {}", url));
        }
    }

    let _ = fs::remove_file(dest);
    fs::rename(&temp_path, dest).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })?;
    Ok(())
}

pub async fn download_file_stream<F>(url: &str, dest: &Path, on_chunk: F) -> Result<(), String>
where
    F: Fn(u64, u64),
{
    let client = get_http_client();
    let mut last_err = String::new();

    for attempt in 1..=3u64 {
        match download_single_file_once(&client, url, dest, None, None, None, &on_chunk).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = e;
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_millis(700 * attempt)).await;
                }
            }
        }
    }

    Err(last_err)
}

pub async fn download_pool(
    tasks: Vec<DownloadTask>,
    concurrency: usize,
    on_progress: impl Fn(u32, &str) + Send + Sync + 'static,
) -> Result<usize, String> {
    if tasks.is_empty() {
        return Ok(0);
    }

    let total_tasks = tasks.len();
    let pending_tasks: Vec<DownloadTask> = tasks
        .into_iter()
        .filter(|t| {
            !is_valid_existing_file(
                &t.dest_path,
                t.size,
                t.sha1.as_deref(),
                t.sha256.as_deref(),
            )
        })
        .collect();

    let pending_count = pending_tasks.len();
    let skipped = total_tasks - pending_count;
    if pending_tasks.is_empty() {
        return Ok(0);
    }

    let completed = Arc::new(AtomicUsize::new(skipped));
    let on_progress = Arc::new(on_progress);
    let client = get_http_client();

    let results: Vec<Result<(), String>> = stream::iter(pending_tasks)
        .map(|task| {
            let client = client.clone();
            let completed = completed.clone();
            let on_progress = on_progress.clone();

            async move {
                let mut last_err = String::new();
                for attempt in 1..=3u64 {
                    match download_single_file_once(
                        &client,
                        &task.url,
                        &task.dest_path,
                        task.size,
                        task.sha1.as_deref(),
                        task.sha256.as_deref(),
                        &|_, _| {},
                    )
                    .await
                    {
                        Ok(()) => {
                            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                            let pct = (done as f64 / total_tasks as f64 * 100.0) as u32;
                            on_progress(pct, &task.label);
                            return Ok(());
                        }
                        Err(e) => {
                            last_err = format!("{} - {}", task.label, e);
                            if attempt < 3 {
                                tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
                            }
                        }
                    }
                }
                Err(last_err)
            }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    let errors: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    if let Some(first_err) = errors.first() {
        return Err(format!(
            "е удалось загрузить {} файл(ов): {}",
            errors.len(),
            first_err
        ));
    }

    Ok(pending_count)
}

pub fn extract_zip(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let out = match entry.enclosed_name() {
            Some(p) => target_dir.join(p),
            None => continue,
        };

        if entry.is_dir() {
            let _ = fs::create_dir_all(&out);
        } else {
            if let Some(parent) = out.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut outfile = File::create(&out).map_err(|e| e.to_string())?;
            let _ = std::io::copy(&mut entry, &mut outfile);
        }
    }
    Ok(())
}