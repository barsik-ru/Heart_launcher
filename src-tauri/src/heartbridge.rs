use crate::downloader::{
    download_file_stream, download_pool, format_error_chain, get_http_client,
    is_valid_existing_file, verify_file_sha256, DownloadTask,
};
use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::Duration;

pub const HEART_BRIDGE_BASE: &str = "https://heartserverm.duckdns.org:27015";
pub const MINECRAFT_VERSION: &str = "1.21.11";

const EMBEDDED_HEART_OVERLAY_JAR: &[u8] = include_bytes!("../resources/heart-overlay-1.0.0.jar");
const EMBEDDED_HEART_IDENTITY_JAR: &[u8] = include_bytes!("../resources/heart-identity-fabric.jar");

#[derive(Serialize, Deserialize, Clone, Default)]
struct ModpackResolutionCache {
    revision: u32,
    mods: HashMap<String, CachedModResolution>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CachedModResolution {
    url: String,
    filename: String,
    size: Option<u64>,
    sha1: Option<String>,
}

const CORE_CLIENT_MODS: &[(&str, &str, &str)] = &[
    (
        "fabric-api",
        "https://cdn.modrinth.com/data/P7dR8mSH/versions/6qAuTtLR/fabric-api-0.141.6%2B1.21.11.jar",
        "fabric-api-0.141.6+1.21.11.jar",
    ),
    (
        "fabric-language-kotlin",
        "https://api.modrinth.com/v2/project/fabric-language-kotlin/version",
        "fabric-language-kotlin",
    ),
    (
        "cloth-config",
        "https://api.modrinth.com/v2/project/cloth-config/version",
        "cloth-config",
    ),
    (
        "creativecore",
        "https://api.modrinth.com/v2/project/creativecore/version",
        "creativecore",
    ),
];

pub fn ensure_embedded_client_mods(game_dir: &Path) {
    let mods_dir = game_dir.join("mods");
    let _ = fs::create_dir_all(&mods_dir);

    // 1. Всегда устанавливаем актуальный heart-overlay-1.0.0.jar (фикс мышки и borderless на Windows 11)
    let overlay_jar = mods_dir.join("heart-overlay-1.0.0.jar");
    let need_overlay_update = match fs::metadata(&overlay_jar) {
        Ok(meta) => meta.len() != EMBEDDED_HEART_OVERLAY_JAR.len() as u64,
        Err(_) => true,
    };
    if need_overlay_update {
        let _ = fs::write(&overlay_jar, EMBEDDED_HEART_OVERLAY_JAR);
    }

    // 2. Гарантируем, что heart-identity-fabric.jar существует и не пустой (0 байт)
    let identity_jar = mods_dir.join("heart-identity-fabric.jar");
    let need_identity_fallback = match fs::metadata(&identity_jar) {
        Ok(meta) => meta.len() == 0,
        Err(_) => true,
    };
    if need_identity_fallback {
        let _ = fs::write(&identity_jar, EMBEDDED_HEART_IDENTITY_JAR);
    }
}

pub async fn check_backend_online() -> bool {
    let client = get_http_client();
    client
        .get(format!("{}/v1/news", HEART_BRIDGE_BASE))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn fetch_news() -> Vec<NewsArticle> {
    let client = get_http_client();
    let url = format!("{}/v1/news", HEART_BRIDGE_BASE);

    if let Ok(res) = client.get(&url).timeout(Duration::from_secs(6)).send().await {
        if res.status().is_success() {
            if let Ok(rows) = res.json::<Vec<HeartBridgeRawNews>>().await {
                return rows
                    .into_iter()
                    .filter(|item| item.published.unwrap_or(true))
                    .map(|item| {
                        let id_str = match item.id {
                            serde_json::Value::String(s) => s,
                            serde_json::Value::Number(n) => n.to_string(),
                            _ => "1".into(),
                        };
                        let excerpt = if item.content.chars().count() > 180 {
                            let truncated: String = item.content.chars().take(180).collect();
                            format!("{}...", truncated.replace('\n', " "))
                        } else {
                            item.content.clone()
                        };

                        NewsArticle {
                            id: id_str,
                            title: item.title,
                            excerpt,
                            content: item.content,
                            category: "Объявления".into(),
                            date: item.created_at.unwrap_or_else(|| "2026-11-04T00:00:00.000Z".into()),
                            image: item.image.unwrap_or_else(|| "worlds/forest-river.webp".into()),
                            pinned: Some(true),
                        }
                    })
                    .collect();
            }
        }
    }

    vec![NewsArticle {
        id: "1".into(),
        title: "Heart Network обновлён!".into(),
        excerpt: "Защищенное HTTPS-подключение активно.".into(),
        content: "Синхронизация модов и Heart Identity работает в штатном режиме.".into(),
        category: "Объявления".into(),
        date: "2026-11-04T00:00:00.000Z".into(),
        image: "worlds/forest-river.webp".into(),
        pinned: Some(true),
    }]
}

pub async fn get_modpack_info(game_dir: &Path) -> InstallationInfo {
    let latest_version = "1.21.11-fabric.0.19.5+6fe252b2".to_string();
    let mods_dir = game_dir.join("mods");
    let mut installed_mods = Vec::new();

    if mods_dir.exists() {
        if let Ok(entries) = fs::read_dir(&mods_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".jar") {
                        installed_mods.push(format!("{} — установлено", name));
                    }
                }
            }
        }
    }

    let is_installed = game_dir
        .join("versions")
        .join("1.21.11")
        .join("1.21.11.jar")
        .exists()
        && mods_dir.join("heart-identity-fabric.jar").exists();

    InstallationInfo {
        installed_version: if is_installed {
            Some(latest_version.clone())
        } else {
            None
        },
        latest_version,
        installed: is_installed,
        last_verified: Some("11.11.2026, 21:51:24".into()),
        update_size: "актуальная сборка".into(),
        minecraft_version: "1.21.11".into(),
        fabric_loader_version: "0.19.5".into(),
        java_major_version: 21,
        changes: ModpackChanges {
            added: installed_mods,
            updated: vec!["Проверка новых релизов модов и ресурс-паков".into()],
            removed: vec!["Серверные утилиты исключены из клиента".into()],
            configurations: vec![
                "Minecraft Java 1.21.11".into(),
                "Fabric Loader 0.19.5".into(),
                "Клиентский профиль".into(),
            ],
        },
    }
}

