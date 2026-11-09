use crate::productivity_db::{
    classification::get_catalog,
    commands::delete_item,
    coordinator::db_path,
    schema::{read_schema_version, CURRENT_SCHEMA_VERSION},
    types::{DeleteItemRequest, RevisionRef},
};
use rusqlite::{params, Connection};
use super::harness::*;

fn make_v8_fixture(archive: &TestArchive, deleted_item_id: &str) {
    let conn = archive.conn();
    conn.execute_batch("DROP INDEX idx_task_item_type; ALTER TABLE productivity_task DROP COLUMN item_type_id; DROP INDEX idx_item_type_id; DROP TABLE productivity_item_tag; DROP TABLE productivity_tag; DROP TABLE productivity_item_type; DROP TABLE productivity_item_type_catalog; ALTER TABLE productivity_item DROP COLUMN item_type_id;")
        .expect("remove V9-only schema from fixture");
    conn.execute("UPDATE archive_meta SET value='8' WHERE key='schema_version'", [])
        .expect("mark fixture V8");
    // The old Item's List relation, including for the tombstoned row, is ordinary V8 data.
    let deleted_list: Option<String> = conn.query_row(
        "SELECT list_id FROM productivity_item WHERE id=?1", [deleted_item_id], |r| r.get(0),
    ).expect("read deleted list");
    assert!(deleted_list.is_some());
}

fn assert_v9(conn: &Connection) {
    assert_eq!(read_schema_version(conn).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
}

#[test]
fn v8_to_v9_migration_preserves_all_existing_item_facts_and_creates_a_readable_backup() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "preserve");
    let live = create_item(&data_dir, "live", Some(&list.id));
    let deleted = create_item(&data_dir, "deleted", Some(&list.id));
    let deleted = delete_item(&data_dir, DeleteItemRequest {
        item: RevisionRef { id: deleted.id.clone(), expected_revision: deleted.revision },
    }).unwrap().item;
    let conn = archive.conn();
    conn.execute(
        "UPDATE productivity_item SET description='keep description', status='进行中', priority='high', planned_point_json=?1, due_point_json=?2, created_at_utc='2020-01-02T03:04:05.000Z', updated_at_utc='2021-02-03T04:05:06.000Z', revision=17 WHERE id=?3",
        params![r#"{"precision":"date","date":"2026-10-10"}"#, r#"{"precision":"date","date":"2026-10-20"}"#, live.id],
    ).unwrap();
    conn.execute(
        "UPDATE productivity_item SET description='deleted description', status='完成', priority='low', planned_point_json=?1, due_point_json=?2, created_at_utc='2019-08-07T06:05:04.000Z', updated_at_utc='2022-03-04T05:06:07.000Z', revision=23 WHERE id=?3",
        params![r#"{"precision":"date","date":"2026-01-01"}"#, r#"{"precision":"date","date":"2026-01-31"}"#, deleted.id],
    ).unwrap();
    let before_live: (Option<String>, String, String, String, Option<String>, Option<String>, String, String, i64, Option<String>) = conn.query_row(
        "SELECT description,status,list_id,priority,planned_point_json,due_point_json,created_at_utc,updated_at_utc,revision,deleted_at_utc FROM productivity_item WHERE id=?1", [&live.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?)),
    ).unwrap();
    let before_deleted: (Option<String>, String, String, String, Option<String>, Option<String>, String, String, i64, Option<String>) = conn.query_row(
        "SELECT description,status,list_id,priority,planned_point_json,due_point_json,created_at_utc,updated_at_utc,revision,deleted_at_utc FROM productivity_item WHERE id=?1", [&deleted.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?)),
    ).unwrap();
    drop(conn);
    make_v8_fixture(&archive, &deleted.id);

    let catalog = get_catalog(&data_dir).expect("migration and catalog read");
    assert!(catalog.catalog.is_none());
    let after = archive.conn();
    assert_v9(&after);
    let after_live: (Option<String>, String, String, String, Option<String>, Option<String>, String, String, i64, Option<String>, Option<String>, Vec<String>) = after.query_row(
        "SELECT description,status,list_id,priority,planned_point_json,due_point_json,created_at_utc,updated_at_utc,revision,deleted_at_utc,item_type_id,(SELECT group_concat(tag_id, ',') FROM productivity_item_tag WHERE item_id=productivity_item.id) FROM productivity_item WHERE id=?1", [&live.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get::<_,Option<String>>(11)?.map(|s|s.split(',').map(str::to_string).collect()).unwrap_or_default())),
    ).unwrap();
    assert_eq!((&after_live.0,&after_live.1,&after_live.2,&after_live.3,&after_live.4,&after_live.5,&after_live.6,&after_live.7,&after_live.8,&after_live.9), (&before_live.0,&before_live.1,&before_live.2,&before_live.3,&before_live.4,&before_live.5,&before_live.6,&before_live.7,&before_live.8,&before_live.9));
    assert_eq!(after_live.10, None);
    assert!(after_live.11.is_empty());

    let after_deleted: (Option<String>, String, String, String, Option<String>, Option<String>, String, String, i64, Option<String>, Option<String>, Vec<String>) = after.query_row(
        "SELECT description,status,list_id,priority,planned_point_json,due_point_json,created_at_utc,updated_at_utc,revision,deleted_at_utc,item_type_id,(SELECT group_concat(tag_id, ',') FROM productivity_item_tag WHERE item_id=productivity_item.id) FROM productivity_item WHERE id=?1", [&deleted.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get::<_,Option<String>>(11)?.map(|s|s.split(',').map(str::to_string).collect()).unwrap_or_default())),
    ).unwrap();
    assert_eq!((&after_deleted.0,&after_deleted.1,&after_deleted.2,&after_deleted.3,&after_deleted.4,&after_deleted.5,&after_deleted.6,&after_deleted.7,&after_deleted.8,&after_deleted.9), (&before_deleted.0,&before_deleted.1,&before_deleted.2,&before_deleted.3,&before_deleted.4,&before_deleted.5,&before_deleted.6,&before_deleted.7,&before_deleted.8,&before_deleted.9));
    assert_eq!(after_deleted.10, None);
    assert!(after_deleted.11.is_empty());

    let backups = std::fs::read_dir(archive.data_dir.join("archive").join("backups")).unwrap()
        .filter_map(Result::ok).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "sqlite")).collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let backup = Connection::open(&backups[0]).unwrap();
    assert_eq!(read_schema_version(&backup).unwrap(), Some(8));
    assert_eq!(backup.query_row("PRAGMA integrity_check", [], |r| r.get::<_,String>(0)).unwrap(), "ok");
    drop(after);
    archive.cleanup();
}

