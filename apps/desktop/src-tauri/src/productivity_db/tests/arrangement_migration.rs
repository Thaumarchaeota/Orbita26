use rusqlite::Connection;

use crate::productivity_db::{
    coordinator::db_path,
    read::list_actions_cmd,
    schema::{read_schema_version, CURRENT_SCHEMA_VERSION},
};

use super::harness::*;

fn v11_fixture(archive: &TestArchive) {
    let conn = archive.conn();
    conn.execute_batch(
        "DROP INDEX idx_task_item_type;
         ALTER TABLE productivity_task DROP COLUMN item_type_id;
         ALTER TABLE productivity_action DROP COLUMN name_link_mode;
         UPDATE archive_meta SET value='11' WHERE key='schema_version';",
    )
    .expect("make V11 fixture");
}

fn backup_paths(archive: &TestArchive) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(archive.data_dir.join("archive").join("backups"))
        .expect("backup directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sqlite"))
        .collect()
}

#[test]
fn v11_to_v12_migration_defaults_legacy_actions_to_unlinked_and_preserves_all_facts() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let live = create_action_for_item(&data_dir, "安排 3", &item.id);
    let deleted = create_action_for_item(&data_dir, "renamed", &item.id);
    let conn = archive.conn();
    conn.execute(
        "UPDATE productivity_action SET summary='keep summary', planned_start_at='2026-01-02T03:04:05.000Z', planned_end_at='2026-01-02T04:04:05.000Z', planned_duration_seconds=NULL, ended=0, revision=41, created_at_utc='2020-01-02T03:04:05.000Z', updated_at_utc='2021-02-03T04:05:06.000Z' WHERE id=?1",
        [&live.id],
    ).unwrap();
    conn.execute(
        "UPDATE productivity_action SET target_kind='item', target_id=?1, ended=1, deleted_at_utc='2022-01-01T00:00:00.000Z', deletion_batch_id='legacy-batch', revision=23 WHERE id=?2",
        rusqlite::params![item.id, deleted.id],
    ).unwrap();
    conn.execute(
        "INSERT INTO productivity_interval (id, action_id, started_at, ended_at, created_at_utc, updated_at_utc, extra_json) VALUES ('legacy-interval', ?1, '2021-01-01T00:00:00.000Z', '2021-01-01T00:15:00.000Z', '2021-01-01T00:00:00.000Z', '2021-01-01T00:15:00.000Z', '{}')",
        [&live.id],
    ).unwrap();
    let before_live: ((String, i64, String, Option<String>, Option<String>, Option<String>, Option<String>), (Option<i64>, i64, Option<String>, Option<String>, String, String)) = conn.query_row(
        "SELECT id, revision, title, summary, session_id, target_kind, target_id, planned_duration_seconds, ended, deleted_at_utc, deletion_batch_id, created_at_utc, updated_at_utc FROM productivity_action WHERE id=?1",
        [&live.id], |r| Ok(((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?),(r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?))),
    ).unwrap();
    let before_plan: (String, String) = conn.query_row(
        "SELECT planned_start_at, planned_end_at FROM productivity_action WHERE id=?1",
        [&live.id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();
    let before_interval: (String, String, String, String) = conn.query_row(
        "SELECT id, started_at, ended_at, updated_at_utc FROM productivity_interval WHERE id='legacy-interval'",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).unwrap();
    drop(conn);
    v11_fixture(&archive);

    let migrated = list_actions_cmd(&data_dir).expect("migrate and read");
    assert_eq!(read_schema_version(&archive.conn()).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    let live_after = migrated.actions.iter().find(|a| a.id == live.id).unwrap();
    let deleted_after = migrated.actions.iter().find(|a| a.id == deleted.id).unwrap();
    assert_eq!(live_after.name_link_mode, "unlinked");
    assert_eq!(deleted_after.name_link_mode, "unlinked");
    assert_eq!(live_after.revision, 41);
    assert_eq!(deleted_after.revision, 23);
    assert_eq!(live_after.planned_start_at.as_deref(), Some(before_plan.0.as_str()));
    assert_eq!(live_after.planned_end_at.as_deref(), Some(before_plan.1.as_str()));
    assert_eq!(live_after.intervals.len(), 1);
    assert_eq!(deleted_after.deleted_at_utc.as_deref(), Some("2022-01-01T00:00:00.000Z"));

    let after = archive.conn();
    let after_live: ((String, i64, String, Option<String>, Option<String>, Option<String>, Option<String>), (Option<i64>, i64, Option<String>, Option<String>, String, String)) = after.query_row(
        "SELECT id, revision, title, summary, session_id, target_kind, target_id, planned_duration_seconds, ended, deleted_at_utc, deletion_batch_id, created_at_utc, updated_at_utc FROM productivity_action WHERE id=?1",
        [&live.id], |r| Ok(((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?),(r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?))),
    ).unwrap();
    assert_eq!(after_live, before_live);
    let after_interval: (String, String, String, String) = after.query_row(
        "SELECT id, started_at, ended_at, updated_at_utc FROM productivity_interval WHERE id='legacy-interval'",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).unwrap();
    assert_eq!(after_interval, before_interval);
    assert_eq!(after.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    assert_eq!(after.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);

    // Reopening must not apply the one-time migration again or create another backup.
    drop(after);
    let again = list_actions_cmd(&data_dir).expect("idempotent reopen");
    assert_eq!(again.actions.len(), migrated.actions.len());
    assert_eq!(backup_paths(&archive).len(), 1);
    let backup = Connection::open(&backup_paths(&archive)[0]).unwrap();
    assert_eq!(read_schema_version(&backup).unwrap(), Some(11));
    assert_eq!(backup.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    archive.cleanup();
}

#[test]
fn failed_v12_migration_keeps_v11_version_and_readable_backup() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let action = create_action_for_item(&data_dir, "legacy", &item.id);
    let conn = archive.conn();
    conn.execute_batch(
        "DROP INDEX idx_task_item_type;
         ALTER TABLE productivity_task DROP COLUMN item_type_id;
         ALTER TABLE productivity_action DROP COLUMN name_link_mode;
         ALTER TABLE productivity_action ADD COLUMN name_link_mode TEXT NOT NULL DEFAULT 'conflict';
         UPDATE archive_meta SET value='11' WHERE key='schema_version';",
    ).unwrap();
    drop(conn);

    let err = list_actions_cmd(&data_dir).unwrap_err();
    assert_err_code(err, "ARCHIVE_LIFECYCLE_ERROR");
    let raw = Connection::open(db_path(&data_dir)).unwrap();
    assert_eq!(read_schema_version(&raw).unwrap(), Some(11));
    let mode: String = raw.query_row("SELECT name_link_mode FROM productivity_action WHERE id=?1", [&action.id], |r| r.get(0)).unwrap();
    assert_eq!(mode, "conflict");
    assert_eq!(raw.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    let backups = backup_paths(&archive);
    assert_eq!(backups.len(), 1);
    let backup = Connection::open(&backups[0]).unwrap();
    assert_eq!(read_schema_version(&backup).unwrap(), Some(11));
    assert_eq!(backup.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    archive.cleanup();
}
