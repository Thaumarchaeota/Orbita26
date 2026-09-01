use serde::Serialize;

#[derive(Serialize)]
struct RedactedLogEvent<'a> {
    request_id: &'a str,
    device_id_hash: &'a str,
    error_code: &'a str,
    op_count: u32,
}

fn redact_device_id(device_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(device_id.as_bytes());
    format!("{:x}", hash)[..12].to_string()
}

fn redact_payload(payload: &str) -> String {
    if payload.is_empty() {
        String::new()
    } else {
        "[REDACTED]".into()
    }
}

#[test]
fn logs_contain_no_raw_content() {
    let event = RedactedLogEvent {
        request_id: "req-abc",
        device_id_hash: &redact_device_id("device-secret-uuid"),
        error_code: "conflict",
        op_count: 3,
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(!json.contains("device-secret-uuid"));
    assert!(!json.contains("journal body"));
    assert!(json.contains("device_id_hash"));
}

#[test]
fn payload_redaction() {
    assert_eq!(redact_payload("sensitive note content"), "[REDACTED]");
    assert_eq!(redact_payload(""), "");
}

#[test]
fn device_id_hash_stable() {
    let h1 = redact_device_id("dev-1");
    let h2 = redact_device_id("dev-1");
    assert_eq!(h1, h2);
    assert_ne!(h1, "dev-1");
}
