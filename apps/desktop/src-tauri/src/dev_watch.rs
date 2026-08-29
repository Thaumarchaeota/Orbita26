use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(debug_assertions)]
fn dev_server_up() -> bool {
    reqwest::blocking::get("http://127.0.0.1:1420/")
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_up = dev_server_up();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let up = dev_server_up();
            if !up && was_up {
                eprintln!("[orbita dev] localhost:1420 不可达，请保持 dev.bat 运行或重新执行 dev.bat");
            }
            if up && !was_up {
                eprintln!("[orbita dev] Vite 已恢复，重载窗口");
                for (_, win) in app.webview_windows() {
                    let _ = win.reload();
                }
            }
            was_up = up;
        }
    });
}

#[cfg(not(debug_assertions))]
pub fn start(_app: AppHandle) {}
