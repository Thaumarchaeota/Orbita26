import type { RevisionRef } from "../types";

/** Wire camelCase DTOs per travel-item-storage.proposed.md §3–§7. */

export type TravelRevisionRef = RevisionRef;

export type TravelErrorCode =
  | "travel_command_required"
  | "revision_conflict"
  | "membership_conflict"
  | "invalid_plan"
  | "action_overlap"
  | "checkpoint_inside_action"
  | "point_merge_required"
  | "protected_structure"
  | "cross_item_reference"
  | "actual_invalid"
  | "unknown_format_readonly"
  | "restore_conflict"
  | "query_context_expired"
  | "request_id_reused"
  | "legacy_or_not_travel"
  | "not_found"
  | "ARCHIVED_LIST_READONLY"
  | "ARCHIVE_BUSY";

export type TravelDomainError = {
  code: TravelErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
};

export type TransportationType =
  | "walk"
  | "bike"
  | "bus"
  | "taxi"
  | "metro"
  | "car"
  | "motorbike"
  | "train"
  | "flight"
  | "tram"
  | "ferry"
  | "cable_car"
  | "helicopter"
  | "other";

export type Transportation = {
  id: string;
  itemId: string;
  schemaVersion: number;
  transportationType: TransportationType | null;
  name: string | null;
  note: string | null;
  serviceNumber: string | null;
  operator: string | null;
  vehicleModel: string | null;
  aircraftRegistration: string | null;
  licensePlate: string | null;
  carriage: string | null;
  seat: string | null;
  departureName: string | null;
  arrivalName: string | null;
  departureCode: string | null;
  arrivalCode: string | null;
  departureTerminal: string | null;
  arrivalTerminal: string | null;
  departureGate: string | null;
  arrivalGate: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type TravelPointAttachmentKind = "action" | "checkpoint";
export type TravelPointRole = "start" | "end" | "single";

export type TravelPoint = {
  id: string;
  itemId: string;
  schemaVersion: number;
  attachmentKind: TravelPointAttachmentKind;
  actionId: string | null;
  checkpointId: string | null;
  role: TravelPointRole;
  actionLabel: string | null;
  location: string | null;
  note: string | null;
  originCheckpointId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type TravelActionActualBoundary = {
  atUtc: string | null;
  pendingAtUtc: string | null;
  origin: "manual" | "source" | null;
  autoFillBlock: boolean;
};

export type TravelActionActualProjection = {
  start: TravelActionActualBoundary;
  end: TravelActionActualBoundary;
  intervalId: string | null;
  closedStartAtUtc: string | null;
  closedEndAtUtc: string | null;
};

export type TravelActionPlan = {
  id: string;
  revision: number;
  title: string;
  nameLinkMode: string;
  plannedStartAt: string;
  plannedEndAt: string;
  ended: boolean;
  transportationId: string | null;
  actual: TravelActionActualProjection;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type TravelCheckpointRoot = {
  id: string;
  revision: number;
  title: string;
  description: string | null;
  plannedAtUtc: string;
  actualAtUtc: string | null;
  completed: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string | null;
};

export type CanonicalTravelPoint = {
  pointId: string;
  plannedAtUtc: string;
  attachmentKind: TravelPointAttachmentKind;
  role: TravelPointRole;
  ownerActionId: string | null;
  ownerCheckpointId: string | null;
  frontActionId: string | null;
  rearActionId: string | null;
  actionLabel: string | null;
  location: string | null;
  note: string | null;
  actualFrontEndAtUtc: string | null;
  actualRearStartAtUtc: string | null;
  actualAtUtc: string | null;
};

export type TravelSegment = {
  actionId: string;
  transportationId: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
};

export type TravelProfileSnapshot = {
  itemId: string;
  schemaVersion: number;
  cancelledAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type TravelItemSummary = {
  id: string;
  revision: number;
  listId: string | null;
  title: string;
  completed: boolean;
  status: string;
  cancelled: boolean;
};

export type TravelMemberRefs = {
  item: TravelRevisionRef;
  actions: TravelRevisionRef[];
  checkpoints: TravelRevisionRef[];
};

export type TravelCapabilities = {
  canEditStructure: boolean;
  canEditPlan: boolean;
  canEditText: boolean;
  canChangeTransportationType: boolean;
  canRecordActual: boolean;
  canFinish: boolean;
  canCancel: boolean;
  canAppend: boolean;
  readOnlyReason?: string | null;
};

export type TripSnapshot = {
  item: TravelItemSummary;
  profile: TravelProfileSnapshot;
  actions: TravelActionPlan[];
  checkpoints: TravelCheckpointRoot[];
  transportations: Transportation[];
  points: TravelPoint[];
  canonicalPoints: CanonicalTravelPoint[];
  segments: TravelSegment[];
  memberRefs: TravelMemberRefs;
  capabilities: TravelCapabilities;
};

export type TravelMutationResult = {
  changed: boolean;
  snapshot: TripSnapshot;
  affectedRootRefs: TravelRevisionRef[];
  batchId?: string | null;
  planHistoryToken?: string;
  planHistory?: TravelPlanHistoryStatus;
};

export type TravelPlanHistoryScope = { ownerId: string; hostEpoch: number };
export type TravelPlanHistoryStatus = TravelPlanHistoryScope & {
  requestId: string; sequence: number; phase: "applied" | "undone" | "unavailable"; available: boolean;
};
export type TravelReplayPlanEffectRequest = {
  expectedDataDir: string; historyOwnerId: string; hostEpoch: number; requestId: string;
  planHistoryToken: string; direction: "undo" | "redo";
  currentTripRefs: { item: TravelRevisionRef; actions: TravelRevisionRef[]; checkpoints: TravelRevisionRef[] };
};
export type TravelReleasePlanHistoryRequest = {
  expectedDataDir: string; historyOwnerId: string; hostEpoch: number;
} & ({ all: true; tokenIds?: never } | { all: false; tokenIds: string[] });
export type TravelPlanCommitOutcome = {
  status: "committed" | "noop" | "cancelled" | "failed" | "uncertain";
  requestId?: string; result?: TravelMutationResult; error?: unknown;
};

export type TravelCommandEnvelope<TPayload> = {
  requestId: string;
  expectedDataDir: string;
  itemRef: TravelRevisionRef | null;
  actionRefs: TravelRevisionRef[];
  checkpointRefs: TravelRevisionRef[];
  payload: TPayload;
};

export type TravelGetRequest = {
  itemId: string;
  expectedDataDir: string;
};

export type TravelListWeekRequest = {
  fromUtc: string;
  toUtc: string;
  expectedDataDir: string;
};

export type TravelWeekItemRef = {
  itemId: string;
  item: TravelRevisionRef;
  snapshot?: TripSnapshot;
};

export type TravelListWeekResult = {
  items: TravelWeekItemRef[];
  segments: TravelSegment[];
  canonicalPoints: CanonicalTravelPoint[];
};

export type TravelListItemsScope =
  | { kind: "all" }
  | { kind: "unlisted" }
  | { kind: "list"; listId: string };

export type TravelListItemsStatus = "active" | "completed" | "cancelled" | "all";

export type TravelListItemsRequest = {
  expectedDataDir: string;
  scope?: TravelListItemsScope;
  status?: TravelListItemsStatus;
  cursor?: string | null;
  limit?: number;
};

export type TravelListItemsRow = {
  itemId: string;
  item: TravelRevisionRef;
  title: string;
  listId: string | null;
  completed: boolean;
  cancelled: boolean;
};

export type TravelListItemsResult = {
  items: TravelListItemsRow[];
  nextCursor: string | null;
};

export type TravelFirstContentCheckpoint = {
  kind: "checkpoint";
  checkpointId: string;
  pointId: string;
  plannedAtUtc: string;
  title?: string | null;
  description?: string | null;
  location?: string | null;
};

export type TravelFirstContentAction = {
  kind: "action";
  actionId: string;
  transportationId: string;
  startPointId: string;
  endPointId: string;
  plannedStartAt: string;
  plannedEndAt: string;
  transportationType?: TransportationType | null;
  startLocation?: string | null;
  endLocation?: string | null;
  transportationFields?: Partial<Pick<Transportation,
    "name" | "note" | "serviceNumber" | "operator" | "vehicleModel" | "aircraftRegistration" |
    "licensePlate" | "carriage" | "seat" | "departureName" | "arrivalName" | "departureCode" |
    "arrivalCode" | "departureTerminal" | "arrivalTerminal" | "departureGate" | "arrivalGate">>;
  transportationSourceSnapshot?: Record<string, unknown> | null;
};

export type TravelCreatePayload = {
  newItemId: string;
  listId?: string | null;
  title: string;
  firstContent: TravelFirstContentCheckpoint | TravelFirstContentAction;
};

export type TravelAppendKind = "checkpoint" | "action" | "flight" | "train";

export type TravelAppendPayload = {
  kind: TravelAppendKind;
  checkpointId?: string;
  pointId?: string;
  actionId?: string;
  transportationId?: string;
  startPointId?: string;
  endPointId?: string;
  plannedAtUtc?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  existingTransportationId?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  transportationFields?: TravelFirstContentAction["transportationFields"];
  transportationSourceSnapshot?: Record<string, unknown> | null;
};

export type TravelUpdateItemPayload = {
  title: string;
};

export type TravelUpdatePointPayload = {
  pointId: string;
  actionLabel?: string | null;
  location?: string | null;
  note?: string | null;
};

export type TravelTransportationPatch = {
  transportationId: string;
  transportationType?: TransportationType | null;
  name?: string | null;
  note?: string | null;
  serviceNumber?: string | null;
  operator?: string | null;
  vehicleModel?: string | null;
  aircraftRegistration?: string | null;
  licensePlate?: string | null;
  carriage?: string | null;
  seat?: string | null;
  departureName?: string | null;
  arrivalName?: string | null;
  departureCode?: string | null;
  arrivalCode?: string | null;
  departureTerminal?: string | null;
  arrivalTerminal?: string | null;
  departureGate?: string | null;
  arrivalGate?: string | null;
};

export type TravelEndpointSplitPolicy = "copy" | "front" | "rear";

export type TravelSplitPolicies = {
  movingFrontEnd: TravelEndpointSplitPolicy;
  movingRearStart: TravelEndpointSplitPolicy;
};

export type TravelPlanEdit =
  | {
      kind: "moveGroup";
      actionIds: string[];
      deltaMinutes: number;
      splitPolicies: TravelSplitPolicies;
    }
  | {
      kind: "moveDetached";
      actionId: string;
      deltaMinutes: number;
      splitPolicies: TravelSplitPolicies;
    }
  | {
      kind: "setBoundary";
      actionId: string;
      side: "start" | "end";
      plannedAtUtc: string;
      planEditGeneration: number;
    }
  | {
      kind: "setSharedBoundary";
      frontActionId: string;
      rearActionId: string;
      zone: "both" | "frontEnd" | "rearStart";
      plannedAtUtc: string;
      planEditGeneration: number;
      splitPolicies?: TravelSplitPolicies;
    }
  | {
      kind: "moveCheckpoint";
      checkpointId: string;
      plannedAtUtc: string;
      planEditGeneration: number;
    }
  | {
      kind: "setRange";
      actionId: string;
      plannedStartAt: string;
      plannedEndAt: string;
      planEditGeneration: number;
    };

export type TravelPointMergeResolution = {
  field: "actionLabel" | "location" | "note";
  chosenValue: string | null;
  sourcePointIds: string[];
};

export type TravelEditPlanPayload = {
  edit: TravelPlanEdit;
  resolutions?: TravelPointMergeResolution[];
  historyScope?: TravelPlanHistoryScope;
};

export type TravelSplitPayload = {
  actionId: string;
  splitAt: string;
  newActionId: string;
  newTransportationId: string;
  newPointId: string;
};

export type TravelSetActualTarget =
  | { kind: "actionBoundary"; actionId: string; side: "start" | "end" }
  | { kind: "checkpoint"; checkpointId: string };

export type TravelSetActualMode = "record" | "correct" | "clear";

export type TravelSetActualPayload = {
  target: TravelSetActualTarget;
  value: string | null;
  mode: TravelSetActualMode;
};

export type TravelSetCheckpointCompletedPayload = {
  checkpointId: string;
  completed: boolean;
  actualAtUtc?: string | null;
};

export type TravelSetJoinActualPayload = {
  frontActionId: string;
  rearActionId: string;
  actualAt: string;
};

export type TravelCancelPayload = {
  endCurrentActionId?: string | null;
};

export type TravelDeleteStagePayload = {
  actionId: string;
  deleteStartPoint: boolean;
  deleteEndPoint: boolean;
};

export type TravelDeleteCheckpointPayload = {
  checkpointId: string;
};

export type TravelClearPointPayload = {
  pointId: string;
};

export type TravelRestorePayload = {
  batchId: string;
};

export type TravelQueryFlightContext = {
  itemId?: string;
  itemRevision?: number;
  transportationId?: string;
  draft?: boolean;
  expectedDataDir: string;
  queryGeneration: number;
};

export type TravelQueryFlightPayload = {
  context: TravelQueryFlightContext;
  flightNumber: string;
  date: string;
};

export type TravelFlightCandidate = Record<string, unknown>;

export type TravelQueryFlightResult = {
  candidates: TravelFlightCandidate[];
  fetchedAtUtc: string;
  provider?: string | null;
  queryGeneration?: number;
  context?: TravelQueryFlightContext;
  status?: string;
  reason?: string | null;
};

export type TravelAdoptFlightPayload = {
  transportationId: string;
  candidate: TravelFlightCandidate;
  raw: Record<string, unknown>;
  adoptionToken: string;
  queryGeneration: number;
  restoreBaselineGeneration: number;
  /** Allowlist enforced by the adopt transaction. Omit for legacy full adopt. */
  selectedFields?: string[];
};

export type TravelAdoptionFieldReport = {
  field: string;
  status: "adopted" | "skipped" | "conflicting";
  reason?: string | null;
};

export type TravelAdoptionReport = {
  adopted: TravelAdoptionFieldReport[];
  skipped: TravelAdoptionFieldReport[];
  conflicting: TravelAdoptionFieldReport[];
  adoptionToken: string;
};

export type TravelAdoptFlightResult = TravelMutationResult & {
  adoptionReport: TravelAdoptionReport;
};

export type TravelRestoreAdoptionFieldsPayload = {
  transportationId: string;
  adoptionToken: string;
  fields: string[];
  expectedCurrentValues: Record<string, string | null>;
};

export type TransportationListTimeBasis = "planned" | "actual";

export type TransportationListRequest = {
  expectedDataDir: string;
  types?: TransportationType[];
  from?: string | null;
  to?: string | null;
  timeBasis?: TransportationListTimeBasis;
  cursor?: string | null;
  limit?: number;
};

export type TransportationListActionSummary = {
  action: TravelRevisionRef;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  pendingStartAtUtc: string | null;
  pendingEndAtUtc: string | null;
  closedStartAtUtc: string | null;
  closedEndAtUtc: string | null;
  ended: boolean;
};

export type TransportationListRow = {
  transportation: Transportation;
  item: TravelRevisionRef;
  itemTitle: string;
  actions: TransportationListActionSummary[];
  minInstantUtc?: string | null;
  maxInstantUtc?: string | null;
};

export type TransportationListResult = {
  rows: TransportationListRow[];
  nextCursor: string | null;
};

export type TravelGetReceiptRequest = {
  expectedDataDir: string;
  requestId: string;
};

export type TravelGetReceiptResult = TravelMutationResult | { status: "not_found" };

export type TravelSaveState = "clean" | "dirty" | "saving" | "failed" | "conflict";

export type TravelEditingSelection = {
  itemId: string;
  blockId?: string | null;
} | null;

export type TravelTextDraftKey =
  | `item:title`
  | `point:${string}:actionLabel`
  | `point:${string}:location`
  | `point:${string}:note`
  | `transportation:${string}:${string}`;

export type TravelRestoreBaseline = {
  transportationId: string;
  adoptionToken: string;
  generation: number;
  beforeValues: Record<string, string | null>;
  adoptedValues: Record<string, string | null>;
};
