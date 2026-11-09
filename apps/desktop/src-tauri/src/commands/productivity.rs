use crate::productivity_db;
use crate::productivity_db::health_plan;
fn health_root(app: &tauri::AppHandle, expected: &str) -> Result<(),String> { if crate::data::get_data_dir(app)? != expected { return Err("数据目录已切换".into()); } Ok(()) }
#[tauri::command]
pub fn productivity_ensure_health_types(app: tauri::AppHandle, req: health_plan::EnsureHealthRequest) -> Result<productivity_db::ItemTypeCatalogSnapshot,String> { health_root(&app,&req.expected_data_dir)?; health_plan::ensure(req).map_err(String::from) }

#[tauri::command]
pub fn productivity_create_health_plan(app: tauri::AppHandle, req: health_plan::CreateHealthPlanRequest) -> Result<health_plan::HealthPlanSnapshot,String> { health_root(&app, &req.expected_data_dir)?; health_plan::create(req).map_err(String::from) }
#[tauri::command]
pub async fn productivity_list_week_health(app: tauri::AppHandle, req: health_plan::WeekHealthRequest) -> Result<health_plan::WeekHealthResponse,String> {
    health_root(&app, &req.expected_data_dir)?;
    let expected = req.expected_data_dir.clone();
    // FIT asset decoding can involve disk IO; keep it off the window thread.
    let response = tauri::async_runtime::spawn_blocking(move || health_plan::list(req))
        .await.map_err(|error| error.to_string())?.map_err(String::from)?;
    health_root(&app, &expected)?;
    Ok(response)
}
#[tauri::command]
pub fn productivity_link_health_plan(app: tauri::AppHandle, req: health_plan::HealthPlanRequest) -> Result<health_plan::HealthPlanSnapshot,String> { health_root(&app, &req.expected_data_dir)?; health_plan::link(req).map_err(String::from) }
#[tauri::command]
pub fn productivity_unlink_health_plan(app: tauri::AppHandle, req: health_plan::HealthPlanRequest) -> Result<health_plan::HealthPlanSnapshot,String> { health_root(&app, &req.expected_data_dir)?; health_plan::unlink(req).map_err(String::from) }
#[tauri::command]
pub fn productivity_reconcile_sleep_plans(app: tauri::AppHandle, req: health_plan::ReconcileHealthRequest) -> Result<Vec<health_plan::HealthPlanSnapshot>,String> { health_root(&app, &req.expected_data_dir)?; health_plan::reconcile(req).map_err(String::from) }
#[tauri::command]
pub fn productivity_mutate_health_plan(app: tauri::AppHandle, req: health_plan::HealthPlanRequest) -> Result<health_plan::HealthPlanSnapshot,String> { health_root(&app, &req.expected_data_dir)?; health_plan::mutate(req).map_err(String::from) }

macro_rules! productivity_cmd {
    ($name:ident, $req:ty, $ret:ty, |$app:ident, $parsed:ident| $body:expr) => {
        #[tauri::command]
        pub fn $name($app: tauri::AppHandle, req: serde_json::Value) -> Result<$ret, String> {
            let $parsed: $req = productivity_db::parse_request(req)?;
            $body
        }
    };
}

#[tauri::command]
pub fn productivity_list_projects(app: tauri::AppHandle) -> Result<productivity_db::ProjectsListResponse, String> {
    productivity_db::productivity_list_projects(&app)
}

#[tauri::command]
pub fn productivity_get_task_list_snapshot(app: tauri::AppHandle) -> Result<productivity_db::panel::TaskListSnapshot, String> {
    productivity_db::productivity_get_task_list_snapshot(&app)
}

productivity_cmd!(productivity_panel_write_task, productivity_db::panel::PanelTaskWriteRequest, serde_json::Value, |app, req| {
    productivity_db::productivity_panel_write_task(&app, req)
});

productivity_cmd!(productivity_get_project, productivity_db::GetByIdRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_get_project_for_data_dir(&app, req.id, req.expected_data_dir)
});

#[tauri::command]
pub fn productivity_list_lists(app: tauri::AppHandle) -> Result<productivity_db::ListsListResponse, String> {
    productivity_db::productivity_list_lists(&app)
}

productivity_cmd!(productivity_get_list, productivity_db::GetByIdRequest, productivity_db::ListResponse, |app, req| {
    productivity_db::productivity_get_list(&app, req.id)
});

