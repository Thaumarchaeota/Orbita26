import { invoke } from "@tauri-apps/api/core";
import type { HealthPlanSnapshot, HealthPlanRequest, WeekHealthResponse, RevisionRef as HealthRevisionRef, HealthSourceRef } from "./types";

export const productivityCreateHealthPlan = (req: { expectedDataDir: string; kind: "sleep" | "activity"; start: string; end: string; activityType?: string; catalog?: HealthRevisionRef }) => invokeDomainWrite<HealthPlanSnapshot>("productivity_create_health_plan", { req });
export const productivityEnsureHealthTypes = (req: { expectedDataDir: string; catalog?: HealthRevisionRef }) => invokeDomainWrite<import("./types").ItemTypeCatalogSnapshot>("productivity_ensure_health_types", { req });
export const productivityListWeekHealth = (req: { expectedDataDir: string; start: string; end: string; includeActivityPauses?: boolean }) => invoke<WeekHealthResponse>("productivity_list_week_health", { req });
export const productivityLinkHealthPlan = (req: HealthPlanRequest) => invokeDomainWrite<HealthPlanSnapshot>("productivity_link_health_plan", { req });
export const productivityUnlinkHealthPlan = (req: HealthPlanRequest) => invokeDomainWrite<HealthPlanSnapshot>("productivity_unlink_health_plan", { req });
export const productivityMutateHealthPlan = (req: HealthPlanRequest) => invokeDomainWrite<HealthPlanSnapshot>("productivity_mutate_health_plan", { req });
export const productivityReconcileSleepPlans = (req: { expectedDataDir: string; plans: { item: HealthRevisionRef; action: HealthRevisionRef }[]; sources: HealthSourceRef[] }) => invokeDomainWrite<HealthPlanSnapshot[]>("productivity_reconcile_sleep_plans", { req });
import { invokeDomainWrite } from "../admin/domain-write-guard";
import type {
  ActionResponse,
  BusinessTimeZoneResponse,
  CommitActionArrangementRequest,
  RestoreActionArrangementStateRequest,
  RestoreSessionBoundaryStateRequest,
  CommitSessionBoundaryRequest,
  CommitThingLifecycleRequest,
  ActionsListResponse,
  AssignActionToSessionRequest,
  AssignItemToListRequest,
  ClearActionTargetRequest,
  CreateItemTypeRequest,
  DeleteItemTypeRequest,
  UpdateItemTypeRequest,
  MoveItemTypeRequest,
  SetItemTypeInactiveRequest,
  ItemTypeCatalogResponse,
  SaveItemTypeCatalogRequest,
  CreateTagRequest,
  UpdateTagRequest,
  SetTagInactiveRequest,
  DeleteTagAndDetachItemsRequest,
  DeleteTagAndDetachItemsResponse,
  TagResponse,
  TagsListResponse,
  CommitItemWithActionsRequest,
  CommitItemWithActionsResponse,
  CompleteThingRequest,
  CompleteThingResponse,
  CreateActionRequest,
  CreateItemRequest,
  CreateItemAfterRequest,
  CreateItemAfterResponse,
  CreateListRequest,
  CreateProjectRequest,
  CreateSessionRequest,
  CreateTaskRequest,
  CreateTaskInProjectRequest,
  DeleteActionRequest,
  DeleteItemRequest,
  DeleteListRequest,
  DeleteListAndMoveItemsToInboxRequest,
  DeleteProjectRequest,
  DeleteSessionOnlyRequest,
  DeleteSessionWithActionsRequest,
  DeleteTaskSubtreeRequest,
  DeleteTaskSubtreeMvpRequest,
  DeletedTaskBatchesResponse,
  ListDeletedTaskBatchesRequest,
  EndActionRequest,
  ReopenActionRequest,
  GetByIdRequest,
  GetListItemMembersRequest,
  GetListItemMembersResponse,
  ItemResponse,
  ItemsListResponse,
  ListAndItemsResponse,
  ListItemsQuery,
  ListResponse,
  ListsListResponse,
  MoveActionToSessionRequest,
  MoveItemToListAndPlaceRequest,
  MoveItemToListAndPlaceResponse,
  MoveItemToListRequest,
  BatchMoveItemsToListRequest,
  BatchDeleteItemsRequest,
  ItemsBatchResponse,
  MoveTaskRequest,
  MoveTaskSameLevelRequest,
  PauseActionRequest,
  ProjectResponse,
  RestoreTaskSubtreeMvpRequest,
  RestoreTaskSubtreeMvpResponse,
  RestoreTaskSubtreeBatchRequest,
  RestoreTaskSubtreeBatchResponse,
  ProjectsListResponse,
  RemoveActionFromSessionRequest,
  RemoveItemFromListRequest,
  RestoreActionRequest,
  RestoreItemRequest,
  RestoreListRequest,
  RestoreProjectRequest,
  RestoreSessionRequest,
  RestoreSessionWithActionsRequest,
  RestoreTaskSubtreeRequest,
  ReorderItemsRequest,
  ReorderItemsResponse,
  ResumeActionRequest,
  SessionAndActionsResponse,
  SessionResponse,
  SessionsListResponse,
  SetActionTargetRequest,
  SetItemStatusRequest,
  SetListStatusRequest,
  SetProjectStatusRequest,
  SetTaskStatusRequest,
  SetTaskStatusGuardedRequest,
  AddTaskSequenceRequest,
  RemoveTaskSequenceRequest,
  SetTaskSequenceAnchorRequest,
  SetTaskCardPositionRequest,
  SetTaskCardPositionsRequest,
  ReorderTaskSiblingsRequest,
  StartActionRequest,
  UpdateActionRequest,
  UpdateItemRequest,
  UpdateListRequest,
  UpdateProjectRequest,
  UpdateSessionRequest,
  UpdateTaskRequest,
  CreateTravelRequest,
  GetTravelRequest,
  TravelSnapshot,
  UpdateTravelRequest,
  AdoptTravelFlightRequest,
  DeleteTravelRequest,
  RestoreTravelRequest,
  TravelSourceQueryRequest,
  TravelSourceQueryResponse,
  ProductivityTaskListSnapshot,
  ProductivityPanelWriteRequest,
  ProductivityPanelWriteOperation,
  ProductivityPanelWriteResponse,
  InsightItemNavigationRequest,
  OpenInsightItemRequest,
  InsightItemNavigationResult,
  ClaimInsightNavigationRequest,
  ClaimedInsightNavigation,
  AckInsightNavigationRequest,
} from "./types";

