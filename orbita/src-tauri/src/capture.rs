use base64::{engine::general_purpose::STANDARD, Engine};
use image::{GenericImageView, ImageEncoder};
use screenshots::Screen;
use serde::Serialize;
use std::io::Cursor;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureScreenResult {
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
}

pub fn capture_primary_screen() -> Result<CaptureScreenResult, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.first().ok_or("未找到显示器")?;
    let img = screen.capture().map_err(|e| e.to_string())?;
    let w = img.width();
    let h = img.height();
    let mut bytes = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(Cursor::new(&mut bytes));
    enc.write_image(
        img.as_raw(),
        w,
        h,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| e.to_string())?;
    Ok(CaptureScreenResult {
        width: w,
        height: h,
        png_base64: STANDARD.encode(bytes),
    })
}

pub fn decode_png_base64(b64: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(b64.trim()).map_err(|e| e.to_string())
}

pub fn copy_png_to_clipboard(b64: &str) -> Result<(), String> {
    let bytes = decode_png_base64(b64)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width: w as usize,
        height: h as usize,
        bytes: rgba.into_raw().into(),
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_png_file(app: &AppHandle, b64: &str) -> Result<String, String> {
    let bytes = decode_png_base64(b64)?;
    let data_dir = crate::data::get_data_dir(app)?;
    if data_dir.trim().is_empty() {
        return Err("请先在设置中配置数据目录".into());
    }
    let dir = PathBuf::from(data_dir).join("screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("screenshot-{now}.png"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn crop_png_base64(b64: &str, x: u32, y: u32, w: u32, h: u32) -> Result<String, String> {
    if w == 0 || h == 0 {
        return Err("选区无效".into());
    }
    let bytes = decode_png_base64(b64)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let (iw, ih) = img.dimensions();
    let x = x.min(iw.saturating_sub(1));
    let y = y.min(ih.saturating_sub(1));
    let w = w.min(iw - x);
    let h = h.min(ih - y);
    if w == 0 || h == 0 {
        return Err("选区无效".into());
    }
    let cropped = img.crop_imm(x, y, w, h);
    let rgba = cropped.to_rgba8();
    let mut out = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(Cursor::new(&mut out));
    enc.write_image(
        rgba.as_raw(),
        w,
        h,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(out))
}
