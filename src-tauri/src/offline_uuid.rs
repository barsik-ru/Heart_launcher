use md5::{Digest, Md5};

pub fn get_offline_player_uuid(username: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(format!("OfflinePlayer:{}", username.trim()).as_bytes());
    let mut hash = hasher.finalize();

    // Преобразуем хэш в RFC 4122 v3 UUID
    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;

    let hex = hex::encode(hash);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}