export function productivityGetTaskListSnapshot() {
  return invoke<ProductivityTaskListSnapshot>("productivity_get_task_list_snapshot");
}

export function productivityPanelWriteTask(req: ProductivityPanelWriteRequest) {
  return invoke<ProductivityPanelWriteResponse>("productivity_panel_write_task", { req });
}

export function openInsightItem(req: OpenInsightItemRequest) {
  const request: InsightItemNavigationRequest = { ...req, requestId: req.requestId ?? crypto.randomUUID() };
  return invoke<InsightItemNavigationResult>("open_insight_item", { req: request });
}

export function claimInsightItemNavigation(req: ClaimInsightNavigationRequest) {
  return invoke<ClaimedInsightNavigation | null>("claim_insight_item_navigation", { req });
}

export function ackInsightItemNavigation(req: AckInsightNavigationRequest) {
  return invoke<InsightItemNavigationResult>("ack_insight_item_navigation", { req });
}

export function getInsightItemNavigationResult(req: { requestId: string }) {
  return invoke<InsightItemNavigationResult>("get_insight_item_navigation_result", { req });
}

export function productivityCreateTravel(req: CreateTravelRequest) { return invokeDomainWrite<TravelSnapshot>("productivity_create_travel", { req }); }
export function productivityGetTravel(req: GetTravelRequest) { return invoke<TravelSnapshot>("productivity_get_travel", { req }); }
export function productivityUpdateTravel(req: UpdateTravelRequest) { return invokeDomainWrite<TravelSnapshot>("productivity_update_travel", { req }); }
export function productivityAdoptTravelFlight(req: AdoptTravelFlightRequest) { return invokeDomainWrite<TravelSnapshot>("productivity_adopt_travel_flight", { req }); }
export function productivityDeleteTravel(req: DeleteTravelRequest) { return invokeDomainWrite<TravelSnapshot>("productivity_delete_travel", { req }); }
export function productivityRestoreTravel(req: RestoreTravelRequest) { return invokeDomainWrite<TravelSnapshot>("productivity_restore_travel", { req }); }
export function productivityQueryTravelSource(req: TravelSourceQueryRequest) { return invoke<TravelSourceQueryResponse>("productivity_query_travel_source", { req }); }

