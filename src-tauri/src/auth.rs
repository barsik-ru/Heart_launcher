use crate::downloader::get_http_client;
use crate::heartbridge::HEART_BRIDGE_BASE;
use crate::offline_uuid::get_offline_player_uuid;
use crate::types::{MinecraftProfile, OfflineAccountStore, StoredAccount, UserProfile};
use directories::BaseDirs;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static SALT_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_iso_date() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(1_793_750_400);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", year, m, d, hour, min, sec)
}

fn normalize_iso_date(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("Invalid Date") {
        return Some(current_iso_date());
    }
    if trimmed.contains("04 нояб") && trimmed.contains("2026") {
        return Some("2026-11-04T00:00:00.000Z".into());
    }
    let bytes = trimmed.as_bytes();
    let is_iso = bytes.len() >= 10
        && bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(|b| b.is_ascii_digit());
    if !is_iso {
        return Some(current_iso_date());
    }
    None
}

fn generate_salt() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SALT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(seq.to_le_bytes());
    hex::encode(&hasher.finalize()[..16])
}

fn hash_password(password: &str, salt: &str) -> String {
    let mut digest = Sha256::digest(format!("{}:{}", salt, password).as_bytes());
    for _ in 0..10_000 {
        let mut h = Sha256::new();
        h.update(&digest);
        h.update(salt.as_bytes());
        digest = h.finalize();
    }
    hex::encode(digest)
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn is_valid_username(username: &str) -> bool {
    let len = username.len();
    (3..=16).contains(&len) && username.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn is_valid_password(password: &str) -> bool {
    password.len() >= 10 && password.len() <= 128
}

fn is_valid_email(email: &str) -> bool {
    let parts: Vec<&str> = email.split('@').collect();
    parts.len() == 2
        && !parts[0].is_empty()
        && parts[1].contains('.')
        && !parts[1].starts_with('.')
        && !parts[1].ends_with('.')
        && !email.chars().any(|c| c.is_whitespace())
}

fn encode_base64_png(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::from("data:image/png;base64,");
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        result.push(TABLE[(b0 >> 2) as usize] as char);
        result.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(TABLE[(((b1 & 0x0F) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(TABLE[(b2 & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn decode_base64_png(input: &str) -> Option<Vec<u8>> {
    let clean = input.trim();
    let data = clean.strip_prefix("data:image/png;base64,").unwrap_or(clean);

    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut map = [255u8; 256];
    for (i, &b) in TABLE.iter().enumerate() {
        map[b as usize] = i as u8;
    }

    let bytes = data.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        for (i, &c) in chunk.iter().enumerate() {
            let val = map[c as usize];
            if val == 255 {
                return None;
            }
            buf[i] = val;
        }
        out.push((buf[0] << 2) | (buf[1] >> 4));
        if chunk.len() > 1 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if chunk.len() > 3 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    Some(out)
}

fn extract_bridge_error(val: &serde_json::Value, fallback: &str) -> String {
    if let Some(msg) = val["error"]["message"].as_str() {
        if !msg.trim().is_empty() {
            return msg.to_string();
        }
    }
    if let Some(msg) = val["message"].as_str() {
        if !msg.trim().is_empty() {
            return msg.to_string();
        }
    }
    fallback.to_string()
}

struct BridgeSession {
    access_token: String,
    refresh_token: Option<String>,
    profile: Option<UserProfile>,
}

async fn try_bridge_register(username: &str, password: &str, email: &str) -> Result<Option<BridgeSession>, String> {
    let client = get_http_client();
    let url = format!("{}/v1/auth/register", HEART_BRIDGE_BASE);
    let body = serde_json::json!({
        "username": username,
        "email": email,
        "password": password,
        "acceptedRules": true
    });

    let resp = match client
        .post(&url)
        .timeout(Duration::from_secs(8))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let status = resp.status();
    let payload: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);

    if status.is_success() {
        let access_token = payload["accessToken"].as_str().unwrap_or_default().to_string();
        if access_token.is_empty() {
            return Ok(None);
        }
        let refresh_token = payload["refreshToken"].as_str().map(String::from);
        let profile = serde_json::from_value::<UserProfile>(payload["profile"].clone()).ok();
        return Ok(Some(BridgeSession {
            access_token,
            refresh_token,
            profile,
        }));
    }

    if matches!(status.as_u16(), 400 | 401 | 403 | 409 | 422 | 429) {
        return Err(extract_bridge_error(
            &payload,
            "Этот логин или почта уже зарегистрированы на сервере Heart.",
        ));
    }

    Err(format!("Сервер Heart вернул ошибку регистрации (HTTP {}).", status))
}

async fn try_bridge_login(username: &str, password: &str) -> Result<Option<BridgeSession>, String> {
    let client = get_http_client();
    let url = format!("{}/v1/auth/login", HEART_BRIDGE_BASE);
    let body = serde_json::json!({
        "username": username,
        "password": password
    });

    let resp = match client
        .post(&url)
        .timeout(Duration::from_secs(8))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let status = resp.status();
    let payload: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);

    if status.is_success() {
        let access_token = payload["accessToken"].as_str().unwrap_or_default().to_string();
        if access_token.is_empty() {
            return Ok(None);
        }
        let refresh_token = payload["refreshToken"].as_str().map(String::from);
        let profile = serde_json::from_value::<UserProfile>(payload["profile"].clone()).ok();
        return Ok(Some(BridgeSession {
            access_token,
            refresh_token,
            profile,
        }));
    }

    if matches!(status.as_u16(), 400 | 401 | 403 | 404 | 422 | 429) {
        return Err(extract_bridge_error(
            &payload,
            "Неверный логин или пароль.",
        ));
    }

    Err(format!("Сервер Heart вернул ошибку входа (HTTP {}).", status))
}

async fn send_authed_json(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<&serde_json::Value>,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut req = client
        .request(method, url)
        .timeout(Duration::from_secs(10))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json");
    if let Some(json_body) = body {
        req = req.json(json_body);
    }
    req.send().await
}

pub struct AuthService {
    store_path: PathBuf,
    game_dir: PathBuf,
}

impl AuthService {
    pub fn new(game_dir: &Path) -> Self {
        let store_path = game_dir.join("offline-accounts.json");

        if !store_path.exists() {
            if let Some(base) = BaseDirs::new() {
                let candidates = [
                    base.data_dir().join("heart-minecraft-launcher").join("offline-accounts.json"),
                    base.data_dir().join("Heart Launcher").join("offline-accounts.json"),
                    base.data_dir().join("heart").join("offline-accounts.json"),
                ];
                for cand in candidates {
                    if cand.exists() {
                        let _ = fs::copy(&cand, &store_path);
                        break;
                    }
                }
            }
        }

        Self {
            store_path,
            game_dir: game_dir.to_path_buf(),
        }
    }

    pub fn load_store(&self) -> OfflineAccountStore {
        if self.store_path.exists() {
            if let Ok(content) = fs::read_to_string(&self.store_path) {
                if let Ok(mut store) = serde_json::from_str::<OfflineAccountStore>(&content) {
                    let mut migrated = false;
                    for acc in &mut store.accounts {
                        if let Some(fixed) = normalize_iso_date(&acc.profile.registered_at) {
                            acc.profile.registered_at = fixed;
                            migrated = true;
                        }
                        if let Some(mc) = &mut acc.profile.minecraft {
                            if let Some(fixed) = normalize_iso_date(&mc.linked_at) {
                                mc.linked_at = fixed;
                                migrated = true;
                            }
                        }
                        if acc.profile.skin_url.is_none() {
                            let skin_file = self.game_dir.join("config").join("heart-identity").join("skin.png");
                            if skin_file.exists() {
                                if let Ok(bytes) = fs::read(skin_file) {
                                    acc.profile.skin_url = Some(encode_base64_png(&bytes));
                                }
                            }
                        }
                    }
                    if migrated {
                        let _ = self.save_store(&store);
                    }
                    return store;
                }
            }
        }
        OfflineAccountStore {
            active_id: None,
            accounts: Vec::new(),
        }
    }

    pub fn save_store(&self, store: &OfflineAccountStore) -> Result<(), String> {
        if let Some(parent) = self.store_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
        fs::write(&self.store_path, json).map_err(|e| e.to_string())
    }

    pub fn get_saved_accounts(&self) -> Vec<UserProfile> {
        self.load_store()
            .accounts
            .into_iter()
            .map(|a| a.profile)
            .collect()
    }

    pub fn get_current_profile(&self) -> Option<UserProfile> {
        let store = self.load_store();
        let active_id = store.active_id?;
        let acc = store
            .accounts
            .into_iter()
            .find(|a| a.profile.id == active_id)?;
        if acc.bridge_access_token.is_none() && acc.bridge_refresh_token.is_none() {
            return None;
        }
        Some(acc.profile)
    }

    pub fn logout(&self) -> Result<(), String> {
        let mut store = self.load_store();
        store.active_id = None;
        self.save_store(&store)
    }

    pub fn save_bridge_tokens(&self, account_id: &str, access: &str, refresh: Option<&str>) {
        let mut store = self.load_store();
        if let Some(acc) = store.accounts.iter_mut().find(|a| a.profile.id == account_id) {
            acc.bridge_access_token = Some(access.to_string());
            if let Some(r) = refresh {
                acc.bridge_refresh_token = Some(r.to_string());
            }
            let _ = self.save_store(&store);
        }
    }

    pub fn get_active_tokens(&self) -> Result<(String, Option<String>, Option<String>), String> {
        let store = self.load_store();
        let active_id = store
            .active_id
            .ok_or_else(|| "Сначала войдите в аккаунт Heart.".to_string())?;
        let acc = store
            .accounts
            .into_iter()
            .find(|a| a.profile.id == active_id)
            .ok_or_else(|| "Активный аккаунт не найден.".to_string())?;
        Ok((
            acc.profile.id,
            acc.bridge_access_token,
            acc.bridge_refresh_token,
        ))
    }

    pub fn update_stored_profile(&self, remote_profile: &UserProfile) -> UserProfile {
        let mut store = self.load_store();
        if let Some(acc) = store.accounts.iter_mut().find(|a| a.profile.id == remote_profile.id) {
            let mut merged = remote_profile.clone();
            if merged.skin_url.is_none() && acc.profile.skin_url.is_some() {
                merged.skin_url = acc.profile.skin_url.clone();
                merged.skin_variant = acc.profile.skin_variant.clone();
            }
            if merged.minecraft.is_none() {
                merged.minecraft = acc.profile.minecraft.clone();
            }
            acc.profile = merged.clone();
            let _ = self.save_store(&store);
            return merged;
        }
        remote_profile.clone()
    }

    pub async fn authorized_bridge_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let (account_id, access_opt, refresh_opt) = self.get_active_tokens()?;
        let client = get_http_client();
        let clean_path = path.trim_start_matches('/');
        let url = format!("{}/{}", HEART_BRIDGE_BASE, clean_path);

        if let Some(ref token) = access_opt {
            if let Ok(resp) = send_authed_json(&client, method.clone(), &url, token, body.as_ref()).await {
                let status = resp.status();
                let payload: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
                if status.is_success() {
                    return Ok(payload);
                }
                if status.as_u16() != 401 {
                    return Err(extract_bridge_error(
                        &payload,
                        &format!("Сервер Heart вернул ошибку (HTTP {}).", status),
                    ));
                }
            }
        }

        let refresh_tok = refresh_opt
            .ok_or_else(|| "Сессия Heart истекла. Нажмите «Выйти» и войдите снова.".to_string())?;
        let refresh_url = format!("{}/v1/auth/refresh", HEART_BRIDGE_BASE);
        let refresh_resp = client
            .post(&refresh_url)
            .timeout(Duration::from_secs(8))
            .json(&serde_json::json!({ "refreshToken": refresh_tok }))
            .send()
            .await
            .map_err(|_| "Не удалось связаться с сервером Heart. Проверьте интернет.".to_string())?;

        if !refresh_resp.status().is_success() {
            return Err("Сессия Heart истекла. Нажмите «Выйти» и войдите снова.".into());
        }

        let ref_payload: serde_json::Value = refresh_resp.json().await.unwrap_or(serde_json::Value::Null);
        let new_access = ref_payload["accessToken"]
            .as_str()
            .ok_or_else(|| "Сервер Heart не вернул новый токен сессии.".to_string())?;
        let new_refresh = ref_payload["refreshToken"].as_str();
        self.save_bridge_tokens(&account_id, new_access, new_refresh);

        let retry_resp = send_authed_json(&client, method, &url, new_access, body.as_ref())
            .await
            .map_err(|_| "Не удалось выполнить запрос к серверу Heart.".to_string())?;
        let retry_status = retry_resp.status();
        let retry_payload: serde_json::Value = retry_resp.json().await.unwrap_or(serde_json::Value::Null);
        if retry_status.is_success() {
            Ok(retry_payload)
        } else {
            Err(extract_bridge_error(
                &retry_payload,
                &format!("Сервер Heart вернул ошибку (HTTP {}).", retry_status),
            ))
        }
    }

    pub async fn register(&self, username: &str, password: &str, email: &str) -> Result<UserProfile, String> {
        let clean = username.trim();
        let clean_email = email.trim();

        if !is_valid_username(clean) {
            return Err("Логин должен быть от 3 до 16 символов (латиница, цифры и _).".into());
        }
        if !is_valid_email(clean_email) {
            return Err("Введите корректную электронную почту.".into());
        }
        if !is_valid_password(password) {
            return Err("Пароль должен содержать от 10 до 128 символов.".into());
        }

        let bridge_session = try_bridge_register(clean, password, clean_email)
            .await?
            .ok_or_else(|| "Не удалось подключиться к серверу Heart для регистрации. Проверьте интернет.".to_string())?;

        let mut store = self.load_store();
        store.accounts.retain(|a| !a.profile.username.eq_ignore_ascii_case(clean));

        let mut profile = bridge_session.profile.unwrap_or_else(|| {
            let uuid = get_offline_player_uuid(clean);
            let now_iso = current_iso_date();
            UserProfile {
                id: uuid.clone(),
                username: clean.to_string(),
                email: clean_email.to_string(),
                registered_at: now_iso.clone(),
                group: "Игрок".into(),
                status: "active".into(),
                minecraft: Some(MinecraftProfile {
                    uuid,
                    username: clean.to_string(),
                    linked_at: now_iso,
                }),
                skin_url: None,
                skin_variant: Some("classic".into()),
                cape_url: None,
            }
        });

        let mc_uuid = get_offline_player_uuid(&profile.username);
        if profile.minecraft.is_none() {
            profile.minecraft = Some(MinecraftProfile {
                uuid: mc_uuid,
                username: profile.username.clone(),
                linked_at: current_iso_date(),
            });
        }

        let salt = generate_salt();
        let hash = hash_password(password, &salt);
        let active_id = profile.id.clone();

        store.accounts.insert(
            0,
            StoredAccount {
                profile: profile.clone(),
                password: None,
                password_hash: Some(hash),
                password_salt: Some(salt),
                bridge_access_token: Some(bridge_session.access_token),
                bridge_refresh_token: bridge_session.refresh_token,
            },
        );
        store.active_id = Some(active_id);
        self.save_store(&store)?;
        Ok(profile)
    }

    pub async fn login(&self, username: &str, password: &str, remember: bool) -> Result<UserProfile, String> {
        let clean = username.trim();
        if !is_valid_username(clean) {
            return Err("Логин должен быть от 3 до 16 символов (латиница, цифры и _).".into());
        }
        if password.is_empty() {
            return Err("Введите пароль.".into());
        }

        let bridge_result = try_bridge_login(clean, password).await;
        let mut store = self.load_store();
        let existing_idx = store
            .accounts
            .iter()
            .position(|a| a.profile.username.eq_ignore_ascii_case(clean));

        match bridge_result {
            Ok(Some(session)) => {
                let salt = generate_salt();
                let hash = hash_password(password, &salt);

                let mut profile = session.profile.unwrap_or_else(|| {
                    let uuid = get_offline_player_uuid(clean);
                    let now_iso = current_iso_date();
                    UserProfile {
                        id: uuid.clone(),
                        username: clean.to_string(),
                        email: format!("{}@heart.local", clean.to_lowercase()),
                        registered_at: now_iso.clone(),
                        group: "Игрок".into(),
                        status: "active".into(),
                        minecraft: Some(MinecraftProfile {
                            uuid,
                            username: clean.to_string(),
                            linked_at: now_iso,
                        }),
                        skin_url: None,
                        skin_variant: Some("classic".into()),
                        cape_url: None,
                    }
                });

                let mc_uuid = get_offline_player_uuid(&profile.username);
                if profile.minecraft.is_none() {
                    profile.minecraft = Some(MinecraftProfile {
                        uuid: mc_uuid,
                        username: profile.username.clone(),
                        linked_at: current_iso_date(),
                    });
                }

                if let Some(idx) = existing_idx {
                    let prev = store.accounts.remove(idx);
                    if profile.skin_url.is_none() {
                        profile.skin_url = prev.profile.skin_url;
                        profile.skin_variant = prev.profile.skin_variant;
                    }
                }

                if let Some(skin_data_url) = &profile.skin_url {
                    if let Some(bytes) = decode_base64_png(skin_data_url) {
                        let skin_dir = self.game_dir.join("config").join("heart-identity");
                        let _ = fs::create_dir_all(&skin_dir);
                        let _ = fs::write(skin_dir.join("skin.png"), bytes);
                        let _ = fs::write(
                            skin_dir.join("skin.txt"),
                            profile.skin_variant.as_deref().unwrap_or("classic"),
                        );
                    }
                }

                let active_id = profile.id.clone();
                store.accounts.insert(
                    0,
                    StoredAccount {
                        profile: profile.clone(),
                        password: None,
                        password_hash: Some(hash),
                        password_salt: Some(salt),
                        bridge_access_token: Some(session.access_token),
                        bridge_refresh_token: session.refresh_token,
                    },
                );
                store.active_id = if remember { Some(active_id) } else { None };
                self.save_store(&store)?;
                Ok(profile)
            }
            Err(server_err) => Err(server_err),
            Ok(None) => {
                let Some(idx) = existing_idx else {
                    return Err("Не удалось подключиться к серверу Heart. Проверьте интернет.".into());
                };
                let existing = &store.accounts[idx];
                let local_ok = match (&existing.password_hash, &existing.password_salt) {
                    (Some(hash), Some(salt)) => constant_time_eq(&hash_password(password, salt), hash),
                    _ => existing.password.as_deref() == Some(password),
                };
                if !local_ok {
                    return Err("Неверный логин или пароль.".into());
                }
                if existing.bridge_access_token.is_none() && existing.bridge_refresh_token.is_none() {
                    return Err("Нет связи с сервером Heart для получения сессии. Проверьте интернет и повторите вход.".into());
                }
                let profile = existing.profile.clone();
                store.active_id = if remember { Some(profile.id.clone()) } else { None };
                self.save_store(&store)?;
                Ok(profile)
            }
        }
    }

    pub fn remove_account(&self, id: &str) -> Result<(), String> {
        let mut store = self.load_store();
        store.accounts.retain(|a| a.profile.id != id);
        if store.active_id.as_deref() == Some(id) {
            store.active_id = None;
        }
        self.save_store(&store)
    }

    pub fn update_profile(
        &self,
        current_username: &str,
        new_username: Option<&str>,
        new_email: Option<&str>,
    ) -> Result<UserProfile, String> {
        let mut store = self.load_store();
        let idx = store
            .accounts
            .iter()
            .position(|a| a.profile.username.eq_ignore_ascii_case(current_username))
            .ok_or_else(|| "Аккаунт не найден".to_string())?;

        if let Some(u) = new_username {
            let trimmed = u.trim();
            if !is_valid_username(trimmed) {
                return Err("Логин должен быть от 3 до 16 символов (латиница, цифры и _).".into());
            }
            let duplicate = store
                .accounts
                .iter()
                .enumerate()
                .any(|(i, a)| i != idx && a.profile.username.eq_ignore_ascii_case(trimmed));
            if duplicate {
                return Err("Этот логин уже занят.".into());
            }
            store.accounts[idx].profile.username = trimmed.to_string();
            if let Some(mc) = &mut store.accounts[idx].profile.minecraft {
                mc.username = trimmed.to_string();
            }
        }

        if let Some(e) = new_email {
            let trimmed = e.trim();
            if !is_valid_email(trimmed) {
                return Err("Введите корректную электронную почту.".into());
            }
            let duplicate = store
                .accounts
                .iter()
                .enumerate()
                .any(|(i, a)| i != idx && a.profile.email.eq_ignore_ascii_case(trimmed));
            if duplicate {
                return Err("Эта почта уже используется.".into());
            }
            store.accounts[idx].profile.email = trimmed.to_string();
        }

        let updated = store.accounts[idx].profile.clone();
        self.save_store(&store)?;
        Ok(updated)
    }

    pub fn save_skin(
        &self,
        username: &str,
        skin_data_url: &str,
        variant: Option<&str>,
    ) -> Result<UserProfile, String> {
        let mut store = self.load_store();
        let acc = store
            .accounts
            .iter_mut()
            .find(|a| a.profile.username.eq_ignore_ascii_case(username))
            .ok_or_else(|| "Аккаунт не найден".to_string())?;

        acc.profile.skin_url = Some(skin_data_url.to_string());
        acc.profile.skin_variant = Some(variant.unwrap_or("classic").to_string());

        let skin_dir = self.game_dir.join("config").join("heart-identity");
        let _ = fs::create_dir_all(&skin_dir);

        if let Some(bytes) = decode_base64_png(skin_data_url) {
            let _ = fs::write(skin_dir.join("skin.png"), bytes);
        }
        let _ = fs::write(skin_dir.join("skin.txt"), variant.unwrap_or("classic"));

        let updated = acc.profile.clone();
        let _ = self.save_store(&store);
        Ok(updated)
    }

    pub fn remove_skin(&self, username: &str) -> Result<UserProfile, String> {
        let mut store = self.load_store();
        let acc = store
            .accounts
            .iter_mut()
            .find(|a| a.profile.username.eq_ignore_ascii_case(username))
            .ok_or_else(|| "Аккаунт не найден".to_string())?;

        acc.profile.skin_url = None;
        let skin_dir = self.game_dir.join("config").join("heart-identity");
        let _ = fs::remove_file(skin_dir.join("skin.png"));

        let updated = acc.profile.clone();
        let _ = self.save_store(&store);
        Ok(updated)
    }
}