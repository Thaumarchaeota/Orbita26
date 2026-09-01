use std::fs;
use std::path::PathBuf;

use orbita_sync::canonical::{canonical_json, content_hash};
use serde_json::Value;

fn contracts_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("contracts")
        .join("journal-health")
        .join("v1")
}

#[test]
fn canonical_hash_vectors_match_contracts() {
    let path = contracts_root().join("test-vectors").join("canonical-hashes.json");
    let raw = fs::read_to_string(&path).expect("canonical-hashes.json");
    let doc: Value = serde_json::from_str(&raw).expect("parse vectors");
    let vectors = doc["vectors"].as_array().expect("vectors array");

    for vector in vectors {
        let id = vector["id"].as_str().unwrap_or("?");
        let input = &vector["input"];
        let expected_canonical = vector["canonical"].as_str().expect("canonical");
        let expected_hash = vector["sha256"].as_str().expect("sha256");

        let actual_canonical = canonical_json(input);
        let actual_hash = content_hash(input);

        assert_eq!(
            actual_canonical, expected_canonical,
            "canonical mismatch for vector {id}"
        );
        assert_eq!(actual_hash, expected_hash, "hash mismatch for vector {id}");
    }
}

#[test]
fn fixture_activity_content_hash() {
    let path = contracts_root().join("fixtures").join("activity.json");
    let raw = fs::read_to_string(&path).expect("activity.json");
    let fixture: Value = serde_json::from_str(&raw).expect("parse fixture");
    let activity = &fixture["activity"];
    let expected = fixture["contentHash"].as_str().expect("contentHash");
    assert_eq!(content_hash(activity), expected);
}
