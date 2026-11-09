use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use uuid::Uuid;

use crate::productivity_db::commands::{
    create_action as create_action_cmd, create_item as create_item_cmd,
    create_list as create_list_cmd, set_list_status as set_list_status_cmd,
};
use crate::productivity_db::coordinator::{db_path, in_transaction, with_read, with_write};
use crate::productivity_db::error::DomainError;
use crate::productivity_db::read::{get_action_cmd, get_item_cmd};
use crate::productivity_db::repository::{item_order_snapshot, live_item_order_member_refs};
use crate::productivity_db::types::{
    ActionSnapshot, CreateActionRequest, CreateItemRequest, CreateListRequest, ItemOrderSnapshot,
    ItemSnapshot, ListSnapshot, RevisionRef, SetListStatusRequest,
};

pub struct TestArchive {
    pub data_dir: PathBuf,
}

impl TestArchive {
    pub fn new() -> Self {
        let mut data_dir = std::env::temp_dir();
        data_dir.push(format!("orbita-productivity-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&data_dir).expect("temp data_dir");
        init_archive(&data_dir);
        Self { data_dir }
    }

    pub fn data_dir_str(&self) -> String {
        self.data_dir.to_string_lossy().into_owned()
    }

    pub fn conn(&self) -> Connection {
        Connection::open(db_path(&self.data_dir_str())).expect("open archive")
    }

    pub fn cleanup(self) {
        let _ = fs::remove_dir_all(&self.data_dir);
    }
}

pub fn init_archive(data_dir: &Path) {
    let root = data_dir.to_string_lossy();
    with_write(&root, |_| Ok(())).expect("init archive");
}

pub fn create_list(data_dir: &str, title: &str) -> ListSnapshot {
    create_list_cmd(
        data_dir,
        CreateListRequest {
            title: title.to_string(),
            description: None,
            status: "进行中".to_string(),
            planned_point: None,
            due_point: None,
        },
    )
    .expect("create list")
    .list
}

pub fn create_item(data_dir: &str, title: &str, list_id: Option<&str>) -> ItemSnapshot {
    create_item_cmd(
        data_dir,
        CreateItemRequest {
            title: title.to_string(),
            description: None,
            status: "进行中".to_string(),
            list_id: list_id.map(str::to_string),
            priority: "none".to_string(),
            planned_point: None,
            due_point: None,
            item_type_id: None,
            tag_ids: vec![],
            classification_expected: None,
        },
    )
    .expect("create item")
    .item
}

pub fn archive_list(data_dir: &str, list: &ListSnapshot) -> ListSnapshot {
    set_list_status(data_dir, list, "已归档")
}

pub fn set_list_status(data_dir: &str, list: &ListSnapshot, status: &str) -> ListSnapshot {
    set_list_status_cmd(
        data_dir,
        SetListStatusRequest {
            list: RevisionRef {
                id: list.id.clone(),
                expected_revision: list.revision,
            },
            status: status.to_string(),
        },
    )
    .expect("set list status")
    .list
}

pub fn get_item(data_dir: &str, id: &str) -> ItemSnapshot {
    get_item_cmd(data_dir, id).expect("get item").item
}

pub fn get_action(data_dir: &str, id: &str) -> ActionSnapshot {
    get_action_cmd(data_dir, id).expect("get action").action
}

pub fn create_action_for_item(data_dir: &str, title: &str, item_id: &str) -> ActionSnapshot {
    create_action_cmd(
        data_dir,
        CreateActionRequest { expected_data_dir: None,
            title: title.to_string(),
            name_link_mode: None,
            summary: None,
            session_id: None,
            target_kind: Some("item".to_string()),
            target_id: Some(item_id.to_string()),
            planned_start_at: None,
            planned_end_at: None,
            planned_duration: None,
            appearance: None,
        },
    )
    .expect("create action")
    .action
}

pub fn create_loose_action(data_dir: &str, title: &str) -> ActionSnapshot {
    create_action_cmd(
        data_dir,
        CreateActionRequest { expected_data_dir: None,
            title: title.to_string(),
            name_link_mode: None,
            summary: None,
            session_id: None,
            target_kind: None,
            target_id: None,
            planned_start_at: None,
            planned_end_at: None,
            planned_duration: None,
            appearance: None,
        },
    )
    .expect("create loose action")
    .action
}

pub fn item_order(data_dir: &str) -> ItemOrderSnapshot {
    with_read(data_dir, |conn| {
        in_transaction(conn.unwrap(), |tx| item_order_snapshot(tx))
    })
    .expect("item order")
}

pub fn item_order_members(data_dir: &str) -> Vec<RevisionRef> {
    with_read(data_dir, |conn| {
        in_transaction(conn.unwrap(), |tx| live_item_order_member_refs(tx))
    })
    .expect("item order members")
}

pub fn live_item_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM productivity_item WHERE deleted_at_utc IS NULL",
        [],
        |r| r.get(0),
    )
    .expect("live item count")
}

pub fn live_action_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM productivity_action WHERE deleted_at_utc IS NULL",
        [],
        |r| r.get(0),
    )
    .expect("live action count")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FactSnapshot {
    pub live_items: i64,
    pub live_actions: i64,
    pub item_order_revision: i64,
}

pub fn capture_facts(archive: &TestArchive, data_dir: &str) -> FactSnapshot {
    FactSnapshot {
        live_items: live_item_count(&archive.conn()),
        live_actions: live_action_count(&archive.conn()),
        item_order_revision: item_order(data_dir).revision,
    }
}

pub fn assert_no_fact_change(archive: &TestArchive, data_dir: &str, before: &FactSnapshot) {
    let after = capture_facts(archive, data_dir);
    assert_eq!(before, &after);
}

pub fn item_revision(conn: &Connection, id: &str) -> i64 {
    conn.query_row(
        "SELECT revision FROM productivity_item WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .expect("item revision")
}

pub fn action_revision(conn: &Connection, id: &str) -> i64 {
    conn.query_row(
        "SELECT revision FROM productivity_action WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .expect("action revision")
}

pub fn list_revision(conn: &Connection, id: &str) -> i64 {
    conn.query_row(
        "SELECT revision FROM productivity_list WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .expect("list revision")
}

pub fn remove_item_from_order(conn: &Connection, item_id: &str) {
    conn.execute(
        "DELETE FROM productivity_item_order_entry WHERE item_id = ?1",
        [item_id],
    )
    .expect("remove item from order");
}

pub fn assert_err_code(err: DomainError, code: &str) {
    assert_eq!(err.code, code);
    let json = serde_json::to_string(&err).expect("serialize error");
    assert!(json.contains(code), "json missing code: {json}");
}
