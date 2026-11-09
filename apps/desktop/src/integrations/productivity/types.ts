export type ProductivityErrorCode =
  | "REVISION_CONFLICT"
  | "ROOT_NOT_FOUND"
  | "ROOT_DELETED"
  | "UNKNOWN_FIELD_WRITE_BLOCKED"
  | "INVALID_PATCH"
  | "INVALID_STATUS"
  | "INVALID_TIME_VALUE"
  | "ACTION_EXECUTION_STATE_INVALID"
  | "ACTIVE_ACTION_BLOCKS_THING"
  | "TARGET_NOT_STARTABLE"
  | "SESSION_INTERVAL_CONFLICT"
  | "ACTION_OUTSIDE_SESSION"
  | "TREE_CYCLE"
  | "CROSS_PROJECT_MOVE_FORBIDDEN"
  | "DELETE_BATCH_MISMATCH"
  | "ARCHIVED_LIST_READONLY"
  | "CLASSIFICATION_INACTIVE"
  | "REFERENCE_BLOCKS_PURGE"
  | "TASK_SEQUENCE_CYCLE"
  | "TASK_SEQUENCE_DUPLICATE"
  | "TASK_SEQUENCE_ENDPOINT_INVALID"
  | "TASK_MOVE_HAS_SEQUENCE_EDGES"
  | "TASK_PARENT_INVALID"
  | "TASK_COORDINATE_INVALID"
  | "TASK_RESTORE_PARENT_DELETED"
  | "TASK_PENDING_CHECKPOINT_BLOCKS_STATUS"
  | "TASK_SIBLING_SET_MISMATCH"
  | "ARCHIVE_LIFECYCLE_ERROR"
  | "ARCHIVE_BUSY";

export type ProductivityDomainError = {
  code: ProductivityErrorCode;
  message: string;
};

export type ProductivityPoint =
  | { precision: "date"; date: string }
  | { precision: "instant"; atUtc: string };

export type RevisionRef = {
  id: string;
  expectedRevision: number;
};

