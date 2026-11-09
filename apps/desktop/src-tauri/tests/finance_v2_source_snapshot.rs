#[path = "../src/finance_v2_source/mod.rs"]
mod finance_v2_source;

use finance_v2_source::{
    RawSourceField, RawSourceFieldValue, RawSourceRecord, SnapshotError,
    SourceOccurrenceRef, SourceRowSnapshot,
};

fn source_ref() -> SourceOccurrenceRef {
    SourceOccurrenceRef::new("artifact-a", "page=1,row=2", "occurrence-1")
}

fn field(name: &str, value: RawSourceFieldValue) -> RawSourceField {
    RawSourceField::new(name, value)
}

#[test]
fn preserves_order_duplicate_names_empty_names_and_original_text() {
    let record = RawSourceRecord::Fields(vec![
        field("摘要", RawSourceFieldValue::Text("示例消费".into())),
        field("", RawSourceFieldValue::Text("001.20".into())),
        field("订单号", RawSourceFieldValue::Text("00001234567890123456".into())),
        field("摘要", RawSourceFieldValue::Empty),
    ]);

    let snapshot = SourceRowSnapshot::new(source_ref(), "profile-a", "revision-1", record)
        .expect("valid source record should produce a snapshot");

    assert_eq!(snapshot.raw_text_version(), 1);
    assert_eq!(snapshot.profile_id(), "profile-a");
    assert_eq!(snapshot.profile_revision(), "revision-1");
    assert_eq!(snapshot.source_ref().artifact_id(), "artifact-a");
    assert_eq!(snapshot.source_ref().locator(), "page=1,row=2");
    assert_eq!(
        snapshot.source_ref().occurrence_discriminator(),
        "occurrence-1"
    );
    assert_eq!(
        snapshot.raw_text(),
        "\"摘要\"=\"示例消费\" | \"\"=\"001.20\" | \"订单号\"=\"00001234567890123456\" | \"摘要\"=\"\""
    );
}

#[test]
fn distinguishes_missing_from_text_while_empty_and_empty_text_share_encoding() {
    let snapshot = SourceRowSnapshot::new(
        source_ref(),
        "profile-a",
        "revision-1",
        RawSourceRecord::Fields(vec![
            field("empty", RawSourceFieldValue::Empty),
            field("empty-text", RawSourceFieldValue::Text(String::new())),
            field("missing", RawSourceFieldValue::Missing),
            field(
                "marker-text",
                RawSourceFieldValue::Text("<missing>".into()),
            ),
            field("slash", RawSourceFieldValue::Text("/".into())),
            field("space", RawSourceFieldValue::Text(" ".into())),
        ]),
    )
    .expect("valid values should be encoded");

    assert_eq!(
        snapshot.raw_text(),
        "\"empty\"=\"\" | \"empty-text\"=\"\" | \"missing\"=<missing> | \"marker-text\"=\"<missing>\" | \"slash\"=\"/\" | \"space\"=\" \""
    );
}

#[test]
fn json_encodes_control_characters_and_forces_unicode_line_separator_escapes() {
    let snapshot = SourceRowSnapshot::new(
        source_ref(),
        "profile-a",
        "revision-1",
        RawSourceRecord::Fields(vec![field(
            "quoted\"|\\\r\n",
            RawSourceFieldValue::Text("tab\tcontrol\u{0001}|actual\u{2028}line\u{2029}end\\u2028".into()),
        )]),
    )
    .expect("valid Unicode should be encoded");

    assert_eq!(
        snapshot.raw_text(),
        "\"quoted\\\"|\\\\\\r\\n\"=\"tab\\tcontrol\\u0001|actual\\u2028line\\u2029end\\\\u2028\""
    );
    assert!(!snapshot.raw_text().contains('\n'));
    assert!(!snapshot.raw_text().contains('\r'));
    assert!(!snapshot.raw_text().contains('\u{2028}'));
    assert!(!snapshot.raw_text().contains('\u{2029}'));
}

