use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use zip::read::ZipArchive;

const MAX_ZIP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FIT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 256;
const MAX_PAUSES: usize = 256;
const FIT_EPOCH_UNIX_SECONDS: i64 = 631_065_600;

#[derive(Clone)]
struct Field { number: u8, size: usize, base_type: u8 }
#[derive(Clone)]
struct Definition { global: u16, big_endian: bool, fields: Vec<Field>, developer_sizes: Vec<usize> }

fn crc(bytes: &[u8]) -> u16 {
    let mut crc = 0u16;
    for byte in bytes {
        crc ^= u16::from(*byte);
        for _ in 0..8 { crc = if crc & 1 != 0 { (crc >> 1) ^ 0xa001 } else { crc >> 1 }; }
    }
    crc
}

fn take<'a>(bytes: &'a [u8], pos: &mut usize, count: usize) -> Result<&'a [u8], String> {
    let end = pos.checked_add(count).filter(|end| *end <= bytes.len())
        .ok_or_else(|| "truncated FIT record".to_string())?;
    let out = &bytes[*pos..end];
    *pos = end;
    Ok(out)
}

fn parse_fit(bytes: &[u8]) -> Result<Vec<(i64, i64)>, String> {
    if bytes.len() < 14 { return Err("truncated FIT header".into()); }
    let header_len = usize::from(bytes[0]);
    if header_len < 12 || header_len > bytes.len() || &bytes[8..12] != b".FIT" {
        return Err("invalid FIT header".into());
    }
    if header_len != 12 && header_len < 14 { return Err("invalid FIT header length".into()); }
    if header_len >= 14 && crc(&bytes[..header_len]) != 0 { return Err("invalid FIT header CRC".into()); }
    let data_len = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let data_end = header_len.checked_add(data_len).ok_or_else(|| "invalid FIT data size".to_string())?;
    if data_end.checked_add(2) != Some(bytes.len()) { return Err("invalid FIT data size".into()); }
    if crc(bytes) != 0 { return Err("invalid FIT CRC".into()); }
    let data = &bytes[header_len..data_end];
    let mut pos = 0;
    let mut definitions: Vec<Option<Definition>> = vec![None; 16];
    let mut last_timestamp: Option<u32> = None;
    let mut pause_start: Option<u32> = None;
    let mut timer_started = false;
    let mut last_timer: Option<u32> = None;
    let mut pauses = Vec::new();
    while pos < data.len() {
        let header = take(data, &mut pos, 1)?[0];
        let compressed = header & 0x80 != 0;
        let local = if compressed { usize::from((header >> 5) & 3) } else { usize::from(header & 15) };
        if !compressed && header & 0x40 != 0 {
            let fixed = take(data, &mut pos, 5)?;
            if fixed[1] > 1 { return Err("invalid FIT architecture".into()); }
            let big_endian = fixed[1] == 1;
            let global = if big_endian { u16::from_be_bytes([fixed[2], fixed[3]]) } else { u16::from_le_bytes([fixed[2], fixed[3]]) };
            let field_count = usize::from(fixed[4]);
            let mut fields = Vec::with_capacity(field_count);
            for _ in 0..field_count {
                let field = take(data, &mut pos, 3)?;
                fields.push(Field { number: field[0], size: usize::from(field[1]), base_type: field[2] });
            }
            let mut developer_sizes = Vec::new();
            if header & 0x20 != 0 {
                let count = usize::from(take(data, &mut pos, 1)?[0]);
                for _ in 0..count { developer_sizes.push(usize::from(take(data, &mut pos, 3)?[1])); }
            }
            definitions[local] = Some(Definition { global, big_endian, fields, developer_sizes });
            continue;
        }
        let definition = definitions[local].as_ref().ok_or_else(|| "FIT record has no definition".to_string())?;
        let mut timestamp = if compressed {
            let previous = last_timestamp.ok_or_else(|| "FIT compressed timestamp has no reference".to_string())?;
            let offset = u32::from(header & 31);
            let mut next = (previous & !31) | offset;
            if offset < (previous & 31) { next = next.checked_add(32).ok_or_else(|| "FIT timestamp overflow".to_string())?; }
            Some(next)
        } else { None };
        let mut event = None;
        let mut event_type = None;
        for field in &definition.fields {
            if compressed && field.number == 253 { continue; }
            let value = take(data, &mut pos, field.size)?;
            if field.number == 253 && field.size == 4 && field.base_type == 0x86 {
                let raw = [value[0], value[1], value[2], value[3]];
                let ts = if definition.big_endian { u32::from_be_bytes(raw) } else { u32::from_le_bytes(raw) };
                if ts != u32::MAX { timestamp = Some(ts); }
            }
            if definition.global == 21 && field.size == 1 && field.base_type == 0 {
                if field.number == 0 && value[0] != 0xff { event = Some(value[0]); }
                if field.number == 1 && value[0] != 0xff { event_type = Some(value[0]); }
            }
        }
        for size in &definition.developer_sizes { take(data, &mut pos, *size)?; }
        if let Some(ts) = timestamp { last_timestamp = Some(ts); }
        if definition.global == 21 && event == Some(0) {
            let kind = event_type.ok_or_else(|| "FIT timer event has no event type".to_string())?;
            if matches!(kind, 0 | 1 | 4 | 8 | 9) {
                let ts = timestamp.ok_or_else(|| "FIT timer event has no timestamp".to_string())?;
                if last_timer.is_some_and(|prev| ts < prev) { return Err("FIT timer events are out of order".into()); }
                last_timer = Some(ts);
                if kind == 0 {
                    if let Some(start) = pause_start.take() {
                        if ts > start {
                            if pauses.len() >= MAX_PAUSES { return Err("FIT has too many timer pauses".into()); }
                            pauses.push(((i64::from(start) + FIT_EPOCH_UNIX_SECONDS) * 1000, (i64::from(ts) + FIT_EPOCH_UNIX_SECONDS) * 1000));
                        }
                    }
                    timer_started = true;
                } else if timer_started && pause_start.is_none() { pause_start = Some(ts); }
            }
        }
    }
    Ok(pauses)
}

