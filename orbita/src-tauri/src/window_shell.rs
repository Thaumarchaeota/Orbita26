use std::time::Duration;
use tauri::WebviewWindow;

const BLEED_L: i32 = 12;
const BLEED_T: i32 = 4;
const BLEED_R: i32 = 4;
const BLEED_B: i32 = 12;

fn active_monitor(window: &WebviewWindow) -> Result<tauri::Monitor, String> {
    if let Ok(Some(m)) = window.current_monitor() {
        return Ok(m);
    }
    window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no monitor".to_string())
}

pub fn fit_work_area(window: &WebviewWindow) -> Result<(), String> {
    let _ = window.unmaximize();
    let monitor = active_monitor(window)?;
    let area = monitor.work_area();
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            area.position.x - BLEED_L,
            area.position.y - BLEED_T,
        )))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            area.size.width + (BLEED_L + BLEED_R) as u32,
            area.size.height + (BLEED_T + BLEED_B) as u32,
        )))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn attach_to_taskbar(window: &WebviewWindow) {
    let _ = window.set_skip_taskbar(false);
}

pub fn detach_from_taskbar(window: &WebviewWindow) {
    let _ = window.set_skip_taskbar(true);
    bring_to_front(window);
}

pub fn repair_window_show(window: &WebviewWindow) -> Result<(), String> {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = fit_work_area(window);
    fix_transparent_chrome(window);
    bring_to_front(window);
    Ok(())
}

pub fn repair_window_focus(window: &WebviewWindow) -> Result<(), String> {
    let _ = window.unminimize();
    let _ = window.show();
    fix_transparent_chrome(window);
    bring_to_front(window);
    let win = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        fix_transparent_chrome(&win);
    });
    Ok(())
}

pub fn repair_window(window: &WebviewWindow, reload: bool) -> Result<(), String> {
    if reload {
        repair_window_show(window)?;
        window.reload().map_err(|e| e.to_string())?;
        return Ok(());
    }
    repair_window_focus(window)
}

pub fn bring_to_front(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetForegroundWindow, SetWindowPos, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        };

        if let Ok(h) = window.hwnd() {
            let hwnd = HWND(h.0);
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOP),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                );
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(target_os = "windows")]
pub fn fix_transparent_chrome(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_BORDER_COLOR,
    };
    use windows::Win32::UI::Controls::MARGINS;

    let Ok(tauri_hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = HWND(tauri_hwnd.0);
    unsafe {
        let margins = MARGINS {
            cxLeftWidth: -1,
            cxRightWidth: -1,
            cyTopHeight: -1,
            cyBottomHeight: -1,
        };
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
        let border: u32 = 0xFFFFFFFE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn fix_transparent_chrome(_window: &WebviewWindow) {}
