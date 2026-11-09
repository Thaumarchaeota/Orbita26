use std::path::Path;

use uuid::Uuid;

use crate::journal_archive_db::{
    create_document, save_document, CreateDocumentRequest, SaveDocumentRequest,
};

#[test]
fn save_document_rejects_non_uuid_and_path_ids_before_writing_files() {
    let data_dir = std::env::temp_dir()
        .join(format!("orbita-journal-path-test-{}", Uuid::new_v4()))
        .to_string_lossy()
        .into_owned();
    let created = create_document(
        &data_dir,
        CreateDocumentRequest {
            title: "Path validation".into(),
            started_at: "2026-01-10T01:30:00Z".into(),
            summary: None,
            mood: None,
            ended_at: None,
            markdown: Some("body".into()),
        },
    )
    .expect("create valid document");

    let absolute_id = Path::new(&data_dir)
        .join("absolute-target")
        .to_string_lossy()
        .into_owned();
    let cases = [
        ("not-a-uuid".to_string(), Path::new(&data_dir).join("archive/journal-details/not-a-uuid")),
        ("../../escape-target".to_string(), Path::new(&data_dir).join("escape-target")),
        (absolute_id, Path::new(&data_dir).join("absolute-target")),
    ];

    for (id, unexpected_path) in cases {
        let result = save_document(
            &data_dir,
            SaveDocumentRequest {
                id,
                expected_revision: created.entry.revision,
                title: Some("Must not write".into()),
                summary: None,
                mood: None,
                started_at: None,
                ended_at: None,
                markdown: Some("must remain unwritten".into()),
            },
        );
        assert!(result.is_err(), "invalid entry id must be rejected");
        assert!(
            !unexpected_path.exists(),
            "invalid id must not create files or directories at {}",
            unexpected_path.display()
        );
    }
}