pub(super) fn read_activity_pauses(data_dir: &str, relative_path: &str) -> Result<Vec<(i64, i64)>, String> {
    let relative = Path::new(relative_path);
    if relative.components().any(|c| !matches!(c, Component::Normal(_))) || !relative.starts_with(Path::new("archive").join("activity-assets")) {
        return Err("invalid activity asset path".into());
    }
    // Resolve links as well as lexical traversal before opening an untrusted asset path.
    let data_root = PathBuf::from(data_dir).canonicalize().map_err(|e| format!("data directory unavailable: {e}"))?;
    let root = data_root.join("archive").join("activity-assets").canonicalize().map_err(|e| format!("activity assets unavailable: {e}"))?;
    if !root.starts_with(&data_root) { return Err("activity assets escape data directory".into()); }
    let path = PathBuf::from(data_dir).join(relative).canonicalize().map_err(|e| format!("activity asset unavailable: {e}"))?;
    if !path.starts_with(&root) { return Err("activity asset escapes its directory".into()); }
    let file = File::open(path).map_err(|e| format!("cannot open activity ZIP: {e}"))?;
    if file.metadata().map_err(|e| format!("cannot inspect activity ZIP: {e}"))?.len() > MAX_ZIP_BYTES { return Err("activity ZIP exceeds size limit".into()); }
    let mut archive = ZipArchive::new(file).map_err(|e| format!("invalid activity ZIP: {e}"))?;
    if archive.len() > MAX_ZIP_ENTRIES { return Err("activity ZIP has too many entries".into()); }
    let mut fit_index = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("invalid ZIP entry: {e}"))?;
        if !entry.is_dir() && entry.name().to_ascii_lowercase().ends_with(".fit") { fit_index = Some(i); break; }
    }
    let mut entry = archive.by_index(fit_index.ok_or_else(|| "activity ZIP contains no FIT file".to_string())?).map_err(|e| format!("invalid FIT entry: {e}"))?;
    if entry.size() > MAX_FIT_BYTES { return Err("FIT file exceeds size limit".into()); }
    let mut bytes = Vec::new();
    (&mut entry).take(MAX_FIT_BYTES + 1).read_to_end(&mut bytes).map_err(|e| format!("cannot read FIT entry: {e}"))?;
    if bytes.len() as u64 > MAX_FIT_BYTES { return Err("FIT file exceeds size limit".into()); }
    parse_fit(&bytes)
}
