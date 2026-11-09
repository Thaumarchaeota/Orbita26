use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::productivity_db::util::{new_uuid, utc_now};

use super::error::{WorkspaceError, WorkspaceResult};
use super::types::*;

pub const ROOT_CONTAINER_ID: &str = "workspace-root";
pub const ITEM_ORDER_ID: &str = "item-order";

pub(crate) const DOMAIN_PRODUCTIVITY: &str = "productivity";
pub(crate) const DOMAIN_JOURNAL: &str = "journal";
pub(crate) const TYPE_PROJECT: &str = "project";
pub(crate) const TYPE_LIST: &str = "list";
pub(crate) const TYPE_ENTRY: &str = "entry";

pub(crate) struct ContainerRow {
    pub id: String,
    pub kind: String,
    pub title: Option<String>,
    pub revision: i64,
    pub root_position: Option<i32>,
    pub deleted_at_utc: Option<String>,
}

pub(crate) struct MemberRow {
    pub id: String,
    pub container_id: String,
    pub position: i32,
    pub member_kind: String,
    pub domain: Option<String>,
    pub object_type: Option<String>,
    pub object_id: Option<String>,
    pub link_kind: Option<String>,
    pub link_title: Option<String>,
    pub link_url: Option<String>,
    pub revision: i64,
}

fn map_sqlite(e: rusqlite::Error) -> WorkspaceError {
    WorkspaceError::archive_lifecycle(e.to_string())
}

pub(crate) fn check_revision(expected: i64, actual: i64) -> WorkspaceResult<()> {
    if expected != actual {
        return Err(WorkspaceError::revision_conflict("revision mismatch"));
    }
    Ok(())
}

pub(crate) fn load_container(conn: &Connection, id: &str) -> WorkspaceResult<ContainerRow> {
    conn.query_row(
        "SELECT id, kind, title, revision, root_position, deleted_at_utc FROM workspace_container WHERE id = ?1",
        [id],
        |row| {
            Ok(ContainerRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                revision: row.get(3)?,
                root_position: row.get(4)?,
                deleted_at_utc: row.get(5)?,
            })
        },
    )
    .map_err(|_| WorkspaceError::root_not_found("container not found"))
}

pub(crate) fn require_live_container(conn: &Connection, id: &str) -> WorkspaceResult<ContainerRow> {
    let row = load_container(conn, id)?;
    if row.deleted_at_utc.is_some() {
        return Err(WorkspaceError::root_deleted("container deleted"));
    }
    Ok(row)
}

pub(crate) fn require_live_group(conn: &Connection, id: &str) -> WorkspaceResult<ContainerRow> {
    let row = require_live_container(conn, id)?;
    if row.kind != "group" {
        return Err(WorkspaceError::invalid_patch("container is not a group"));
    }
    Ok(row)
}

pub(crate) fn require_member_container(conn: &Connection, id: &str) -> WorkspaceResult<ContainerRow> {
    let row = require_live_container(conn, id)?;
    if row.kind == "root" || row.kind == "group" {
        return Ok(row);
    }
    Err(WorkspaceError::invalid_patch("invalid member container kind"))
}

pub(crate) fn load_live_members(conn: &Connection, container_id: &str) -> WorkspaceResult<Vec<MemberRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, container_id, position, member_kind, domain, object_type, object_id, link_kind, link_title, link_url, revision
             FROM workspace_member
             WHERE container_id = ?1 AND deleted_at_utc IS NULL
             ORDER BY position ASC",
        )
        .map_err(map_sqlite)?;
    let rows = stmt
        .query_map([container_id], |row| {
            Ok(MemberRow {
                id: row.get(0)?,
                container_id: row.get(1)?,
                position: row.get(2)?,
                member_kind: row.get(3)?,
                domain: row.get(4)?,
                object_type: row.get(5)?,
                object_id: row.get(6)?,
                link_kind: row.get(7)?,
                link_title: row.get(8)?,
                link_url: row.get(9)?,
                revision: row.get(10)?,
            })
        })
        .map_err(map_sqlite)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_sqlite)?);
    }
    Ok(out)
}

