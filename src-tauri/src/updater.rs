use crate::downloader::{format_error_chain, get_http_client};
use crate::types::{AppUpdateProgress, AppUpdateStatus};
use futures_util::StreamExt;
use serde::Deserialize;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x00000008;

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/barsik-ru/Heart_launcher/releases/latest";

#[derive(Debug, Clone, PartialEq, Eq)]
enum AssetKind {
    PortableExe,
    SetupExe,
    ZipArchive,
    LinuxBinary,
}

#[derive(Debug, Clone)]
struct ReleaseAsset {
    name: String,
    download_url: String,
    size: u64,
    kind: AssetKind,
}

struct UpdaterState {
    status: AppUpdateStatus,
    asset: Option<ReleaseAsset>,
    downloaded_path: Option<PathBuf>,
}

static UPDATER_STATE: OnceLock<Mutex<UpdaterState>> = OnceLock::new();

fn state_lock() -> &'static Mutex<UpdaterState> {
    UPDATER_STATE.get_or_init(|| {
        Mutex::new(UpdaterState {
            status: AppUpdateStatus {
                state: "idle".into(),
                current_version: env!("CARGO_PKG_VERSION").into(),
                available_version: None,
                progress: None,
                error: None,
                demo: false,
            },
            asset: None,
            downloaded_path: None,
        })
    })
}

fn emit_state(app: &AppHandle, status: &AppUpdateStatus) {
    let _ = app.emit("event:updater:state", status);
}

fn set_and_emit_status(app: &AppHandle, mutator: impl FnOnce(&mut AppUpdateStatus)) -> AppUpdateStatus {
    let mut guard = state_lock().lock().unwrap();
    mutator(&mut guard.status);
    let snapshot = guard.status.clone();
    drop(guard);
    emit_state(app, &snapshot);
    snapshot
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let clean = raw.trim().trim_start_matches(['v', 'V']);
    let main = clean.split(['-', '+']).next().unwrap_or(clean);
    let mut parts = main.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn pick_release_asset(assets: &[GitHubAsset]) -> Option<ReleaseAsset> {
    #[cfg(windows)]
    {
        // 1. Сначала ищем прямой переносимый .exe (не setup/uninstaller)
        if let Some(a) = assets.iter().find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".exe") && !n.contains("setup") && !n.contains("installer") && !n.contains("unins")
        }) {
            return Some(ReleaseAsset {
                name: a.name.clone(),
                download_url: a.browser_download_url.clone(),
                size: a.size,
                kind: AssetKind::PortableExe,
            });
        }

        // 2. Затем .zip архив для Windows
        if let Some(a) = assets.iter().find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".zip") && !n.contains("blockmap")
        }) {
            return Some(ReleaseAsset {
                name: a.name.clone(),
                download_url: a.browser_download_url.clone(),
                size: a.size,
                kind: AssetKind::ZipArchive,
            });
        }

        // 3. Затем NSIS-установщик (*setup*.exe)
        if let Some(a) = assets.iter().find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".exe") && !n.contains("unins")
        }) {
            return Some(ReleaseAsset {
                name: a.name.clone(),
                download_url: a.browser_download_url.clone(),
                size: a.size,
                kind: AssetKind::SetupExe,
            });
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(a) = assets.iter().find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".appimage")
        }) {
            return Some(ReleaseAsset {
                name: a.name.clone(),
                download_url: a.browser_download_url.clone(),
                size: a.size,
                kind: AssetKind::LinuxBinary,
            });
        }
    }

    None
}

fn is_dir_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".heart_write_probe_{}", std::process::id()));
    match File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn encode_powershell_utf16le(script: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bytes = Vec::with_capacity(script.len() * 2);
    for unit in script.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(windows)]
fn ps_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

