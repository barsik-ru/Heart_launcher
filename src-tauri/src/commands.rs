use crate::auth::AuthService;
use crate::heartbridge::{check_backend_online, fetch_news, get_modpack_info};
use crate::java::ensure_java_21;
use crate::launcher::{install_and_launch, prepare_environment};
use crate::minecraft_ping::query_server;
use crate::types::*;
use directories::BaseDirs;
use std::fs;
use std::path::PathBuf;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};

pub fn get_default_game_dir() -> PathBuf {
    if let Some(base) = BaseDirs::new() {
        base.data_dir().join(".heart")
    } else {
        PathBuf::from(".heart")
    }
}

#[cfg(windows)]
fn query_win32_physical_resolution() -> Option<(u32, u32)> {
    #[repr(C)]
    struct DevModeW {
        dm_device_name: [u16; 32],
        dm_spec_version: u16,
        dm_driver_version: u16,
        dm_size: u16,
        dm_driver_extra: u16,
        dm_fields: u32,
        dm_union1: [u8; 16],
        dm_color: i16,
        dm_duplex: i16,
        dm_y_resolution: i16,
        dm_tt_option: i16,
        dm_collate: i16,
        dm_form_name: [u16; 32],
        dm_log_pixels: u16,
        dm_bits_per_pel: u32,
        dm_pels_width: u32,
        dm_pels_height: u32,
        dm_display_flags: u32,
        dm_display_frequency: u32,
        dm_icm_method: u32,
        dm_icm_intent: u32,
        dm_media_type: u32,
        dm_dither_type: u32,
        dm_reserved1: u32,
        dm_reserved2: u32,
        dm_panning_width: u32,
        dm_panning_height: u32,
    }

    extern "system" {
        fn EnumDisplaySettingsW(lpsz_device_name: *const u16, i_mode_num: u32, lp_dev_mode: *mut DevModeW) -> i32;
    }

    const ENUM_CURRENT_SETTINGS: u32 = u32::MAX;

    unsafe {
        let mut dev_mode: DevModeW = std::mem::zeroed();
        dev_mode.dm_size = std::mem::size_of::<DevModeW>() as u16;
        if EnumDisplaySettingsW(std::ptr::null(), ENUM_CURRENT_SETTINGS, &mut dev_mode) != 0 {
            if dev_mode.dm_pels_width >= 640 && dev_mode.dm_pels_height >= 480 {
                return Some((dev_mode.dm_pels_width, dev_mode.dm_pels_height));
            }
        }
    }
    None
}

pub fn get_native_screen_resolution(app: Option<&AppHandle>) -> (u32, u32) {
    if let Some(handle) = app {
        if let Some(win) = handle.get_webview_window("main") {
            if let Ok(Some(monitor)) = win.current_monitor() {
                let size = monitor.size();
                if size.width >= 640 && size.height >= 480 {
                    return (size.width, size.height);
                }
            }
            if let Ok(Some(monitor)) = win.primary_monitor() {
                let size = monitor.size();
                if size.width >= 640 && size.height >= 480 {
                    return (size.width, size.height);
                }
            }
        }
    }

    #[cfg(windows)]
    if let Some((w, h)) = query_win32_physical_resolution() {
        return (w, h);
    }

    (1920, 1080)
}

#[tauri::command]
pub fn system_get_screen_resolution(app: AppHandle) -> serde_json::Value {
    let (width, height) = get_native_screen_resolution(Some(&app));
    serde_json::json!({
        "width": width,
        "height": height
    })
}

#[tauri::command]
pub fn system_get_memory() -> SystemMemoryInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_bytes = sys.total_memory();
    let free_bytes = sys.available_memory();
    SystemMemoryInfo {
        total_bytes,
        free_bytes,
        total_gb: total_bytes / 1024 / 1024 / 1024,
        free_gb: free_bytes / 1024 / 1024 / 1024,
    }
}

#[tauri::command]
pub async fn app_get_info() -> AppInfo {
    let is_online = check_backend_online().await;
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        is_packaged: true,
        service_mode: if is_online { "backend".into() } else { "offline".into() },
    }
}