#[test]
fn text_records_use_the_same_json_encoding_without_invented_fields() {
    let snapshot = SourceRowSnapshot::new(
        source_ref(),
        "profile-a",
        "revision-1",
        RawSourceRecord::Text("first line\r\nsecond\u{2028}line".into()),
    )
    .expect("text record should be encoded");

    assert_eq!(
        snapshot.raw_text(),
        "\"first line\\r\\nsecond\\u2028line\""
    );
}

#[test]
fn construction_is_deterministic_and_snapshot_owns_its_input() {
    let mut original = String::from("001.20");
    let record = RawSourceRecord::Fields(vec![field(
        "amount",
        RawSourceFieldValue::Text(original.clone()),
    )]);

    let first = SourceRowSnapshot::new(
        source_ref(),
        "profile-a",
        "revision-1",
        record.clone(),
    )
    .expect("record should be valid");
    let second = SourceRowSnapshot::new(source_ref(), "profile-a", "revision-1", record)
        .expect("same record should be valid");

    original.clear();
    original.push_str("99.00");

    assert_eq!(first, second);
    assert_eq!(first.raw_text(), "\"amount\"=\"001.20\"");
}

#[test]
fn identical_text_at_different_occurrences_keeps_distinct_identity() {
    let first = SourceRowSnapshot::new(
        SourceOccurrenceRef::new("artifact-a", "row=1", "occurrence-1"),
        "profile-a",
        "revision-1",
        RawSourceRecord::Text("same".into()),
    )
    .expect("first occurrence should be valid");
    let second = SourceRowSnapshot::new(
        SourceOccurrenceRef::new("artifact-a", "row=1", "occurrence-2"),
        "profile-a",
        "revision-1",
        RawSourceRecord::Text("same".into()),
    )
    .expect("second occurrence should be valid");
    let third = SourceRowSnapshot::new(
        SourceOccurrenceRef::new("artifact-b", "row=1", "occurrence-1"),
        "profile-a",
        "revision-1",
        RawSourceRecord::Text("same".into()),
    )
    .expect("different artifact should be valid");

    assert_eq!(first.raw_text(), second.raw_text());
    assert_ne!(first.source_ref(), second.source_ref());
    assert_ne!(first.source_ref(), third.source_ref());
}

#[test]
fn rejects_blank_reference_parts_and_empty_field_records() {
    let cases = [
        (
            SourceOccurrenceRef::new(" ", "row=1", "occurrence-1"),
            "profile-a",
            "revision-1",
            RawSourceRecord::Text("record".into()),
            SnapshotError::EmptyArtifactId,
        ),
        (
            SourceOccurrenceRef::new("artifact-a", "\t", "occurrence-1"),
            "profile-a",
            "revision-1",
            RawSourceRecord::Text("record".into()),
            SnapshotError::EmptyLocator,
        ),
        (
            SourceOccurrenceRef::new("artifact-a", "row=1", "\n"),
            "profile-a",
            "revision-1",
            RawSourceRecord::Text("record".into()),
            SnapshotError::EmptyOccurrenceDiscriminator,
        ),
        (
            source_ref(),
            " ",
            "revision-1",
            RawSourceRecord::Text("record".into()),
            SnapshotError::EmptyProfileId,
        ),
        (
            source_ref(),
            "profile-a",
            "\r\n",
            RawSourceRecord::Text("record".into()),
            SnapshotError::EmptyProfileRevision,
        ),
        (
            source_ref(),
            "profile-a",
            "revision-1",
            RawSourceRecord::Fields(Vec::new()),
            SnapshotError::EmptyRecord,
        ),
    ];

    for (source_ref, profile_id, profile_revision, record, expected) in cases {
        assert_eq!(
            SourceRowSnapshot::new(source_ref, profile_id, profile_revision, record),
            Err(expected)
        );
    }
}