pub(crate) fn require_live_member(conn: &Connection, member_id: &str) -> WorkspaceResult<MemberRow> {
    conn.query_row(
        "SELECT id, container_id, position, member_kind, domain, object_type, object_id, link_kind, link_title, link_url, revision
         FROM workspace_member
         WHERE id = ?1 AND deleted_at_utc IS NULL",
        [member_id],
        |row| {
            Ok(MemberRow {
                id: row.get(0)?,
                container_id: row.get(1)?,
                position: row.get(2)?,
                member_kind: row.get(3)?,
                domain: row.get(4)?,
                object_type: row.get(5)?,
                object_id: row.get(6)?,
                link_kind: row.get(7)?,
                link_title: row.get(8)?,
                link_url: row.get(9)?,
                revision: row.get(10)?,
            })
        },
    )
    .map_err(|_| WorkspaceError::root_not_found("workspace member not found"))
}

pub(crate) fn check_member_ids(expected: &[MemberRef], actual: &[MemberRow]) -> WorkspaceResult<()> {
    if expected.len() != actual.len() {
        return Err(WorkspaceError::revision_conflict("member set mismatch"));
    }
    let mut exp = expected.iter().map(|m| m.id.as_str()).collect::<Vec<_>>();
    exp.sort();
    let mut act = actual.iter().map(|m| m.id.as_str()).collect::<Vec<_>>();
    act.sort();
    if exp != act {
        return Err(WorkspaceError::revision_conflict("member set mismatch"));
    }
    Ok(())
}

pub(crate) fn bump_container(tx: &Transaction, id: &str, now: &str) -> WorkspaceResult<i64> {
    let rev: i64 = tx
        .query_row(
            "SELECT revision FROM workspace_container WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|_| WorkspaceError::root_not_found("container not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE workspace_container SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(map_sqlite)?;
    Ok(next)
}

pub(crate) fn validate_group_title(title: &str) -> WorkspaceResult<()> {
    if title.trim().is_empty() {
        return Err(WorkspaceError::invalid_patch("group title is required"));
    }
    Ok(())
}

fn next_group_root_position(tx: &Transaction) -> WorkspaceResult<i32> {
    let max: Option<i32> = tx
        .query_row(
            "SELECT MAX(root_position) FROM workspace_container WHERE kind = 'group' AND deleted_at_utc IS NULL",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_sqlite)?
        .flatten();
    Ok(max.unwrap_or(-1) + 1)
}

fn shift_group_root_positions(tx: &Transaction, from: i32, now: &str) -> WorkspaceResult<()> {
    tx.execute(
        "UPDATE workspace_container SET root_position = root_position + 1, updated_at_utc = ?1
         WHERE kind = 'group' AND deleted_at_utc IS NULL AND root_position >= ?2",
        params![now, from],
    )
    .map_err(map_sqlite)?;
    Ok(())
}

pub(crate) fn reorder_container_members(
    tx: &Transaction,
    container_id: &str,
    ordered_ids: &[String],
    now: &str,
) -> WorkspaceResult<()> {
    let members = load_live_members(tx, container_id)?;
    if members.len() != ordered_ids.len() {
        return Err(WorkspaceError::revision_conflict("member set mismatch"));
    }
    let live: HashSet<String> = members.iter().map(|m| m.id.clone()).collect();
    for id in ordered_ids {
        if !live.contains(id) {
            return Err(WorkspaceError::revision_conflict("member set mismatch"));
        }
    }
    for (idx, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE workspace_member SET position = ?1, updated_at_utc = ?2 WHERE id = ?3",
            params![idx, now, id],
        )
        .map_err(map_sqlite)?;
    }
    Ok(())
}