export function productivityGetItemTypeCatalog() { return invoke<ItemTypeCatalogResponse>("productivity_get_item_type_catalog"); }
export function productivitySaveItemTypeCatalog(req: SaveItemTypeCatalogRequest) { return invokeDomainWrite<ItemTypeCatalogResponse>("productivity_save_item_type_catalog", { req }); }
export function productivityCreateItemType(req: CreateItemTypeRequest) { return invokeDomainWrite<ItemTypeCatalogResponse>("productivity_create_item_type",{req}); }
export function productivityDeleteItemType(req: DeleteItemTypeRequest) { return invokeDomainWrite<ItemTypeCatalogResponse>("productivity_delete_item_type", { req }); }
export function productivityUpdateItemType(req: UpdateItemTypeRequest) { return invokeDomainWrite<ItemTypeCatalogResponse>("productivity_update_item_type",{req}); }
export function productivityMoveItemType(req: MoveItemTypeRequest) { return invokeDomainWrite<ItemTypeCatalogResponse>("productivity_move_item_type",{req}); }
export function productivitySetItemTypeInactive(req: SetItemTypeInactiveRequest) { return invokeDomainWrite<ItemTypeCatalogResponse>("productivity_set_item_type_inactive",{req}); }
export function productivityCreateTag(req: CreateTagRequest) { return invokeDomainWrite<TagResponse>("productivity_create_tag",{req}); }
export function productivityUpdateTag(req: UpdateTagRequest) { return invokeDomainWrite<TagResponse>("productivity_update_tag",{req}); }
export function productivitySetTagInactive(req: SetTagInactiveRequest) { return invokeDomainWrite<TagResponse>("productivity_set_tag_inactive",{req}); }
export function productivityGetTag(id: string) { return invoke<TagResponse>("productivity_get_tag",{req:{id}}); }
export function productivityListTags() { return invoke<TagsListResponse>("productivity_list_tags"); }
export function productivityDeleteTagAndDetachItems(req: DeleteTagAndDetachItemsRequest) { return invokeDomainWrite<DeleteTagAndDetachItemsResponse>("productivity_delete_tag_and_detach_items",{req}); }

export function productivityListProjects() {
  return invoke<ProjectsListResponse>("productivity_list_projects");
}

export function productivityGetBusinessTimeZone() {
  return invoke<BusinessTimeZoneResponse>("productivity_get_business_time_zone");
}

export function productivityGetProject(req: GetByIdRequest) {
  return invoke<ProjectResponse>("productivity_get_project", { req });
}

export function productivityListLists() {
  return invoke<ListsListResponse>("productivity_list_lists");
}

export function productivityGetList(req: GetByIdRequest) {
  return invoke<ListResponse>("productivity_get_list", { req });
}

export function productivityGetListItemMembers(req: GetListItemMembersRequest) {
  return invoke<GetListItemMembersResponse>("productivity_get_list_item_members", { req });
}