productivity_cmd!(productivity_list_items, productivity_db::ListItemsQuery, productivity_db::ItemsListResponse, |app, req| {
    productivity_db::productivity_list_items(&app, req)
});

productivity_cmd!(productivity_get_item, productivity_db::GetByIdRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_get_item(&app, req.id)
});

productivity_cmd!(productivity_create_travel, productivity_db::CreateTravelRequest, productivity_db::TravelSnapshot, |app, req| {
    productivity_db::productivity_create_travel(&app, req)
});
productivity_cmd!(productivity_get_travel, productivity_db::GetTravelRequest, productivity_db::TravelSnapshot, |app, req| {
    productivity_db::productivity_get_travel(&app, req)
});
productivity_cmd!(productivity_update_travel, productivity_db::UpdateTravelRequest, productivity_db::TravelSnapshot, |app, req| productivity_db::productivity_update_travel(&app, req));
productivity_cmd!(productivity_adopt_travel_flight, productivity_db::AdoptTravelFlightRequest, productivity_db::TravelSnapshot, |app, req| productivity_db::productivity_adopt_travel_flight(&app, req));
productivity_cmd!(productivity_delete_travel, productivity_db::DeleteTravelRequest, productivity_db::TravelSnapshot, |app, req| productivity_db::productivity_delete_travel(&app, req));
productivity_cmd!(productivity_restore_travel, productivity_db::RestoreTravelRequest, productivity_db::TravelSnapshot, |app, req| productivity_db::productivity_restore_travel(&app, req));

#[tauri::command]
pub fn productivity_get_item_type_catalog(app: tauri::AppHandle) -> Result<productivity_db::ItemTypeCatalogResponse,String> { productivity_db::productivity_get_item_type_catalog(&app) }
productivity_cmd!(productivity_delete_item_type, productivity_db::DeleteItemTypeRequest, productivity_db::ItemTypeCatalogResponse, |app, req| productivity_db::productivity_delete_item_type(&app,req));
productivity_cmd!(productivity_save_item_type_catalog, productivity_db::SaveItemTypeCatalogRequest, productivity_db::ItemTypeCatalogResponse, |app, req| productivity_db::productivity_save_item_type_catalog(&app,req));
productivity_cmd!(productivity_create_item_type, productivity_db::CreateItemTypeRequest, productivity_db::ItemTypeCatalogResponse, |app, req| productivity_db::productivity_create_item_type(&app,req));
productivity_cmd!(productivity_update_item_type, productivity_db::UpdateItemTypeRequest, productivity_db::ItemTypeCatalogResponse, |app, req| productivity_db::productivity_update_item_type(&app,req));
productivity_cmd!(productivity_move_item_type, productivity_db::MoveItemTypeRequest, productivity_db::ItemTypeCatalogResponse, |app, req| productivity_db::productivity_move_item_type(&app,req));
productivity_cmd!(productivity_set_item_type_inactive, productivity_db::SetItemTypeInactiveRequest, productivity_db::ItemTypeCatalogResponse, |app, req| productivity_db::productivity_set_item_type_inactive(&app,req));
productivity_cmd!(productivity_create_tag, productivity_db::CreateTagRequest, productivity_db::TagResponse, |app, req| productivity_db::productivity_create_tag(&app,req));
productivity_cmd!(productivity_update_tag, productivity_db::UpdateTagRequest, productivity_db::TagResponse, |app, req| productivity_db::productivity_update_tag(&app,req));
productivity_cmd!(productivity_set_tag_inactive, productivity_db::SetTagInactiveRequest, productivity_db::TagResponse, |app, req| productivity_db::productivity_set_tag_inactive(&app,req));
productivity_cmd!(productivity_get_tag, productivity_db::GetByIdRequest, productivity_db::TagResponse, |app, req| productivity_db::productivity_get_tag(&app,req.id));
#[tauri::command]
pub fn productivity_list_tags(app: tauri::AppHandle) -> Result<productivity_db::TagsListResponse,String> { productivity_db::productivity_list_tags(&app) }
productivity_cmd!(productivity_delete_tag_and_detach_items, productivity_db::DeleteTagAndDetachItemsRequest, productivity_db::DeleteTagAndDetachItemsResponse, |app, req| productivity_db::productivity_delete_tag_and_detach_items(&app,req));