#[tauri::command]
pub fn updater_get_status() -> AppUpdateStatus {
    state_lock().lock().unwrap().status.clone()
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<AppUpdateStatus, String> {
    {
        let guard = state_lock().lock().unwrap();
        if matches!(
            guard.status.state.as_str(),
            "downloading" | "downloaded" | "installing"
        ) {
            return Ok(guard.status.clone());
        }
    }

    set_and_emit_status(&app, |s| {
        s.state = "checking".into();
        s.error = None;
    });

    let client = get_http_client();
    let resp = match client
        .get(GITHUB_LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let status = set_and_emit_status(&app, |s| {
                s.state = "error".into();
                s.error = Some(format!(
                    "Не удалось проверить обновления: {}",
                    format_error_chain(&e)
                ));
            });
            return Ok(status);
        }
    };

    if !resp.status().is_success() {
        let code = resp.status();
        let status = set_and_emit_status(&app, |s| {
            s.state = if code.as_u16() == 404 {
                "not-available".into()
            } else {
                "error".into()
            };
            s.error = if code.as_u16() == 404 {
                None
            } else {
                Some(format!("GitHub API вернул HTTP {}", code))
            };
        });
        return Ok(status);
    }

    let release: GitHubRelease = match resp.json().await {
        Ok(r) => r,
        Err(e) => {
            let status = set_and_emit_status(&app, |s| {
                s.state = "error".into();
                s.error = Some(format!("Ошибка чтения метаданных релиза: {}", e));
            });
            return Ok(status);
        }
    };

    let current_ver_str = env!("CARGO_PKG_VERSION");
    let remote_ver_str = release.tag_name.trim().trim_start_matches(['v', 'V']).to_string();

    let is_newer = match (parse_semver(&remote_ver_str), parse_semver(current_ver_str)) {
        (Some(remote), Some(current)) => remote > current,
        _ => false,
    };

    if !is_newer {
        let mut guard = state_lock().lock().unwrap();
        guard.asset = None;
        guard.downloaded_path = None;
        guard.status.state = "not-available".into();
        guard.status.available_version = None;
        guard.status.progress = None;
        guard.status.error = None;
        let snapshot = guard.status.clone();
        drop(guard);
        emit_state(&app, &snapshot);
        return Ok(snapshot);
    }

    let Some(asset) = pick_release_asset(&release.assets) else {
        let status = set_and_emit_status(&app, |s| {
            s.state = "not-available".into();
            s.available_version = None;
            s.error = Some("В релизе нет файла обновления для вашей ОС.".into());
        });
        return Ok(status);
    };

    let mut guard = state_lock().lock().unwrap();
    guard.asset = Some(asset);
    guard.downloaded_path = None;
    guard.status.state = "available".into();
    guard.status.available_version = Some(remote_ver_str);
    guard.status.progress = None;
    guard.status.error = None;
    let snapshot = guard.status.clone();
    drop(guard);
    emit_state(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn updater_download(app: AppHandle) -> Result<(), String> {
    let asset = {
        let guard = state_lock().lock().unwrap();
        if guard.status.state == "downloading" {
            return Ok(());
        }
        if guard.status.state == "downloaded" && guard.downloaded_path.as_ref().is_some_and(|p| p.exists()) {
            return Ok(());
        }
        guard
            .asset
            .clone()
            .ok_or_else(|| "Нет доступного обновления для загрузки.".to_string())?
    };

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Не удалось определить путь к текущему лаунчеру: {}", e))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Не удалось определить папку текущего лаунчера.".to_string())?;

    let target_dir = if is_dir_writable(exe_dir) {
        exe_dir.to_path_buf()
    } else {
        let fallback = std::env::temp_dir().join("heart-launcher-update");
        let _ = fs::create_dir_all(&fallback);
        fallback
    };

    let exe_stem = current_exe
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("HeartLauncher");

    let dest_path = match asset.kind {
        AssetKind::PortableExe => target_dir.join(format!("{}.update.exe", exe_stem)),
        AssetKind::SetupExe | AssetKind::ZipArchive | AssetKind::LinuxBinary => {
            target_dir.join(&asset.name)
        }
    };
    let part_path = PathBuf::from(format!("{}.part", dest_path.display()));
    let _ = fs::remove_file(&part_path);

    set_and_emit_status(&app, |s| {
        s.state = "downloading".into();
        s.progress = Some(0);
        s.error = None;
    });

    let client = get_http_client();
    let res = match client
        .get(&asset.download_url)
        .timeout(Duration::from_secs(120))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let msg = format!("Ошибка загрузки обновления: HTTP {}", r.status());
            set_and_emit_status(&app, |s| {
                s.state = "error".into();
                s.error = Some(msg.clone());
            });
            return Err(msg);
        }
        Err(e) => {
            let msg = format!("Ошибка сети при загрузке обновления: {}", format_error_chain(&e));
            set_and_emit_status(&app, |s| {
                s.state = "error".into();
                s.error = Some(msg.clone());
            });
            return Err(msg);
        }
    };

    let total_bytes = res.content_length().unwrap_or(asset.size);
    let mut file = File::create(&part_path).map_err(|e| {
        let msg = format!("Не удалось создать файл обновления: {}", e);
        set_and_emit_status(&app, |s| {
            s.state = "error".into();
            s.error = Some(msg.clone());
        });
        msg
    })?;

    let mut stream = res.bytes_stream();
    let mut transferred_bytes: u64 = 0;
    let mut last_emit = Instant::now();
    let mut bytes_since_emit: u64 = 0;

    while let Some(chunk_res) = stream.next().await {
        let chunk = match chunk_res {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&part_path);
                let msg = format!("Сбой загрузки обновления: {}", format_error_chain(&e));
                set_and_emit_status(&app, |s| {
                    s.state = "error".into();
                    s.error = Some(msg.clone());
                });
                return Err(msg);
            }
        };

        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&part_path);
            let msg = format!("Ошибка записи файла обновления: {}", e);
            set_and_emit_status(&app, |s| {
                s.state = "error".into();
                s.error = Some(msg.clone());
            });
            return Err(msg);
        }

        let len = chunk.len() as u64;
        transferred_bytes += len;
        bytes_since_emit += len;

        let elapsed = last_emit.elapsed().as_secs_f64();
        if elapsed >= 0.15 {
            let percent = if total_bytes > 0 {
                ((transferred_bytes as f64 / total_bytes as f64) * 100.0).min(99.0) as u32
            } else {
                0
            };
            let bps = (bytes_since_emit as f64 / elapsed) as u64;
            last_emit = Instant::now();
            bytes_since_emit = 0;

            let _ = app.emit(
                "event:updater:progress",
                AppUpdateProgress {
                    percent,
                    transferred_bytes,
                    total_bytes,
                    bytes_per_second: bps,
                    timestamp: now_millis(),
                },
            );
            set_and_emit_status(&app, |s| {
                s.state = "downloading".into();
                s.progress = Some(percent);
            });
        }
    }

    drop(file);

    if asset.size > 0 && transferred_bytes != asset.size {
        let _ = fs::remove_file(&part_path);
        let msg = format!(
            "Размер файла обновления не совпал ({} из {} байт).",
            transferred_bytes, asset.size
        );
        set_and_emit_status(&app, |s| {
            s.state = "error".into();
            s.error = Some(msg.clone());
        });
        return Err(msg);
    }

    let _ = fs::remove_file(&dest_path);
    if let Err(e) = fs::rename(&part_path, &dest_path) {
        let _ = fs::remove_file(&part_path);
        let msg = format!("Не удалось сохранить файл обновления: {}", e);
        set_and_emit_status(&app, |s| {
            s.state = "error".into();
            s.error = Some(msg.clone());
        });
        return Err(msg);
    }

    let _ = app.emit(
        "event:updater:progress",
        AppUpdateProgress {
            percent: 100,
            transferred_bytes,
            total_bytes: transferred_bytes,
            bytes_per_second: 0,
            timestamp: now_millis(),
        },
    );

    let mut guard = state_lock().lock().unwrap();
    guard.downloaded_path = Some(dest_path);
    guard.status.state = "downloaded".into();
    guard.status.progress = Some(100);
    guard.status.error = None;
    let snapshot = guard.status.clone();
    drop(guard);
    emit_state(&app, &snapshot);

    Ok(())
}

