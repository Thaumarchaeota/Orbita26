use std::path::PathBuf;

#[cfg(target_os = "windows")]
mod win {
    use std::ffi::OsStr;
    use std::mem::{self, MaybeUninit};
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use image::RgbaImage;
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC,
        GetDIBits, GetObjectW, HBITMAP, HDC, HGDIOBJ, ReleaseDC,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW, ShellLink,
        SLGP_UNCPRIORITY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GetIconInfo, PrivateExtractIconsW, HICON, LR_DEFAULTCOLOR,
    };
    use windows::core::Interface;
    use windows::core::PCWSTR;

    struct ComGuard;
    impl ComGuard {
        fn new() -> Self {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }
            Self
        }
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    struct AutoDc(HDC);
    impl Drop for AutoDc {
        fn drop(&mut self) {
            if !self.0.0.is_null() {
                unsafe {
                    let _ = ReleaseDC(None, self.0);
                }
            }
        }
    }

    struct AutoBitmap(HBITMAP);
    impl Drop for AutoBitmap {
        fn drop(&mut self) {
            if !self.0.0.is_null() {
                unsafe {
                    let _ = DeleteObject(HGDIOBJ::from(self.0));
                }
            }
        }
    }

    struct AutoIcon(HICON);
    impl Drop for AutoIcon {
        fn drop(&mut self) {
            if !self.0.0.is_null() {
                unsafe {
                    let _ = DestroyIcon(self.0);
                }
            }
        }
    }

    fn to_wide260(path: &Path) -> [u16; 260] {
        let mut buf = [0u16; 260];
        let wide: Vec<u16> = OsStr::new(path).encode_wide().collect();
        let n = wide.len().min(259);
        buf[..n].copy_from_slice(&wide[..n]);
        buf
    }

    fn to_wide(path: &Path) -> Vec<u16> {
        OsStr::new(path).encode_wide().chain(Some(0)).collect()
    }

    fn is_lnk(path: &Path) -> bool {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false)
    }

    fn trim_wide(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    fn resolve_lnk(lnk: &Path) -> Result<(PathBuf, i32), String> {
        let _com = ComGuard::new();
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
            let file: IPersistFile = link.cast().map_err(|e| e.to_string())?;
            file.Load(PCWSTR::from_raw(to_wide(lnk).as_ptr()), STGM_READ)
                .map_err(|e| e.to_string())?;

            let mut icon_path = [0u16; 260];
            let mut icon_index = 0i32;
            if link.GetIconLocation(&mut icon_path, &mut icon_index).is_ok() {
                let location = trim_wide(&icon_path);
                if !location.is_empty() {
                    return Ok((PathBuf::from(location), icon_index));
                }
            }

            let mut target = [0u16; 260];
            link.GetPath(&mut target, std::ptr::null_mut(), SLGP_UNCPRIORITY.0 as u32)
                .map_err(|e| e.to_string())?;
            let target_path = trim_wide(&target);
            if target_path.is_empty() {
                return Err("快捷方式无目标".into());
            }
            Ok((PathBuf::from(target_path), 0))
        }
    }

    fn resolve_icon_source(path: &Path) -> Result<(PathBuf, i32), String> {
        if is_lnk(path) {
            let (target, index) = resolve_lnk(path)?;
            if is_lnk(&target) {
                return resolve_icon_source(&target);
            }
            return Ok((target, index));
        }
        Ok((path.to_path_buf(), 0))
    }

    unsafe fn hicon_to_rgba(icon: HICON) -> Result<RgbaImage, String> {
        let bitmap_size_i32 = i32::try_from(mem::size_of::<BITMAP>()).map_err(|e| e.to_string())?;
        let biheader_size_u32 =
            u32::try_from(mem::size_of::<BITMAPINFOHEADER>()).map_err(|e| e.to_string())?;

        let mut info = MaybeUninit::uninit();
        GetIconInfo(icon, info.as_mut_ptr()).map_err(|e| e.to_string())?;
        let info = info.assume_init();

        let _hbm_mask = AutoBitmap(info.hbmMask);
        let _hbm_color = AutoBitmap(info.hbmColor);
        let _icon_guard = AutoIcon(icon);

        let mut bitmap: MaybeUninit<BITMAP> = MaybeUninit::uninit();
        let result = GetObjectW(
            HGDIOBJ::from(info.hbmColor),
            bitmap_size_i32,
            Some(bitmap.as_mut_ptr().cast()),
        );
        if result != bitmap_size_i32 {
            return Err("GetObjectW failed".into());
        }
        let bitmap = bitmap.assume_init();

        let width_u32 = bitmap.bmWidth.unsigned_abs();
        let height_u32 = bitmap.bmHeight.unsigned_abs();
        let width_usize = usize::try_from(width_u32).map_err(|e| e.to_string())?;
        let height_usize = usize::try_from(height_u32).map_err(|e| e.to_string())?;
        let expected_lines = i32::try_from(height_u32).map_err(|e| e.to_string())?;

        let buf_size = width_usize
            .checked_mul(height_usize)
            .ok_or_else(|| "buffer overflow".to_string())?;
        let mut buf = vec![0u32; buf_size];

        let dc = GetDC(None);
        if dc.0.is_null() {
            return Err("GetDC failed".into());
        }
        let _dc_guard = AutoDc(dc);

        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: biheader_size_u32,
                biWidth: bitmap.bmWidth,
                biHeight: -bitmap.bmHeight,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };
        let result = GetDIBits(
            dc,
            info.hbmColor,
            0,
            height_u32,
            Some(buf.as_mut_ptr().cast()),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        );
        if result == 0 || result != expected_lines {
            return Err("GetDIBits failed".into());
        }

        let pixel_data = std::slice::from_raw_parts(
            buf.as_ptr() as *const u8,
            buf.len() * mem::size_of::<u32>(),
        );
        let rgba_data = pixel_data
            .chunks_exact(4)
            .flat_map(|px| [px[2], px[1], px[0], px[3]])
            .collect::<Vec<_>>();

        RgbaImage::from_raw(width_u32, height_u32, rgba_data).ok_or_else(|| "invalid rgba".into())
    }

    fn extract_with_private(source: &Path, index: i32, size: i32) -> Result<RgbaImage, String> {
        let filename = to_wide260(source);
        let mut icons = [HICON::default()];
        let count = unsafe {
            PrivateExtractIconsW(
                &filename,
                index,
                size,
                size,
                Some(&mut icons),
                None,
                LR_DEFAULTCOLOR.0,
            )
        };
        if count == 0 || icons[0].0.is_null() {
            return Err("PrivateExtractIconsW failed".into());
        }
        let icon = icons[0];
        let _guard = AutoIcon(icon);
        unsafe { hicon_to_rgba(icon) }
    }

    fn extract_with_shell(source: &Path) -> Result<RgbaImage, String> {
        let wide = to_wide(source);
        let mut shfileinfo = SHFILEINFOW::default();
        let result = unsafe {
            SHGetFileInfoW(
                PCWSTR::from_raw(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut shfileinfo),
                mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            )
        };
        if result == 0 {
            return Err("SHGetFileInfoW failed".into());
        }
        let icon = shfileinfo.hIcon;
        let _guard = AutoIcon(icon);
        unsafe { hicon_to_rgba(icon) }
    }

    pub fn extract_png(path: &str, out: &PathBuf) -> Result<(), String> {
        let input = Path::new(path);
        let (source, index) = resolve_icon_source(input)?;
        let sizes = [256i32, 128, 64, 48, 32];
        let mut image = None;
        for size in sizes {
            if let Ok(img) = extract_with_private(&source, index, size) {
                image = Some(img);
                break;
            }
        }
        let mut image = match image {
            Some(img) => img,
            None => extract_with_shell(&source)?,
        };
        if image.width() > 128 {
            image = image::imageops::resize(&image, 128, 128, image::imageops::FilterType::Lanczos3);
        }
        image.save(out).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn extract_png(_path: &str, _out: &PathBuf) -> Result<(), String> {
    Err("仅 Windows 支持".into())
}

#[cfg(target_os = "windows")]
fn extract_png(path: &str, out: &PathBuf) -> Result<(), String> {
    win::extract_png(path, out)
}

pub fn cache_icon(cache_dir: &PathBuf, app_id: &str, path: &str) -> Result<String, String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let out = cache_dir.join(format!("{app_id}.png"));
    extract_png(path, &out)?;
    Ok(out.to_string_lossy().into_owned())
}

pub fn read_data_url(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

pub fn delete_cached(path: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
