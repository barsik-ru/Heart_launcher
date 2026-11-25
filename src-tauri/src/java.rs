use crate::downloader::{download_file_stream, extract_zip};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn prefer_javaw_path(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.eq_ignore_ascii_case("java.exe") {
                let javaw = path.with_file_name("javaw.exe");
                if javaw.exists() {
                    return javaw;
                }
            }
        }
    }
    path
}

pub fn find_java_binary(dir: &Path) -> Option<PathBuf> {
    let primary_name = if cfg!(windows) { "javaw.exe" } else { "java" };
    let fallback_name = if cfg!(windows) { "java.exe" } else { "java" };

    if !dir.exists() {
        return None;
    }

    let mut fallback_match: Option<PathBuf> = None;
    let mut stack = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        if let Ok(entries) = fs::read_dir(current) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.is_file() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        if name.eq_ignore_ascii_case(primary_name) {
                            return Some(p);
                        }
                        if fallback_match.is_none() && name.eq_ignore_ascii_case(fallback_name) {
                            fallback_match = Some(prefer_javaw_path(p));
                        }
                    }
                }
            }
        }
    }

    fallback_match
}

pub fn check_system_java(custom_path: &str) -> Option<PathBuf> {
    if !custom_path.trim().is_empty() {
        let p = PathBuf::from(custom_path.trim());
        if p.exists() {
            if p.is_dir() {
                if let Some(found) = find_java_binary(&p) {
                    return Some(found);
                }
            } else {
                return Some(prefer_javaw_path(p));
            }
        }
    }

    if let Ok(jh) = std::env::var("JAVA_HOME") {
        let jh_path = PathBuf::from(jh);
        let javaw = jh_path.join("bin").join(if cfg!(windows) { "javaw.exe" } else { "java" });
        if javaw.exists() {
            return Some(javaw);
        }
        let java = jh_path.join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
        if java.exists() {
            return Some(prefer_javaw_path(java));
        }
    }

    let binary = if cfg!(windows) { "javaw" } else { "java" };
    let mut cmd = Command::new(binary);
    cmd.arg("-version");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(out) = cmd.output() {
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out.stdout)
        );
        if combined.contains("21.") {
            return Some(PathBuf::from(binary));
        }
    }
    None
}

pub async fn ensure_java_21(
    game_dir: &Path,
    custom_path: &str,
    on_log: impl Fn(&str),
) -> Result<PathBuf, String> {
    let runtime_dir = game_dir.join("runtime").join("java-21");

    // 1. Проверяем уже распакованную Java в .heart/runtime/java-21
    if let Some(java) = find_java_binary(&runtime_dir) {
        return Ok(java);
    }

    // 2. Проверяем кастомную/системную Java 21
    if let Some(java) = check_system_java(custom_path) {
        return Ok(java);
    }

    // 3. Автоскачивание Adoptium JRE 21
    on_log("Загрузка портативной Java 21 (Adoptium JRE)...");
    let _ = fs::create_dir_all(&runtime_dir);

    let os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
    let archive_name = if cfg!(windows) { "jre21.zip" } else { "jre21.tar.gz" };
    let temp_archive = game_dir.join("runtime").join(archive_name);
    let _ = fs::remove_file(&temp_archive);

    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/21/ga/{}/{}/jre/hotspot/normal/eclipse",
        os, arch
    );

    download_file_stream(&url, &temp_archive, |_, _| {}).await?;

    on_log("Распаковка Java 21...");
    if let Err(err) = extract_zip(&temp_archive, &runtime_dir) {
        let _ = fs::remove_file(&temp_archive);
        return Err(format!("Ошибка распаковки Java 21: {}", err));
    }
    let _ = fs::remove_file(&temp_archive);

    find_java_binary(&runtime_dir)
        .ok_or_else(|| "Не удалось найти javaw.exe после распаковки Java 21".into())
}