export function productivityListItems(req: ListItemsQuery = {}) {
  return invoke<ItemsListResponse>("productivity_list_items", { req });
}

export function productivityGetItem(req: GetByIdRequest) {
  return invoke<ItemResponse>("productivity_get_item", { req });
}

export function productivityListSessions() {
  return invoke<SessionsListResponse>("productivity_list_sessions");
}

export function productivityGetSession(req: GetByIdRequest) {
  return invoke<SessionResponse>("productivity_get_session", { req });
}

export function productivityListActions(expectedDataDir?: string) {
  return invoke<ActionsListResponse>("productivity_list_actions", expectedDataDir ? { expectedDataDir } : undefined);
}

export function productivityListCheckpoints(req: { includeDeleted: boolean; expectedDataDir?: string }) {
  return invoke<import("./checkpoint-types").CheckpointsListResponse>("productivity_list_checkpoints", { req });
}

export function productivityGetAction(req: GetByIdRequest) {
  return invoke<ActionResponse>("productivity_get_action", { req });
}

export function productivityCreateProject(req: CreateProjectRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_create_project", { req });
}

export function productivityCreateTask(req: CreateTaskRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_create_task", { req });
}

export function productivityUpdateProject(req: UpdateProjectRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_update_project", { req });
}

export function productivityUpdateTask(req: UpdateTaskRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_update_task", { req });
}

export function productivityMoveTaskWithinProject(req: MoveTaskRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_move_task_within_project", { req });
}

export function productivitySetProjectStatus(req: SetProjectStatusRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_set_project_status", { req });
}

export function productivitySetTaskStatus(req: SetTaskStatusRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_set_task_status", { req });
}

export function productivityDeleteProject(req: DeleteProjectRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_delete_project", { req });
}

export function productivityRestoreProject(req: RestoreProjectRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_restore_project", { req });
}

export function productivityDeleteTaskSubtree(req: DeleteTaskSubtreeRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_delete_task_subtree", { req });
}

export function productivityRestoreTaskSubtree(req: RestoreTaskSubtreeRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_restore_task_subtree", { req });
}

// Project / Task path-map MVP commands. Each write returns the canonical complete Project snapshot.
export function productivityCreateTaskInProject(req: CreateTaskInProjectRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_create_task_in_project", { req });
}
export function productivitySetTaskStatusGuarded(req: SetTaskStatusGuardedRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_set_task_status_guarded", { req });
}
export function productivityAddTaskSequence(req: AddTaskSequenceRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_add_task_sequence", { req });
}
export function productivityRemoveTaskSequence(req: RemoveTaskSequenceRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_remove_task_sequence", { req });
}
export function productivitySetTaskSequenceAnchor(req: SetTaskSequenceAnchorRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_set_task_sequence_anchor", { req });
}
export function productivitySetTaskCardPosition(req: SetTaskCardPositionRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_set_task_card_position", { req });
}
export function productivitySetTaskCardPositions(req: SetTaskCardPositionsRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_set_task_card_positions", { req });
}
export function productivityReorderTaskSiblings(req: ReorderTaskSiblingsRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_reorder_task_siblings", { req });
}
export function productivityMoveTaskSameLevel(req: MoveTaskSameLevelRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_move_task_same_level", { req });
}
export function productivityDeleteTaskSubtreeMvp(req: DeleteTaskSubtreeMvpRequest) {
  return invokeDomainWrite<ProjectResponse>("productivity_delete_task_subtree", { req });
}
export function productivityRestoreTaskSubtreeMvp(req: RestoreTaskSubtreeMvpRequest) {
  return invokeDomainWrite<RestoreTaskSubtreeMvpResponse>("productivity_restore_task_subtree", { req });
}
export function productivityRestoreTaskSubtreeBatch(req: RestoreTaskSubtreeBatchRequest) {
  return invokeDomainWrite<RestoreTaskSubtreeBatchResponse>("productivity_restore_task_subtree_batch", { req });
}
export function productivityListDeletedTaskBatches(req: ListDeletedTaskBatchesRequest) {
  return invoke<DeletedTaskBatchesResponse>("productivity_list_deleted_task_batches", { req });
}

