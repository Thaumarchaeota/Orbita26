use std::fs;

use uuid::Uuid;

use crate::journal_archive_db::{
    create_document, detail_files, save_document, CreateDocumentRequest, SaveDocumentRequest,
};

#[test]
fn failed_document_save_preserves_other_prewrite_and_referenced_version() {
    let data_dir = std::env::temp_dir()
        .join(format!("orbita-journal-detail-test-{}", Uuid::new_v4()))
        .to_string_lossy()
        .into_owned();

    let created = create_document(
        &data_dir,
        CreateDocumentRequest {
            title: "First version".into(),
            started_at: "2026-01-10T01:30:00Z".into(),
            summary: None,
            mood: None,
            ended_at: None,
            markdown: Some("committed body".into()),
        },
    )
    .expect("create initial document");
    let entry_id = created.entry.id;
    let referenced_id = created
        .entry
        .detail_file_id
        .expect("document has a referenced detail");
    let referenced_path = detail_files::detail_file_path(&data_dir, &entry_id, &referenced_id)
        .expect("referenced detail path");

    // Model another save that has already prewritten its immutable version but
    // has not committed its SQLite pointer yet.
    let (other_prewrite_id, _) =
        detail_files::prepare_detail_version(&data_dir, &entry_id, "another in-flight body")
            .expect("prepare concurrent version");
    let other_prewrite_path = detail_files::detail_file_path(&data_dir, &entry_id, &other_prewrite_id)
        .expect("in-flight detail path");

    let failed = save_document(
        &data_dir,
        SaveDocumentRequest {
            id: entry_id.clone(),
            expected_revision: 999,
            title: Some("Must not commit".into()),
            summary: None,
            mood: None,
            started_at: None,
            ended_at: None,
            markdown: Some("this save must roll back".into()),
        },
    );
    let error = match failed {
        Err(error) => error,
        Ok(_) => panic!("stale revision must fail"),
    };
    assert_eq!(error.code, "REVISION_CONFLICT");

    assert!(
        referenced_path.is_file(),
        "rollback must preserve the currently referenced detail"
    );
    assert!(
        other_prewrite_path.is_file(),
        "rollback must not remove another operation's prewritten version"
    );
    assert_eq!(
        detail_files::load_detail_markdown(
            &data_dir,
            &entry_id,
            &referenced_id,
            created.entry.detail_sha256.as_deref().expect("detail hash"),
        )
        .expect("referenced body remains readable"),
        "committed body"
    );

    // A failed request is allowed to remove only its own prepared version.
    let markdown_files = fs::read_dir(
        detail_files::detail_dir(&data_dir, &entry_id).expect("entry detail directory"),
    )
        .expect("detail directory")
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "md"))
        .count();
    assert_eq!(markdown_files, 2, "only the committed and in-flight versions remain");
}
