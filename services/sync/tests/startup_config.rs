use orbita_sync::auth::secrets::validate_required_secrets;
use orbita_sync::config::{state_dir_from, Config, SECRET_ENROLLMENT_PEPPER, SECRET_TOKEN_PEPPER};
use tempfile::tempdir;

fn write_test_secrets() {
    let dir = tempfile::tempdir().expect("tempdir");
    let enroll = dir.path().join("enroll.pepper");
    let token = dir.path().join("token.pepper");
    std::fs::write(&enroll, "test-enrollment-pepper").unwrap();
    std::fs::write(&token, "test-token-pepper").unwrap();
    std::env::set_var(SECRET_ENROLLMENT_PEPPER.path_env, enroll);
    std::env::set_var(SECRET_TOKEN_PEPPER.path_env, token);
    std::mem::forget(dir);
}

#[test]
fn startup_rejects_missing_secrets() {
    std::env::remove_var(SECRET_TOKEN_PEPPER.path_env);
    std::env::remove_var(SECRET_ENROLLMENT_PEPPER.path_env);
    let dir = tempdir().unwrap();
    let cfg = state_dir_from(dir.path());
    assert!(validate_required_secrets().is_err());
    assert!(cfg.validate_startup().is_err());
}

#[test]
fn startup_accepts_mounted_secrets() {
    write_test_secrets();
    let dir = tempdir().unwrap();
    let mut cfg = state_dir_from(dir.path());
    cfg.backup_dir = dir.path().join("backup");
    assert!(cfg.validate_startup().is_ok());
}

#[test]
fn push_request_matches_sync_operation() {
    let raw = r#"{
        "contractVersion": "journal-health/v1",
        "deviceId": "00000000-0000-4000-8000-000000000001",
        "clientChangeSeq": 0,
        "changes": []
    }"#;
    let parsed: orbita_sync::sync::PushRequest = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.device_id, "00000000-0000-4000-8000-000000000001");
}

#[test]
fn push_request_denies_unknown_fields() {
    let raw = r#"{
        "contractVersion": "journal-health/v1",
        "deviceId": "00000000-0000-4000-8000-000000000001",
        "clientChangeSeq": 0,
        "changes": [],
        "schemaVersion": 1
    }"#;
    let parsed: Result<orbita_sync::sync::PushRequest, _> = serde_json::from_str(raw);
    assert!(parsed.is_err());
}

#[test]
fn config_toml_overrides_bind() {
    let dir = tempdir().unwrap();
    let cfg_path = dir.path().join("config.toml");
    std::fs::write(
        &cfg_path,
        "[server]\nbind = \"0.0.0.0:1234\"\n",
    )
    .unwrap();
    std::env::set_var("ORBITA_SYNC_CONFIG", cfg_path.to_str().unwrap());
    let cfg = Config::load().unwrap();
    assert_eq!(cfg.listen_addr, "0.0.0.0:1234");
}