pub(crate) fn move_member(
    tx: &Transaction,
    member_id: &str,
    source_container_id: &str,
    target_container_id: &str,
    target_position: Option<i32>,
    now: &str,
) -> WorkspaceResult<()> {
    let member = require_live_member(tx, member_id)?;
    if member.container_id != source_container_id {
        return Err(WorkspaceError::invalid_patch("member not in source container"));
    }
    require_member_container(tx, target_container_id)?;

    let source_ids = load_live_members(tx, source_container_id)?
        .into_iter()
        .map(|m| m.id)
        .collect::<Vec<_>>();
    let source_idx = source_ids
        .iter()
        .position(|id| id == member_id)
        .ok_or_else(|| WorkspaceError::root_not_found("member not in source container"))?;

    let mut target_ids = if source_container_id == target_container_id {
        let mut ids = source_ids.clone();
        ids.remove(source_idx);
        ids
    } else {
        load_live_members(tx, target_container_id)?
            .into_iter()
            .map(|m| m.id)
            .collect()
    };

    let pos = target_position.unwrap_or(target_ids.len() as i32);
    if pos < 0 || pos > target_ids.len() as i32 {
        return Err(WorkspaceError::invalid_patch("position out of range"));
    }
    target_ids.insert(pos as usize, member_id.to_string());

    if source_container_id != target_container_id {
        let mut source_remaining = source_ids.clone();
        source_remaining.remove(source_idx);
        reorder_container_members(tx, source_container_id, &source_remaining, now)?;
        tx.execute(
            "UPDATE workspace_member SET container_id = ?1, updated_at_utc = ?2 WHERE id = ?3",
            params![target_container_id, now, member_id],
        )
        .map_err(map_sqlite)?;
    }
    reorder_container_members(tx, target_container_id, &target_ids, now)?;
    Ok(())
}

pub(crate) fn insert_domain_member(
    tx: &Transaction,
    container_id: &str,
    member_kind: &str,
    domain: &str,
    object_type: &str,
    object_id: &str,
    position: Option<i32>,
    now: &str,
) -> WorkspaceResult<String> {
    if find_live_member_by_object(tx, domain, object_type, object_id)?.is_some() {
        return Err(WorkspaceError::invalid_patch("object already has a workspace position"));
    }
    let members = load_live_members(tx, container_id)?;
    let pos = position.unwrap_or(members.len() as i32);
    if pos < 0 || pos > members.len() as i32 {
        return Err(WorkspaceError::invalid_patch("position out of range"));
    }
    tx.execute(
        "UPDATE workspace_member SET position = position + 1, updated_at_utc = ?1
         WHERE container_id = ?2 AND deleted_at_utc IS NULL AND position >= ?3",
        params![now, container_id, pos],
    )
    .map_err(map_sqlite)?;
    let id = new_uuid();
    tx.execute(
        "INSERT INTO workspace_member (id, container_id, position, member_kind, domain, object_type, object_id, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, container_id, pos, member_kind, domain, object_type, object_id, now],
    )
    .map_err(map_sqlite)?;
    Ok(id)
}

