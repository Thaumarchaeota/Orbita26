use rusqlite::params;

use crate::productivity_db::coordinator::{in_transaction, with_write};
use crate::productivity_db::util::new_uuid;
use crate::productivity_db::DomainResult;

use super::super::error::WorkspaceError;
use super::super::repository::{
    build_workspace_snapshot, bump_container, bump_item_order, check_revision, collect_list_item_targets,
    ensure_no_active_actions_for_targets, now, require_live_list, require_live_member, require_member_container,
    soft_delete_member,
};
use super::super::types::{DeleteListBodyRequest, WorkspaceResponse};

pub fn delete_list_body(data_dir: &str, req: DeleteListBodyRequest) -> DomainResult<WorkspaceResponse> {
    with_write(data_dir, |conn| {
        in_transaction(conn, |tx| {
            let revision = require_live_list(tx, &req.list.id)?;
            check_revision(req.list.expected_revision, revision)?;
            let container = require_member_container(tx, &req.container.id)?;
            check_revision(req.container.expected_revision, container.revision)?;
            let member = require_live_member(tx, &req.member.id)?;
            if member.container_id != req.container.id
                || member.member_kind != "list"
                || member.object_id.as_deref() != Some(req.list.id.as_str())
            {
                return Err(WorkspaceError::invalid_patch("member does not reference list").into());
            }
            let mut stmt = tx
                .prepare("SELECT id, revision FROM productivity_item WHERE list_id = ?1 AND deleted_at_utc IS NULL")
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            let rows = stmt
                .query_map([&req.list.id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            let mut actual_items = Vec::new();
            for row in rows {
                actual_items.push(row.map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?);
            }
            if actual_items.len() != req.expected_members.len() {
                return Err(WorkspaceError::revision_conflict("member set mismatch").into());
            }
            let mut exp = req.expected_members.iter().map(|m| m.id.as_str()).collect::<Vec<_>>();
            exp.sort();
            let mut act = actual_items.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>();
            act.sort();
            if exp != act {
                return Err(WorkspaceError::revision_conflict("member set mismatch").into());
            }
            for expected in &req.expected_members {
                let item_rev: i64 = tx
                    .query_row(
                        "SELECT revision FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL",
                        [&expected.id],
                        |row| row.get(0),
                    )
                    .map_err(|_| WorkspaceError::root_not_found("item not found"))?;
                check_revision(expected.expected_revision, item_rev)?;
            }
            let targets = collect_list_item_targets(tx, &req.list.id)?;
            ensure_no_active_actions_for_targets(tx, &targets)?;
            let now = now();
            let batch = new_uuid();
            tx.execute(
                "UPDATE productivity_list SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
                params![now, batch, req.list.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            tx.execute(
                "UPDATE productivity_item SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2
                 WHERE list_id = ?3 AND deleted_at_utc IS NULL",
                params![now, batch, req.list.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            for item in &req.expected_members {
                tx.execute(
                    "UPDATE productivity_item SET revision = revision + 1, updated_at_utc = ?1 WHERE id = ?2",
                    params![now, item.id],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
                tx.execute(
                    "DELETE FROM productivity_item_order_entry WHERE item_id = ?1",
                    [&item.id],
                )
                .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            }
            tx.execute(
                "UPDATE productivity_list SET revision = revision + 1, updated_at_utc = ?1 WHERE id = ?2",
                params![now, req.list.id],
            )
            .map_err(|e| WorkspaceError::archive_lifecycle(e.to_string()))?;
            bump_item_order(tx, &now)?;
            soft_delete_member(tx, &req.member.id, &req.container.id, &now)?;
            bump_container(tx, &req.container.id, &now)?;
            build_workspace_snapshot(tx, None).map_err(Into::into)
        })
    })
}
