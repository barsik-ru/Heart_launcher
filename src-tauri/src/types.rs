use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub ram_gb: u32,
    pub java_path: String,
    pub game_path: String,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    pub borderless: bool,
    pub close_on_launch: bool,
    pub auto_connect_server: bool,
    pub language: String,
    pub animations: bool,
    pub theme: String,
    pub setup_complete: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            ram_gb: 6,
            java_path: String::new(),
            game_path: String::new(),
            width: 1920,
            height: 1080,
            fullscreen: false,
            borderless: true,
            close_on_launch: false,
            auto_connect_server: true,
            language: "ru".into(),
            animations: true,
            theme: "verdant".into(),
            setup_complete: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub username: String,
    pub email: String,
    pub registered_at: String,
    pub group: String,
    pub status: String,
    pub minecraft: Option<MinecraftProfile>,
    pub skin_url: Option<String>,
    pub skin_variant: Option<String>,
    pub cape_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    #[serde(flatten)]
    pub profile: UserProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_salt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bridge_access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bridge_refresh_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftProfile {
    pub uuid: String,
    pub username: String,
    pub linked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineAccountStore {
    #[serde(alias = "activeId")]
    pub active_id: Option<String>,
    pub accounts: Vec<StoredAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub online: bool,
    pub players: u32,
    pub capacity: u32,
    pub latency: Option<u64>,
    pub message: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub total_gb: u64,
    pub free_gb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub is_packaged: bool,
    pub service_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub content: String,
    pub category: String,
    pub date: String,
    pub image: String,
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationInfo {
    pub installed_version: Option<String>,
    pub latest_version: String,
    pub installed: bool,
    pub last_verified: Option<String>,
    pub update_size: String,
    pub minecraft_version: String,
    pub fabric_loader_version: String,
    pub java_major_version: u32,
    pub changes: ModpackChanges,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackChanges {
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    pub configurations: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HeartBridgeManifest {
    pub schema_version: Option<u32>,
    pub pack_id: Option<String>,
    pub name: Option<String>,
    pub game_version: String,
    pub loader: String,
    pub loader_version: String,
    pub revision: u32,
    pub mods: Vec<HeartBridgeMod>,
    pub resource_packs: Option<Vec<HeartBridgeResourcePack>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HeartBridgeMod {
    pub slug: String,
    pub title: Option<String>,
    pub filename: Option<String>,
    pub download_url: Option<String>,
    pub version_id: Option<String>,
    pub sha1: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HeartBridgeResourcePack {
    pub slug: String,
    pub title: Option<String>,
    pub filename: String,
    pub download_url: String,
    pub sha1: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartBridgeRawNews {
    pub id: serde_json::Value,
    pub title: String,
    pub content: String,
    pub created_at: Option<String>,
    pub image: Option<String>,
    pub published: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    pub state: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub progress: Option<u32>,
    pub error: Option<String>,
    pub demo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgress {
    pub percent: u32,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub bytes_per_second: u64,
    pub timestamp: u64,
}