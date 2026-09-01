use anyhow::{anyhow, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn hash_input_field(record_type: &str) -> Option<&'static str> {
    match record_type {
        "daily_metrics" => Some("data"),
        "metric_day_snapshot" => Some("payload"),
        "sleep_night" => Some("night"),
        "nap" | "meal" | "body_measurement" | "event" | "mood" | "note" => Some("payload"),
        "activity" => Some("activity"),
        _ => None,
    }
}

pub fn snapshot_content_hash(record_type: &str, snapshot: &Value) -> Result<String> {
    if let Some(field) = hash_input_field(record_type) {
        let input = snapshot
            .get(field)
            .ok_or_else(|| anyhow!("missing hash input field '{field}' for {record_type}"))?;
        Ok(content_hash(input))
    } else {
        Err(anyhow!("unknown record_type for hash: {record_type}"))
    }
}

pub fn tombstone_content_hash(tombstone: &Value) -> String {
    content_hash(tombstone)
}

fn escape_json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => {
                use std::fmt::Write as _;
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}

/// RFC 8785/JCS-compatible JSON for the I-JSON values admitted by contracts.
/// Object member names are ordered by UTF-16 code units, not Rust UTF-8 scalar
/// order; clients in different languages otherwise hash non-BMP keys differently.
pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => canonical_number(n),
        Value::String(s) => format!("\"{}\"", escape_json_string(s)),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| utf16_cmp(a, b));
            let parts: Vec<String> = keys
                .iter()
                .map(|k| {
                    format!(
                        "\"{}\":{}",
                        escape_json_string(k),
                        canonical_json(&map[*k])
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

fn utf16_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

pub fn content_hash(value: &Value) -> String {
    let canonical = canonical_json(value);
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

fn canonical_number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    if let Some(f) = n.as_f64() {
        if f == 0.0 {
            return "0".to_string();
        }
        let mut buf = ryu::Buffer::new();
        let shortest = buf.format_finite(f);
        return normalize_jcs_number(shortest);
    }
    n.to_string()
}

/// Ryu provides the shortest round-trippable IEEE-754 decimal. JCS uses that
/// value with ECMAScript's fixed/scientific boundary and normalized exponent.
fn normalize_jcs_number(shortest: &str) -> String {
    let (mantissa, exponent) = match shortest.find(['e', 'E']) {
        Some(index) => (&shortest[..index], shortest[index + 1..].parse::<i32>().unwrap_or(0)),
        None => return trim_fraction(shortest),
    };
    let digits = mantissa.replace('.', "");
    let negative = digits.starts_with('-');
    let magnitude_digits = if negative { &digits[1..] } else { &digits[..] };
    let decimal_index = mantissa
        .find('.')
        .map(|dot| dot as i32 - if negative { 1 } else { 0 })
        .unwrap_or_else(|| magnitude_digits.len() as i32);
    let decimal_exponent = decimal_index + exponent;
    // ECMAScript uses fixed notation for [1e-6, 1e21).
    if (-6..21).contains(&(decimal_exponent - 1)) {
        let mut out = String::new();
        if negative {
            out.push('-');
        }
        if decimal_exponent <= 0 {
            out.push_str("0.");
            out.push_str(&"0".repeat((-decimal_exponent) as usize));
            out.push_str(magnitude_digits);
        } else if decimal_exponent as usize >= magnitude_digits.len() {
            out.push_str(magnitude_digits);
            out.push_str(&"0".repeat(decimal_exponent as usize - magnitude_digits.len()));
        } else {
            out.push_str(&magnitude_digits[..decimal_exponent as usize]);
            out.push('.');
            out.push_str(&magnitude_digits[decimal_exponent as usize..]);
        }
        return trim_fraction(&out);
    }
    let mantissa = trim_fraction(mantissa);
    if exponent >= 0 {
        format!("{mantissa}e+{exponent}")
    } else {
        format!("{mantissa}e{exponent}")
    }
}

fn trim_fraction(number: &str) -> String {
    number
        .strip_suffix(".0")
        .unwrap_or(number)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorted_keys_stable() {
        let a = json!({"b": 2, "a": 1});
        let b = json!({"a": 1, "b": 2});
        assert_eq!(canonical_json(&a), canonical_json(&b));
        assert_eq!(content_hash(&a), content_hash(&b));
    }

    #[test]
    fn utf8_string_unescaped() {
        let v = json!({"emoji": "😀"});
        let s = canonical_json(&v);
        assert!(s.contains("😀"));
        assert!(!s.contains("\\u"));
    }

    #[test]
    fn activity_fixture_payload_hash() {
        let activity = json!({
            "sport": "running",
            "duration": 3600,
            "metrics": {
                "startTime": 1704067200,
                "distance": 10000,
                "distance_km": 10.0,
                "avg_speed_kmh": 10.0
            }
        });
        assert_eq!(
            content_hash(&activity),
            "a7bf8fe9da69757bcc4bbb194306d4a73e0fea0a41ec0c14a3fa0e49ee8eb5f1"
        );
    }

    #[test]
    fn hash_input_not_envelope() {
        let snap = json!({
            "id": "00000000-0000-4000-8000-000000000001",
            "revision": 99,
            "activity": {"sport": "run", "duration": 1, "metrics": {"startTime": 1}}
        });
        let envelope_hash = content_hash(&snap);
        let payload_hash = snapshot_content_hash("activity", &snap).unwrap();
        assert_ne!(envelope_hash, payload_hash);
    }
}