export function productivityCreateList(req: CreateListRequest) {
  return invokeDomainWrite<ListResponse>("productivity_create_list", { req });
}

export function productivityUpdateList(req: UpdateListRequest) {
  return invokeDomainWrite<ListResponse>("productivity_update_list", { req });
}

export function productivitySetListStatus(req: SetListStatusRequest) {
  return invokeDomainWrite<ListResponse>("productivity_set_list_status", { req });
}

export function productivityDeleteList(req: DeleteListRequest) {
  return invokeDomainWrite<ListAndItemsResponse>("productivity_delete_list", { req });
}

export function productivityDeleteListAndMoveItemsToInbox(req: DeleteListAndMoveItemsToInboxRequest) {
  return invokeDomainWrite<ListAndItemsResponse>("productivity_delete_list_and_move_items_to_inbox", { req });
}

export function productivityRestoreList(req: RestoreListRequest) {
  return invokeDomainWrite<ListAndItemsResponse>("productivity_restore_list", { req });
}

export function productivityCreateItem(req: CreateItemRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_create_item", { req });
}

export function productivityCreateItemAfter(req: CreateItemAfterRequest) {
  return invokeDomainWrite<CreateItemAfterResponse>("productivity_create_item_after", { req });
}

export function productivityUpdateItem(req: UpdateItemRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_update_item", { req });
}

export function productivitySetItemStatus(req: SetItemStatusRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_set_item_status", { req });
}

export function productivityDeleteItem(req: DeleteItemRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_delete_item", { req });
}

export function productivityRestoreItem(req: RestoreItemRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_restore_item", { req });
}

export function productivityAssignItemToList(req: AssignItemToListRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_assign_item_to_list", { req });
}

export function productivityMoveItemToList(req: MoveItemToListRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_move_item_to_list", { req });
}

export function productivityRemoveItemFromList(req: RemoveItemFromListRequest) {
  return invokeDomainWrite<ItemResponse>("productivity_remove_item_from_list", { req });
}

export function productivityBatchMoveItemsToList(req: BatchMoveItemsToListRequest) {
  return invokeDomainWrite<ItemsBatchResponse>("productivity_batch_move_items_to_list", { req });
}

export function productivityBatchDeleteItems(req: BatchDeleteItemsRequest) {
  return invokeDomainWrite<ItemsBatchResponse>("productivity_batch_delete_items", { req });
}

export function productivityCreateSession(req: CreateSessionRequest) {
  return invokeDomainWrite<SessionResponse>("productivity_create_session", { req });
}

export function productivityUpdateSession(req: UpdateSessionRequest) {
  return invokeDomainWrite<SessionResponse>("productivity_update_session", { req });
}

export function productivityCommitSessionBoundary(req: CommitSessionBoundaryRequest) {
  return invokeDomainWrite<SessionAndActionsResponse>("productivity_commit_session_boundary", { req });
}

export function productivityRestoreSessionBoundaryState(req: RestoreSessionBoundaryStateRequest) {
  return invokeDomainWrite<SessionAndActionsResponse>("productivity_restore_session_boundary_state", { req });
}

export function productivityDeleteSessionOnly(req: DeleteSessionOnlyRequest) {
  return invokeDomainWrite<SessionAndActionsResponse>("productivity_delete_session_only", { req });
}

export function productivityRestoreSession(req: RestoreSessionRequest) {
  return invokeDomainWrite<SessionResponse>("productivity_restore_session", { req });
}

export function productivityDeleteSessionWithActions(req: DeleteSessionWithActionsRequest) {
  return invokeDomainWrite<SessionAndActionsResponse>("productivity_delete_session_with_actions", { req });
}

