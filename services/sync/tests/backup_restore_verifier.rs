use orbita_sync::tools::{online_backup, isolated_restore, BackupOptions, RestoreVerifier};
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn backup_restore_verifier_end_to_end() {
    let dir = tempdir().unwrap();
    let live = dir.path().join("server.sqlite");
    let backup = dir.path().join("backup.sqlite");
    let restored = dir.path().join("restored.sqlite");

    {
        let conn = Connection::open(&live).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES (1);
             CREATE TABLE records_current (id TEXT PRIMARY KEY, v INTEGER);",
        )
        .unwrap();
    }

    online_backup(&live, &backup, &BackupOptions::default()).unwrap();

    let verifier = RestoreVerifier {
        require_integrity_check: true,
        require_schema_migrations: true,
    };
    let report = isolated_restore(&backup, &restored, &verifier).unwrap();
    assert!(report.integrity_ok);
    assert_eq!(report.migration_version, Some(1));
}
