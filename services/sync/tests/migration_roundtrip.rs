use rusqlite::Connection;
use tempfile::tempdir;

fn migrate_v1(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
         CREATE TABLE records_current (
           entity_id TEXT PRIMARY KEY,
           server_version INTEGER NOT NULL,
           payload_hash TEXT NOT NULL
         );
         INSERT INTO schema_migrations VALUES (1, datetime('now'));",
    )
}

fn migrate_v2(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "ALTER TABLE records_current ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
         INSERT INTO schema_migrations VALUES (2, datetime('now'));",
    )
}

#[test]
fn migration_round_trip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("test.sqlite");
    {
        let conn = Connection::open(&path).unwrap();
        migrate_v1(&conn).unwrap();
        migrate_v2(&conn).unwrap();
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 2);
    }
    let conn = Connection::open(&path).unwrap();
    let has_deleted: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('records_current') WHERE name='deleted'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has_deleted, 1);
}

#[test]
fn migration_rollback_on_failure() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("fail.sqlite");
    let conn = Connection::open(&path).unwrap();
    migrate_v1(&conn).unwrap();
    let result = conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);");
    assert!(result.is_err());
    let v: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, 1);
}
