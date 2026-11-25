use crate::types::ServerStatus;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

fn write_varint(val: i32) -> Vec<u8> {
    let mut v = val as u32;
    let mut res = Vec::new();
    loop {
        let mut byte = (v & 0x7F) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        res.push(byte);
        if v == 0 {
            break;
        }
    }
    res
}

async fn read_varint<R: AsyncReadExt + Unpin>(reader: &mut R) -> Result<i32, String> {
    let mut val: i32 = 0;
    let mut pos: u8 = 0;
    loop {
        let b = reader.read_u8().await.map_err(|e| e.to_string())?;
        val |= ((b & 0x7F) as i32) << pos;
        if (b & 0x80) == 0 {
            break;
        }
        pos += 7;
        if pos >= 35 {
            return Err("VarInt too large".to_string());
        }
    }
    Ok(val)
}

async fn do_query(host: &str, port: u16, addr: &str, start: Instant) -> Result<ServerStatus, String> {
    let mut stream = TcpStream::connect(addr).await.map_err(|e| e.to_string())?;

    // 1. Handshake Packet (id: 0x00, protocol: 765, host, port, next_state: 1)
    let mut handshake = vec![0x00];
    handshake.extend(write_varint(765));
    let host_bytes = host.as_bytes();
    handshake.extend(write_varint(host_bytes.len() as i32));
    handshake.extend_from_slice(host_bytes);
    handshake.extend_from_slice(&port.to_be_bytes());
    handshake.extend(write_varint(1));

    let mut packet = write_varint(handshake.len() as i32);
    packet.extend(handshake);
    stream.write_all(&packet).await.map_err(|e| e.to_string())?;

    // 2. Status Request Packet
    stream.write_all(&[0x01, 0x00]).await.map_err(|e| e.to_string())?;

    // 3. Чтение ответа
    let _packet_len = read_varint(&mut stream).await?;
    let packet_id = read_varint(&mut stream).await?;
    if packet_id != 0 {
        return Err("Unexpected packet ID".to_string());
    }

    let json_len = read_varint(&mut stream).await?;
    let mut json_buf = vec![0u8; json_len as usize];
    stream.read_exact(&mut json_buf).await.map_err(|e| e.to_string())?;

    let json_str = String::from_utf8(json_buf).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    let players = parsed["players"]["online"].as_u64().unwrap_or(0) as u32;
    let capacity = parsed["players"]["max"].as_u64().unwrap_or(0) as u32;
    let motd = parsed["description"]["text"]
        .as_str()
        .unwrap_or("Heart Minecraft Server")
        .to_string();

    Ok(ServerStatus {
        online: true,
        players,
        capacity,
        latency: Some(start.elapsed().as_millis() as u64),
        message: motd,
        address: addr.to_string(),
    })
}

pub async fn query_server(host: &str, port: u16) -> ServerStatus {
    let addr = format!("{}:{}", host, port);
    let start = Instant::now();

    match timeout(Duration::from_millis(3500), do_query(host, port, &addr, start)).await {
        Ok(Ok(status)) => status,
        _ => ServerStatus {
            online: false,
            players: 0,
            capacity: 0,
            latency: None,
            message: "Сервер недоступен".into(),
            address: addr,
        },
    }
}