async fn resolve_modrinth_file(
    client: &reqwest::Client,
    slug_or_id: &str,
    version_id: Option<&str>,
) -> Result<(String, String, Option<u64>, Option<String>), String> {
    if let Some(vid) = version_id {
        if vid != "local" {
            let ver_url = format!("https://api.modrinth.com/v2/version/{}", vid);
            for attempt in 1..=2u64 {
                if let Ok(resp) = client.get(&ver_url).send().await {
                    if resp.status().is_success() {
                        if let Ok(val) = resp.json::<serde_json::Value>().await {
                            if let Some(files) = val["files"].as_array() {
                                let f_opt = files
                                    .iter()
                                    .find(|f| f["primary"].as_bool().unwrap_or(false))
                                    .or_else(|| files.first());
                                if let Some(f) = f_opt {
                                    if let (Some(u), Some(fn_str)) =
                                        (f["url"].as_str(), f["filename"].as_str())
                                    {
                                        return Ok((
                                            u.to_string(),
                                            fn_str.to_string(),
                                            f["size"].as_u64(),
                                            f["hashes"]["sha1"].as_str().map(String::from),
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
            }
        }
    }

    let q_url = format!(
        "https://api.modrinth.com/v2/project/{}/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%22{}%22%5D",
        slug_or_id, MINECRAFT_VERSION
    );

    let mut last_err = format!("Не удалось найти версию {} на Modrinth", slug_or_id);
    for attempt in 1..=3u64 {
        match client.get(&q_url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_err = format!("Modrinth HTTP {} для {}", resp.status(), slug_or_id);
                } else {
                    match resp.json::<Vec<serde_json::Value>>().await {
                        Ok(vers) => {
                            let cand = vers
                                .iter()
                                .find(|v| v["version_type"].as_str() == Some("release"))
                                .or_else(|| vers.first());
                            if let Some(v) = cand {
                                if let Some(files) = v["files"].as_array() {
                                    let f_opt = files
                                        .iter()
                                        .find(|f| f["primary"].as_bool().unwrap_or(false))
                                        .or_else(|| files.first());
                                    if let Some(f) = f_opt {
                                        if let (Some(u), Some(fn_str)) =
                                            (f["url"].as_str(), f["filename"].as_str())
                                        {
                                            return Ok((
                                                u.to_string(),
                                                fn_str.to_string(),
                                                f["size"].as_u64(),
                                                f["hashes"]["sha1"].as_str().map(String::from),
                                            ));
                                        }
                                    }
                                }
                            }
                            return Err(format!(
                                "Для {} не найдена совместимая Fabric-версия {}",
                                slug_or_id, MINECRAFT_VERSION
                            ));
                        }
                        Err(e) => {
                            last_err = format!(
                                "Ошибка чтения ответа Modrinth для {}: {}",
                                slug_or_id,
                                format_error_chain(&e)
                            );
                        }
                    }
                }
            }
            Err(e) => {
                last_err = format!(
                    "Ошибка запроса Modrinth для {}: {}",
                    slug_or_id,
                    format_error_chain(&e)
                );
            }
        }
        if attempt < 3 {
            tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
        }
    }

    Err(last_err)
}

pub async fn sync_heartbridge_modpack(
    game_dir: &Path,
    on_log: impl Fn(&str),
    on_progress: impl Fn(u32, &str) + Send + Sync + 'static,
) -> Result<usize, String> {
    let client = get_http_client();
    let mods_dir = game_dir.join("mods");
    let rp_dir = game_dir.join("resourcepacks");
    let cache_dir = game_dir.join("heart-launcher");
    let _ = fs::create_dir_all(&mods_dir);
    let _ = fs::create_dir_all(&rp_dir);
    let _ = fs::create_dir_all(&cache_dir);

    ensure_embedded_client_mods(game_dir);

    let cache_file = cache_dir.join("tauri-modpack-cache.json");
    let mut cache: ModpackResolutionCache = fs::read_to_string(&cache_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut cache_dirty = false;

    let mut download_tasks: Vec<DownloadTask> = Vec::new();
    let mut queued_paths: HashSet<String> = HashSet::new();
    let mut manifest_slugs: HashSet<String> = HashSet::new();

    // Точный список всех JAR-файлов (в нижнем регистре), которые должны остаться в mods/
    let mut expected_mod_files: HashSet<String> = HashSet::new();
    expected_mod_files.insert("heart-overlay-1.0.0.jar".to_string());
    expected_mod_files.insert("heart-identity-fabric.jar".to_string());

    let mut push_task = |task: DownloadTask| {
        let key = task.dest_path.to_string_lossy().to_lowercase();
        if queued_paths.insert(key) {
            download_tasks.push(task);
        }
    };

    // 1. Получаем манифест сборки и ресурс-паки от сервера HeartBridge
    let manifest_url = format!("{}/v1/modpack", HEART_BRIDGE_BASE);
    let mut manifest_opt: Option<HeartBridgeManifest> = None;
    let mut manifest_err: Option<String> = None;

    for attempt in 1..=3u64 {
        match client.get(&manifest_url).send().await {
            Ok(res) => {
                if !res.status().is_success() {
                    manifest_err = Some(format!(
                        "HeartBridge вернул HTTP {} при получении сборки",
                        res.status()
                    ));
                } else {
                    match res.text().await {
                        Ok(body) => match serde_json::from_str::<HeartBridgeManifest>(&body) {
                            Ok(manifest) => {
                                manifest_opt = Some(manifest);
                                manifest_err = None;
                                break;
                            }
                            Err(e) => {
                                manifest_err = Some(format!(
                                    "Некорректный JSON манифеста HeartBridge: {}",
                                    e
                                ));
                                break;
                            }
                        },
                        Err(e) => {
                            manifest_err = Some(format!(
                                "Ошибка чтения манифеста HeartBridge: {}",
                                format_error_chain(&e)
                            ));
                        }
                    }
                }
            }
            Err(e) => {
                manifest_err = Some(format!(
                    "Сервер HeartBridge недоступен: {}",
                    format_error_chain(&e)
                ));
            }
        }
        if attempt < 3 {
            tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
        }
    }

    if let Some(err_msg) = manifest_err {
        on_log(&format!("ВНИМАНИЕ: {}", err_msg));
        if cache.mods.is_empty() {
            return Err(err_msg);
        }
    }

    let mut current_rp_files: HashSet<String> = HashSet::new();
    let has_authoritative_manifest = manifest_opt.is_some();

    if let Some(manifest) = manifest_opt {
        if cache.revision != manifest.revision {
            cache.revision = manifest.revision;
            // При смене ревизии сбрасываем незакреплённые `:latest` кэши
            cache.mods.retain(|k, _| !k.ends_with(":latest"));
            cache_dirty = true;
        }

        // Моды из манифеста HeartBridge
        for m in manifest.mods {
            let slug_lower = m.slug.to_lowercase();
            manifest_slugs.insert(slug_lower.clone());

            let filename_lower = m.filename.as_deref().unwrap_or("").to_lowercase();
            if slug_lower.contains("heart-overlay")
                || slug_lower.contains("heart_overlay")
                || filename_lower.contains("heart-overlay")
            {
                continue;
            }

            if let Some(url_str) = &m.download_url {
                let filename = m.filename.clone().unwrap_or_else(|| format!("{}.jar", m.slug));
                expected_mod_files.insert(filename.to_lowercase());
                let full_url = if url_str.starts_with("http") {
                    url_str.clone()
                } else {
                    format!("{}/{}", HEART_BRIDGE_BASE, url_str.trim_start_matches('/'))
                };

                push_task(DownloadTask {
                    url: full_url,
                    dest_path: mods_dir.join(&filename),
                    size: m.file_size,
                    sha1: m.sha1.clone(),
                    label: format!("Мод: {}", filename),
                });
            } else {
                let cache_key = format!("{}:{}", m.slug, m.version_id.as_deref().unwrap_or("latest"));
                if let Some(cached) = cache.mods.get(&cache_key) {
                    expected_mod_files.insert(cached.filename.to_lowercase());
                    let dest = mods_dir.join(&cached.filename);
                    if !is_valid_existing_file(&dest, cached.size, cached.sha1.as_deref()) {
                        push_task(DownloadTask {
                            url: cached.url.clone(),
                            dest_path: dest,
                            size: cached.size,
                            sha1: cached.sha1.clone(),
                            label: format!("Мод: {}", cached.filename),
                        });
                    }
                } else {
                    let (url, filename, size, sha1) =
                        resolve_modrinth_file(&client, &m.slug, m.version_id.as_deref()).await?;
                    expected_mod_files.insert(filename.to_lowercase());
                    cache.mods.insert(
                        cache_key,
                        CachedModResolution {
                            url: url.clone(),
                            filename: filename.clone(),
                            size,
                            sha1: sha1.clone(),
                        },
                    );
                    cache_dirty = true;
                    push_task(DownloadTask {
                        url,
                        dest_path: mods_dir.join(&filename),
                        size,
                        sha1,
                        label: format!("Мод: {}", filename),
                    });
                }
            }
        }

        // Ресурс-паки
        if let Some(rps) = manifest.resource_packs {
            for rp in rps {
                current_rp_files.insert(rp.filename.clone());
                let full_url = if rp.download_url.starts_with("http") {
                    rp.download_url.clone()
                } else {
                    format!("{}/{}", HEART_BRIDGE_BASE, rp.download_url.trim_start_matches('/'))
                };

                push_task(DownloadTask {
                    url: full_url,
                    dest_path: rp_dir.join(&rp.filename),
                    size: rp.file_size,
                    sha1: rp.sha1.clone(),
                    label: format!("Ресурс-пак: {}", rp.title.unwrap_or(rp.slug)),
                });
            }
        }
    }

    // 2. Базовые клиентские библиотеки — разрешаем точные имена файлов, чтобы очистка не удалила нужные
    for (slug, direct_url, default_filename) in CORE_CLIENT_MODS {
        if manifest_slugs.contains(*slug) {
            continue;
        }

        if *slug == "fabric-api" {
            expected_mod_files.insert(default_filename.to_lowercase());
            let dest = mods_dir.join(default_filename);
            if !is_valid_existing_file(&dest, Some(2427670), None) {
                on_log("Загрузка библиотеки Fabric API 1.21.11...");
                push_task(DownloadTask {
                    url: direct_url.to_string(),
                    dest_path: dest,
                    size: Some(2427670),
                    sha1: None,
                    label: format!("Мод: {}", default_filename),
                });
            }
        } else if direct_url.starts_with("https://cdn.modrinth.com") {
            expected_mod_files.insert(default_filename.to_lowercase());
            push_task(DownloadTask {
                url: direct_url.to_string(),
                dest_path: mods_dir.join(default_filename),
                size: None,
                sha1: None,
                label: format!("Мод: {}", default_filename),
            });
        } else {
            let core_key = format!("core:{}", slug);
            if let Some(cached) = cache.mods.get(&core_key) {
                expected_mod_files.insert(cached.filename.to_lowercase());
                let dest = mods_dir.join(&cached.filename);
                if !is_valid_existing_file(&dest, cached.size, cached.sha1.as_deref()) {
                    push_task(DownloadTask {
                        url: cached.url.clone(),
                        dest_path: dest,
                        size: cached.size,
                        sha1: cached.sha1.clone(),
                        label: format!("Мод: {}", cached.filename),
                    });
                }
            } else if let Ok((url, filename, size, sha1)) =
                resolve_modrinth_file(&client, slug, None).await
            {
                expected_mod_files.insert(filename.to_lowercase());
                cache.mods.insert(
                    core_key,
                    CachedModResolution {
                        url: url.clone(),
                        filename: filename.clone(),
                        size,
                        sha1: sha1.clone(),
                    },
                );
                cache_dirty = true;
                push_task(DownloadTask {
                    url,
                    dest_path: mods_dir.join(&filename),
                    size,
                    sha1,
                    label: format!("Мод: {}", filename),
                });
            } else if let Ok(entries) = fs::read_dir(&mods_dir) {
                // Фоллбек на случай офлайна Modrinth: оставляем существующий JAR этой библиотеки
                for entry in entries.flatten() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    let lower = fname.to_lowercase();
                    if lower.contains(slug) && lower.ends_with(".jar") {
                        expected_mod_files.insert(lower);
                    }
                }
            }
        }
    }

    if cache_dirty {
        if let Ok(json) = serde_json::to_string_pretty(&cache) {
            let _ = fs::write(&cache_file, json);
        }
    }

    // 3. Companion
    let companion_info_url = format!("{}/v1/companion/info", HEART_BRIDGE_BASE);
    if let Ok(res) = client.get(&companion_info_url).send().await {
        if res.status().is_success() {
            if let Ok(info) = res.json::<serde_json::Value>().await {
                if let (Some(sha256), Some(dl_url)) =
                    (info["sha256"].as_str(), info["downloadUrl"].as_str())
                {
                    let target_jar = mods_dir.join("heart-identity-fabric.jar");
                    if !verify_file_sha256(&target_jar, sha256) {
                        on_log("Обновление Heart Identity Companion...");
                        let download_url =
                            format!("{}/{}", HEART_BRIDGE_BASE, dl_url.trim_start_matches('/'));
                        let _ = download_file_stream(&download_url, &target_jar, |_, _| {}).await;
                    }
                }
            }
        }
    }

    ensure_embedded_client_mods(game_dir);

    // 4. Загружаем недостающие/обновлённые файлы
    let downloaded_count = download_pool(download_tasks, 8, on_progress).await?;

    // 5. Удаляем лишние моды и устаревшие управляемые ресурс-паки, если получен свежий манифест
    if has_authoritative_manifest {
        if let Ok(entries) = fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let fname = entry.file_name().to_string_lossy().to_string();
                let lower = fname.to_lowercase();
                if (lower.ends_with(".jar") || lower.ends_with(".jar.part"))
                    && !expected_mod_files.contains(&lower)
                {
                    if fs::remove_file(&path).is_ok() {
                        on_log(&format!("Удалён лишний мод: {}", fname));
                    }
                }
            }
        }

        // Очистка только тех ресурс-паков, которыми ранее управлял лаунчер
        let managed_rp_file = cache_dir.join("tauri-managed-resourcepacks.json");
        let previous_rps: Vec<String> = fs::read_to_string(&managed_rp_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        for old_rp in previous_rps {
            if !current_rp_files.contains(&old_rp) {
                let old_path = rp_dir.join(&old_rp);
                if old_path.exists() && fs::remove_file(&old_path).is_ok() {
                    on_log(&format!("Удалён устаревший ресурс-пак: {}", old_rp));
                }
            }
        }

        let current_rp_vec: Vec<String> = current_rp_files.into_iter().collect();
        if let Ok(json) = serde_json::to_string_pretty(&current_rp_vec) {
            let _ = fs::write(&managed_rp_file, json);
        }
    }

    // 6. Конфиги
    let configs_url = format!("{}/v1/configs/manifest", HEART_BRIDGE_BASE);
    if let Ok(res) = client.get(&configs_url).send().await {
        if res.status().is_success() {
            if let Ok(manifest) = res.json::<serde_json::Value>().await {
                if let Some(files) = manifest["files"].as_array() {
                    for entry in files {
                        if let (Some(path_str), Some(sha256), Some(dl_url)) = (
                            entry["path"].as_str(),
                            entry["sha256"].as_str(),
                            entry["downloadUrl"].as_str(),
                        ) {
                            let clean_path =
                                path_str.trim_start_matches("config/").trim_start_matches('/');
                            let target_path = game_dir.join("config").join(clean_path);

                            if !verify_file_sha256(&target_path, sha256) {
                                if let Some(p) = target_path.parent() {
                                    let _ = fs::create_dir_all(p);
                                }
                                let download_url = format!(
                                    "{}/{}",
                                    HEART_BRIDGE_BASE,
                                    dl_url.trim_start_matches('/')
                                );
                                let _ = download_file_stream(&download_url, &target_path, |_, _| {})
                                    .await;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(downloaded_count)
}