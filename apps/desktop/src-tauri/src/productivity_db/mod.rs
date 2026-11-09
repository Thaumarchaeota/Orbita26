pub mod commands;
pub mod classification;
pub mod coordinator;
pub mod error;
pub mod execution;
pub mod point;
pub mod read;
pub mod repository;
pub mod schema;
pub mod types;
pub mod util;
pub mod validation;
pub mod travel;
pub mod health_plan;
mod activity_pauses;
pub mod panel;
pub mod checkpoint;
pub mod travel_foundation;
pub mod travel_v2;

pub use coordinator::switch_data_dir;
pub use error::DomainError;
pub use error::DomainResult;

pub fn parse_request<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(value)
        .map_err(|e| DomainError::invalid_patch(format!("invalid request: {e}")).into())
}
pub use read::*;
pub use types::*;

pub fn productivity_get_task_list_snapshot(app: &AppHandle) -> Result<panel::TaskListSnapshot, String> { panel::get_task_list_snapshot(app) }
pub fn productivity_panel_write_task(app: &AppHandle, req: panel::PanelTaskWriteRequest) -> Result<serde_json::Value, String> { panel::apply_task_write(app, req) }

use crate::data::get_data_dir;
use tauri::AppHandle;

fn data_dir_for(app: &AppHandle) -> Result<String, String> {
    get_data_dir(app)
}

pub fn productivity_get_business_time_zone(app: &AppHandle) -> Result<BusinessTimeZoneResponse, String> {
    read::get_business_time_zone_cmd(&data_dir_for(app)?).map_err(String::from)
}