#[test]
fn failed_v9_migration_rolls_back_schema_version_and_keeps_backup_readable() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    conn.execute_batch("DROP INDEX idx_task_item_type; ALTER TABLE productivity_task DROP COLUMN item_type_id; DROP INDEX idx_item_type_id; ALTER TABLE productivity_item DROP COLUMN item_type_id; DROP TABLE productivity_item_tag; DROP TABLE productivity_tag; DROP TABLE productivity_item_type; DROP TABLE productivity_item_type_catalog;").unwrap();
    // A conflicting pre-existing V9 table makes the migration fail after its first DDL step.
    conn.execute_batch("CREATE TABLE productivity_tag (conflict INTEGER); UPDATE archive_meta SET value='8' WHERE key='schema_version';").unwrap();
    drop(conn);

    let err = get_catalog(&data_dir).unwrap_err();
    assert_err_code(err, "ARCHIVE_LIFECYCLE_ERROR");
    let raw = Connection::open(db_path(&data_dir)).unwrap();
    assert_eq!(read_schema_version(&raw).unwrap(), Some(8));
    let has_item_type_column: bool = raw.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('productivity_item') WHERE name='item_type_id'", [], |r| r.get(0),
    ).unwrap();
    assert!(!has_item_type_column, "first migration DDL must roll back");
    let backups = std::fs::read_dir(archive.data_dir.join("archive").join("backups")).unwrap()
        .filter_map(Result::ok).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "sqlite")).collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let backup = Connection::open(&backups[0]).unwrap();
    assert_eq!(read_schema_version(&backup).unwrap(), Some(8));
    assert_eq!(backup.query_row("PRAGMA integrity_check", [], |r| r.get::<_,String>(0)).unwrap(), "ok");
    archive.cleanup();
}

#[test]
fn fresh_database_is_v9_and_newer_schema_is_rejected() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    assert_v9(&archive.conn());
    archive.conn().execute("UPDATE archive_meta SET value=?1 WHERE key='schema_version'", [(CURRENT_SCHEMA_VERSION + 1).to_string()]).unwrap();
    let other = TestArchive::new();
    let _ = crate::productivity_db::classification::get_catalog(&other.data_dir_str()).unwrap();
    let err = get_catalog(&data_dir).unwrap_err();
    assert_err_code(err, "ARCHIVE_LIFECYCLE_ERROR");
    other.cleanup();
    archive.cleanup();
}
