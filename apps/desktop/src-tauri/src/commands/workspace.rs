use crate::data::get_data_dir;
use crate::workspace_db;

macro_rules! workspace_cmd {
    ($name:ident, $req:ty, $ret:ty, |$root:ident, $parsed:ident| $body:expr) => {
        #[tauri::command]
        pub fn $name(app: tauri::AppHandle, req: serde_json::Value) -> Result<$ret, String> {
            let $root = get_data_dir(&app)?;
            let $parsed: $req = serde_json::from_value(req)
                .map_err(|e| format!("invalid request: {e}"))?;
            $body
        }
    };
}

workspace_cmd!(workspace_create_group, workspace_db::CreateGroupRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::create_group(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_rename_group, workspace_db::RenameGroupRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::rename_group(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_move_member, workspace_db::MoveWorkspaceMemberRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::move_workspace_member(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_reorder_container, workspace_db::ReorderWorkspaceContainerRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::reorder_workspace_container(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_add_list, workspace_db::AddListToWorkspaceRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::add_list_to_workspace(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_add_journal_document, workspace_db::AddJournalDocumentToWorkspaceRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::add_journal_document_to_workspace(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_remove_list, workspace_db::RemoveListFromWorkspaceRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::remove_list_from_workspace(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_create_link, workspace_db::CreateWorkspaceLinkRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::create_workspace_link(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_rename_link, workspace_db::RenameWorkspaceLinkRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::rename_workspace_link(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_update_link_target, workspace_db::UpdateWorkspaceLinkTargetRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::update_workspace_link_target(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_rebind_local_target, workspace_db::RebindLocalTargetRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::rebind_local_target(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_delete_link, workspace_db::DeleteWorkspaceLinkRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::delete_workspace_link(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_delete_group, workspace_db::DeleteGroupAndReleaseMembersRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::delete_group_and_release_members(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_delete_project, workspace_db::DeleteProjectFromWorkspaceRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::delete_project_from_workspace(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_delete_list_body, workspace_db::DeleteListBodyRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::delete_list_body(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_delete_journal_document, workspace_db::DeleteJournalDocumentFromWorkspaceRequest, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::delete_journal_document_from_workspace(&root, req).map_err(String::from)
});

workspace_cmd!(workspace_list, workspace_db::ListWorkspaceQuery, workspace_db::WorkspaceResponse, |root, req| {
    workspace_db::list_workspace(&root, req).map_err(String::from)
});