export function productivityRestoreSessionWithActions(req: RestoreSessionWithActionsRequest) {
  return invokeDomainWrite<SessionAndActionsResponse>("productivity_restore_session_with_actions", { req });
}

export function productivityCreateAction(req: CreateActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_create_action", { req });
}

export function productivityUpdateAction(req: UpdateActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_update_action", { req });
}

export function productivityCommitActionArrangement(req: CommitActionArrangementRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_commit_action_arrangement", { req });
}

export function productivityRestoreActionArrangementState(req: RestoreActionArrangementStateRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_restore_action_arrangement_state", { req });
}

export function productivityStartAction(req: StartActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_start_action", { req });
}

export function productivityPauseAction(req: PauseActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_pause_action", { req });
}

export function productivityResumeAction(req: ResumeActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_resume_action", { req });
}

export function productivityEndAction(req: EndActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_end_action", { req });
}

export function productivityReopenAction(req: ReopenActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_reopen_action", { req });
}

export function productivityDeleteAction(req: DeleteActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_delete_action", { req });
}

export function productivityRestoreAction(req: RestoreActionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_restore_action", { req });
}

export function productivityAssignActionToSession(req: AssignActionToSessionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_assign_action_to_session", { req });
}

export function productivityMoveActionToSession(req: MoveActionToSessionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_move_action_to_session", { req });
}

export function productivityRemoveActionFromSession(req: RemoveActionFromSessionRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_remove_action_from_session", { req });
}

export function productivitySetActionTarget(req: SetActionTargetRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_set_action_target", { req });
}

export function productivityClearActionTarget(req: ClearActionTargetRequest) {
  return invokeDomainWrite<ActionResponse>("productivity_clear_action_target", { req });
}

export function productivityCompleteThingAndEndRelatedActions(req: CompleteThingRequest) {
  return invokeDomainWrite<CompleteThingResponse>("productivity_complete_thing_and_end_related_actions", { req });
}

export function productivityCommitThingLifecycle(req: CommitThingLifecycleRequest) {
  return invokeDomainWrite<CompleteThingResponse>("productivity_commit_thing_lifecycle", { req });
}

export function productivityCommitItemWithActions(req: CommitItemWithActionsRequest) {
  return invokeDomainWrite<CommitItemWithActionsResponse>("productivity_commit_item_with_actions", { req });
}

export function productivityReorderItems(req: ReorderItemsRequest) {
  return invokeDomainWrite<ReorderItemsResponse>("productivity_reorder_items", { req });
}

export function productivityMoveItemToListAndPlace(req: MoveItemToListAndPlaceRequest) {
  return invokeDomainWrite<MoveItemToListAndPlaceResponse>("productivity_move_item_to_list_and_place", { req });
}

export function productivityApplyAiBatch(req: Record<string, unknown>) {
  return invokeDomainWrite<unknown>("productivity_apply_ai_batch", { req });
}

export {
  productivityAssignCheckpointToSession,
  productivityCommitItemWithCheckpoint,
  productivityCommitCheckpointArrangement,
  productivityClearCheckpointTarget,
  productivityCompleteCheckpoint,
  productivityCorrectCheckpointActual,
  productivityCreateCheckpoint,
  productivityDeleteCheckpoint,
  productivityGetCheckpoint,
  productivityRemoveCheckpointFromSession,
  productivityRestoreCheckpoint,
  productivityReopenCheckpoint,
  productivitySetCheckpointTarget,
  productivityUpdateCheckpoint,
} from "./checkpoint-client";

export function productivityEditActionInterval(req: { expectedDataDir: string; action: { id: string; expectedRevision: number }; targetOwningRoot: { id: string; expectedRevision: number } | null; operation: "create" | "update" | "delete"; intervalId?: string; startedAt?: string; endedAt?: string }) {
  return invokeDomainWrite<ActionResponse>("productivity_edit_action_interval", { req });
}