export type TaskSnapshot = {
  id: string;
  projectId: string;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  itemTypeId?: string | null;
  /** Sibling display order returned by the Project snapshot. */
  siblingPosition?: number;
  plannedPoint?: ProductivityPoint | null;
  duePoint?: ProductivityPoint | null;
  deletionBatchId?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type ProjectSnapshot = {
  id: string;
  revision: number;
  title: string;
  description?: string | null;
  status: string;
  plannedPoint?: ProductivityPoint | null;
  duePoint?: ProductivityPoint | null;
  tasks: TaskSnapshot[];
  taskSequenceEdges?: TaskSequenceEdgeSnapshot[];
  taskCardPositions?: TaskCardPositionSnapshot[];
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type ListSnapshot = {
  id: string;
  revision: number;
  title: string;
  description?: string | null;
  status: string;
  plannedPoint?: ProductivityPoint | null;
  duePoint?: ProductivityPoint | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type ItemSnapshot = {
  id: string;
  revision: number;
  listId?: string | null;
  itemTypeId: string | null;
  tagIds: string[];
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  plannedPoint?: ProductivityPoint | null;
  duePoint?: ProductivityPoint | null;
  deletionBatchId?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
  travelKind?: "flight" | "train" | null;
};

export type TravelRangeInput = {
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  departureCode?: string | null;
  departureName?: string | null;
  arrivalCode?: string | null;
  arrivalName?: string | null;
  departureTerminal?: string | null;
  arrivalTerminal?: string | null;
  departureGate?: string | null;
  arrivalGate?: string | null;
};
export type CreateTravelRequest = { expectedDataDir: string; title: string; kind: "flight" | "train"; rootColor?: string | null; ranges: TravelRangeInput[]; listId?: string | null; description?: string | null };
export type GetTravelRequest = { itemId: string; includeDeleted: boolean };
export type UpdateTravelRequest = { expectedDataDir: string; item: RevisionRef; kind?: "flight" | "train"; serviceNumber?: string | null; operatorCode?: string | null; operatorName?: string | null; aircraftType?: string | null; carriage?: string | null; seatNumber?: string | null; actionRevisions: RevisionRef[]; ranges?: TravelRangeInput[]; sourceSnapshot?: Record<string, unknown> | null };
export type AdoptTravelFlightRequest = { expectedDataDir: string; item: RevisionRef; expectedActions: RevisionRef[]; chosenRecord: Record<string, unknown>; matchedSegments: Record<string, unknown>[]; request: { fnum: string; date: string }; fetchedAtUtc: string };
export type DeleteTravelRequest = { expectedDataDir: string; item: RevisionRef; expectedActions: RevisionRef[] };
export type RestoreTravelRequest = { expectedDataDir: string; item: RevisionRef; expectedActions: RevisionRef[] };
export type TravelDetailSnapshot = { itemId: string; schemaVersion: number; kind: "flight" | "train"; serviceNumber?: string | null; operatorCode?: string | null; operatorName?: string | null; aircraftType?: string | null; carriage?: string | null; seatNumber?: string | null; sourceSnapshot: Record<string, unknown>; deletionBatchId?: string | null; createdAtUtc: string; updatedAtUtc: string; deletedAtUtc?: string | null };
export type TravelLegSnapshot = { id: string; itemId: string; actionId: string; position: number; departureCode?: string | null; departureName?: string | null; arrivalCode?: string | null; arrivalName?: string | null; departureTerminal?: string | null; arrivalTerminal?: string | null; departureGate?: string | null; arrivalGate?: string | null; sourceSnapshot: Record<string, unknown>; deletionBatchId?: string | null; createdAtUtc: string; updatedAtUtc: string; deletedAtUtc?: string | null };
export type TravelSnapshot = { item: ItemSnapshot; detail?: TravelDetailSnapshot | null; legs: TravelLegSnapshot[]; actions: ActionSnapshot[] };
export type TravelSourceQueryRequest = { expectedDataDir: string; apiKey: string; fnum: string; date: string };
export type TravelSourceQueryResponse = { request: { fnum: string; date: string }; fetchedAtUtc: string; result: unknown };

export type ItemOrderSnapshot = {
  id: string;
  revision: number;
  orderedItemIds: string[];
  updatedAtUtc: string;
};

export const ITEM_ORDER_ROOT_ID = "item-order";

export type ItemPriority = "none" | "low" | "medium" | "high";

export type SessionActualRange = {
  actualStartAt?: string | null;
  actualEndAt?: string | null;
};

export type SessionSnapshot = {
  id: string;
  revision: number;
  title: string;
  description?: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  trackLane: number;
  trackSpan: number;
  actualRange: SessionActualRange;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type IntervalSnapshot = {
  id: string;
  actionId: string;
  startedAt: string;
  endedAt?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type ExecutionState = "未开始" | "进行中" | "暂停" | "已结束";

export type ActionStroke =
  | "none"
  | "solid"
  | "dashed"
  | "dotted"
  | "double"
  | "dash-dot"
  | "dash-dot-dot";

export type ActionAppearance = {
  color: string;
  opacity: number;
  stroke: ActionStroke;
};

export type ActionSnapshot = {
  id: string;
  revision: number;
  title: string;
  nameLinkMode: ActionNameLinkMode;
  summary?: string | null;
  sessionId?: string | null;
  targetKind?: "project" | "task" | "item" | null;
  targetId?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  plannedDuration?: number | null;
  appearance?: ActionAppearance | null;
  ended: boolean;
  executionState: ExecutionState;
  intervals: IntervalSnapshot[];
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type ProjectPatch = {
  title?: string;
  description?: string | null;
  plannedPoint?: ProductivityPoint | null;
  duePoint?: ProductivityPoint | null;
};

export type TaskPatch = ProjectPatch & { itemTypeId?: string | null; classificationExpected?: ClassificationExpected };

export type ListPatch = ProjectPatch;
export type ClassificationExpected = { itemTypeCatalog?: RevisionRef; tags?: RevisionRef[] };
export type ItemPatch = ProjectPatch & { priority?: string; status?: string; itemTypeId?: string | null; tagIds?: string[]; classificationExpected?: ClassificationExpected };

export type ItemTypeSnapshot = { id: string; name: string; parentItemTypeId: string | null; colorOverride: string | null; effectiveColor: string; inactive: boolean; effectiveInactive: boolean; createdAtUtc: string; updatedAtUtc: string; systemRole?: string | null; referenceCount?: number; childCount?: number; canDelete?: boolean };
export type DeleteItemTypeRequest = { expectedDataDir: string; catalog: RevisionRef; itemTypeId: string };
export type ItemTypeCatalogSnapshot = { id: string; revision: number; itemTypes: ItemTypeSnapshot[]; createdAtUtc: string; updatedAtUtc: string; deletedAtUtc: string | null };
export type ItemTypeCatalogResponse = { catalog: ItemTypeCatalogSnapshot | null };
export type SaveItemTypeCatalogNode = {
  id: string;
  name: string;
  parentItemTypeId: string | null;
  colorOverride: string | null;
  inactive: boolean;
};
export type SaveItemTypeCatalogRequest = {
  expectedDataDir: string;
  catalog?: RevisionRef;
  nodes: SaveItemTypeCatalogNode[];
};
export type TagSnapshot = { id: string; revision: number; name: string; inactive: boolean; createdAtUtc: string; updatedAtUtc: string; deletedAtUtc: string | null };
export type TagResponse = { tag: TagSnapshot };
export type TagsListResponse = { tags: TagSnapshot[] };
export type CreateItemTypeRequest = { catalog?: RevisionRef; name: string; parentItemTypeId?: string | null; colorOverride?: string | null };
export type UpdateItemTypeRequest = { catalog: RevisionRef; itemTypeId: string; name?: string; colorOverride?: string | null };
export type MoveItemTypeRequest = { catalog: RevisionRef; itemTypeId: string; parentItemTypeId: string | null; colorOverride?: string | null };
export type SetItemTypeInactiveRequest = { catalog: RevisionRef; itemTypeId: string; inactive: boolean };
export type CreateTagRequest = { name: string };
export type UpdateTagRequest = { tag: RevisionRef; name: string };
export type SetTagInactiveRequest = { tag: RevisionRef; inactive: boolean };
export type DeleteTagAndDetachItemsRequest = { tag: RevisionRef; expectedMembers: RevisionRef[] };
export type DeleteTagAndDetachItemsResponse = { tag: TagSnapshot; items: ItemSnapshot[] };

export type SessionPatch = {
  title?: string;
  description?: string | null;
  plannedStartAt?: string;
  plannedEndAt?: string;
  trackLane?: number;
  trackSpan?: number;
};

export type ActionPatch = {
  title?: string;
  nameLinkMode?: ActionNameLinkMode;
  summary?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  plannedDuration?: number | null;
  appearance?: ActionAppearance | null;
};

export type CreateProjectRequest = {
  expectedDataDir?: string;
  title: string;
  description?: string;
  status: string;
  plannedPoint?: ProductivityPoint;
  duePoint?: ProductivityPoint;
};

export type CreateTaskRequest = {
  project: RevisionRef;
  title: string;
  description?: string;
  status: string;
  parentTaskId?: string | null;
  plannedPoint?: ProductivityPoint;
  duePoint?: ProductivityPoint;
};

export type TaskSequenceAnchor = { side: "top" | "right" | "bottom" | "left"; offset: number };

export type TaskSequenceEdgeSnapshot = {
  id: string;
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
  sourceAnchor?: TaskSequenceAnchor | null;
  targetAnchor?: TaskSequenceAnchor | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
  deletionBatchId?: string | null;
};

export type TaskCardPositionSnapshot = {
  taskId: string;
  projectId: string;
  parentTaskId?: string | null;
  x: number;
  y: number;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type CreateTaskInProjectRequest = {
  expectedDataDir: string;
  project: RevisionRef;
  title: string;
  status: string;
  parentTaskId?: string | null;
  description?: string | null;
  plannedPoint?: ProductivityPoint | null;
  duePoint?: ProductivityPoint | null;
  initialPosition?: { x: number; y: number };
  newInitialSequence?: { anchorTaskId: string; placement: "before" | "after" };
};
export type SetTaskStatusGuardedRequest = { expectedDataDir: string; project: RevisionRef; taskId: string; status: string };
export type AddTaskSequenceRequest = { expectedDataDir: string; project: RevisionRef; sourceTaskId: string; targetTaskId: string; sourceAnchor?: TaskSequenceAnchor | null; targetAnchor?: TaskSequenceAnchor | null };
export type RemoveTaskSequenceRequest = { expectedDataDir: string; project: RevisionRef; edgeId: string };
export type SetTaskSequenceAnchorRequest = {
  expectedDataDir: string;
  project: RevisionRef;
  edgeId: string;
  expectedSourceTaskId: string;
  expectedTargetTaskId: string;
  expectedParentTaskId: string;
  endpoint: "source" | "target";
  anchor: TaskSequenceAnchor | null;
};
export type SetTaskCardPositionRequest = { expectedDataDir: string; project: RevisionRef; taskId: string; expectedParentTaskId: string | null; x: number; y: number };
export type SetTaskCardPositionsRequest = { expectedDataDir: string; project: RevisionRef; expectedParentTaskId: string | null; positions: { taskId: string; x: number; y: number }[] };
export type ReorderTaskSiblingsRequest = { expectedDataDir: string; project: RevisionRef; parentTaskId: string | null; expectedSiblingIds: string[]; orderedSiblingIds: string[] };
export type MoveTaskSameLevelRequest = {
  expectedDataDir: string;
  project: RevisionRef;
  taskId: string;
  targetParentTaskId: string | null;
  expectedSourceSiblingIds: string[];
  expectedTargetSiblingIds: string[];
  targetOrderedSiblingIds: string[];
  position: { x: number; y: number };
};
export type ListDeletedTaskBatchesRequest = { expectedDataDir: string; projectId: string };
export type DeletedTaskBatch = { deletionBatchId: string; rootTaskId: string; rootTitle: string; taskIds: string[]; edgeIds: string[]; deletedAtUtc: string };
export type DeletedTaskBatchesResponse = { projectId: string; projectRevision: number; batches: DeletedTaskBatch[] };
export type RestoreTaskSummary = { restoredTaskIds: string[]; restoredEdgeIds: string[]; skippedEdges: { edgeId: string; reasonCode: string }[] };
export type RestoreTaskSubtreeMvpRequest = { expectedDataDir: string; project: RevisionRef; taskId: string; expectedEdgeIds: string[] };
export type RestoreTaskSubtreeMvpResponse = { project: ProjectSnapshot; restoreSummary: RestoreTaskSummary };
export type RestoreTaskSubtreeBatchRequest = { expectedDataDir: string; project: RevisionRef; taskId: string; expectedDeletionBatchId: string; expectedSubtreeTaskIds: string[]; expectedEdgeIds: string[] };
export type RestoreTaskSubtreeBatchResponse = { project: ProjectSnapshot; restoreSummary?: RestoreTaskSummary | null };
export type DeleteTaskSubtreeMvpRequest = { expectedDataDir: string; project: RevisionRef; taskId: string; expectedSubtreeTaskIds: string[]; expectedEdgeIds: string[] };

export type UpdateProjectRequest = { project: RevisionRef; patch: ProjectPatch };
export type UpdateTaskRequest = { expectedDataDir?: string; project: RevisionRef; taskId: string; patch: TaskPatch };
export type MoveTaskRequest = {
  project: RevisionRef;
  taskId: string;
  parentTaskId?: string | null;
  insertIndex?: number;
  expectedSiblings: string[];
};
export type SetProjectStatusRequest = { project: RevisionRef; status: string };
export type SetTaskStatusRequest = { project: RevisionRef; taskId: string; status: string };
export type DeleteProjectRequest = { expectedDataDir?: string; project: RevisionRef };
export type RestoreProjectRequest = { project: RevisionRef };
export type DeleteTaskSubtreeRequest = { project: RevisionRef; taskId: string };
export type RestoreTaskSubtreeRequest = { project: RevisionRef; taskId: string };

export type CreateListRequest = {
  title: string;
  description?: string;
  status: string;
  plannedPoint?: ProductivityPoint;
  duePoint?: ProductivityPoint;
};

export type UpdateListRequest = { list: RevisionRef; patch: ListPatch };
export type SetListStatusRequest = { list: RevisionRef; status: string };
export type DeleteListRequest = { list: RevisionRef; expectedMembers: RevisionRef[] };
export type DeleteListAndMoveItemsToInboxRequest = { expectedDataDir: string; list: RevisionRef; expectedMembers: RevisionRef[] };
export type RestoreListRequest = { list: RevisionRef; expectedMembers: RevisionRef[] };
export type GetListItemMembersRequest = { expectedDataDir: string; listId: string };
export type GetListItemMembersResponse = { dataDir: string; list: ListSnapshot; members: RevisionRef[] };

export type CreateItemRequest = {
  title: string;
  description?: string;
  status: string;
  listId?: string | null;
  priority?: string;
  plannedPoint?: ProductivityPoint;
  duePoint?: ProductivityPoint;
  itemTypeId?: string | null;
  tagIds?: string[];
  classificationExpected?: ClassificationExpected;
};

export type CreateItemAfterRequest = {
  title: string;
  description?: string;
  status: string;
  listId?: string | null;
  priority?: string;
  plannedPoint?: ProductivityPoint;
  duePoint?: ProductivityPoint;
  itemTypeId?: string | null;
  tagIds?: string[];
  classificationExpected?: ClassificationExpected;
  insertAfterItemId: string;
  itemOrder: RevisionRef;
  expectedMembers: RevisionRef[];
};

export type UpdateItemRequest = { item: RevisionRef; patch: ItemPatch };
export type SetItemStatusRequest = { item: RevisionRef; status: string };
export type DeleteItemRequest = { item: RevisionRef };
export type RestoreItemRequest = { item: RevisionRef };
export type AssignItemToListRequest = { item: RevisionRef; list: RevisionRef };
export type MoveItemToListRequest = AssignItemToListRequest;
export type RemoveItemFromListRequest = { item: RevisionRef };

/** Atomic list actions used by the task list toolbar and arrangement menu. */
export type BatchMoveItemsToListRequest = {
  expectedDataDir: string;
  items: RevisionRef[];
  list?: RevisionRef | null;
};
export type BatchDeleteItem = { item: RevisionRef; expectedActions: RevisionRef[] };
export type BatchDeleteItemsRequest = { expectedDataDir: string; items: BatchDeleteItem[] };
export type ItemsBatchResponse = {
  items: ItemSnapshot[];
  itemOrder?: ItemOrderSnapshot;
};

export type CreateSessionRequest = {
  title: string;
  description?: string;
  plannedStartAt: string;
  plannedEndAt: string;
  trackLane?: number;
  trackSpan?: number;
};

export type UpdateSessionRequest = { expectedDataDir?: string; session: RevisionRef; patch: SessionPatch; expectedCheckpoints?: RevisionRef[] };
export type CommitSessionBoundaryRequest = {
  expectedDataDir?: string;
  session: RevisionRef;
  expectedMembers: RevisionRef[];
  expectedCheckpoints?: RevisionRef[];
  plannedStartAt: string;
  plannedEndAt: string;
};
export type DeleteSessionOnlyRequest = { expectedDataDir?: string; session: RevisionRef; expectedMembers: RevisionRef[]; expectedCheckpoints?: RevisionRef[] };
export type RestoreSessionRequest = { session: RevisionRef };
export type DeleteSessionWithActionsRequest = DeleteSessionOnlyRequest;
export type RestoreSessionWithActionsRequest = DeleteSessionOnlyRequest;

export type CreateActionRequest = { expectedDataDir?: string;
  title: string;
  nameLinkMode?: ActionNameLinkMode;
  summary?: string;
  sessionId?: string | null;
  targetKind?: "project" | "task" | "item" | null;
  targetId?: string | null;
  plannedStartAt?: string;
  plannedEndAt?: string;
  plannedDuration?: number;
  appearance?: ActionAppearance;
};

export type UpdateActionRequest = { expectedDataDir?: string; action: RevisionRef; patch: ActionPatch };
export type ActionNameLinkMode = "initial-linked" | "manually-linked" | "unlinked";
export type CommitActionArrangementRequest = { expectedDataDir?: string;
  action: RevisionRef;
  targetOwningRoot: RevisionRef | null;
  currentSession: RevisionRef | null;
  currentSessionMembers: RevisionRef[];
  nextSession: RevisionRef | null;
  nextSessionMembers: RevisionRef[];
  plannedStartAt: string;
  plannedEndAt: string;
};
export type ActionArrangementState = {
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  plannedDuration: number | null;
  sessionId: string | null;
};
export type RestoreActionArrangementStateRequest = {
  expectedDataDir: string;
  action: RevisionRef;
  targetOwningRoot: RevisionRef | null;
  expectedState: ActionArrangementState;
  targetState: ActionArrangementState;
  currentSession: RevisionRef | null;
  currentSessionMembers: RevisionRef[];
  nextSession: RevisionRef | null;
  nextSessionMembers: RevisionRef[];
};
export type SessionBoundaryState = { plannedStartAt: string; plannedEndAt: string };
export type SessionBoundaryMembershipChange = {
  action: RevisionRef;
  targetOwningRoot: RevisionRef | null;
  expectedSessionId: string | null;
  targetSessionId: string | null;
};
export type RestoreSessionBoundaryStateRequest = {
  expectedDataDir: string;
  session: RevisionRef;
  expectedState: SessionBoundaryState;
  targetState: SessionBoundaryState;
  expectedMembers: RevisionRef[];
  expectedCheckpoints: RevisionRef[];
  targetMemberIds: string[];
  targetCheckpointIds: string[];
  membershipChanges: SessionBoundaryMembershipChange[];
};
export type BusinessTimeZoneResponse = {
  baseOffset: string;
  replacements: { startUtc: string; endUtc: string; offset: string }[];
};
export type CommitThingLifecycleRequest = {
  thingKind: "item" | "task";
  owningRoot: RevisionRef;
  taskId?: string;
  outcome: "complete" | "cancel";
  expectedMembers: RevisionRef[];
  confirmActiveIntervals: boolean;
  expectedDataDir?: string;
  expectedCheckpoints?: RevisionRef[];
  completeCheckpointsWithoutActual?: boolean;
  actionDisposition?: "end" | "preserve";
};
export type StartActionRequest = { expectedDataDir?: string; action: RevisionRef };
export type PauseActionRequest = { expectedDataDir?: string; action: RevisionRef };
export type ResumeActionRequest = { expectedDataDir?: string; action: RevisionRef };
export type EndActionRequest = { expectedDataDir?: string; action: RevisionRef };
export type ReopenActionRequest = { expectedDataDir?: string; action: RevisionRef };
export type DeleteActionRequest = { expectedDataDir?: string; action: RevisionRef };
export type RestoreActionRequest = { action: RevisionRef; session?: RevisionRef };
export type AssignActionToSessionRequest = { action: RevisionRef; session: RevisionRef };
export type MoveActionToSessionRequest = AssignActionToSessionRequest;
export type RemoveActionFromSessionRequest = { action: RevisionRef };
export type SetActionTargetRequest = {
  action: RevisionRef;
  targetKind: "project" | "task" | "item";
  targetId: string;
  owningRoot: RevisionRef;
};
export type ClearActionTargetRequest = { action: RevisionRef };

export type CompleteThingRequest = {
  thingKind: "project" | "task" | "list" | "item";
  owningRoot: RevisionRef;
  taskId?: string;
  expectedMembers: RevisionRef[];
};

export type GetByIdRequest = { id: string; expectedDataDir?: string };
export type ListItemsQuery = { listId?: string; unassignedOnly?: boolean };

export type ProjectResponse = { project: ProjectSnapshot };
export type ListResponse = { list: ListSnapshot };
export type ItemResponse = { item: ItemSnapshot };
export type CreateItemAfterResponse = {
  item: ItemSnapshot;
  itemOrder: ItemOrderSnapshot;
  items: ItemSnapshot[];
};
export type ListAndItemsResponse = { list: ListSnapshot; items: ItemSnapshot[] };
export type SessionResponse = { session: SessionSnapshot };
export type SessionAndActionsResponse = { session: SessionSnapshot; actions: ActionSnapshot[] };
export type ActionResponse = { action: ActionSnapshot };
export type CompleteThingResponse = {
  project?: ProjectSnapshot | null;
  checkpoints?: import("./checkpoint-types").CheckpointSnapshot[] | null;
  list?: ListSnapshot | null;
  item?: ItemSnapshot | null;
  actions: ActionSnapshot[];
};
export type ProjectsListResponse = { projects: ProjectSnapshot[] };
export type ListsListResponse = { lists: ListSnapshot[] };
export type ItemsListResponse = { items: ItemSnapshot[]; itemOrder?: ItemOrderSnapshot };
export type SessionsListResponse = { sessions: SessionSnapshot[] };
export type ActionsListResponse = { actions: ActionSnapshot[] };

/** Single Archive-consistent read used by the Panel's local task host. */
export type ProductivityTaskListSnapshot = {
  resolvedDataDir: string;
  dataDirEpoch: number;
  changeVersion: number;
  lists: ListSnapshot[];
  items: ItemSnapshot[];
  itemOrder: ItemOrderSnapshot | null;
  actions: ActionSnapshot[];
  itemTypes: ItemTypeCatalogSnapshot | null;
  businessTimeZone: BusinessTimeZoneResponse;
};

export type ProductivityPanelWriteOperation =
  | { kind: "setItemStatus"; request: SetItemStatusRequest }
  | { kind: "updateItem"; request: UpdateItemRequest }
  | { kind: "createItem"; request: CreateItemRequest }
  | { kind: "createItemAfter"; request: CreateItemAfterRequest }
  | { kind: "moveItem"; request: MoveItemToListAndPlaceRequest }
  | { kind: "reorderItems"; request: ReorderItemsRequest }
  | { kind: "deleteItem"; request: DeleteItemRequest }
  | { kind: "batchMoveItemsToList"; request: BatchMoveItemsToListRequest }
  | { kind: "batchDeleteItems"; request: BatchDeleteItemsRequest };
export type ProductivityPanelWriteRequest = {
  expectedDataDir: string;
  expectedDataDirEpoch: number;
  operation: ProductivityPanelWriteOperation;
};
export type ProductivityPanelWriteResponse = ItemResponse | CreateItemAfterResponse | MoveItemToListAndPlaceResponse | ReorderItemsResponse | ItemsBatchResponse;
export type InsightItemNavigationRequest = {
  requestId: string;
  expectedDataDir: string;
  expectedDataDirEpoch: number;
  itemId: string;
};
export type OpenInsightItemRequest = Omit<InsightItemNavigationRequest, "requestId"> & { requestId?: string };
export type InsightItemNavigationStatus = "accepted" | "opened" | "cancelled" | "failed";
export type InsightItemNavigationResult = { status: InsightItemNavigationStatus; requestId: string; message?: string };
export type ClaimInsightNavigationRequest = { hostInstanceId: string };
export type ClaimedInsightNavigation = InsightItemNavigationRequest;
export type AckInsightNavigationRequest = {
  requestId: string;
  hostInstanceId: string;
  result: { status: "opened" | "cancelled" | "failed"; message?: string };
};

export type CommitActionCreateDraft = {
  title: string;
  nameLinkMode?: ActionNameLinkMode;
  summary?: string;
  sessionId?: string | null;
  plannedStartAt?: string;
  plannedEndAt?: string;
  plannedDuration?: number;
  appearance?: ActionAppearance;
};

export type CommitActionUpdateDraft = {
  action: RevisionRef;
  patch: ActionPatch;
};

export type CommitItemWithActionsRequest = {
  itemId?: string;
  itemExpectedRevision?: number;
  itemCreate?: CreateItemRequest;
  itemPatch?: ItemPatch;
  expectedAssociatedActions: RevisionRef[];
  actionCreates: CommitActionCreateDraft[];
  actionUpdates: CommitActionUpdateDraft[];
  actionDeletes: RevisionRef[];
};

export type CommitItemWithActionsResponse = {
  item: ItemSnapshot;
  actions: ActionSnapshot[];
};

export type ReorderItemsRequest = {
  itemOrder: RevisionRef;
  expectedMembers: RevisionRef[];
  orderedItemIds: string[];
};

export type ReorderItemsResponse = {
  itemOrder: ItemOrderSnapshot;
  items: ItemSnapshot[];
};

export type MoveItemToListAndPlaceRequest = {
  item: RevisionRef;
  list?: RevisionRef | null;
  itemOrder: RevisionRef;
};

export type MoveItemToListAndPlaceResponse = {
  item: ItemSnapshot;
  itemOrder: ItemOrderSnapshot;
};
export type HealthSourceRef = { kind: "sleep-night" | "nap" | "activity"; id: string; expectedRevision: number };
export type HealthPlanSnapshot = {
  item: ItemSnapshot; action: ActionSnapshot;
  detail: { kind: "sleep" | "activity"; activityType: string | null; healthKind: string | null; healthId: string | null; autoMatchEnabled: boolean; invalidSource: boolean };
};
export type WeekHealthSource = {
  kind: "sleep-night" | "nap" | "activity" | "meal"; id: string; revision: number;
  start: number; end: number; wakeDate: string | null; title: string;
  activityType: string | null; slot: string | null; iconKey?: string | null; segments: unknown;
};
export type WeekHealthResponse = { plans: HealthPlanSnapshot[]; sources: WeekHealthSource[]; catalog: ItemTypeCatalogSnapshot | null };
export type HealthPlanRequest = { expectedDataDir: string; item: RevisionRef; action: RevisionRef; source?: HealthSourceRef; start?: string; end?: string; operation?: "update" | "cancel" | "delete" | "restore" };

export type {
  AssignCheckpointSessionRequest,
  CheckpointRequest,
  CheckpointResponse,
  CheckpointSnapshot,
  CheckpointsListResponse,
  CommitCheckpointArrangementRequest,
  CommitItemWithCheckpointRequest,
  ItemWithCheckpointResponse,
  CheckpointTargetKind,
  CompleteCheckpointRequest,
  CorrectCheckpointActualRequest,
  CreateCheckpointRequest,
  GetCheckpointRequest,
  ListCheckpointsRequest,
  SetCheckpointTargetRequest,
  UpdateCheckpointRequest,
} from "./checkpoint-types";