pub(crate) fn find_live_member_by_object(
    conn: &Connection,
    domain: &str,
    object_type: &str,
    object_id: &str,
) -> WorkspaceResult<Option<MemberRow>> {
    conn.query_row(
        "SELECT id, container_id, position, member_kind, domain, object_type, object_id, link_kind, link_title, link_url, revision
         FROM workspace_member
         WHERE domain = ?1 AND object_type = ?2 AND object_id = ?3 AND deleted_at_utc IS NULL",
        params![domain, object_type, object_id],
        |row| {
            Ok(MemberRow {
                id: row.get(0)?,
                container_id: row.get(1)?,
                position: row.get(2)?,
                member_kind: row.get(3)?,
                domain: row.get(4)?,
                object_type: row.get(5)?,
                object_id: row.get(6)?,
                link_kind: row.get(7)?,
                link_title: row.get(8)?,
                link_url: row.get(9)?,
                revision: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(map_sqlite)
}

pub(crate) fn soft_delete_versioned_member(
    tx: &Transaction,
    member_id: &str,
    container_id: &str,
    expected_revision: i64,
    now: &str,
) -> WorkspaceResult<()> {
    let member = require_live_member(tx, member_id)?;
    if member.container_id != container_id {
        return Err(WorkspaceError::invalid_patch("member not in container"));
    }
    check_revision(expected_revision, member.revision)?;
    tx.execute(
        "UPDATE workspace_member SET deleted_at_utc = ?1, updated_at_utc = ?1, revision = revision + 1 WHERE id = ?2",
        params![now, member_id],
    )
    .map_err(map_sqlite)?;
    tx.execute(
        "UPDATE workspace_member SET position = position - 1, updated_at_utc = ?1
         WHERE container_id = ?2 AND deleted_at_utc IS NULL AND position > ?3",
        params![now, container_id, member.position],
    )
    .map_err(map_sqlite)?;
    Ok(())
}

pub(crate) fn hide_live_domain_member(
    tx: &Transaction,
    domain: &str,
    object_type: &str,
    object_id: &str,
    now: &str,
) -> WorkspaceResult<()> {
    if let Some(member) = find_live_member_by_object(tx, domain, object_type, object_id)? {
        soft_delete_member(tx, &member.id, &member.container_id, now)?;
        bump_container(tx, &member.container_id, now)?;
    }
    Ok(())
}

pub(crate) fn soft_delete_member(tx: &Transaction, member_id: &str, container_id: &str, now: &str) -> WorkspaceResult<()> {
    let member = require_live_member(tx, member_id)?;
    if member.container_id != container_id {
        return Err(WorkspaceError::invalid_patch("member not in container"));
    }
    tx.execute(
        "UPDATE workspace_member SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
        params![now, member_id],
    )
    .map_err(map_sqlite)?;
    tx.execute(
        "UPDATE workspace_member SET position = position - 1, updated_at_utc = ?1
         WHERE container_id = ?2 AND deleted_at_utc IS NULL AND position > ?3",
        params![now, container_id, member.position],
    )
    .map_err(map_sqlite)?;
    Ok(())
}

pub(crate) fn require_live_list(conn: &Connection, list_id: &str) -> WorkspaceResult<i64> {
    let (revision, deleted): (i64, Option<String>) = conn
        .query_row(
            "SELECT revision, deleted_at_utc FROM productivity_list WHERE id = ?1",
            [list_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| WorkspaceError::root_not_found("list not found"))?;
    if deleted.is_some() {
        return Err(WorkspaceError::root_deleted("list deleted"));
    }
    Ok(revision)
}

pub(crate) fn require_live_journal_document(conn: &Connection, entry_id: &str) -> WorkspaceResult<i64> {
    let (kind, revision, deleted): (String, i64, Option<String>) = conn
        .query_row(
            "SELECT kind, revision, deleted_at_utc FROM journal_entry WHERE id = ?1",
            [entry_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| WorkspaceError::root_not_found("journal entry not found"))?;
    if deleted.is_some() {
        return Err(WorkspaceError::root_deleted("journal entry deleted"));
    }
    if kind != "document" {
        return Err(WorkspaceError::invalid_patch("journal entry must be kind=document"));
    }
    Ok(revision)
}

pub(crate) fn require_live_project(conn: &Connection, project_id: &str) -> WorkspaceResult<i64> {
    let (revision, deleted): (i64, Option<String>) = conn
        .query_row(
            "SELECT revision, deleted_at_utc FROM productivity_project WHERE id = ?1",
            [project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| WorkspaceError::root_not_found("project not found"))?;
    if deleted.is_some() {
        return Err(WorkspaceError::root_deleted("project deleted"));
    }
    Ok(revision)
}

pub(crate) fn ensure_no_active_interval_for_project_tasks(tx: &Transaction, project_id: &str) -> WorkspaceResult<()> {
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*)
             FROM productivity_action a
             INNER JOIN productivity_task t ON a.target_kind = 'task' AND a.target_id = t.id
             INNER JOIN productivity_interval i ON i.action_id = a.id
             WHERE t.project_id = ?1
               AND t.deleted_at_utc IS NULL
               AND a.deleted_at_utc IS NULL
               AND a.ended = 0
               AND i.deleted_at_utc IS NULL
               AND i.ended_at IS NULL",
            [project_id],
            |row| row.get(0),
        )
        .map_err(map_sqlite)?;
    if count > 0 {
        return Err(WorkspaceError::active_action_blocks());
    }
    Ok(())
}

pub(crate) fn ensure_no_active_actions_for_targets(tx: &Transaction, target_ids: &[String]) -> WorkspaceResult<()> {
    if target_ids.is_empty() {
        return Ok(());
    }
    let placeholders = target_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT COUNT(*) FROM productivity_action a
         INNER JOIN productivity_interval i ON i.action_id = a.id
         WHERE a.deleted_at_utc IS NULL AND a.ended = 0
           AND i.deleted_at_utc IS NULL AND i.ended_at IS NULL
           AND a.target_id IN ({placeholders})"
    );
    let mut stmt = tx.prepare(&sql).map_err(map_sqlite)?;
    let params: Vec<&dyn rusqlite::ToSql> = target_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let count: i64 = stmt
        .query_row(rusqlite::params_from_iter(params), |row| row.get(0))
        .map_err(map_sqlite)?;
    if count > 0 {
        return Err(WorkspaceError::active_action_blocks());
    }
    Ok(())
}

pub(crate) fn collect_list_item_targets(tx: &Transaction, list_id: &str) -> WorkspaceResult<Vec<String>> {
    let mut ids = vec![list_id.to_string()];
    let mut stmt = tx
        .prepare("SELECT id FROM productivity_item WHERE list_id = ?1 AND deleted_at_utc IS NULL")
        .map_err(map_sqlite)?;
    let rows = stmt
        .query_map([list_id], |row| row.get::<_, String>(0))
        .map_err(map_sqlite)?;
    for row in rows {
        ids.push(row.map_err(map_sqlite)?);
    }
    Ok(ids)
}

pub(crate) fn bump_item_order(tx: &Transaction, now: &str) -> WorkspaceResult<()> {
    tx.execute(
        "UPDATE productivity_item_order SET revision = revision + 1, updated_at_utc = ?1 WHERE id = ?2",
        params![now, ITEM_ORDER_ID],
    )
    .map_err(map_sqlite)?;
    Ok(())
}

pub(crate) fn load_local_path(
    conn: &Connection,
    link_member_id: &str,
    device_id: Option<&str>,
) -> WorkspaceResult<Option<String>> {
    if device_id.is_none() {
        return Ok(None);
    }
    conn.query_row(
        "SELECT local_path FROM workspace_device_binding WHERE link_member_id = ?1 AND device_id = ?2",
        params![link_member_id, device_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(map_sqlite)
}

fn domain_member_target_is_live(conn: &Connection, m: &MemberRow) -> WorkspaceResult<bool> {
    let object_id = match m.object_id.as_deref() {
        Some(id) => id,
        None => return Ok(true),
    };
    let deleted_at: Option<Option<String>> = match (m.domain.as_deref(), m.object_type.as_deref()) {
        (Some(DOMAIN_PRODUCTIVITY), Some(TYPE_PROJECT)) => conn
            .query_row(
                "SELECT deleted_at_utc FROM productivity_project WHERE id = ?1",
                [object_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite)?,
        (Some(DOMAIN_PRODUCTIVITY), Some(TYPE_LIST)) => conn
            .query_row(
                "SELECT deleted_at_utc FROM productivity_list WHERE id = ?1",
                [object_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite)?,
        (Some(DOMAIN_JOURNAL), Some(TYPE_ENTRY)) => conn
            .query_row(
                "SELECT deleted_at_utc FROM journal_entry WHERE id = ?1",
                [object_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite)?,
        _ => return Ok(true),
    };
    Ok(matches!(deleted_at, Some(None)))
}

fn member_to_snapshot(row: &MemberRow, local_path: Option<String>) -> MemberSnapshot {
    MemberSnapshot {
        id: row.id.clone(),
        container_id: row.container_id.clone(),
        position: row.position,
        member_kind: row.member_kind.clone(),
        domain: row.domain.clone(),
        object_type: row.object_type.clone(),
        object_id: row.object_id.clone(),
        link_kind: row.link_kind.clone(),
        link_title: row.link_title.clone(),
        link_url: row.link_url.clone(),
        local_path,
        revision: row.revision,
    }
}

pub(crate) fn build_workspace_snapshot(
    conn: &Connection,
    device_id: Option<&str>,
) -> WorkspaceResult<WorkspaceResponse> {
    let root = require_live_container(conn, ROOT_CONTAINER_ID)?;
    let root_members = load_live_members(conn, ROOT_CONTAINER_ID)?;
    let mut root_snapshots = Vec::new();
    for m in &root_members {
        if !domain_member_target_is_live(conn, m)? {
            continue;
        }
        let local_path = if m.member_kind == "link" {
            load_local_path(conn, &m.id, device_id)?
        } else {
            None
        };
        root_snapshots.push(member_to_snapshot(m, local_path));
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, title, revision, root_position FROM workspace_container
             WHERE kind = 'group' AND deleted_at_utc IS NULL
             ORDER BY root_position ASC",
        )
        .map_err(map_sqlite)?;
    let group_rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i32>(3)?,
            ))
        })
        .map_err(map_sqlite)?;
    let mut groups = Vec::new();
    for row in group_rows {
        let (id, title, revision, root_position) = row.map_err(map_sqlite)?;
        let members = load_live_members(conn, &id)?;
        let mut member_snapshots = Vec::new();
        for m in &members {
            if !domain_member_target_is_live(conn, m)? {
                continue;
            }
            let local_path = if m.member_kind == "link" {
                load_local_path(conn, &m.id, device_id)?
            } else {
                None
            };
            member_snapshots.push(member_to_snapshot(m, local_path));
        }
        groups.push(GroupSnapshot {
            id,
            title,
            revision,
            root_position,
            members: member_snapshots,
        });
    }

    Ok(WorkspaceResponse {
        root: RootContainerSnapshot {
            id: root.id,
            revision: root.revision,
            members: root_snapshots,
        },
        groups,
    })
}

pub(crate) fn validate_link_kind(kind: &str) -> WorkspaceResult<()> {
    match kind {
        "bookmark" | "executable" | "file" | "folder" => Ok(()),
        _ => Err(WorkspaceError::invalid_patch("invalid link kind")),
    }
}

pub(crate) fn validate_local_link_inputs(
    link_kind: &str,
    link_url: Option<&str>,
    local_path: Option<&str>,
    device_id: Option<&str>,
) -> WorkspaceResult<()> {
    if link_kind == "bookmark" {
        let url = link_url.ok_or_else(|| WorkspaceError::invalid_patch("linkUrl is required for bookmark"))?;
        if url.trim().is_empty() {
            return Err(WorkspaceError::invalid_patch("linkUrl is required for bookmark"));
        }
        if local_path.is_some() || device_id.is_some() {
            return Err(WorkspaceError::invalid_patch("local path is not used for bookmark"));
        }
        return Ok(());
    }
    let path = local_path.ok_or_else(|| WorkspaceError::invalid_patch("localPath is required for local link"))?;
    if path.trim().is_empty() {
        return Err(WorkspaceError::invalid_patch("localPath is required for local link"));
    }
    let device = device_id.ok_or_else(|| WorkspaceError::invalid_patch("deviceId is required for local link"))?;
    if device.trim().is_empty() {
        return Err(WorkspaceError::invalid_patch("deviceId is required for local link"));
    }
    if link_url.is_some() {
        return Err(WorkspaceError::invalid_patch("linkUrl is not used for local link"));
    }
    Ok(())
}

pub(crate) fn now() -> String {
    utc_now()
}

pub(crate) fn create_group_row(
    tx: &Transaction,
    title: &str,
    root_expected_revision: i64,
    root_position: Option<i32>,
    now: &str,
) -> WorkspaceResult<String> {
    let root = require_live_container(tx, ROOT_CONTAINER_ID)?;
    check_revision(root_expected_revision, root.revision)?;
    validate_group_title(title)?;
    let pos = match root_position {
        Some(p) => {
            if p < 0 {
                return Err(WorkspaceError::invalid_patch("rootPosition out of range"));
            }
            shift_group_root_positions(tx, p, now)?;
            p
        }
        None => next_group_root_position(tx)?,
    };
    let id = new_uuid();
    tx.execute(
        "INSERT INTO workspace_container (id, kind, title, revision, root_position, created_at_utc, updated_at_utc)
         VALUES (?1, 'group', ?2, 1, ?3, ?4, ?4)",
        params![id, title.trim(), pos, now],
    )
    .map_err(map_sqlite)?;
    bump_container(tx, ROOT_CONTAINER_ID, now)?;
    Ok(id)
}
