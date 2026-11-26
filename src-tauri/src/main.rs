#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod commands;
mod downloader;
mod heartbridge;
mod java;
mod launcher;
mod minecraft_ping;
mod offline_uuid;
mod servers_dat;
mod types;
mod updater;

use commands::*;
use updater::{updater_check, updater_download, updater_get_status, updater_install};

#[cfg(windows)]
fn trim_all_process_tree() {
    use std::ffi::c_void;
    use std::mem::size_of;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> *mut c_void;
        fn Process32FirstW(h_snapshot: *mut c_void, lppe: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(h_snapshot: *mut c_void, lppe: *mut ProcessEntry32W) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> *mut c_void;
        fn SetProcessWorkingSetSize(h_process: *mut c_void, min: usize, max: usize) -> i32;
        fn GetCurrentProcess() -> *mut c_void;
        fn GetCurrentProcessId() -> u32;
    }

    unsafe {
        let my_pid = GetCurrentProcessId();
        SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);

        let snapshot = CreateToolhelp32Snapshot(0x00000002, 0);
        if !snapshot.is_null() && snapshot != -1isize as *mut c_void {
            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.dw_size = size_of::<ProcessEntry32W>() as u32;

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    if entry.th32_parent_process_id == my_pid {
                        let child_handle = OpenProcess(0x0100 | 0x1000, 0, entry.th32_process_id);
                        if !child_handle.is_null() {
                            SetProcessWorkingSetSize(child_handle, usize::MAX, usize::MAX);
                            CloseHandle(child_handle);
                        }
                    }
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
    }
}

fn main() {
    updater::cleanup_old_update_artifacts();
    if cfg!(windows) {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu \
             --disable-gpu-compositing \
             --disable-d3d11 \
             --js-flags=--max-old-space-size=40,--expose-gc \
             --disable-background-networking \
             --disable-background-timer-throttling \
             --disable-renderer-backgrounding \
             --disable-extensions \
             --disable-default-apps \
             --disable-sync \
             --disable-domain-reliability \
             --disable-features=Translate,OptimizationHints,MediaRouter,AudioServiceOutOfProcess,CalculateNativeWinOcclusion,InterestFeedContentSuggestions \
             --enable-features=msLowPriorityProcess \
             --renderer-process-limit=1"
        );
    }

    tauri::Builder::default()
        .setup(|app| {
            #[cfg(windows)]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(10));
                        if let Some(win) = tauri::Manager::get_webview_window(&handle, "main") {
                            let _ = win.eval("window.gc && window.gc()");
                        }
                        trim_all_process_tree();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_get_memory,
            system_get_screen_resolution,
            app_get_info,
            system_open_game_folder,
            system_open_discord,
            server_get_status,
            news_get,
            news_get_article,
            modpack_get_info,
            settings_get,
            settings_update,
            auth_register,
            auth_login,
            auth_logout,
            auth_get_current_profile,
            auth_sync_profile,
            auth_get_saved_accounts,
            auth_remove_account,
            auth_update_profile,
            auth_save_skin,
            auth_remove_skin,
            launcher_launch,
            launcher_install,
            launcher_update,
            launcher_verify,
            dialog_select_path,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
            updater_get_status,
            updater_check,
            updater_download,
            updater_install
        ])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска Heart Launcher");
}