#[tauri::command]
pub fn system_open_game_folder() -> Result<(), String> {
    let dir = get_default_game_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn system_open_discord() -> Result<(), String> {
    open::that("https://discord.gg/heartru").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_get_status() -> ServerStatus {
    query_server("87.228.56.12", 25565).await
}

#[tauri::command]
pub async fn news_get() -> Vec<NewsArticle> {
    fetch_news().await
}

#[tauri::command]
pub async fn news_get_article(id: String) -> Option<NewsArticle> {
    fetch_news().await.into_iter().find(|n| n.id == id)
}

#[tauri::command]
pub async fn modpack_get_info() -> InstallationInfo {
    get_modpack_info(&get_default_game_dir()).await
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> LauncherSettings {
    let dir = get_default_game_dir();
    let path = dir.join("launcher-settings.json");
    let (native_w, native_h) = get_native_screen_resolution(Some(&app));

    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(mut s) = serde_json::from_str::<LauncherSettings>(&data) {
                if s.width < 640 || s.height < 480 {
                    s.width = native_w;
                    s.height = native_h;
                }
                return s;
            }
        }
    }

    let mut defaults = LauncherSettings::default();
    defaults.width = native_w;
    defaults.height = native_h;
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string_pretty(&defaults) {
        let _ = fs::write(&path, json);
    }
    defaults
}

#[tauri::command]
pub fn settings_update(settings: LauncherSettings) -> Result<LauncherSettings, String> {
    let dir = get_default_game_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("launcher-settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub async fn auth_register(username: String, password: String, email: String) -> Result<UserProfile, String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.register(&username, &password, &email).await
}

#[tauri::command]
pub async fn auth_login(username: String, password: String, remember: Option<bool>) -> Result<UserProfile, String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.login(&username, &password, remember.unwrap_or(true)).await
}

#[tauri::command]
pub fn auth_logout() -> Result<(), String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.logout()
}

#[tauri::command]
pub fn auth_get_current_profile() -> Option<UserProfile> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.get_current_profile()
}

#[tauri::command]
pub async fn auth_sync_profile() -> Result<UserProfile, String> {
    let auth = AuthService::new(&get_default_game_dir());
    let val = auth
        .authorized_bridge_request(reqwest::Method::GET, "/v1/account/me", None)
        .await?;
    let remote = serde_json::from_value::<UserProfile>(val)
        .map_err(|e| format!("Ошибка чтения профиля с сервера: {}", e))?;
    Ok(auth.update_stored_profile(&remote))
}

#[tauri::command]
pub fn auth_get_saved_accounts() -> Vec<UserProfile> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.get_saved_accounts()
}

#[tauri::command]
pub fn auth_remove_account(id: String) -> Result<(), String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.remove_account(&id)
}

#[tauri::command]
pub fn auth_update_profile(
    current_username: String,
    username: Option<String>,
    email: Option<String>,
) -> Result<UserProfile, String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.update_profile(&current_username, username.as_deref(), email.as_deref())
}

#[tauri::command]
pub fn auth_save_skin(username: String, skin_data_url: String, variant: Option<String>) -> Result<UserProfile, String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.save_skin(&username, &skin_data_url, variant.as_deref())
}

#[tauri::command]
pub fn auth_remove_skin(username: String) -> Result<UserProfile, String> {
    let auth = AuthService::new(&get_default_game_dir());
    auth.remove_skin(&username)
}

#[tauri::command]
pub async fn launcher_launch(app: AppHandle, username: Option<String>) -> Result<(), String> {
    let game_dir = get_default_game_dir();
    let mut settings = settings_get(app.clone());

    if !settings.auto_connect_server {
        settings.auto_connect_server = true;
    }

    let auth = AuthService::new(&game_dir);
    let store = auth.load_store();

    let account = if let Some(u) = username.filter(|s| !s.trim().is_empty()) {
        store
            .accounts
            .into_iter()
            .find(|a| a.profile.username.eq_ignore_ascii_case(u.trim()))
    } else if let Some(active_id) = store.active_id {
        store
            .accounts
            .into_iter()
            .find(|a| a.profile.id == active_id)
    } else {
        None
    }
    .ok_or_else(|| "Сначала войдите в аккаунт или зарегистрируйтесь!".to_string())?;

    install_and_launch(
        app,
        game_dir,
        settings,
        account.profile.username,
        account.profile.id,
        account.bridge_access_token,
        account.bridge_refresh_token,
    )
    .await
}

#[tauri::command]
pub async fn launcher_install(app: AppHandle) -> Result<(), String> {
    let game_dir = get_default_game_dir();
    let settings = settings_get(app.clone());
    let app_h = app.clone();

    ensure_java_21(&game_dir, &settings.java_path, move |msg| {
        let _ = app_h.emit("event:launcher:log", format!("[game] {}", msg));
    })
    .await?;

    let app_h2 = app.clone();
    prepare_environment(&app, &game_dir, true, move |msg| {
        let _ = app_h2.emit("event:launcher:log", format!("[game] {}", msg));
    })
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn launcher_update(app: AppHandle) -> Result<(), String> {
    launcher_install(app).await
}

#[tauri::command]
pub async fn launcher_verify(app: AppHandle) -> Result<(), String> {
    launcher_install(app).await
}

#[tauri::command]
pub fn dialog_select_path(_kind: String) -> Option<String> {
    None
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(is_max) = win.is_maximized() {
            if is_max {
                let _ = win.unmaximize();
            } else {
                let _ = win.maximize();
            }
        }
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

#[tauri::command]
pub fn window_is_maximized(app: AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_maximized().ok())
        .unwrap_or(false)
}