#[tauri::command]
pub fn productivity_list_sessions(app: tauri::AppHandle) -> Result<productivity_db::SessionsListResponse, String> {
    productivity_db::productivity_list_sessions(&app)
}

productivity_cmd!(productivity_get_session, productivity_db::GetByIdRequest, productivity_db::SessionResponse, |app, req| {
    productivity_db::productivity_get_session(&app, req.id)
});

#[tauri::command]
pub fn productivity_list_actions(app: tauri::AppHandle, expected_data_dir: Option<String>) -> Result<productivity_db::ActionsListResponse, String> {
    productivity_db::productivity_list_actions(&app, expected_data_dir)
}

productivity_cmd!(productivity_create_task_in_project, productivity_db::CreateTaskInProjectRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_create_task_in_project(&app,req));
productivity_cmd!(productivity_add_task_sequence, productivity_db::TaskSequenceRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_add_task_sequence(&app,req));
productivity_cmd!(productivity_remove_task_sequence, productivity_db::RemoveTaskSequenceRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_remove_task_sequence(&app,req));
productivity_cmd!(productivity_set_task_sequence_anchor, productivity_db::SetTaskSequenceAnchorRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_set_task_sequence_anchor(&app,req));
productivity_cmd!(productivity_set_task_card_position, productivity_db::SetTaskCardPositionRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_set_task_card_position(&app,req));
productivity_cmd!(productivity_set_task_card_positions, productivity_db::SetTaskCardPositionsRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_set_task_card_positions(&app,req));
productivity_cmd!(productivity_reorder_task_siblings, productivity_db::ReorderTaskSiblingsRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_reorder_task_siblings(&app,req));
productivity_cmd!(productivity_move_task_same_level, productivity_db::MoveTaskSameLevelRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_move_task_same_level(&app,req));
productivity_cmd!(productivity_set_task_status_guarded, productivity_db::SetTaskStatusGuardedRequest, productivity_db::ProjectResponse, |app, req| productivity_db::productivity_set_task_status_guarded(&app,req));
productivity_cmd!(productivity_list_deleted_task_batches, productivity_db::ListDeletedTaskBatchesRequest, productivity_db::DeletedTaskBatchesResponse, |app, req| productivity_db::productivity_list_deleted_task_batches(&app,req));

#[tauri::command]
pub fn productivity_get_business_time_zone(app: tauri::AppHandle) -> Result<productivity_db::BusinessTimeZoneResponse, String> {
    productivity_db::productivity_get_business_time_zone(&app)
}

productivity_cmd!(productivity_get_action, productivity_db::GetByIdRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_get_action(&app, req.id)
});

productivity_cmd!(productivity_create_checkpoint, productivity_db::CreateCheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_create_checkpoint(&app, req) });
productivity_cmd!(productivity_get_checkpoint, productivity_db::GetCheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_get_checkpoint(&app, req) });
productivity_cmd!(productivity_list_checkpoints, productivity_db::ListCheckpointsRequest, productivity_db::CheckpointsListResponse, |app, req| { productivity_db::productivity_list_checkpoints(&app, req) });
productivity_cmd!(productivity_update_checkpoint, productivity_db::UpdateCheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_update_checkpoint(&app, req) });
productivity_cmd!(productivity_complete_checkpoint, productivity_db::CompleteCheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_complete_checkpoint(&app, req) });
productivity_cmd!(productivity_correct_checkpoint_actual, productivity_db::CorrectCheckpointActualRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_correct_checkpoint_actual(&app, req) });
productivity_cmd!(productivity_reopen_checkpoint, productivity_db::CheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_reopen_checkpoint(&app, req) });
productivity_cmd!(productivity_delete_checkpoint, productivity_db::CheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_delete_checkpoint(&app, req) });
productivity_cmd!(productivity_restore_checkpoint, productivity_db::CheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_restore_checkpoint(&app, req) });
productivity_cmd!(productivity_set_checkpoint_target, productivity_db::SetCheckpointTargetRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_set_checkpoint_target(&app, req) });
productivity_cmd!(productivity_clear_checkpoint_target, productivity_db::CheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_clear_checkpoint_target(&app, req) });
productivity_cmd!(productivity_assign_checkpoint_to_session, productivity_db::AssignCheckpointSessionRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_assign_checkpoint_to_session(&app, req) });
productivity_cmd!(productivity_remove_checkpoint_from_session, productivity_db::CheckpointRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_remove_checkpoint_from_session(&app, req) });
productivity_cmd!(productivity_commit_item_with_checkpoint, productivity_db::CommitItemWithCheckpointRequest, productivity_db::ItemWithCheckpointResponse, |app, req| { productivity_db::productivity_commit_item_with_checkpoint(&app, req) });
productivity_cmd!(productivity_commit_checkpoint_arrangement, productivity_db::CommitCheckpointArrangementRequest, productivity_db::CheckpointResponse, |app, req| { productivity_db::productivity_commit_checkpoint_arrangement(&app, req) });

