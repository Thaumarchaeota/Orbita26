use rusqlite::{params, OptionalExtension, Row, Transaction};

use super::error::{DomainError, DomainResult};
use super::execution::{apply_execution_state, derive_execution_state};
use super::point::{point_from_json, point_to_json, ProductivityPoint};
use super::types::*;

pub(crate) fn task_sequence_anchor_from_row(row: &Row, column: &str) -> rusqlite::Result<Option<TaskSequenceAnchor>> {
    let raw: Option<String> = row.get(column)?;
    raw.map(|raw| {
        let anchor: TaskSequenceAnchor = serde_json::from_str(&raw).map_err(|error|
            rusqlite::Error::FromSqlConversionFailure(row.as_ref().column_index(column).unwrap_or(0), rusqlite::types::Type::Text, Box::new(error)))?;
        if !anchor.is_valid() {
            return Err(rusqlite::Error::FromSqlConversionFailure(row.as_ref().column_index(column).unwrap_or(0), rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid task sequence anchor"))));
        }
        Ok(anchor)
    }).transpose()
}

fn parse_appearance_json(raw: &str) -> DomainResult<Option<ActionAppearance>> {
    let t = raw.trim();
    if t.is_empty() || t == "{}" || t == "null" {
        return Ok(None);
    }
    serde_json::from_str(t).map(Some).map_err(|e| DomainError::archive_lifecycle(e.to_string()))
}

fn appearance_to_json(value: Option<&ActionAppearance>) -> DomainResult<String> {
    match value {
        None => Ok("{}".to_string()),
        Some(a) => serde_json::to_string(a).map_err(|e| DomainError::archive_lifecycle(e.to_string())),
    }
}

pub(crate) fn has_unknown_fields(extra: &str) -> bool {
    !extra.trim().is_empty() && extra != "{}" && extra != "null"
}

pub(crate) fn guard_unknown(extra: &str) -> DomainResult<()> {
    if has_unknown_fields(extra) {
        return Err(DomainError::unknown_field_blocked());
    }
    Ok(())
}

fn root_load_error(table: &str, id: &str, tx: &Transaction) -> DomainResult<()> {
    let sql = format!("SELECT deleted_at_utc FROM {table} WHERE id = ?1");
    let deleted: Option<Option<String>> = tx
        .query_row(&sql, [id], |row| row.get(0))
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match deleted {
        None => Err(DomainError::root_not_found(format!("{table} not found"))),
        Some(Some(_)) => Err(DomainError::root_deleted(format!("{table} deleted"))),
        Some(None) => Ok(()),
    }
}

pub(crate) fn require_live_project(tx: &Transaction, id: &str) -> DomainResult<()> {
    root_load_error("productivity_project", id, tx)
}

pub(crate) fn require_live_list(tx: &Transaction, id: &str) -> DomainResult<()> {
    root_load_error("productivity_list", id, tx)
}

pub(crate) fn require_live_item(tx: &Transaction, id: &str) -> DomainResult<()> {
    root_load_error("productivity_item", id, tx)
}

pub(crate) fn require_live_session(tx: &Transaction, id: &str) -> DomainResult<()> {
    root_load_error("productivity_session", id, tx)
}

pub(crate) fn require_live_action(tx: &Transaction, id: &str) -> DomainResult<()> {
    root_load_error("productivity_action", id, tx)
}

pub(crate) fn require_live_task_in_project(
    tx: &Transaction,
    project_id: &str,
    task_id: &str,
) -> DomainResult<()> {
    let row: Option<(Option<String>, String)> = tx
        .query_row(
            "SELECT deleted_at_utc, project_id FROM productivity_task WHERE id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match row {
        None => Err(DomainError::root_not_found("task not found")),
        Some((Some(_), _)) => Err(DomainError::root_deleted("task deleted")),
        Some((None, pid)) if pid != project_id => {
            Err(DomainError::root_not_found("task not in project"))
        }
        Some((None, _)) => Ok(()),
    }
}

pub(crate) fn require_task_in_project_including_deleted(
    tx: &Transaction,
    project_id: &str,
    task_id: &str,
) -> DomainResult<String> {
    let row: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT project_id, deletion_batch_id FROM productivity_task WHERE id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match row {
        None => Err(DomainError::root_not_found("task not found")),
        Some((pid, _)) if pid != project_id => {
            Err(DomainError::root_not_found("task not in project"))
        }
        Some((_, batch)) => batch.ok_or_else(DomainError::delete_batch_mismatch),
    }
}

#[derive(Debug)]
struct PointParseError(DomainError);

impl std::fmt::Display for PointParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for PointParseError {}

fn domain_to_sqlite(e: DomainError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(PointParseError(e)))
}

fn sqlite_to_domain(e: rusqlite::Error) -> DomainError {
    if let rusqlite::Error::ToSqlConversionFailure(ref inner) = e {
        if let Some(pe) = inner.downcast_ref::<PointParseError>() {
            return pe.0.clone();
        }
    }
    DomainError::archive_lifecycle(e.to_string())
}

fn row_point(raw: rusqlite::Result<Option<String>>) -> Result<Option<ProductivityPoint>, rusqlite::Error> {
    point_from_json(raw?).map_err(domain_to_sqlite)
}

fn row_to_task(row: &Row<'_>) -> Result<TaskSnapshot, rusqlite::Error> {
    Ok(TaskSnapshot {
        item_type_id: row.get("item_type_id")?,
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        parent_task_id: row.get("parent_task_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status: row.get("status")?,
        sibling_position: row.get("sibling_position")?,
        planned_point: row_point(row.get("planned_point_json"))?,
        due_point: row_point(row.get("due_point_json"))?,
        deletion_batch_id: row.get("deletion_batch_id")?,
        created_at_utc: row.get("created_at_utc")?,
        updated_at_utc: row.get("updated_at_utc")?,
        deleted_at_utc: row.get("deleted_at_utc")?,
    })
}

pub(crate) fn load_project_row(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<(ProjectSnapshot, String)> {
    let sql = if live_only {
        "SELECT * FROM productivity_project WHERE id = ?1 AND deleted_at_utc IS NULL"
    } else {
        "SELECT * FROM productivity_project WHERE id = ?1"
    };
    let row = tx
        .query_row(sql, [id], |row| {
            Ok((
                ProjectSnapshot {
                    id: row.get("id")?,
                    revision: row.get("revision")?,
                    title: row.get("title")?,
                    description: row.get("description")?,
                    status: row.get("status")?,
                    planned_point: row_point(row.get("planned_point_json"))?,
                    due_point: row_point(row.get("due_point_json"))?,
                    tasks: vec![],
                    task_sequence_edges: vec![],
                    task_card_positions: vec![],
                    created_at_utc: row.get("created_at_utc")?,
                    updated_at_utc: row.get("updated_at_utc")?,
                    deleted_at_utc: row.get("deleted_at_utc")?,
                },
                row.get::<_, String>("extra_json")?,
            ))
        })
        .optional()
        .map_err(sqlite_to_domain)?;
    match row {
        Some(v) => Ok(v),
        None if live_only => {
            require_live_project(tx, id)?;
            Err(DomainError::root_not_found("project not found"))
        }
        None => Err(DomainError::root_not_found("project not found")),
    }
}

pub(crate) fn load_tasks_for_project(tx: &Transaction, project_id: &str, live_only: bool) -> DomainResult<Vec<TaskSnapshot>> {
    let sql = if live_only {
        "SELECT * FROM productivity_task WHERE project_id = ?1 AND deleted_at_utc IS NULL ORDER BY sibling_position, created_at_utc, id"
    } else {
        "SELECT * FROM productivity_task WHERE project_id = ?1 ORDER BY sibling_position, created_at_utc, id"
    };
    let mut stmt = tx
        .prepare(sql)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([project_id], |row| Ok((row_to_task(row)?, row.get::<_, String>("extra_json")?)))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        let (task, extra) = row.map_err(sqlite_to_domain)?;
        guard_unknown(&extra)?;
        out.push(task);
    }
    Ok(out)
}

pub(crate) fn guard_project_members(tx:&Transaction,project_id:&str)->DomainResult<()> {
    let _=load_tasks_for_project(tx,project_id,false)?;
    // Relations and positions are also Project members; snapshots validate their extra fields.
    let _=project_snapshot(tx,project_id,false)?;
    Ok(())
}

pub(crate) fn project_snapshot(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<ProjectSnapshot> {
    let (mut project, extra) = load_project_row(tx, id, live_only)?;
    guard_unknown(&extra)?;
    project.tasks = load_tasks_for_project(tx, id, live_only)?;
    let live_clause = if live_only { " AND deleted_at_utc IS NULL" } else { "" };
    let edge_sql = format!("SELECT * FROM productivity_task_sequence_edge WHERE project_id=?1{live_clause} ORDER BY created_at_utc,id");
    let mut edge_stmt = tx.prepare(&edge_sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let edge_rows = edge_stmt.query_map([id], |row| Ok((TaskSequenceEdgeSnapshot {
        id: row.get("id")?, project_id: row.get("project_id")?, source_task_id: row.get("source_task_id")?, target_task_id: row.get("target_task_id")?,
        source_anchor: task_sequence_anchor_from_row(row,"source_anchor_json")?, target_anchor: task_sequence_anchor_from_row(row,"target_anchor_json")?,
        created_at_utc: row.get("created_at_utc")?, updated_at_utc: row.get("updated_at_utc")?, deleted_at_utc: row.get("deleted_at_utc")?, deletion_batch_id: row.get("deletion_batch_id")?,
    }, row.get::<_, String>("extra_json")?))).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for edge in edge_rows { let (edge, extra) = edge.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?; guard_unknown(&extra)?; project.task_sequence_edges.push(edge); }
    let position_sql = format!("SELECT task_id,project_id,parent_task_id,x,y,updated_at_utc,deleted_at_utc,extra_json FROM productivity_task_card_position WHERE project_id=?1{live_clause} ORDER BY task_id");
    let mut position_stmt = tx.prepare(&position_sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let position_rows = position_stmt.query_map([id], |row| Ok((TaskCardPositionSnapshot {
        task_id: row.get(0)?, project_id: row.get(1)?, parent_task_id: row.get(2)?, x: row.get(3)?, y: row.get(4)?, updated_at_utc: row.get(5)?, deleted_at_utc: row.get(6)?,
    }, row.get::<_, String>(7)?))).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for position in position_rows {
        let (position, extra) = position.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        guard_unknown(&extra)?;
        if position.deleted_at_utc.is_none() {
            let task = project.tasks.iter().find(|task| task.id == position.task_id && task.deleted_at_utc.is_none());
            let parent_is_root = task.and_then(|task| task.parent_task_id.as_ref()).and_then(|parent_id| project.tasks.iter().find(|parent| parent.id == *parent_id && parent.deleted_at_utc.is_none())).is_some_and(|parent| parent.parent_task_id.is_none());
            if task.map_or(true, |task| task.parent_task_id.as_deref() != Some(position.parent_task_id.as_str())) || !parent_is_root {
                return Err(DomainError::new("TASK_POSITION_INCONSISTENT", "任务卡片位置与当前任务树层级不一致"));
            }
        }
        project.task_card_positions.push(position);
    }
    Ok(project)
}

pub(crate) fn list_projects(tx: &Transaction, live_only: bool) -> DomainResult<Vec<ProjectSnapshot>> {
    let sql = if live_only {
        "SELECT id FROM productivity_project WHERE deleted_at_utc IS NULL ORDER BY created_at_utc"
    } else {
        "SELECT id FROM productivity_project ORDER BY created_at_utc"
    };
    let mut stmt = tx
        .prepare(sql)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for id in ids {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        out.push(project_snapshot(tx, &id, live_only)?);
    }
    Ok(out)
}

pub(crate) fn load_list_row(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<(ListSnapshot, String)> {
    let sql = if live_only {
        "SELECT * FROM productivity_list WHERE id = ?1 AND deleted_at_utc IS NULL"
    } else {
        "SELECT * FROM productivity_list WHERE id = ?1"
    };
    let row = tx
        .query_row(sql, [id], |row| {
            Ok((
                ListSnapshot {
                    id: row.get("id")?,
                    revision: row.get("revision")?,
                    title: row.get("title")?,
                    description: row.get("description")?,
                    status: row.get("status")?,
                    planned_point: row_point(row.get("planned_point_json"))?,
                    due_point: row_point(row.get("due_point_json"))?,
                    created_at_utc: row.get("created_at_utc")?,
                    updated_at_utc: row.get("updated_at_utc")?,
                    deleted_at_utc: row.get("deleted_at_utc")?,
                },
                row.get::<_, String>("extra_json")?,
            ))
        })
        .optional()
        .map_err(sqlite_to_domain)?;
    match row {
        Some(v) => Ok(v),
        None if live_only => {
            require_live_list(tx, id)?;
            Err(DomainError::root_not_found("list not found"))
        }
        None => Err(DomainError::root_not_found("list not found")),
    }
}

pub(crate) fn list_snapshot(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<ListSnapshot> {
    let (list, extra) = load_list_row(tx, id, live_only)?;
    guard_unknown(&extra)?;
    Ok(list)
}

pub(crate) fn list_lists(tx: &Transaction, live_only: bool) -> DomainResult<Vec<ListSnapshot>> {
    let sql = if live_only {
        "SELECT id FROM productivity_list WHERE deleted_at_utc IS NULL ORDER BY created_at_utc"
    } else {
        "SELECT id FROM productivity_list ORDER BY created_at_utc"
    };
    let mut stmt = tx.prepare(sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for id in ids {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        out.push(list_snapshot(tx, &id, live_only)?);
    }
    Ok(out)
}

pub(crate) fn load_item_row(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<(ItemSnapshot, String)> {
    let sql = if live_only {
        "SELECT * FROM productivity_item WHERE id = ?1 AND deleted_at_utc IS NULL"
    } else {
        "SELECT * FROM productivity_item WHERE id = ?1"
    };
    let row = tx
        .query_row(sql, [id], |row| {
            Ok((
                ItemSnapshot {
                    id: row.get("id")?,
                    revision: row.get("revision")?,
                    list_id: row.get("list_id")?,
                    item_type_id: row.get("item_type_id")?,
                    tag_ids: Vec::new(),
                    title: row.get("title")?,
                    description: row.get("description")?,
                    status: row.get("status")?,
                    priority: row.get("priority")?,
                    planned_point: row_point(row.get("planned_point_json"))?,
                    due_point: row_point(row.get("due_point_json"))?,
                    deletion_batch_id: row.get("deletion_batch_id")?,
                    created_at_utc: row.get("created_at_utc")?,
                    updated_at_utc: row.get("updated_at_utc")?,
                    deleted_at_utc: row.get("deleted_at_utc")?,
                    travel_kind: None,
                },
                row.get::<_, String>("extra_json")?,
            ))
        })
        .optional()
        .map_err(sqlite_to_domain)?;
    match row {
        Some(v) => Ok(v),
        None if live_only => {
            require_live_item(tx, id)?;
            Err(DomainError::root_not_found("item not found"))
        }
        None => Err(DomainError::root_not_found("item not found")),
    }
}

pub(crate) fn item_snapshot(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<ItemSnapshot> {
    let (mut item, _extra) = load_item_row(tx, id, live_only)?;
    item.travel_kind = tx.query_row(
        "SELECT kind FROM productivity_item_travel_detail WHERE item_id = ?1 AND (?2 = 0 OR deleted_at_utc IS NULL)",
        rusqlite::params![id, if live_only { 1 } else { 0 }],
        |row| row.get(0),
    ).optional().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut stmt = tx.prepare("SELECT tag_id FROM productivity_item_tag WHERE item_id = ?1 ORDER BY tag_id")?;
    item.tag_ids = stmt.query_map([id], |row| row.get(0))?.collect::<Result<Vec<_>, _>>()?;
    Ok(item)
}

pub(crate) fn list_items(tx: &Transaction, list_id: Option<&str>, unassigned_only: bool, live_only: bool) -> DomainResult<Vec<ItemSnapshot>> {
    let (sql, param): (String, Option<String>) = if unassigned_only {
        (
            "SELECT i.id FROM productivity_item i
             JOIN productivity_item_order_entry e ON e.item_id = i.id
             WHERE i.list_id IS NULL".into(),
            None,
        )
    } else if let Some(lid) = list_id {
        (
            "SELECT i.id FROM productivity_item i
             JOIN productivity_item_order_entry e ON e.item_id = i.id
             WHERE i.list_id = ?1".into(),
            Some(lid.to_string()),
        )
    } else {
        (
            "SELECT i.id FROM productivity_item i
             JOIN productivity_item_order_entry e ON e.item_id = i.id".into(),
            None,
        )
    };
    let sql = if live_only {
        if sql.contains(" WHERE ") {
            format!("{sql} AND i.deleted_at_utc IS NULL ORDER BY e.position")
        } else {
            format!("{sql} WHERE i.deleted_at_utc IS NULL ORDER BY e.position")
        }
    } else {
        format!("{sql} ORDER BY e.position")
    };
    let mut stmt = tx.prepare(&sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids: Vec<String> = if let Some(p) = param {
        stmt.query_map([p], |row| row.get::<_, String>(0))
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
    } else {
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
    };
    let mut out = Vec::new();
    for id in ids {
        out.push(item_snapshot(tx, &id, live_only)?);
    }
    Ok(out)
}

pub(crate) fn load_session_row(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<(SessionSnapshot, String)> {
    let sql = if live_only {
        "SELECT * FROM productivity_session WHERE id = ?1 AND deleted_at_utc IS NULL"
    } else {
        "SELECT * FROM productivity_session WHERE id = ?1"
    };
    let row = tx
        .query_row(sql, [id], |row| {
            Ok((
                SessionSnapshot {
                    id: row.get("id")?,
                    revision: row.get("revision")?,
                    title: row.get("title")?,
                    description: row.get("description")?,
                    planned_start_at: row.get("planned_start_at")?,
                    planned_end_at: row.get("planned_end_at")?,
                    track_lane: row.get("track_lane")?,
                    track_span: row.get("track_span")?,
                    actual_range: SessionActualRange {
                        actual_start_at: None,
                        actual_end_at: None,
                    },
                    created_at_utc: row.get("created_at_utc")?,
                    updated_at_utc: row.get("updated_at_utc")?,
                    deleted_at_utc: row.get("deleted_at_utc")?,
                },
                row.get::<_, String>("extra_json")?,
            ))
        })
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match row {
        Some(v) => Ok(v),
        None if live_only => {
            require_live_session(tx, id)?;
            Err(DomainError::root_not_found("session not found"))
        }
        None => Err(DomainError::root_not_found("session not found")),
    }
}

pub(crate) fn derive_session_actual(tx: &Transaction, session_id: &str) -> DomainResult<SessionActualRange> {
    let mut stmt = tx
        .prepare(
            "SELECT i.started_at, i.ended_at FROM productivity_interval i
             JOIN productivity_action a ON a.id = i.action_id
             WHERE a.session_id = ?1 AND a.deleted_at_utc IS NULL AND i.deleted_at_utc IS NULL
             ORDER BY i.started_at",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut starts: Vec<String> = Vec::new();
    let mut has_open = false;
    let mut max_end: Option<String> = None;
    for row in rows {
        let (start, end) = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        starts.push(start);
        if end.is_none() {
            has_open = true;
        } else if let Some(e) = end {
            if max_end.as_ref().map(|m| e > *m).unwrap_or(true) {
                max_end = Some(e);
            }
        }
    }
    if starts.is_empty() {
        return Ok(SessionActualRange {
            actual_start_at: None,
            actual_end_at: None,
        });
    }
    let min_start = starts.iter().min().cloned();
    Ok(SessionActualRange {
        actual_start_at: min_start,
        actual_end_at: if has_open { None } else { max_end },
    })
}

pub(crate) fn session_snapshot(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<SessionSnapshot> {
    let (mut session, extra) = load_session_row(tx, id, live_only)?;
    guard_unknown(&extra)?;
    session.actual_range = derive_session_actual(tx, id)?;
    Ok(session)
}

pub(crate) fn list_sessions(tx: &Transaction, live_only: bool) -> DomainResult<Vec<SessionSnapshot>> {
    let sql = if live_only {
        "SELECT id FROM productivity_session WHERE deleted_at_utc IS NULL ORDER BY planned_start_at"
    } else {
        "SELECT id FROM productivity_session ORDER BY planned_start_at"
    };
    let mut stmt = tx.prepare(sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for id in ids {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        out.push(session_snapshot(tx, &id, live_only)?);
    }
    Ok(out)
}

pub(crate) fn load_intervals(tx: &Transaction, action_id: &str, live_only: bool) -> DomainResult<Vec<IntervalSnapshot>> {
    let sql = if live_only {
        "SELECT * FROM productivity_interval WHERE action_id = ?1 AND deleted_at_utc IS NULL ORDER BY started_at"
    } else {
        "SELECT * FROM productivity_interval WHERE action_id = ?1 ORDER BY started_at"
    };
    let mut stmt = tx.prepare(sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([action_id], |row| {
            Ok(IntervalSnapshot {
                id: row.get("id")?,
                action_id: row.get("action_id")?,
                started_at: row.get("started_at")?,
                ended_at: row.get("ended_at")?,
                created_at_utc: row.get("created_at_utc")?,
                updated_at_utc: row.get("updated_at_utc")?,
                deleted_at_utc: row.get("deleted_at_utc")?,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}

pub(crate) fn load_action_row(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<(ActionSnapshot, String)> {
    let sql = if live_only {
        "SELECT * FROM productivity_action WHERE id = ?1 AND deleted_at_utc IS NULL"
    } else {
        "SELECT * FROM productivity_action WHERE id = ?1"
    };
    let row = tx
        .query_row(sql, [id], |row| {
            let ended: i64 = row.get("ended")?;
            Ok((
                ActionSnapshot {
                    id: row.get("id")?,
                    revision: row.get("revision")?,
                    title: row.get("title")?,
                    name_link_mode: row.get("name_link_mode")?,
                    summary: row.get("summary")?,
                    session_id: row.get("session_id")?,
                    target_kind: row.get("target_kind")?,
                    target_id: row.get("target_id")?,
                    planned_start_at: row.get("planned_start_at")?,
                    planned_end_at: row.get("planned_end_at")?,
                    planned_duration: row.get("planned_duration_seconds")?,
                    ended: ended != 0,
                    execution_state: String::new(),
                    intervals: vec![],
                    transportation_id: row.get("transportation_id").unwrap_or(None),
                    appearance: {
                        let raw: String = row.get("appearance_json")?;
                        parse_appearance_json(&raw).map_err(|err| {
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                rusqlite::types::Type::Text,
                                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err.to_string())),
                            )
                        })?
                    },
                    created_at_utc: row.get("created_at_utc")?,
                    updated_at_utc: row.get("updated_at_utc")?,
                    deleted_at_utc: row.get("deleted_at_utc")?,
                },
                row.get::<_, String>("extra_json")?,
            ))
        })
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match row {
        Some(v) => Ok(v),
        None if live_only => {
            require_live_action(tx, id)?;
            Err(DomainError::root_not_found("action not found"))
        }
        None => Err(DomainError::root_not_found("action not found")),
    }
}

pub(crate) fn action_snapshot(tx: &Transaction, id: &str, live_only: bool) -> DomainResult<ActionSnapshot> {
    let (mut action, extra) = load_action_row(tx, id, live_only)?;
    guard_unknown(&extra)?;
    action.intervals = load_intervals(tx, id, live_only)?;
    action.execution_state = derive_execution_state(action.ended, &action.intervals);
    Ok(action)
}

pub(crate) fn list_actions(tx: &Transaction, live_only: bool) -> DomainResult<Vec<ActionSnapshot>> {
    let sql = if live_only {
        "SELECT id FROM productivity_action WHERE deleted_at_utc IS NULL ORDER BY created_at_utc"
    } else {
        "SELECT id FROM productivity_action ORDER BY created_at_utc"
    };
    let mut stmt = tx.prepare(sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for id in ids {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        out.push(action_snapshot(tx, &id, live_only)?);
    }
    Ok(out)
}

pub(crate) fn actions_for_session(tx: &Transaction, session_id: &str, live_only: bool) -> DomainResult<Vec<ActionSnapshot>> {
    let sql = if live_only {
        "SELECT id FROM productivity_action WHERE session_id = ?1 AND deleted_at_utc IS NULL"
    } else {
        "SELECT id FROM productivity_action WHERE session_id = ?1"
    };
    let mut stmt = tx.prepare(sql).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([session_id], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for id in ids {
        let id = id.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        out.push(action_snapshot(tx, &id, live_only)?);
    }
    Ok(out)
}

pub(crate) fn items_for_list(tx: &Transaction, list_id: &str, live_only: bool) -> DomainResult<Vec<ItemSnapshot>> {
    list_items(tx, Some(list_id), false, live_only)
}

pub(crate) fn check_revision(expected: i64, actual: i64) -> DomainResult<()> {
    if expected != actual {
        return Err(DomainError::revision_conflict("revision mismatch"));
    }
    Ok(())
}

pub(crate) fn check_members(expected: &[RevisionRef], actual: &[RevisionRef]) -> DomainResult<()> {
    if expected.len() != actual.len() {
        return Err(DomainError::revision_conflict("member set mismatch"));
    }
    let mut exp = expected.to_vec();
    exp.sort_by(|a, b| a.id.cmp(&b.id));
    let mut act = actual.to_vec();
    act.sort_by(|a, b| a.id.cmp(&b.id));
    for (e, a) in exp.iter().zip(act.iter()) {
        if e.id != a.id || e.expected_revision != a.expected_revision {
            return Err(DomainError::revision_conflict("member revision mismatch"));
        }
    }
    Ok(())
}

pub(crate) fn insert_project(
    tx: &Transaction,
    id: &str,
    title: &str,
    description: Option<&str>,
    status: &str,
    planned: Option<&str>,
    due: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    tx.execute(
        "INSERT INTO productivity_project (id, revision, title, description, status, planned_point_json, due_point_json, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, '{}')",
        params![id, title, description, status, planned, due, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn bump_project(tx: &Transaction, id: &str, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row(
            "SELECT revision FROM productivity_project WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|_| DomainError::root_not_found("project not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_project SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn insert_task(
    tx: &Transaction,
    id: &str,
    project_id: &str,
    parent_task_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    status: &str,
    planned: Option<&str>,
    due: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    let sibling_position: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(sibling_position), -1) + 1 FROM productivity_task
             WHERE project_id = ?1 AND IFNULL(parent_task_id, '') = IFNULL(?2, '') AND deleted_at_utc IS NULL",
            params![project_id, parent_task_id],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "INSERT INTO productivity_task (id, project_id, parent_task_id, title, description, status, planned_point_json, due_point_json, sibling_position, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, '{}')",
        params![
            id,
            project_id,
            parent_task_id,
            title,
            description,
            status,
            planned,
            due,
            sibling_position,
            now
        ],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn soft_delete_project_tree(tx: &Transaction, project_id: &str, batch: &str, now: &str) -> DomainResult<()> {
    tx.execute(
        "UPDATE productivity_project SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3",
        params![now, batch, project_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_task SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE project_id = ?3 AND deleted_at_utc IS NULL",
        params![now, batch, project_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("UPDATE productivity_task_sequence_edge SET deleted_at_utc=?1,updated_at_utc=?1,deletion_batch_id=?2 WHERE project_id=?3 AND deleted_at_utc IS NULL",params![now,batch,project_id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("UPDATE productivity_task_card_position SET deleted_at_utc=?1,updated_at_utc=?1 WHERE project_id=?2 AND deleted_at_utc IS NULL",params![now,project_id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn restore_project_tree(tx: &Transaction, project_id: &str, batch: &str, now: &str) -> DomainResult<()> {
    let project_batch: Option<String> = tx
        .query_row(
            "SELECT deletion_batch_id FROM productivity_project WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        .flatten();
    if project_batch.as_deref() != Some(batch) {
        return Err(DomainError::delete_batch_mismatch());
    }
    tx.execute(
        "UPDATE productivity_project SET deleted_at_utc = NULL, updated_at_utc = ?1, deletion_batch_id = NULL WHERE id = ?2",
        params![now, project_id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "UPDATE productivity_task SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE project_id = ?2 AND deletion_batch_id = ?3",
        params![now, project_id, batch],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("UPDATE productivity_task_sequence_edge SET deleted_at_utc=NULL,updated_at_utc=?1,deletion_batch_id=NULL WHERE project_id=?2 AND deletion_batch_id=?3",params![now,project_id,batch]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute("UPDATE productivity_task_card_position SET deleted_at_utc=NULL,updated_at_utc=?1 WHERE task_id IN (SELECT id FROM productivity_task WHERE project_id=?2 AND deletion_batch_id=?3)",params![now,project_id,batch]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn task_descendants(tx: &Transaction, project_id: &str, root_task_id: &str) -> DomainResult<Vec<String>> {
    let tasks = load_tasks_for_project(tx, project_id, false)?;
    let mut out = vec![root_task_id.to_string()];
    let mut queue = vec![root_task_id.to_string()];
    while let Some(cur) = queue.pop() {
        for t in &tasks {
            if t.parent_task_id.as_deref() == Some(cur.as_str()) && !out.contains(&t.id) {
                out.push(t.id.clone());
                queue.push(t.id.clone());
            }
        }
    }
    Ok(out)
}

pub(crate) fn soft_delete_task_subtree(tx: &Transaction, project_id: &str, root_task_id: &str, batch: &str, now: &str) -> DomainResult<()> {
    let ids = task_descendants(tx, project_id, root_task_id)?;
    for id in ids {
        tx.execute(
            "UPDATE productivity_task SET deleted_at_utc = ?1, updated_at_utc = ?1, deletion_batch_id = ?2 WHERE id = ?3 AND deleted_at_utc IS NULL",
            params![now, batch, id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

pub(crate) fn restore_task_subtree_rows(
    tx: &Transaction,
    project_id: &str,
    root_task_id: &str,
    batch: &str,
    now: &str,
) -> DomainResult<bool> {
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM productivity_task WHERE id = ?1 AND project_id = ?2 AND deletion_batch_id = ?3",
            params![root_task_id, project_id, batch],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if count == 0 {
        return Err(DomainError::delete_batch_mismatch());
    }
    let ids = task_descendants(tx, project_id, root_task_id)?;
    let mut restored = 0usize;
    for id in ids {
        restored += tx.execute(
            "UPDATE productivity_task SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2 AND project_id = ?3 AND deletion_batch_id = ?4",
            params![now, id, project_id, batch],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(restored > 0)
}

pub(crate) fn insert_list(
    tx: &Transaction,
    id: &str,
    title: &str,
    description: Option<&str>,
    status: &str,
    planned: Option<&str>,
    due: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    tx.execute(
        "INSERT INTO productivity_list (id, revision, title, description, status, planned_point_json, due_point_json, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, '{}')",
        params![id, title, description, status, planned, due, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn bump_list(tx: &Transaction, id: &str, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row("SELECT revision FROM productivity_list WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| DomainError::root_not_found("list not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_list SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn insert_item(
    tx: &Transaction,
    id: &str,
    list_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    status: &str,
    priority: &str,
    planned: Option<&str>,
    due: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    tx.execute(
        "INSERT INTO productivity_item (id, revision, list_id, title, description, status, priority, planned_point_json, due_point_json, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, '{}')",
        params![id, list_id, title, description, status, priority, planned, due, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn bump_item(tx: &Transaction, id: &str, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row("SELECT revision FROM productivity_item WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| DomainError::root_not_found("item not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_item SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn insert_session(
    tx: &Transaction,
    id: &str,
    title: &str,
    description: Option<&str>,
    start: &str,
    end: &str,
    track_lane: i32,
    track_span: i32,
    now: &str,
) -> DomainResult<()> {
    tx.execute(
        "INSERT INTO productivity_session (id, revision, title, description, planned_start_at, planned_end_at, track_lane, track_span, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, '{}')",
        params![id, title, description, start, end, track_lane, track_span, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn bump_session(tx: &Transaction, id: &str, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row("SELECT revision FROM productivity_session WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| DomainError::root_not_found("session not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_session SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn insert_action(
    tx: &Transaction,
    id: &str,
    title: &str,
    summary: Option<&str>,
    session_id: Option<&str>,
    target_kind: Option<&str>,
    target_id: Option<&str>,
    planned_start: Option<&str>,
    planned_end: Option<&str>,
    planned_duration: Option<i64>,
    ended: bool,
    appearance: Option<&ActionAppearance>,
    now: &str,
) -> DomainResult<()> {
    if session_id.is_some() && target_kind==Some("item") {
        if let Some(item)=target_id { super::health_plan::guard_item(tx,item)?; }
    }
    let appearance_json = appearance_to_json(appearance)?;
    tx.execute(
        "INSERT INTO productivity_action (id, revision, title, summary, session_id, target_kind, target_id, planned_start_at, planned_end_at, planned_duration_seconds, ended, created_at_utc, updated_at_utc, extra_json, appearance_json)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, '{}', ?12)",
        params![
            id,
            title,
            summary,
            session_id,
            target_kind,
            target_id,
            planned_start,
            planned_end,
            planned_duration,
            if ended { 1i64 } else { 0i64 },
            now,
            appearance_json
        ],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn bump_checkpoint(tx: &Transaction, id: &str, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row("SELECT revision FROM productivity_checkpoint WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| DomainError::root_not_found("checkpoint not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_checkpoint SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn bump_action(tx: &Transaction, id: &str, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row("SELECT revision FROM productivity_action WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| DomainError::root_not_found("action not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_action SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, id],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn insert_interval(
    tx: &Transaction,
    id: &str,
    action_id: &str,
    started_at: &str,
    ended_at: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    super::health_plan::guard_action(tx, action_id)?;
    tx.execute(
        "INSERT INTO productivity_interval (id, action_id, started_at, ended_at, created_at_utc, updated_at_utc, extra_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, '{}')",
        params![id, action_id, started_at, ended_at, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub(crate) fn point_json(point: &Option<super::point::ProductivityPoint>) -> DomainResult<(Option<String>, Option<String>)> {
    if let Some(p) = point {
        super::point::validate_point(p)?;
    }
    Ok((point_to_json(point), None))
}

pub(crate) fn apply_point_patch(
    current_planned: &Option<super::point::ProductivityPoint>,
    current_due: &Option<super::point::ProductivityPoint>,
    patch_planned: &Option<Option<super::point::ProductivityPoint>>,
    patch_due: &Option<Option<super::point::ProductivityPoint>>,
) -> DomainResult<(Option<super::point::ProductivityPoint>, Option<super::point::ProductivityPoint>)> {
    let planned = if let Some(v) = patch_planned {
        if let Some(p) = v {
            super::point::validate_point(p)?;
        }
        v.clone()
    } else {
        current_planned.clone()
    };
    let due = if let Some(v) = patch_due {
        if let Some(p) = v {
            super::point::validate_point(p)?;
        }
        v.clone()
    } else {
        current_due.clone()
    };
    Ok((planned, due))
}

pub(crate) fn finished_action_snapshot(tx: &Transaction, id: &str) -> DomainResult<ActionSnapshot> {
    Ok(apply_execution_state(action_snapshot(tx, id, true)?))
}

pub(crate) fn load_item_order_row(tx: &Transaction) -> DomainResult<(i64, String)> {
    tx.query_row(
        "SELECT revision, updated_at_utc FROM productivity_item_order WHERE id = ?1",
        [ITEM_ORDER_ROOT_ID],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|_| DomainError::root_not_found("item order not found"))
}

pub(crate) fn item_order_snapshot(tx: &Transaction) -> DomainResult<ItemOrderSnapshot> {
    let (revision, updated_at_utc) = load_item_order_row(tx)?;
    let mut stmt = tx
        .prepare(
            "SELECT item_id FROM productivity_item_order_entry ORDER BY position",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut ordered_item_ids = Vec::new();
    for row in rows {
        ordered_item_ids.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(ItemOrderSnapshot {
        id: ITEM_ORDER_ROOT_ID.to_string(),
        revision,
        ordered_item_ids,
        updated_at_utc,
    })
}

pub(crate) fn live_item_order_member_refs(tx: &Transaction) -> DomainResult<Vec<RevisionRef>> {
    let mut stmt = tx
        .prepare(
            "SELECT i.id, i.revision FROM productivity_item i
             JOIN productivity_item_order_entry e ON e.item_id = i.id
             WHERE i.deleted_at_utc IS NULL
             ORDER BY e.position",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RevisionRef {
                id: row.get(0)?,
                expected_revision: row.get(1)?,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}

pub(crate) fn bump_item_order(tx: &Transaction, now: &str) -> DomainResult<i64> {
    let rev: i64 = tx
        .query_row(
            "SELECT revision FROM productivity_item_order WHERE id = ?1",
            [ITEM_ORDER_ROOT_ID],
            |row| row.get(0),
        )
        .map_err(|_| DomainError::root_not_found("item order not found"))?;
    let next = rev + 1;
    tx.execute(
        "UPDATE productivity_item_order SET revision = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![next, now, ITEM_ORDER_ROOT_ID],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(next)
}

pub(crate) fn append_item_to_order(tx: &Transaction, item_id: &str, now: &str) -> DomainResult<()> {
    let position: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM productivity_item_order_entry",
            [],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "INSERT INTO productivity_item_order_entry (item_id, position) VALUES (?1, ?2)",
        params![item_id, position],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    bump_item_order(tx, now)?;
    Ok(())
}

pub(crate) fn remove_item_from_order(tx: &Transaction, item_id: &str, now: &str) -> DomainResult<()> {
    let changed = tx
        .execute(
            "DELETE FROM productivity_item_order_entry WHERE item_id = ?1",
            [item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if changed > 0 {
        compact_item_order_positions(tx)?;
        bump_item_order(tx, now)?;
    }
    Ok(())
}

pub(crate) fn compact_item_order_positions(tx: &Transaction) -> DomainResult<()> {
    let mut stmt = tx
        .prepare("SELECT item_id FROM productivity_item_order_entry ORDER BY position")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for (position, item_id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE productivity_item_order_entry SET position = ?1 WHERE item_id = ?2",
            params![position as i32, item_id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

pub(crate) fn write_item_order(tx: &Transaction, ordered_item_ids: &[String], now: &str) -> DomainResult<()> {
    tx.execute("DELETE FROM productivity_item_order_entry", [])
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    for (position, item_id) in ordered_item_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO productivity_item_order_entry (item_id, position) VALUES (?1, ?2)",
            params![item_id, position as i32],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    bump_item_order(tx, now)?;
    Ok(())
}

pub(crate) fn insert_item_after_in_order(
    tx: &Transaction,
    new_item_id: &str,
    after_item_id: &str,
    now: &str,
) -> DomainResult<()> {
    let mut stmt = tx
        .prepare("SELECT item_id FROM productivity_item_order_entry ORDER BY position")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut ordered: Vec<String> = Vec::new();
    for row in rows {
        ordered.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    let pos = ordered
        .iter()
        .position(|id| id == after_item_id)
        .ok_or_else(|| DomainError::root_not_found("anchor item not in order"))?;
    ordered.insert(pos + 1, new_item_id.to_string());
    write_item_order(tx, &ordered, now)
}

pub(crate) fn move_item_to_order_tail(
    tx: &Transaction,
    item_id: &str,
    target_list_id: Option<&str>,
    now: &str,
) -> DomainResult<()> {
    let mut stmt = tx
        .prepare("SELECT item_id FROM productivity_item_order_entry ORDER BY position")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut ordered: Vec<String> = Vec::new();
    for row in rows {
        let id = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if id != item_id {
            ordered.push(id);
        }
    }
    let mut insert_at = ordered.len();
    for (idx, id) in ordered.iter().enumerate().rev() {
        let list_id: Option<String> = tx
            .query_row(
                "SELECT list_id FROM productivity_item WHERE id = ?1",
                [id.as_str()],
                |row| row.get(0),
            )
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let same_list = match (&target_list_id, list_id.as_deref()) {
            (None, None) => true,
            (Some(t), Some(l)) => *t == l,
            _ => false,
        };
        if same_list {
            insert_at = idx + 1;
            break;
        }
    }
    ordered.insert(insert_at, item_id.to_string());
    write_item_order(tx, &ordered, now)
}

pub(crate) fn sibling_ids_for_parent(
    tasks: &[TaskSnapshot],
    parent_task_id: Option<&str>,
    exclude_task_id: Option<&str>,
) -> Vec<String> {
    tasks
        .iter()
        .filter(|t| {
            t.deleted_at_utc.is_none()
                && t.parent_task_id.as_deref() == parent_task_id
                && exclude_task_id.map(|id| t.id.as_str() != id).unwrap_or(true)
        })
        .map(|t| t.id.clone())
        .collect()
}

pub(crate) fn write_sibling_positions(tx: &Transaction, ordered_ids: &[String], now: &str) -> DomainResult<()> {
    for (position, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE productivity_task SET sibling_position = ?1, updated_at_utc = ?2 WHERE id = ?3",
            params![position as i32, now, id],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

pub(crate) fn actions_targeting_item_refs(tx: &Transaction, item_id: &str) -> DomainResult<Vec<RevisionRef>> {
    let mut stmt = tx
        .prepare(
            "SELECT id, revision FROM productivity_action
             WHERE deleted_at_utc IS NULL AND target_kind = 'item' AND target_id = ?1
             ORDER BY created_at_utc, id",
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt
        .query_map([item_id], |row| {
            Ok(RevisionRef {
                id: row.get(0)?,
                expected_revision: row.get(1)?,
            })
        })
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?);
    }
    Ok(out)
}
