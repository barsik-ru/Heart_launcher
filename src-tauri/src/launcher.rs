use crate::auth::AuthService;
use crate::commands::get_native_screen_resolution;
use crate::downloader::{
    download_pool, extract_zip, fetch_text_with_retry, get_http_client, DownloadTask,
};
use crate::heartbridge::{sync_heartbridge_modpack, HEART_BRIDGE_BASE};
use crate::java::{ensure_java_21, prefer_javaw_path};
use crate::offline_uuid::get_offline_player_uuid;
use crate::servers_dat::ensure_server_entry;
use crate::types::LauncherSettings;
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const MINECRAFT_VERSION: &str = "1.21.11";
pub const FABRIC_LOADER_VERSION: &str = "0.19.5";

#[derive(Deserialize)]
#[allow(dead_code)]
struct VersionManifest {
    versions: Vec<ManifestEntry>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct ManifestEntry {
    id: String,
    url: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangVersionDetails {
    downloads: MojangDownloads,
    libraries: Vec<MojangLibrary>,
    #[serde(rename = "assetIndex")]
    asset_index: Option<MojangAssetIndex>,
    arguments: Option<MojangArguments>,
    #[serde(rename = "minecraftArguments")]
    minecraft_arguments: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangArguments {
    game: Option<Vec<serde_json::Value>>,
    jvm: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangDownloads {
    client: MojangDownloadFile,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangDownloadFile {
    url: String,
    size: Option<u64>,
    sha1: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangAssetIndex {
    id: String,
    url: String,
    sha1: Option<String>,
    size: Option<u64>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangLibrary {
    name: String,
    downloads: Option<MojangLibraryDownloads>,
    rules: Option<Vec<MojangRule>>,
    natives: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangLibraryDownloads {
    artifact: Option<MojangArtifact>,
    classifiers: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangArtifact {
    path: String,
    url: String,
    size: Option<u64>,
    sha1: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangRule {
    action: String,
    os: Option<MojangRuleOs>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MojangRuleOs {
    name: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct FabricProfile {
    #[serde(rename = "mainClass")]
    main_class: String,
    libraries: Vec<FabricLibrary>,
    arguments: Option<MojangArguments>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct FabricLibrary {
    name: String,
    url: Option<String>,
}

fn is_rule_allowed(rules: Option<&[MojangRule]>) -> bool {
    let rules = match rules {
        Some(r) if !r.is_empty() => r,
        _ => return true,
    };
    let current_os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };
    let mut allowed = false;
    for rule in rules {
        let mut match_os = true;
        if let Some(os) = &rule.os {
            if let Some(name) = &os.name {
                if name != current_os {
                    match_os = false;
                }
            }
        }
        if match_os {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

fn maven_to_path(name: &str, base_url: Option<&str>) -> (PathBuf, String) {
    let (coord, ext) = name.split_once('@').unwrap_or((name, "jar"));
    let parts: Vec<&str> = coord.split(':').collect();
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let filename = match parts.get(3) {
        Some(classifier) if !classifier.is_empty() => {
            format!("{}-{}-{}.{}", artifact, version, classifier, ext)
        }
        _ => format!("{}-{}.{}", artifact, version, ext),
    };
    let relative = PathBuf::from(&group).join(artifact).join(version).join(&filename);

    let base = base_url.unwrap_or("https://libraries.minecraft.net/");
    let clean_base = base.trim_end_matches('/');
    let url = format!("{}/{}/{}/{}/{}", clean_base, group, artifact, version, filename);
    (relative, url)
}

fn has_extracted_natives(natives_dir: &Path) -> bool {
    if let Ok(entries) = fs::read_dir(natives_dir) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("dll")
                    || ext.eq_ignore_ascii_case("so")
                    || ext.eq_ignore_ascii_case("dylib")
                {
                    return true;
                }
            }
        }
    }
    false
}

fn ensure_options_txt_fullscreen_disabled(game_dir: &Path) {
    let options_path = game_dir.join("options.txt");
    if options_path.exists() {
        if let Ok(raw) = fs::read_to_string(&options_path) {
            if raw.contains("fullscreen:true") {
                let updated = raw.replace("fullscreen:true", "fullscreen:false");
                let _ = fs::write(&options_path, updated);
            } else if !raw.contains("fullscreen:") {
                let updated = format!("{}\nfullscreen:false\n", raw.trim_end());
                let _ = fs::write(&options_path, updated);
            }
        }
    } else {
        let _ = fs::write(&options_path, "fullscreen:false\n");
    }
}

pub async fn prepare_environment(
    app: &AppHandle,
    game_dir: &Path,
    emit_download_progress: bool,
    on_log: impl Fn(&str),
) -> Result<(PathBuf, String, String), String> {
    if emit_download_progress {
        let _ = app.emit("event:launcher:progress", 5);
    }

    let version_json_dir = game_dir.join("versions").join(MINECRAFT_VERSION);
    let version_json_file = version_json_dir.join(format!("{}.json", MINECRAFT_VERSION));
    let fabric_json_file = version_json_dir.join(format!("fabric-{}.json", FABRIC_LOADER_VERSION));

    let mojang_details: MojangVersionDetails = match version_json_file
        .exists()
        .then(|| fs::read_to_string(&version_json_file).ok())
        .flatten()
        .and_then(|content| serde_json::from_str::<MojangVersionDetails>(&content).ok())
    {
        Some(details) => details,
        None => {
            let _ = fs::remove_file(&version_json_file);
            on_log("Загрузка манифеста версий Mojang...");
            let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
            let manifest_text = fetch_text_with_retry(manifest_url, "Манифест Mojang").await?;
            let manifest: VersionManifest = serde_json::from_str(&manifest_text)
                .map_err(|e| format!("Ошибка разбора манифеста Mojang: {}", e))?;

            let version_entry = manifest
                .versions
                .into_iter()
                .find(|v| v.id == MINECRAFT_VERSION)
                .ok_or_else(|| format!("Версия {} не найдена", MINECRAFT_VERSION))?;

            let details_text =
                fetch_text_with_retry(&version_entry.url, "Профиль версии Minecraft").await?;
            let parsed: MojangVersionDetails = serde_json::from_str(&details_text)
                .map_err(|e| format!("Ошибка разбора профиля Minecraft: {}", e))?;

            let _ = fs::create_dir_all(&version_json_dir);
            let _ = fs::write(&version_json_file, &details_text);
            parsed
        }
    };

    let fabric_profile: FabricProfile = match fabric_json_file
        .exists()
        .then(|| fs::read_to_string(&fabric_json_file).ok())
        .flatten()
        .and_then(|content| serde_json::from_str::<FabricProfile>(&content).ok())
    {
        Some(profile) => profile,
        None => {
            let _ = fs::remove_file(&fabric_json_file);
            on_log("Загрузка профиля Fabric Loader...");
            let fabric_url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
                MINECRAFT_VERSION, FABRIC_LOADER_VERSION
            );
            let profile_text =
                fetch_text_with_retry(&fabric_url, "Профиль Fabric Loader").await?;
            let parsed: FabricProfile = serde_json::from_str(&profile_text)
                .map_err(|e| format!("Ошибка разбора профиля Fabric: {}", e))?;

            let _ = fs::create_dir_all(&version_json_dir);
            let _ = fs::write(&fabric_json_file, &profile_text);
            parsed
        }
    };

    let mut download_tasks: Vec<DownloadTask> = Vec::new();
    let mut native_jars: Vec<PathBuf> = Vec::new();

    let client_jar_path = version_json_dir.join(format!("{}.jar", MINECRAFT_VERSION));
    download_tasks.push(DownloadTask {
        url: mojang_details.downloads.client.url.clone(),
        dest_path: client_jar_path.clone(),
        size: mojang_details.downloads.client.size,
        sha1: mojang_details.downloads.client.sha1.clone(),
        label: format!("{}.jar", MINECRAFT_VERSION),
    });

    for lib in &mojang_details.libraries {
        if !is_rule_allowed(lib.rules.as_deref()) {
            continue;
        }

        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                let dest = game_dir.join("libraries").join(&artifact.path);
                download_tasks.push(DownloadTask {
                    url: artifact.url.clone(),
                    dest_path: dest,
                    size: artifact.size,
                    sha1: artifact.sha1.clone(),
                    label: lib.name.clone(),
                });
            }

            if cfg!(windows) {
                if let Some(classifiers) = &downloads.classifiers {
                    if let Some(nat) = classifiers.get("natives-windows") {
                        if let (Some(path), Some(url)) = (nat["path"].as_str(), nat["url"].as_str()) {
                            let dest = game_dir.join("libraries").join(path);
                            native_jars.push(dest.clone());
                            download_tasks.push(DownloadTask {
                                url: url.to_string(),
                                dest_path: dest,
                                size: nat["size"].as_u64(),
                                sha1: nat["sha1"].as_str().map(String::from),
                                label: format!("Natives: {}", lib.name),
                            });
                        }
                    }
                }
            }
        }
    }

    for flib in &fabric_profile.libraries {
        let (rel_path, url) = maven_to_path(&flib.name, flib.url.as_deref());
        let dest = game_dir.join("libraries").join(rel_path);
        download_tasks.push(DownloadTask {
            url,
            dest_path: dest,
            size: None,
            sha1: None,
            label: flib.name.clone(),
        });
    }

    let app_handle = app.clone();
    let downloaded_libs = download_pool(download_tasks, 10, move |pct, label| {
        let mapped_pct = 5 + (pct as f64 * 0.45) as u32;
        if emit_download_progress {
            let _ = app_handle.emit("event:launcher:progress", mapped_pct);
        } else {
            let _ = app_handle.emit(
                "event:launcher:step",
                format!("Загрузка клиента ({}%)...", pct),
            );
        }
        let _ = app_handle.emit("event:launcher:log", format!("[game] {}", label));
    })
    .await?;

    let natives_dir = version_json_dir.join("natives");
    let _ = fs::create_dir_all(&natives_dir);
    if downloaded_libs > 0 || !has_extracted_natives(&natives_dir) {
        for nat in native_jars {
            if nat.exists() {
                let _ = extract_zip(&nat, &natives_dir);
            }
        }
    }

    let asset_index_id = mojang_details
        .asset_index
        .as_ref()
        .map(|ai| ai.id.clone())
        .unwrap_or_else(|| MINECRAFT_VERSION.to_string());

    let mut downloaded_assets = 0usize;
    if let Some(assets) = mojang_details.asset_index {
        let asset_index_dir = game_dir.join("assets").join("indexes");
        let _ = fs::create_dir_all(&asset_index_dir);
        let index_file = asset_index_dir.join(format!("{}.json", assets.id));

        let index_text = match index_file
            .exists()
            .then(|| fs::read_to_string(&index_file).ok())
            .flatten()
            .filter(|txt| serde_json::from_str::<serde_json::Value>(txt).is_ok())
        {
            Some(txt) => txt,
            None => {
                let _ = fs::remove_file(&index_file);
                let txt = fetch_text_with_retry(&assets.url, "Индекс ресурсов Minecraft").await?;
                let _: serde_json::Value = serde_json::from_str(&txt)
                    .map_err(|e| format!("Ошибка разбора индекса ресурсов: {}", e))?;
                let _ = fs::write(&index_file, &txt);
                txt
            }
        };

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&index_text) {
            if let Some(objects) = json["objects"].as_object() {
                let mut asset_tasks = Vec::new();
                for (_path, obj) in objects.iter() {
                    if let Some(hash) = obj["hash"].as_str() {
                        let prefix = &hash[..2];
                        let dest = game_dir.join("assets").join("objects").join(prefix).join(hash);
                        let url =
                            format!("https://resources.download.minecraft.net/{}/{}", prefix, hash);
                        asset_tasks.push(DownloadTask {
                            url,
                            dest_path: dest,
                            size: obj["size"].as_u64(),
                            sha1: Some(hash.to_string()),
                            label: format!("Ресурс: {}", hash),
                        });
                    }
                }
                let app_h = app.clone();
                downloaded_assets = download_pool(asset_tasks, 12, move |pct, _| {
                    if emit_download_progress {
                        let mapped = 50 + (pct as f64 * 0.20) as u32;
                        let _ = app_h.emit("event:launcher:progress", mapped);
                    } else {
                        let _ = app_h.emit(
                            "event:launcher:step",
                            format!("Загрузка ресурсов ({}%)...", pct),
                        );
                    }
                })
                .await?;
            }
        }
    }

    let app_log = app.clone();
    let app_prog = app.clone();
    let downloaded_mods = sync_heartbridge_modpack(
        game_dir,
        move |msg| {
            let _ = app_log.emit("event:launcher:log", format!("[game] {}", msg));
        },
        move |pct, label| {
            if emit_download_progress {
                let mapped = 70 + (pct as f64 * 0.28) as u32;
                let _ = app_prog.emit("event:launcher:progress", mapped);
            } else {
                let _ = app_prog.emit(
                    "event:launcher:step",
                    format!("Загрузка сборки ({}%)...", pct),
                );
            }
            let _ = app_prog.emit("event:launcher:log", format!("[game] {}", label));
        },
    )
    .await?;

    if emit_download_progress || downloaded_libs > 0 || downloaded_assets > 0 || downloaded_mods > 0 {
        if emit_download_progress {
            let _ = app.emit("event:launcher:progress", 100);
        }
    }

    Ok((client_jar_path, fabric_profile.main_class, asset_index_id))
}

pub fn build_full_classpath(game_dir: &Path, client_jar: &Path) -> String {
    let mut entries: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let libraries_dir = game_dir.join("libraries");
    let mut stack = vec![libraries_dir];

    while let Some(current) = stack.pop() {
        if let Ok(dir_entries) = fs::read_dir(current) {
            for entry in dir_entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().and_then(|e| e.to_str()) == Some("jar") {
                    let filename = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if seen.insert(filename) {
                        entries.push(p);
                    }
                }
            }
        }
    }

    entries.push(client_jar.to_path_buf());

    let sep = if cfg!(windows) { ";" } else { ":" };
    entries
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join(sep)
}

async fn request_ticket_grant(
    client: &reqwest::Client,
    access_token: &str,
) -> Option<serde_json::Value> {
    let grant_url = format!("{}/v1/auth/minecraft-ticket-grant", HEART_BRIDGE_BASE);
    let resp = client
        .post(&grant_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .ok()?;
    if resp.status().is_success() {
        resp.json::<serde_json::Value>().await.ok()
    } else {
        None
    }
}

async fn fetch_real_grant(
    game_dir: &Path,
    client: &reqwest::Client,
    username: &str,
    account_id: &str,
    bridge_access_token: Option<&str>,
    bridge_refresh_token: Option<&str>,
    on_log: &impl Fn(&str),
) -> Result<serde_json::Value, String> {
    on_log(&format!("Получение билета Heart Identity для {}...", username));

    let mut active_token = bridge_access_token.map(String::from);

    if let Some(token) = &active_token {
        if let Some(grant_data) = request_ticket_grant(client, token).await {
            if let Some(grant_str) = grant_data["grant"].as_str() {
                on_log("Успешно получен билет Heart Identity!");
                return Ok(serde_json::json!({
                    "schemaVersion": 1,
                    "grant": grant_str,
                    "username": grant_data["minecraftUsername"].as_str().unwrap_or(username),
                    "uuid": grant_data["minecraftUuid"].as_str().unwrap_or(&get_offline_player_uuid(username)),
                    "apiBaseUrl": HEART_BRIDGE_BASE,
                    "allowedServerAddresses": [
                        "87.228.56.12:25565",
                        "87.228.56.12",
                        "heartserverm.duckdns.org:27015",
                        "heartserverm.duckdns.org:25565",
                        "heartserverm.duckdns.org"
                    ],
                    "expiresAt": grant_data["expiresAt"].as_str().unwrap_or("2099-01-01T00:00:00.000Z")
                }));
            }
        }
    }

    if let Some(refresh_tok) = bridge_refresh_token {
        let refresh_url = format!("{}/v1/auth/refresh", HEART_BRIDGE_BASE);
        if let Ok(resp) = client
            .post(&refresh_url)
            .json(&serde_json::json!({ "refreshToken": refresh_tok }))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(new_access) = val["accessToken"].as_str() {
                        let new_refresh = val["refreshToken"].as_str();
                        AuthService::new(game_dir).save_bridge_tokens(account_id, new_access, new_refresh);
                        active_token = Some(new_access.to_string());
                    }
                }
            }
        }
    }

    if let Some(token) = &active_token {
        if let Some(grant_data) = request_ticket_grant(client, token).await {
            if let Some(grant_str) = grant_data["grant"].as_str() {
                on_log("Успешно получен обновлённый билет Heart Identity!");
                return Ok(serde_json::json!({
                    "schemaVersion": 1,
                    "grant": grant_str,
                    "username": grant_data["minecraftUsername"].as_str().unwrap_or(username),
                    "uuid": grant_data["minecraftUuid"].as_str().unwrap_or(&get_offline_player_uuid(username)),
                    "apiBaseUrl": HEART_BRIDGE_BASE,
                    "allowedServerAddresses": [
                        "87.228.56.12:25565",
                        "87.228.56.12",
                        "heartserverm.duckdns.org:27015",
                        "heartserverm.duckdns.org:25565",
                        "heartserverm.duckdns.org"
                    ],
                    "expiresAt": grant_data["expiresAt"].as_str().unwrap_or("2099-01-01T00:00:00.000Z")
                }));
            }
        }
    }

    Err("Сессия Heart истекла или недействительна. Нажмите «Выйти» в левом нижнем углу лаунчера и войдите заново.".into())
}

pub async fn install_and_launch(
    app: AppHandle,
    game_dir: PathBuf,
    settings: LauncherSettings,
    username: String,
    uuid: String,
    bridge_access_token: Option<String>,
    bridge_refresh_token: Option<String>,
) -> Result<(), String> {
    let app_h = app.clone();
    let on_log = move |msg: &str| {
        let _ = app_h.emit("event:launcher:log", format!("[game] {}", msg));
    };

    let client = get_http_client();

    let _ = app.emit("event:launcher:step", "Проверка окружения Java 21...");
    let java_bin = prefer_javaw_path(ensure_java_21(&game_dir, &settings.java_path, &on_log).await?);

    let _ = app.emit("event:launcher:step", "Проверка файлов клиента...");
    let (client_jar, main_class, asset_index_id) =
        prepare_environment(&app, &game_dir, false, &on_log).await?;

    let _ = app.emit("event:launcher:step", "Авторизация Heart Identity...");
    let identity_dir = game_dir.join("config").join("heart-identity");
    let _ = fs::create_dir_all(&identity_dir);
    let grant_file = identity_dir.join("minecraft-grant.json");
    let _ = fs::remove_file(identity_dir.join("join-ticket.json"));

    let grant_payload = match fetch_real_grant(
        &game_dir,
        &client,
        &username,
        &uuid,
        bridge_access_token.as_deref(),
        bridge_refresh_token.as_deref(),
        &on_log,
    )
    .await
    {
        Ok(payload) => payload,
        Err(err) => {
            let _ = fs::remove_file(&grant_file);
            return Err(err);
        }
    };

    fs::write(
        &grant_file,
        serde_json::to_string_pretty(&grant_payload).unwrap_or_default(),
    )
    .map_err(|e| format!("Не удалось записать minecraft-grant.json: {}", e))?;

    let launch_username = grant_payload["username"]
        .as_str()
        .unwrap_or(&username)
        .to_string();
    let launch_uuid = grant_payload["uuid"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| get_offline_player_uuid(&launch_username));

    if settings.borderless {
        ensure_options_txt_fullscreen_disabled(&game_dir);
    }

    let (native_w, native_h) = get_native_screen_resolution(Some(&app));
    let launch_width = if settings.borderless || settings.width < 640 {
        native_w
    } else {
        settings.width
    };
    let launch_height = if settings.borderless || settings.height < 480 {
        native_h
    } else {
        settings.height
    };

    let classpath = build_full_classpath(&game_dir, &client_jar);

    let natives_dir = game_dir.join("versions").join(MINECRAFT_VERSION).join("natives");
    let max_ram = if settings.ram_gb < 2 { 4 } else { settings.ram_gb };
    let min_ram = (max_ram / 2).clamp(2, 4);

    let mut jvm_args: Vec<String> = vec![
        format!("-Xms{}G", min_ram),
        format!("-Xmx{}G", max_ram),
        "-XX:+UseG1GC".into(),
        "-XX:+ParallelRefProcEnabled".into(),
        "-XX:MaxGCPauseMillis=60".into(),
        "-XX:+UnlockExperimentalVMOptions".into(),
        "-XX:+DisableExplicitGC".into(),
        "-XX:+AlwaysPreTouch".into(),
        "-XX:G1NewSizePercent=28".into(),
        "-XX:G1MaxNewSizePercent=36".into(),
        "-XX:G1ReservePercent=12".into(),
        "-XX:G1HeapWastePercent=5".into(),
        "-XX:G1MixedGCCountTarget=4".into(),
        "-XX:InitiatingHeapOccupancyPercent=15".into(),
        "-XX:G1MixedGCLiveThresholdPercent=90".into(),
        "-XX:G1RSetUpdatingPauseTimePercent=5".into(),
        "-XX:SurvivorRatio=32".into(),
        "-XX:+PerfDisableSharedMem".into(),
        "-XX:MaxTenuringThreshold=1".into(),
        format!("-Djava.library.path={}", natives_dir.display()),
        format!("-Djna.tmpdir={}", natives_dir.display()),
        format!("-Dorg.lwjgl.system.SharedLibraryExtractPath={}", natives_dir.display()),
        format!("-Dio.netty.native.workdir={}", natives_dir.display()),
        "-Dminecraft.launcher.brand=HEART".into(),
        "-Dminecraft.launcher.version=0.4.0".into(),
    ];

    if settings.borderless {
        jvm_args.push("-Dheart.borderless=true".into());
    }

    jvm_args.push("-cp".into());
    jvm_args.push(classpath);
    jvm_args.push(main_class);

    let mut game_args: Vec<String> = vec![
        "--username".into(),
        launch_username,
        "--version".into(),
        format!("fabric-loader-{}-{}", FABRIC_LOADER_VERSION, MINECRAFT_VERSION),
        "--gameDir".into(),
        game_dir.display().to_string(),
        "--assetsDir".into(),
        game_dir.join("assets").display().to_string(),
        "--assetIndex".into(),
        asset_index_id,
        "--uuid".into(),
        launch_uuid,
        "--accessToken".into(),
        "0".into(),
        "--userType".into(),
        "mojang".into(),
        "--versionType".into(),
        "release".into(),
        "--width".into(),
        launch_width.to_string(),
        "--height".into(),
        launch_height.to_string(),
    ];

    if settings.auto_connect_server {
        game_args.push("--quickPlayMultiplayer".into());
        game_args.push("87.228.56.12:25565".into());
    }

    ensure_server_entry(&game_dir, "Heart", "87.228.56.12:25565");

    on_log("Запуск игрового процесса Minecraft...");
    let _ = app.emit("event:launcher:step", "Запуск JVM Minecraft...");

    let mut full_args = jvm_args;
    full_args.extend(game_args);

    let mut cmd = Command::new(java_bin);
    cmd.args(&full_args)
        .current_dir(&game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить процесс Java: {}", e))?;

    let _ = app.emit("event:launcher:process", format!("started:{}", child.id()));

    if let Some(stdout) = child.stdout.take() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            let mut window_ready_sent = false;

            for line in reader.lines().flatten() {
                if !window_ready_sent {
                    if line.contains("Backend library: LWJGL") {
                        let _ = app_handle.emit("event:launcher:step", "Инициализация графики LWJGL...");
                    } else if line.contains("OpenAL initialized")
                        || line.contains("Reloading ResourceManager")
                    {
                        let _ = app_handle.emit("event:launcher:step", "Загрузка ресурсов и модов...");
                    } else if line.contains("Sound engine started")
                        || line.contains("Narrator library successfully initialized")
                        || line.contains("Connecting to")
                        || line.contains("Loaded 0 advancements")
                        || line.contains("Setting user:")
                    {
                        window_ready_sent = true;
                        let _ = app_handle.emit("event:launcher:process", "running".to_string());
                    }
                }
                let _ = app_handle.emit("event:launcher:log", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = app_handle.emit("event:launcher:log", line);
            }
        });
    }

    let app_safety = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(35));
        let _ = app_safety.emit("event:launcher:process", "running".to_string());
    });

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let code = status.map(|s| s.code().unwrap_or(0)).unwrap_or(-1);
        let _ = app_handle.emit("event:launcher:process", format!("exited:{}", code));
    });

    Ok(())
}