productivity_cmd!(productivity_create_project, productivity_db::CreateProjectWireRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_create_project_wire(&app, req)
});

productivity_cmd!(productivity_create_task, productivity_db::CreateTaskRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_create_task(&app, req)
});

productivity_cmd!(productivity_update_project, productivity_db::UpdateProjectRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_update_project(&app, req)
});

productivity_cmd!(productivity_update_task, productivity_db::UpdateTaskRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_update_task(&app, req)
});

productivity_cmd!(productivity_move_task_within_project, productivity_db::MoveTaskRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_move_task_within_project(&app, req)
});

productivity_cmd!(productivity_set_project_status, productivity_db::SetProjectStatusWireRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_set_project_status_expected(&app, req)
});

productivity_cmd!(productivity_set_task_status, productivity_db::SetTaskStatusRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_set_task_status(&app, req)
});

productivity_cmd!(productivity_delete_project, productivity_db::DeleteProjectRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_delete_project(&app, req)
});

productivity_cmd!(productivity_restore_project, productivity_db::RestoreProjectRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_restore_project(&app, req)
});

productivity_cmd!(productivity_delete_task_subtree, productivity_db::DeleteTaskSubtreeRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_delete_task_subtree_exact(&app, req)
});

productivity_cmd!(productivity_restore_task_subtree, productivity_db::RestoreTaskSubtreeRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_restore_task_subtree_exact(&app, req)
});

productivity_cmd!(productivity_restore_task_subtree_batch, productivity_db::RestoreTaskSubtreeBatchRequest, productivity_db::ProjectResponse, |app, req| {
    productivity_db::productivity_restore_task_subtree_batch(&app, req)
});

productivity_cmd!(productivity_create_list, productivity_db::CreateListRequest, productivity_db::ListResponse, |app, req| {
    productivity_db::productivity_create_list(&app, req)
});

productivity_cmd!(productivity_update_list, productivity_db::UpdateListRequest, productivity_db::ListResponse, |app, req| {
    productivity_db::productivity_update_list(&app, req)
});

productivity_cmd!(productivity_set_list_status, productivity_db::SetListStatusRequest, productivity_db::ListResponse, |app, req| {
    productivity_db::productivity_set_list_status(&app, req)
});

productivity_cmd!(productivity_delete_list, productivity_db::DeleteListRequest, productivity_db::ListAndItemsResponse, |app, req| {
    productivity_db::productivity_delete_list(&app, req)
});

productivity_cmd!(productivity_delete_list_and_move_items_to_inbox, productivity_db::DeleteListAndMoveItemsToInboxRequest, productivity_db::ListAndItemsResponse, |app, req| {
    productivity_db::productivity_delete_list_and_move_items_to_inbox(&app, req)
});

productivity_cmd!(productivity_get_list_item_members, productivity_db::GetListItemMembersRequest, productivity_db::ListItemMembersResponse, |app, req| {
    productivity_db::productivity_get_list_item_members(&app, req)
});

productivity_cmd!(productivity_restore_list, productivity_db::RestoreListRequest, productivity_db::ListAndItemsResponse, |app, req| {
    productivity_db::productivity_restore_list(&app, req)
});

productivity_cmd!(productivity_create_item, productivity_db::CreateItemRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_create_item(&app, req)
});

productivity_cmd!(productivity_create_item_after, productivity_db::CreateItemAfterRequest, productivity_db::CreateItemAfterResponse, |app, req| {
    productivity_db::productivity_create_item_after(&app, req)
});

productivity_cmd!(productivity_update_item, productivity_db::UpdateItemRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_update_item(&app, req)
});

