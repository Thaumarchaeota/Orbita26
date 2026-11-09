//! Independent adversarial cases for the in-memory Finance v2 source snapshot.
//!
//! This file checks information preservation and ownership boundaries that are
//! easy to lose while making the serializer convenient.  It uses synthetic
//! values only and never reads a source artifact.

#[path = "../src/finance_v2_source/mod.rs"]
mod finance_v2_source;

use finance_v2_source::{
    RawSourceField, RawSourceFieldValue, RawSourceRecord, SourceOccurrenceRef,
    SourceRowSnapshot,
};

#[test]
fn preserves_numeric_looking_text_whitespace_and_unicode_without_normalization() {
    let snapshot = SourceRowSnapshot::new(
        SourceOccurrenceRef::new("artifact", "row=7", "occurrence=7"),
        "profile",
        "rev-1",
        RawSourceRecord::Fields(vec![
            RawSourceField::new(
                "金额",
                RawSourceFieldValue::Text(" 001.20 ".to_owned()),
            ),
            RawSourceField::new(
                "订单",
                RawSourceFieldValue::Text("-0.00/0000000000000000000001".to_owned()),
            ),
            RawSourceField::new(
                "组合",
                RawSourceFieldValue::Text("e\u{301} / é".to_owned()),
            ),
        ]),
    )
    .expect("synthetic fields should produce a snapshot");

    assert_eq!(
        snapshot.raw_text(),
        "\"金额\"=\" 001.20 \" | \"订单\"=\"-0.00/0000000000000000000001\" | \"组合\"=\"e\u{301} / é\""
    );
}

#[test]
fn snapshot_owns_reference_and_profile_input_after_construction() {
    let mut artifact = String::from("artifact-before");
    let mut locator = String::from("locator-before");
    let mut occurrence = String::from("occurrence-before");
    let mut profile = String::from("profile-before");
    let mut revision = String::from("revision-before");

    let snapshot = SourceRowSnapshot::new(
        SourceOccurrenceRef::new(&artifact, &locator, &occurrence),
        &profile,
        &revision,
        RawSourceRecord::Text("original".into()),
    )
    .expect("snapshot should own copied input");

    artifact.replace_range(.., "artifact-after");
    locator.replace_range(.., "locator-after");
    occurrence.replace_range(.., "occurrence-after");
    profile.replace_range(.., "profile-after");
    revision.replace_range(.., "revision-after");

    assert_eq!(snapshot.source_ref().artifact_id(), "artifact-before");
    assert_eq!(snapshot.source_ref().locator(), "locator-before");
    assert_eq!(
        snapshot.source_ref().occurrence_discriminator(),
        "occurrence-before"
    );
    assert_eq!(snapshot.profile_id(), "profile-before");
    assert_eq!(snapshot.profile_revision(), "revision-before");
    assert_eq!(snapshot.raw_text(), "\"original\"");
}

#[test]
fn repeated_occurrence_identity_is_not_derived_from_raw_text() {
    let record = RawSourceRecord::Text("same raw row".to_owned());
    let first = SourceRowSnapshot::new(
        SourceOccurrenceRef::new("artifact", "page=1,row=1", "first"),
        "profile",
        "1",
        record.clone(),
    )
    .expect("first occurrence should be valid");
    let second = SourceRowSnapshot::new(
        SourceOccurrenceRef::new("artifact", "page=1,row=1", "second"),
        "profile",
        "1",
        record,
    )
    .expect("second occurrence should be valid");

    assert_eq!(first.raw_text(), second.raw_text());
    assert_ne!(first.source_ref(), second.source_ref());
}

