use crate::productivity_db::coordinator::with_read;
use crate::productivity_db::DomainError;
use crate::productivity_db::DomainResult;

use super::super::repository::build_workspace_snapshot;
use super::super::types::{ListWorkspaceQuery, WorkspaceResponse};

pub fn list_workspace(data_dir: &str, query: ListWorkspaceQuery) -> DomainResult<WorkspaceResponse> {
    with_read(data_dir, |conn| {
        let conn = conn.ok_or_else(|| DomainError::archive_lifecycle("archive not initialized"))?;
        build_workspace_snapshot(conn, query.device_id.as_deref()).map_err(Into::into)
    })
}