productivity_cmd!(productivity_set_item_status, productivity_db::SetItemStatusRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_set_item_status(&app, req)
});

productivity_cmd!(productivity_delete_item, productivity_db::DeleteItemRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_delete_item(&app, req)
});

productivity_cmd!(productivity_restore_item, productivity_db::RestoreItemRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_restore_item(&app, req)
});

productivity_cmd!(productivity_assign_item_to_list, productivity_db::AssignItemToListRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_assign_item_to_list(&app, req)
});

productivity_cmd!(productivity_move_item_to_list, productivity_db::MoveItemToListRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_move_item_to_list(&app, req)
});

productivity_cmd!(productivity_remove_item_from_list, productivity_db::RemoveItemFromListRequest, productivity_db::ItemResponse, |app, req| {
    productivity_db::productivity_remove_item_from_list(&app, req)
});

productivity_cmd!(productivity_batch_move_items_to_list, productivity_db::BatchMoveItemsToListRequest, productivity_db::ItemsBatchResponse, |app, req| {
    productivity_db::productivity_batch_move_items_to_list(&app, req)
});

productivity_cmd!(productivity_batch_delete_items, productivity_db::BatchDeleteItemsRequest, productivity_db::ItemsBatchResponse, |app, req| {
    productivity_db::productivity_batch_delete_items(&app, req)
});

productivity_cmd!(productivity_create_session, productivity_db::CreateSessionRequest, productivity_db::SessionResponse, |app, req| {
    productivity_db::productivity_create_session(&app, req)
});

productivity_cmd!(productivity_update_session, productivity_db::UpdateSessionRequest, productivity_db::SessionResponse, |app, req| {
    productivity_db::productivity_update_session(&app, req)
});

productivity_cmd!(productivity_commit_session_boundary, productivity_db::CommitSessionBoundaryRequest, productivity_db::SessionAndActionsResponse, |app, req| {
    productivity_db::productivity_commit_session_boundary(&app, req)
});

productivity_cmd!(productivity_restore_session_boundary_state, productivity_db::RestoreSessionBoundaryStateRequest, productivity_db::SessionAndActionsResponse, |app, req| {
    productivity_db::productivity_restore_session_boundary_state(&app, req)
});

productivity_cmd!(productivity_delete_session_only, productivity_db::DeleteSessionOnlyRequest, productivity_db::SessionAndActionsResponse, |app, req| {
    productivity_db::productivity_delete_session_only(&app, req)
});

productivity_cmd!(productivity_restore_session, productivity_db::RestoreSessionRequest, productivity_db::SessionResponse, |app, req| {
    productivity_db::productivity_restore_session(&app, req)
});

productivity_cmd!(productivity_delete_session_with_actions, productivity_db::DeleteSessionWithActionsRequest, productivity_db::SessionAndActionsResponse, |app, req| {
    productivity_db::productivity_delete_session_with_actions(&app, req)
});

productivity_cmd!(productivity_restore_session_with_actions, productivity_db::RestoreSessionWithActionsRequest, productivity_db::SessionAndActionsResponse, |app, req| {
    productivity_db::productivity_restore_session_with_actions(&app, req)
});

productivity_cmd!(productivity_create_action, productivity_db::CreateActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_create_action(&app, req)
});

productivity_cmd!(productivity_update_action, productivity_db::UpdateActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_update_action(&app, req)
});

productivity_cmd!(productivity_commit_action_arrangement, productivity_db::CommitActionArrangementRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_commit_action_arrangement(&app, req)
});

productivity_cmd!(productivity_restore_action_arrangement_state, productivity_db::RestoreActionArrangementStateRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_restore_action_arrangement_state(&app, req)
});

productivity_cmd!(productivity_start_action, productivity_db::StartActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_start_action(&app, req)
});

productivity_cmd!(productivity_pause_action, productivity_db::PauseActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_pause_action(&app, req)
});

productivity_cmd!(productivity_resume_action, productivity_db::ResumeActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_resume_action(&app, req)
});

productivity_cmd!(productivity_end_action, productivity_db::EndActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_end_action(&app, req)
});

productivity_cmd!(productivity_reopen_action, productivity_db::ReopenActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_reopen_action(&app, req)
});

