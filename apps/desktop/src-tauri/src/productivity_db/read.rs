use super::coordinator::{in_transaction, with_read};
use super::error::DomainResult;
use super::repository::{
    action_snapshot, item_order_snapshot, item_snapshot, list_actions, list_items, list_lists,
    list_projects, list_sessions, project_snapshot, session_snapshot,
};
use super::types::*;

pub fn get_business_time_zone_cmd(data_dir: &str) -> DomainResult<BusinessTimeZoneResponse> {
    with_read(data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(BusinessTimeZoneResponse {
                base_offset: super::schema::BASE_TIMEZONE_OFFSET.to_string(),
                replacements: vec![],
            });
        };
        in_transaction(conn, |tx| {
            let base_offset = tx.query_row(
                "SELECT value FROM archive_meta WHERE key = 'base_timezone_offset'",
                [],
                |row| row.get(0),
            ).map_err(|e| super::error::DomainError::archive_lifecycle(e.to_string()))?;
            let mut stmt = tx.prepare(
                "SELECT start_utc, end_utc, offset FROM timezone_replacement ORDER BY start_utc, id"
            ).map_err(|e| super::error::DomainError::archive_lifecycle(e.to_string()))?;
            let rows = stmt.query_map([], |row| Ok(BusinessTimeZoneReplacement {
                start_utc: row.get(0)?, end_utc: row.get(1)?, offset: row.get(2)?,
            })).map_err(|e| super::error::DomainError::archive_lifecycle(e.to_string()))?;
            let replacements = rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| super::error::DomainError::archive_lifecycle(e.to_string()))?;
            Ok(BusinessTimeZoneResponse { base_offset, replacements })
        })
    })
}

pub fn list_projects_cmd(data_dir: &str) -> DomainResult<ProjectsListResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Ok(ProjectsListResponse { projects: vec![] });
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ProjectsListResponse {
                projects: list_projects(tx, true)?,
            })
        })
    })
}

pub fn get_project_cmd(data_dir: &str, id: &str) -> DomainResult<ProjectResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Err(super::error::DomainError::root_not_found("project not found"));
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ProjectResponse {
                project: project_snapshot(tx, id, true)?,
                restore_summary: None,
            })
        })
    })
}

pub fn list_lists_cmd(data_dir: &str) -> DomainResult<ListsListResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Ok(ListsListResponse { lists: vec![] });
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ListsListResponse {
                lists: list_lists(tx, true)?,
            })
        })
    })
}

pub fn get_list_cmd(data_dir: &str, id: &str) -> DomainResult<ListResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Err(super::error::DomainError::root_not_found("list not found"));
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ListResponse {
                list: super::repository::list_snapshot(tx, id, true)?,
            })
        })
    })
}

pub fn get_list_item_members_cmd(data_dir: &str, id: &str) -> DomainResult<ListItemMembersResponse> {
    with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| super::error::DomainError::root_not_found("list not found"))?;
        in_transaction(conn, |tx| Ok(ListItemMembersResponse {
            data_dir: data_dir.to_string(),
            list: super::repository::list_snapshot(tx, id, true)?,
            members: super::validation::list_item_member_refs(tx, id)?,
        }))
    })
}

pub fn list_items_cmd(data_dir: &str, query: &ListItemsQuery) -> DomainResult<ItemsListResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Ok(ItemsListResponse {
                items: vec![],
                item_order: None,
            });
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ItemsListResponse {
                items: list_items(
                    tx,
                    query.list_id.as_deref(),
                    query.unassigned_only.unwrap_or(false),
                    true,
                )?,
                item_order: Some(item_order_snapshot(tx)?),
            })
        })
    })
}

pub fn get_item_cmd(data_dir: &str, id: &str) -> DomainResult<ItemResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Err(super::error::DomainError::root_not_found("item not found"));
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ItemResponse {
                item: item_snapshot(tx, id, true)?,
            })
        })
    })
}

pub fn list_sessions_cmd(data_dir: &str) -> DomainResult<SessionsListResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Ok(SessionsListResponse { sessions: vec![] });
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(SessionsListResponse {
                sessions: list_sessions(tx, true)?,
            })
        })
    })
}

pub fn get_session_cmd(data_dir: &str, id: &str) -> DomainResult<SessionResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Err(super::error::DomainError::root_not_found("session not found"));
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(SessionResponse {
                session: session_snapshot(tx, id, true)?,
            })
        })
    })
}

pub fn list_actions_cmd(data_dir: &str) -> DomainResult<ActionsListResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Ok(ActionsListResponse { actions: vec![] });
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ActionsListResponse {
                actions: list_actions(tx, true)?,
            })
        })
    })
}

pub fn get_action_cmd(data_dir: &str, id: &str) -> DomainResult<ActionResponse> {
    with_read(data_dir, |conn| {
        if conn.is_none() {
            return Err(super::error::DomainError::root_not_found("action not found"));
        }
        in_transaction(conn.unwrap(), |tx| {
            Ok(ActionResponse {
                action: action_snapshot(tx, id, true)?,
            })
        })
    })
}
