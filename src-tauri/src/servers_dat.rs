use std::fs;
use std::path::Path;

pub fn ensure_server_entry(game_dir: &Path, server_name: &str, server_ip: &str) {
    let servers_path = game_dir.join("servers.dat");
    let name_bytes = server_name.as_bytes();
    let ip_bytes = server_ip.as_bytes();

    let mut server_compound = vec![
        0x08, 0x00, 0x04, b'n', b'a', b'm', b'e',
        (name_bytes.len() >> 8) as u8, (name_bytes.len() & 0xff) as u8,
    ];
    server_compound.extend_from_slice(name_bytes);
    server_compound.extend_from_slice(&[
        0x08, 0x00, 0x02, b'i', b'p',
        (ip_bytes.len() >> 8) as u8, (ip_bytes.len() & 0xff) as u8,
    ]);
    server_compound.extend_from_slice(ip_bytes);
    server_compound.extend_from_slice(&[
        0x01, 0x00, 0x0e, b'a', b'c', b'c', b'e', b'p', b't', b'T', b'e', b'x', b't', b'u', b'r', b'e', b's', 0x01,
        0x00,
    ]);

    if !servers_path.exists() {
        let mut fresh = vec![
            0x0a, 0x00, 0x00,
            0x09, 0x00, 0x07, b's', b'e', b'r', b'v', b'e', b'r', b's',
            0x0a, 0x00, 0x00, 0x00, 0x01,
        ];
        fresh.extend_from_slice(&server_compound);
        fresh.push(0x00);
        let _ = fs::write(servers_path, fresh);
        return;
    }

    if let Ok(mut data) = fs::read(&servers_path) {
        if data.windows(ip_bytes.len()).any(|w| w == ip_bytes) {
            return;
        }

        let marker = [0x09, 0x00, 0x07, b's', b'e', b'r', b'v', b'e', b'r', b's', 0x0a];
        if let Some(pos) = data.windows(marker.len()).position(|w| w == marker) {
            let count_pos = pos + marker.len();
            if count_pos + 4 <= data.len() {
                let count = i32::from_be_bytes(data[count_pos..count_pos + 4].try_into().unwrap());
                data.splice(count_pos..count_pos + 4, (count + 1).to_be_bytes());
                data.splice(count_pos + 4..count_pos + 4, server_compound);
                let _ = fs::write(servers_path, data);
            }
        }
    }
}