productivity_cmd!(productivity_delete_action, productivity_db::DeleteActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_delete_action(&app, req)
});

productivity_cmd!(productivity_restore_action, productivity_db::RestoreActionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_restore_action(&app, req)
});

productivity_cmd!(productivity_assign_action_to_session, productivity_db::AssignActionToSessionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_assign_action_to_session(&app, req)
});

productivity_cmd!(productivity_move_action_to_session, productivity_db::MoveActionToSessionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_move_action_to_session(&app, req)
});

productivity_cmd!(productivity_remove_action_from_session, productivity_db::RemoveActionFromSessionRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_remove_action_from_session(&app, req)
});

productivity_cmd!(productivity_set_action_target, productivity_db::SetActionTargetRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_set_action_target(&app, req)
});

productivity_cmd!(productivity_clear_action_target, productivity_db::ClearActionTargetRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_clear_action_target(&app, req)
});

productivity_cmd!(productivity_complete_thing_and_end_related_actions, productivity_db::CompleteThingRequest, productivity_db::CompleteThingResponse, |app, req| {
    productivity_db::productivity_complete_thing_and_end_related_actions(&app, req)
});

#[tauri::command]
pub fn productivity_commit_thing_lifecycle(app:tauri::AppHandle,req:serde_json::Value)->Result<productivity_db::CompleteThingResponse,String>{
    let wire:productivity_db::CommitThingLifecycleWireRequest=productivity_db::parse_request(req)?;
    let actual=crate::data::get_data_dir(&app)?;
    let expected=wire.expected_data_dir.unwrap_or(actual);
    productivity_db::productivity_commit_thing_lifecycle_mvp(&app,productivity_db::CommitThingLifecycleMvpRequest{
        thing_kind:wire.thing_kind,owning_root:wire.owning_root,task_id:wire.task_id,outcome:wire.outcome,expected_members:wire.expected_members,
        confirm_active_intervals:wire.confirm_active_intervals,expected_data_dir:expected,expected_checkpoints:wire.expected_checkpoints,
        complete_checkpoints_without_actual:wire.complete_checkpoints_without_actual,action_disposition:wire.action_disposition.unwrap_or_else(||"end".into()),
    })
}

productivity_cmd!(productivity_commit_item_with_actions, productivity_db::CommitItemWithActionsRequest, productivity_db::CommitItemWithActionsResponse, |app, req| {
    productivity_db::commands::commit_item_with_actions(&crate::data::get_data_dir(&app)?, req).map_err(String::from)
});

productivity_cmd!(productivity_reorder_items, productivity_db::ReorderItemsRequest, productivity_db::ReorderItemsResponse, |app, req| {
    productivity_db::commands::reorder_items(&crate::data::get_data_dir(&app)?, req).map_err(String::from)
});

productivity_cmd!(productivity_move_item_to_list_and_place, productivity_db::MoveItemToListAndPlaceRequest, productivity_db::MoveItemToListAndPlaceResponse, |app, req| {
    productivity_db::commands::move_item_to_list_and_place(&crate::data::get_data_dir(&app)?, req).map_err(String::from)
});