pub fn productivity_get_item_type_catalog(app: &AppHandle) -> Result<ItemTypeCatalogResponse,String> { classification::get_catalog(&data_dir_for(app)?).map_err(String::from) }
pub fn productivity_delete_item_type(app: &AppHandle, req: DeleteItemTypeRequest) -> Result<ItemTypeCatalogResponse,String> {
    let actual = data_dir_for(app)?;
    if std::path::Path::new(&actual) != std::path::Path::new(&req.expected_data_dir) {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    classification::delete_item_type(&actual, req).map_err(String::from)
}
pub fn productivity_save_item_type_catalog(app: &AppHandle, req: SaveItemTypeCatalogRequest) -> Result<ItemTypeCatalogResponse,String> {
    let actual = data_dir_for(app)?;
    if std::path::Path::new(&actual) != std::path::Path::new(&req.expected_data_dir) {
        return Err(crate::productivity_db::DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    classification::save_item_type_catalog(&actual, req).map_err(String::from)
}
pub fn productivity_create_item_type(app: &AppHandle, req: CreateItemTypeRequest) -> Result<ItemTypeCatalogResponse,String> { classification::create_item_type(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_update_item_type(app: &AppHandle, req: UpdateItemTypeRequest) -> Result<ItemTypeCatalogResponse,String> { classification::update_item_type(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_move_item_type(app: &AppHandle, req: MoveItemTypeRequest) -> Result<ItemTypeCatalogResponse,String> { classification::move_item_type(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_set_item_type_inactive(app: &AppHandle, req: SetItemTypeInactiveRequest) -> Result<ItemTypeCatalogResponse,String> { classification::set_item_type_inactive(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_create_tag(app: &AppHandle, req: CreateTagRequest) -> Result<TagResponse,String> { classification::create_tag(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_update_tag(app: &AppHandle, req: UpdateTagRequest) -> Result<TagResponse,String> { classification::update_tag(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_set_tag_inactive(app: &AppHandle, req: SetTagInactiveRequest) -> Result<TagResponse,String> { classification::set_tag_inactive(&data_dir_for(app)?,req).map_err(String::from) }
pub fn productivity_get_tag(app: &AppHandle, id: String) -> Result<TagResponse,String> { classification::get_tag(&data_dir_for(app)?,&id).map_err(String::from) }
pub fn productivity_list_tags(app: &AppHandle) -> Result<TagsListResponse,String> { classification::list_tags(&data_dir_for(app)?).map_err(String::from) }
pub fn productivity_delete_tag_and_detach_items(app: &AppHandle, req: DeleteTagAndDetachItemsRequest) -> Result<DeleteTagAndDetachItemsResponse,String> { classification::delete_tag_and_detach_items(&data_dir_for(app)?,req).map_err(String::from) }

pub fn productivity_list_projects(app: &AppHandle) -> Result<ProjectsListResponse, String> {
    let root = data_dir_for(app)?;
    read::list_projects_cmd(&root).map_err(String::from)
}

pub fn productivity_get_project(app: &AppHandle, id: String) -> Result<ProjectResponse, String> {
    let root = data_dir_for(app)?;
    read::get_project_cmd(&root, &id).map_err(String::from)
}

pub fn productivity_get_project_for_data_dir(app:&AppHandle,id:String,expected:Option<String>)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;if expected.as_deref().is_some_and(|e|e!=actual){return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}read::get_project_cmd(&actual,&id).map_err(String::from)}
pub fn productivity_create_task_in_project(app:&AppHandle,req:CreateTaskInProjectRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::create_task_in_project(&actual,req).map_err(String::from)}
pub fn productivity_add_task_sequence(app:&AppHandle,req:TaskSequenceRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::add_task_sequence(&actual,req).map_err(String::from)}
pub fn productivity_remove_task_sequence(app:&AppHandle,req:RemoveTaskSequenceRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::remove_task_sequence(&actual,req).map_err(String::from)}
pub fn productivity_set_task_sequence_anchor(app:&AppHandle,req:SetTaskSequenceAnchorRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::set_task_sequence_anchor(&actual,req).map_err(String::from)}
pub fn productivity_set_task_card_position(app:&AppHandle,req:SetTaskCardPositionRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::set_task_card_position(&actual,req).map_err(String::from)}
pub fn productivity_set_task_card_positions(app:&AppHandle,req:SetTaskCardPositionsRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::set_task_card_positions(&actual,req).map_err(String::from)}
pub fn productivity_reorder_task_siblings(app:&AppHandle,req:ReorderTaskSiblingsRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::reorder_task_siblings(&actual,req).map_err(String::from)}
pub fn productivity_move_task_same_level(app:&AppHandle,req:MoveTaskSameLevelRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::move_task_same_level(&actual,req).map_err(String::from)}
pub fn productivity_set_task_status_guarded(app:&AppHandle,req:SetTaskStatusGuardedRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::set_task_status_guarded(&actual,req).map_err(String::from)}
pub fn productivity_list_deleted_task_batches(app:&AppHandle,req:ListDeletedTaskBatchesRequest)->Result<DeletedTaskBatchesResponse,String>{let actual=data_dir_for(app)?;commands::list_deleted_task_batches(&actual,req).map_err(String::from)}
pub fn productivity_delete_task_subtree_exact(app:&AppHandle,req:DeleteTaskSubtreeRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::delete_task_subtree_exact(&actual,req).map_err(String::from)}
pub fn productivity_restore_task_subtree_exact(app:&AppHandle,req:RestoreTaskSubtreeRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::restore_task_subtree_exact(&actual,req).map_err(String::from)}
pub fn productivity_restore_task_subtree_batch(app:&AppHandle,req:RestoreTaskSubtreeBatchRequest)->Result<ProjectResponse,String>{let actual=data_dir_for(app)?;commands::restore_task_subtree_batch(&actual,req).map_err(String::from)}

pub fn productivity_list_lists(app: &AppHandle) -> Result<ListsListResponse, String> {
    let root = data_dir_for(app)?;
    read::list_lists_cmd(&root).map_err(String::from)
}

pub fn productivity_get_list(app: &AppHandle, id: String) -> Result<ListResponse, String> {
    let root = data_dir_for(app)?;
    read::get_list_cmd(&root, &id).map_err(String::from)
}

pub fn productivity_list_items(app: &AppHandle, query: ListItemsQuery) -> Result<ItemsListResponse, String> {
    let root = data_dir_for(app)?;
    read::list_items_cmd(&root, &query).map_err(String::from)
}

pub fn productivity_get_item(app: &AppHandle, id: String) -> Result<ItemResponse, String> {
    let root = data_dir_for(app)?;
    read::get_item_cmd(&root, &id).map_err(String::from)
}

pub fn productivity_create_travel(app: &AppHandle, req: CreateTravelRequest) -> Result<TravelSnapshot, String> {
    let actual=data_dir_for(app)?; if actual != req.expected_data_dir { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); } travel::create_travel(&actual, req).map_err(String::from)
}

pub fn productivity_get_travel(app: &AppHandle, req: GetTravelRequest) -> Result<TravelSnapshot, String> {
    travel::get_travel(&data_dir_for(app)?, req).map_err(String::from)
}
pub fn productivity_update_travel(app: &AppHandle, req: UpdateTravelRequest) -> Result<TravelSnapshot, String> { let actual=data_dir_for(app)?; if actual != req.expected_data_dir { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); } travel::update_travel(&actual, req).map_err(String::from) }
pub fn productivity_adopt_travel_flight(app: &AppHandle, req: AdoptTravelFlightRequest) -> Result<TravelSnapshot, String> { let actual=data_dir_for(app)?; if actual != req.expected_data_dir { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); } travel::adopt_travel_flight(&actual, req).map_err(String::from) }
pub fn productivity_delete_travel(app: &AppHandle, req: DeleteTravelRequest) -> Result<TravelSnapshot, String> { let actual=data_dir_for(app)?; if actual != req.expected_data_dir { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); } travel::delete_travel(&actual, req).map_err(String::from) }
pub fn productivity_restore_travel(app: &AppHandle, req: RestoreTravelRequest) -> Result<TravelSnapshot, String> { let actual=data_dir_for(app)?; if actual != req.expected_data_dir { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); } travel::restore_travel(&actual, req).map_err(String::from) }

pub fn productivity_list_sessions(app: &AppHandle) -> Result<SessionsListResponse, String> {
    let root = data_dir_for(app)?;
    read::list_sessions_cmd(&root).map_err(String::from)
}

pub fn productivity_get_session(app: &AppHandle, id: String) -> Result<SessionResponse, String> {
    let root = data_dir_for(app)?;
    read::get_session_cmd(&root, &id).map_err(String::from)
}

pub fn productivity_list_actions(app: &AppHandle, expected_data_dir: Option<String>) -> Result<ActionsListResponse, String> {
    let root = data_dir_for(app)?;
    if expected_data_dir.as_deref().is_some_and(|expected| expected != root) { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); }
    read::list_actions_cmd(&root).map_err(String::from)
}

pub fn productivity_get_action(app: &AppHandle, id: String) -> Result<ActionResponse, String> {
    let root = data_dir_for(app)?;
    read::get_action_cmd(&root, &id).map_err(String::from)
}

pub fn productivity_create_checkpoint(app:&AppHandle,req:CreateCheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::create(&actual,req).map_err(String::from)}
pub fn productivity_get_checkpoint(app:&AppHandle,req:GetCheckpointRequest)->Result<CheckpointResponse,String>{checkpoint::get(&data_dir_for(app)?,req).map_err(String::from)}
pub fn productivity_list_checkpoints(app:&AppHandle,req:ListCheckpointsRequest)->Result<CheckpointsListResponse,String>{let actual=data_dir_for(app)?;if req.expected_data_dir.as_deref().is_some_and(|expected|expected!=actual){return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::list(&actual,req).map_err(String::from)}
pub fn productivity_update_checkpoint(app:&AppHandle,req:UpdateCheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::update(&actual,req).map_err(String::from)}
pub fn productivity_complete_checkpoint(app:&AppHandle,req:CompleteCheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::complete(&actual,req).map_err(String::from)}
pub fn productivity_correct_checkpoint_actual(app:&AppHandle,req:CorrectCheckpointActualRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::correct_actual(&actual,req).map_err(String::from)}
pub fn productivity_reopen_checkpoint(app:&AppHandle,req:CheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::reopen(&actual,req).map_err(String::from)}
pub fn productivity_delete_checkpoint(app:&AppHandle,req:CheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::delete(&actual,req).map_err(String::from)}
pub fn productivity_restore_checkpoint(app:&AppHandle,req:CheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::restore(&actual,req).map_err(String::from)}
pub fn productivity_set_checkpoint_target(app:&AppHandle,req:SetCheckpointTargetRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::set_target(&actual,req).map_err(String::from)}
pub fn productivity_clear_checkpoint_target(app:&AppHandle,req:CheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::clear_target(&actual,req).map_err(String::from)}
pub fn productivity_assign_checkpoint_to_session(app:&AppHandle,req:AssignCheckpointSessionRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::assign_session(&actual,req).map_err(String::from)}
pub fn productivity_remove_checkpoint_from_session(app:&AppHandle,req:CheckpointRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::remove_session(&actual,req).map_err(String::from)}
pub fn productivity_commit_item_with_checkpoint(app:&AppHandle,req:CommitItemWithCheckpointRequest)->Result<ItemWithCheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::create_item_with_checkpoint(&actual,req).map_err(String::from)}
pub fn productivity_commit_checkpoint_arrangement(app:&AppHandle,req:CommitCheckpointArrangementRequest)->Result<CheckpointResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}checkpoint::commit_arrangement(&actual,req).map_err(String::from)}

pub fn productivity_create_project(app: &AppHandle, req: CreateProjectRequest) -> Result<ProjectResponse, String> {
    commands::create_project(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_create_project_wire(app: &AppHandle, req: CreateProjectWireRequest) -> Result<ProjectResponse, String> {
    let actual = data_dir_for(app)?;
    if req.expected_data_dir.as_deref().is_some_and(|expected| expected != actual) {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    let expected = req.expected_data_dir.as_deref().unwrap_or(&actual);
    commands::create_project_expected(&actual, CreateProjectRequest { title: req.title, description: req.description, status: req.status, planned_point: req.planned_point, due_point: req.due_point }, Some(expected)).map_err(String::from)
}

pub fn productivity_create_task(app: &AppHandle, req: CreateTaskRequest) -> Result<ProjectResponse, String> {
    commands::create_task(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_update_project(app: &AppHandle, req: UpdateProjectRequest) -> Result<ProjectResponse, String> {
    commands::update_project(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_update_task(app: &AppHandle, req: UpdateTaskRequest) -> Result<ProjectResponse, String> {
    commands::update_task(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_move_task_within_project(app: &AppHandle, req: MoveTaskRequest) -> Result<ProjectResponse, String> {
    commands::move_task(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_set_project_status(app: &AppHandle, req: SetProjectStatusRequest) -> Result<ProjectResponse, String> {
    commands::set_project_status(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_set_project_status_expected(app: &AppHandle, req: SetProjectStatusWireRequest) -> Result<ProjectResponse, String> {
    let actual = data_dir_for(app)?;
    if req.expected_data_dir.as_deref().is_some_and(|expected| expected != actual) {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    commands::set_project_status_expected(&actual, SetProjectStatusRequest { project: req.project, status: req.status }, Some(&actual)).map_err(String::from)
}

pub fn productivity_set_task_status(app: &AppHandle, req: SetTaskStatusRequest) -> Result<ProjectResponse, String> {
    commands::set_task_status(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_project(app: &AppHandle, req: DeleteProjectRequest) -> Result<ProjectResponse, String> {
    commands::delete_project(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_restore_project(app: &AppHandle, req: RestoreProjectRequest) -> Result<ProjectResponse, String> {
    commands::restore_project(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_task_subtree(app: &AppHandle, req: DeleteTaskSubtreeRequest) -> Result<ProjectResponse, String> {
    commands::delete_task_subtree(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_restore_task_subtree(app: &AppHandle, req: RestoreTaskSubtreeRequest) -> Result<ProjectResponse, String> {
    commands::restore_task_subtree(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_create_list(app: &AppHandle, req: CreateListRequest) -> Result<ListResponse, String> {
    commands::create_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_update_list(app: &AppHandle, req: UpdateListRequest) -> Result<ListResponse, String> {
    commands::update_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_set_list_status(app: &AppHandle, req: SetListStatusRequest) -> Result<ListResponse, String> {
    commands::set_list_status(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_list(app: &AppHandle, req: DeleteListRequest) -> Result<ListAndItemsResponse, String> {
    commands::delete_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_list_and_move_items_to_inbox(app: &AppHandle, req: DeleteListAndMoveItemsToInboxRequest) -> Result<ListAndItemsResponse, String> {
    let actual = data_dir_for(app)?;
    if std::path::Path::new(&actual) != std::path::Path::new(&req.expected_data_dir) {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    commands::delete_list_and_move_items_to_inbox(req).map_err(String::from)
}

pub fn productivity_get_list_item_members(app: &AppHandle, req: GetListItemMembersRequest) -> Result<ListItemMembersResponse, String> {
    let actual = data_dir_for(app)?;
    if std::path::Path::new(&actual) != std::path::Path::new(&req.expected_data_dir) {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    read::get_list_item_members_cmd(&actual, &req.list_id).map_err(String::from)
}

pub fn productivity_restore_list(app: &AppHandle, req: RestoreListRequest) -> Result<ListAndItemsResponse, String> {
    commands::restore_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_create_item(app: &AppHandle, req: CreateItemRequest) -> Result<ItemResponse, String> {
    commands::create_item(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_update_item(app: &AppHandle, req: UpdateItemRequest) -> Result<ItemResponse, String> {
    commands::update_item(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_set_item_status(app: &AppHandle, req: SetItemStatusRequest) -> Result<ItemResponse, String> {
    commands::set_item_status(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_item(app: &AppHandle, req: DeleteItemRequest) -> Result<ItemResponse, String> {
    commands::delete_item(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_restore_item(app: &AppHandle, req: RestoreItemRequest) -> Result<ItemResponse, String> {
    commands::restore_item(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_assign_item_to_list(app: &AppHandle, req: AssignItemToListRequest) -> Result<ItemResponse, String> {
    commands::assign_item_to_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_move_item_to_list(app: &AppHandle, req: MoveItemToListRequest) -> Result<ItemResponse, String> {
    commands::move_item_to_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_remove_item_from_list(app: &AppHandle, req: RemoveItemFromListRequest) -> Result<ItemResponse, String> {
    commands::remove_item_from_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_batch_move_items_to_list(app: &AppHandle, req: BatchMoveItemsToListRequest) -> Result<ItemsBatchResponse, String> {
    commands::batch_move_items_to_list(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_batch_delete_items(app: &AppHandle, req: BatchDeleteItemsRequest) -> Result<ItemsBatchResponse, String> {
    commands::batch_delete_items(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_create_session(app: &AppHandle, req: CreateSessionRequest) -> Result<SessionResponse, String> {
    commands::create_session(&data_dir_for(app)?, req).map_err(String::from)
}

fn session_write_data_dir(app: &AppHandle, expected: Option<&str>) -> Result<String, String> {
    let actual = data_dir_for(app)?;
    if let Some(expected) = expected {
        if std::path::Path::new(&actual) != std::path::Path::new(expected) {
            return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
        }
    }
    Ok(actual)
}

pub fn productivity_update_session(app: &AppHandle, req: UpdateSessionRequest) -> Result<SessionResponse, String> {
    commands::update_session(&session_write_data_dir(app, req.expected_data_dir.as_deref())?, req).map_err(String::from)
}

pub fn productivity_commit_session_boundary(app: &AppHandle, req: CommitSessionBoundaryRequest) -> Result<SessionAndActionsResponse, String> {
    commands::commit_session_boundary(&session_write_data_dir(app, req.expected_data_dir.as_deref())?, req).map_err(String::from)
}

pub fn productivity_restore_session_boundary_state(app: &AppHandle, req: RestoreSessionBoundaryStateRequest) -> Result<SessionAndActionsResponse, String> {
    commands::restore_session_boundary_state(&session_write_data_dir(app, Some(&req.expected_data_dir))?, req).map_err(String::from)
}

pub fn productivity_delete_session_only(app: &AppHandle, req: DeleteSessionOnlyRequest) -> Result<SessionAndActionsResponse, String> {
    commands::delete_session_only(&session_write_data_dir(app, req.expected_data_dir.as_deref())?, req).map_err(String::from)
}

pub fn productivity_restore_session(app: &AppHandle, req: RestoreSessionRequest) -> Result<SessionResponse, String> {
    commands::restore_session(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_session_with_actions(app: &AppHandle, req: DeleteSessionWithActionsRequest) -> Result<SessionAndActionsResponse, String> {
    commands::delete_session_with_actions(&session_write_data_dir(app, req.expected_data_dir.as_deref())?, req).map_err(String::from)
}

pub fn productivity_restore_session_with_actions(app: &AppHandle, req: RestoreSessionWithActionsRequest) -> Result<SessionAndActionsResponse, String> {
    commands::restore_session_with_actions(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_create_action(app: &AppHandle, req: CreateActionRequest) -> Result<ActionResponse, String> {
    commands::create_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_update_action(app: &AppHandle, req: UpdateActionRequest) -> Result<ActionResponse, String> {
    commands::update_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_commit_action_arrangement(app: &AppHandle, req: CommitActionArrangementRequest) -> Result<ActionResponse, String> {
    commands::commit_action_arrangement(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_restore_action_arrangement_state(app: &AppHandle, req: RestoreActionArrangementStateRequest) -> Result<ActionResponse, String> {
    commands::restore_action_arrangement_state(&session_write_data_dir(app, Some(&req.expected_data_dir))?, req).map_err(String::from)
}

pub fn productivity_start_action(app: &AppHandle, req: StartActionRequest) -> Result<ActionResponse, String> {
    commands::start_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_pause_action(app: &AppHandle, req: PauseActionRequest) -> Result<ActionResponse, String> {
    commands::pause_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_resume_action(app: &AppHandle, req: ResumeActionRequest) -> Result<ActionResponse, String> {
    commands::resume_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_end_action(app: &AppHandle, req: EndActionRequest) -> Result<ActionResponse, String> {
    commands::end_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_reopen_action(app: &AppHandle, req: ReopenActionRequest) -> Result<ActionResponse, String> {
    commands::reopen_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_delete_action(app: &AppHandle, req: DeleteActionRequest) -> Result<ActionResponse, String> {
    commands::delete_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_restore_action(app: &AppHandle, req: RestoreActionRequest) -> Result<ActionResponse, String> {
    commands::restore_action(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_assign_action_to_session(app: &AppHandle, req: AssignActionToSessionRequest) -> Result<ActionResponse, String> {
    commands::assign_action_to_session(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_move_action_to_session(app: &AppHandle, req: MoveActionToSessionRequest) -> Result<ActionResponse, String> {
    commands::move_action_to_session(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_remove_action_from_session(app: &AppHandle, req: RemoveActionFromSessionRequest) -> Result<ActionResponse, String> {
    commands::remove_action_from_session(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_set_action_target(app: &AppHandle, req: SetActionTargetRequest) -> Result<ActionResponse, String> {
    commands::set_action_target(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_clear_action_target(app: &AppHandle, req: ClearActionTargetRequest) -> Result<ActionResponse, String> {
    commands::clear_action_target(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_complete_thing_and_end_related_actions(app: &AppHandle, req: CompleteThingRequest) -> Result<CompleteThingResponse, String> {
    commands::complete_thing_and_end_related_actions(&data_dir_for(app)?, req).map_err(String::from)
}

pub fn productivity_commit_thing_lifecycle(app: &AppHandle, req: CommitThingLifecycleRequest) -> Result<CompleteThingResponse, String> {
    let actual = data_dir_for(app)?;
    if let Some(expected) = req.expected_data_dir.as_deref() {
        if expected != actual { return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into()); }
    }
    commands::commit_thing_lifecycle(&actual, req).map_err(String::from)
}
pub fn productivity_commit_thing_lifecycle_mvp(app:&AppHandle,req:CommitThingLifecycleMvpRequest)->Result<CompleteThingResponse,String>{let actual=data_dir_for(app)?;if actual!=req.expected_data_dir{return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());}commands::commit_thing_lifecycle_mvp(&actual,req).map_err(String::from)}

pub fn productivity_create_item_after(app: &AppHandle, req: CreateItemAfterRequest) -> Result<CreateItemAfterResponse, String> {
    commands::create_item_after(&data_dir_for(app)?, req).map_err(String::from)
}

fn travel_v2_data_dir(app: &AppHandle, expected: &str) -> Result<String, String> {
    let actual = data_dir_for(app)?;
    if actual != expected {
        return Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消").into());
    }
    Ok(actual)
}

pub fn productivity_travel_v2_get(app: &AppHandle, req: travel_v2::TravelV2GetRequest) -> Result<travel_v2::TravelV2GetResponse, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::get_trip(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_list_week(app: &AppHandle, req: travel_v2::TravelV2ListWeekRequest) -> Result<travel_v2::TravelV2ListWeekResponse, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::list_week(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_list_items(app: &AppHandle, req: travel_v2::TravelV2ListItemsRequest) -> Result<travel_v2::TravelV2ListItemsResponse, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::list_items(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_create(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::CreateTripPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::create(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_append(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::AppendTripPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::append(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_update_item(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::UpdateItemPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::update_item(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_update_point(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::UpdatePointPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::update_point(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_update_transportation(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::UpdateTransportationPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::update_transportation(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_edit_plan(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::EditPlanPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::edit_plan(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_replay_plan_effect(app: &AppHandle, req: travel_v2::ReplayTravelPlanEffectRequest) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::plan_history::replay(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_release_plan_history(_app: &AppHandle, req: travel_v2::ReleaseTravelPlanHistoryRequest) -> Result<(), String> {
    // Owner-scoped memory cleanup must still work after the active directory changed.
    travel_v2::plan_history::release(req).map_err(String::from)
}

pub fn productivity_travel_v2_split(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::SplitPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::split(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_set_actual(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::SetActualPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::set_actual(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_set_checkpoint_completed(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::SetCheckpointCompletedPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::set_checkpoint_completed(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_set_join_actual(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::SetJoinActualPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::set_join_actual(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_finish(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<serde_json::Value>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::finish(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_reopen(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<serde_json::Value>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::reopen(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_cancel(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::CancelTripPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::cancel(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_delete_stage(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::DeleteStagePayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::delete_stage(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_delete_checkpoint(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::DeleteCheckpointPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::delete_checkpoint(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_clear_point(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::ClearPointPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::clear_point(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_delete_trip(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<serde_json::Value>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::delete_trip(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_restore(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::RestoreTripPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::restore(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_adopt_flight(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::AdoptFlightPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::adopt_flight(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_restore_adoption_fields(app: &AppHandle, req: travel_v2::TravelMutationEnvelope<travel_v2::RestoreAdoptionFieldsPayload>) -> Result<travel_v2::TravelMutationResult, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::restore_adoption_fields(&root, req).map_err(String::from)
}

pub fn productivity_transportation_list(app: &AppHandle, req: travel_v2::TransportationListRequest) -> Result<travel_v2::TransportationListResponse, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::transportation_list(&root, req).map_err(String::from)
}

pub fn productivity_travel_v2_get_receipt(app: &AppHandle, req: travel_v2::GetReceiptRequest) -> Result<travel_v2::GetReceiptResponse, String> {
    let root = travel_v2_data_dir(app, &req.expected_data_dir)?;
    travel_v2::get_receipt(&root, &req.expected_data_dir, &req.request_id).map_err(String::from)
}

#[cfg(test)]
mod tests;


pub fn productivity_edit_action_interval(app: &AppHandle, req: EditActionIntervalRequest) -> Result<ActionResponse, String> {
    commands::edit_action_interval(&session_write_data_dir(app, Some(&req.expected_data_dir))?, req).map_err(String::from)
}