#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    let (asset, downloaded_path) = {
        let guard = state_lock().lock().unwrap();
        (guard.asset.clone(), guard.downloaded_path.clone())
    };

    let asset = asset.ok_or_else(|| "Метаданные обновления не найдены.".to_string())?;
    let downloaded_path =
        downloaded_path.ok_or_else(|| "Файл обновления ещё не скачан.".to_string())?;

    if !downloaded_path.exists() {
        return Err("Файл обновления не найден на диске.".into());
    }

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Не удалось определить путь к текущему лаунчеру: {}", e))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Не удалось определить папку текущего лаунчера.".to_string())?;

    set_and_emit_status(&app, |s| {
        s.state = "installing".into();
        s.error = None;
    });

    #[cfg(windows)]
    {
        let pid = std::process::id();
        let cur_q = ps_quote(&current_exe);
        let dir_q = ps_quote(exe_dir);
        let dl_q = ps_quote(&downloaded_path);

        let script = match asset.kind {
            AssetKind::PortableExe => format!(
                r#"
$pidToWait = {pid}
$curExe = {cur_q}
$exeDir = {dir_q}
$newExe = {dl_q}
try {{ Wait-Process -Id $pidToWait -Timeout 20 -ErrorAction SilentlyContinue }} catch {{}}
Start-Sleep -Milliseconds 350
for ($i = 0; $i -lt 15; $i++) {{
  try {{
    Move-Item -LiteralPath $newExe -Destination $curExe -Force
    break
  }} catch {{
    Start-Sleep -Milliseconds 300
  }}
}}
if (Test-Path -LiteralPath $curExe) {{
  Start-Process -FilePath $curExe -WorkingDirectory $exeDir
}}
"#
            ),
            AssetKind::SetupExe => format!(
                r#"
$pidToWait = {pid}
$curExe = {cur_q}
$exeDir = {dir_q}
$setupExe = {dl_q}
try {{ Wait-Process -Id $pidToWait -Timeout 20 -ErrorAction SilentlyContinue }} catch {{}}
Start-Sleep -Milliseconds 350
Start-Process -FilePath $setupExe -ArgumentList ('/S /D=' + $exeDir) -Wait
Remove-Item -LiteralPath $setupExe -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $curExe) {{
  Start-Process -FilePath $curExe -WorkingDirectory $exeDir
}}
"#
            ),
            AssetKind::ZipArchive => {
                let extract_dir = std::env::temp_dir().join(format!("heart_update_extract_{}", pid));
                let ext_q = ps_quote(&extract_dir);
                format!(
                    r#"
$pidToWait = {pid}
$curExe = {cur_q}
$exeDir = {dir_q}
$zipPath = {dl_q}
$extractDir = {ext_q}
try {{ Wait-Process -Id $pidToWait -Timeout 20 -ErrorAction SilentlyContinue }} catch {{}}
Start-Sleep -Milliseconds 350
if (Test-Path -LiteralPath $extractDir) {{ Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }}
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
$exeCandidate = Get-ChildItem -LiteralPath $extractDir -Filter *.exe -Recurse | Select-Object -First 1
if ($exeCandidate) {{
  for ($i = 0; $i -lt 15; $i++) {{
    try {{
      Copy-Item -LiteralPath $exeCandidate.FullName -Destination $curExe -Force
      break
    }} catch {{
      Start-Sleep -Milliseconds 300
    }}
  }}
}}
Copy-Item -Path (Join-Path $extractDir '*') -Destination $exeDir -Recurse -Force -Exclude '*.exe' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $curExe) {{
  Start-Process -FilePath $curExe -WorkingDirectory $exeDir
}}
"#
                )
            }
            AssetKind::LinuxBinary => String::new(),
        };

        let encoded = encode_powershell_utf16le(&script);
        let needs_elevation = !is_dir_writable(exe_dir);

        if needs_elevation {
            let outer_ps = format!(
                "Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{}')",
                encoded
            );
            Command::new("powershell.exe")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &outer_ps])
                .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Не удалось запустить установщик обновления: {}", e))?;
        } else {
            Command::new("powershell.exe")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", &encoded])
                .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Не удалось запустить скрипт обновления: {}", e))?;
        }

        app.exit(0);
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&downloaded_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&downloaded_path, perms);
        }
        if fs::rename(&downloaded_path, &current_exe).is_err() {
            fs::copy(&downloaded_path, &current_exe)
                .map_err(|e| format!("Не удалось заменить файл лаунчера: {}", e))?;
            let _ = fs::remove_file(&downloaded_path);
        }
        let _ = Command::new(&current_exe)
            .current_dir(exe_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        app.exit(0);
        Ok(())
    }
}