productivity_cmd!(productivity_travel_v2_get, productivity_db::travel_v2::TravelV2GetRequest, productivity_db::travel_v2::TravelV2GetResponse, |app, req| productivity_db::productivity_travel_v2_get(&app, req));
productivity_cmd!(productivity_travel_v2_list_week, productivity_db::travel_v2::TravelV2ListWeekRequest, productivity_db::travel_v2::TravelV2ListWeekResponse, |app, req| productivity_db::productivity_travel_v2_list_week(&app, req));
productivity_cmd!(productivity_travel_v2_list_items, productivity_db::travel_v2::TravelV2ListItemsRequest, productivity_db::travel_v2::TravelV2ListItemsResponse, |app, req| productivity_db::productivity_travel_v2_list_items(&app, req));
productivity_cmd!(productivity_travel_v2_create, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::CreateTripPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_create(&app, req));
productivity_cmd!(productivity_travel_v2_append, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::AppendTripPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_append(&app, req));
productivity_cmd!(productivity_travel_v2_update_item, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::UpdateItemPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_update_item(&app, req));
productivity_cmd!(productivity_travel_v2_update_point, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::UpdatePointPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_update_point(&app, req));
productivity_cmd!(productivity_travel_v2_update_transportation, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::UpdateTransportationPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_update_transportation(&app, req));
productivity_cmd!(productivity_travel_v2_edit_plan, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::EditPlanPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_edit_plan(&app, req));
productivity_cmd!(productivity_travel_v2_replay_plan_effect, productivity_db::travel_v2::ReplayTravelPlanEffectRequest, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_replay_plan_effect(&app, req));
productivity_cmd!(productivity_travel_v2_release_plan_history, productivity_db::travel_v2::ReleaseTravelPlanHistoryRequest, (), |app, req| productivity_db::productivity_travel_v2_release_plan_history(&app, req));
productivity_cmd!(productivity_travel_v2_split, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::SplitPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_split(&app, req));
productivity_cmd!(productivity_travel_v2_set_actual, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::SetActualPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_set_actual(&app, req));
productivity_cmd!(productivity_travel_v2_set_checkpoint_completed, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::SetCheckpointCompletedPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_set_checkpoint_completed(&app, req));
productivity_cmd!(productivity_travel_v2_set_join_actual, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::SetJoinActualPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_set_join_actual(&app, req));
productivity_cmd!(productivity_travel_v2_finish, productivity_db::travel_v2::TravelMutationEnvelope<serde_json::Value>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_finish(&app, req));
productivity_cmd!(productivity_travel_v2_reopen, productivity_db::travel_v2::TravelMutationEnvelope<serde_json::Value>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_reopen(&app, req));
productivity_cmd!(productivity_travel_v2_cancel, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::CancelTripPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_cancel(&app, req));
productivity_cmd!(productivity_travel_v2_delete_stage, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::DeleteStagePayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_delete_stage(&app, req));
productivity_cmd!(productivity_travel_v2_delete_checkpoint, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::DeleteCheckpointPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_delete_checkpoint(&app, req));
productivity_cmd!(productivity_travel_v2_clear_point, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::ClearPointPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_clear_point(&app, req));
productivity_cmd!(productivity_travel_v2_delete_trip, productivity_db::travel_v2::TravelMutationEnvelope<serde_json::Value>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_delete_trip(&app, req));
productivity_cmd!(productivity_travel_v2_restore, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::RestoreTripPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_restore(&app, req));
productivity_cmd!(productivity_travel_v2_adopt_flight, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::AdoptFlightPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_adopt_flight(&app, req));
productivity_cmd!(productivity_travel_v2_restore_adoption_fields, productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::RestoreAdoptionFieldsPayload>, productivity_db::travel_v2::TravelMutationResult, |app, req| productivity_db::productivity_travel_v2_restore_adoption_fields(&app, req));
productivity_cmd!(productivity_transportation_list, productivity_db::travel_v2::TransportationListRequest, productivity_db::travel_v2::TransportationListResponse, |app, req| productivity_db::productivity_transportation_list(&app, req));
productivity_cmd!(productivity_travel_v2_get_receipt, productivity_db::travel_v2::GetReceiptRequest, productivity_db::travel_v2::GetReceiptResponse, |app, req| productivity_db::productivity_travel_v2_get_receipt(&app, req));

#[tauri::command]
pub async fn productivity_travel_v2_query_flight(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let parsed: productivity_db::travel_v2::TravelMutationEnvelope<productivity_db::travel_v2::QueryFlightPayload> =
        productivity_db::parse_request(req)?;
    if crate::data::get_data_dir(&app)? != parsed.expected_data_dir {
        return Err("数据目录已切换，操作已取消".into());
    }
    productivity_db::travel_v2::query_flight(&app, parsed)
        .await
        .map_err(String::from)
}

productivity_cmd!(productivity_apply_ai_batch, productivity_db::ApplyProductivityAiBatchRequest, productivity_db::ApplyProductivityAiBatchResponse, |app, req| {
    let root = crate::data::get_data_dir(&app)?;
    if let Some(expected) = &req.expected_data_dir {
        if expected != &root {
            return Err("数据目录已切换，操作已取消".to_string());
        }
    }
    productivity_db::commands::apply_productivity_ai_batch(&root, req).map_err(String::from)
});

productivity_cmd!(productivity_edit_action_interval, productivity_db::EditActionIntervalRequest, productivity_db::ActionResponse, |app, req| {
    productivity_db::productivity_edit_action_interval(&app, req)
});
