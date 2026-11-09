import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../../admin/domain-write-guard";
import {
  parseTravelAdoptFlightResult,
  parseTravelGetReceiptResponse,
  parseTravelListWeekResponse,
  parseTravelMutationResult,
  parseTravelV2GetResponse,
} from "./wire-parse";
import type {
  TravelAdoptFlightPayload,
  TravelAdoptFlightResult,
  TravelAppendPayload,
  TravelCancelPayload,
  TravelClearPointPayload,
  TravelCommandEnvelope,
  TravelCreatePayload,
  TravelDeleteCheckpointPayload,
  TravelDeleteStagePayload,
  TravelEditPlanPayload,
  TravelGetReceiptRequest,
  TravelGetReceiptResult,
  TravelGetRequest,
  TravelListItemsRequest,
  TravelListItemsResult,
  TravelListWeekRequest,
  TravelListWeekResult,
  TravelMutationResult,
  TravelReplayPlanEffectRequest,
  TravelReleasePlanHistoryRequest,
  TravelQueryFlightPayload,
  TravelQueryFlightResult,
  TravelRestoreAdoptionFieldsPayload,
  TravelRestorePayload,
  TravelRevisionRef,
  TravelSetActualPayload,
  TravelSetCheckpointCompletedPayload,
  TravelSetJoinActualPayload,
  TravelSplitPayload,
  TravelTransportationPatch,
  TravelUpdateItemPayload,
  TravelUpdatePointPayload,
  TransportationListRequest,
  TransportationListResult,
  TripSnapshot,
} from "./types";

export function newTravelMemberId(): string {
  return crypto.randomUUID();
}

export function newTravelRequestId(): string {
  return crypto.randomUUID();
}

export function memberRefsFromSnapshot(snapshot: TripSnapshot): {
  itemRef: TravelRevisionRef;
  actionRefs: TravelRevisionRef[];
  checkpointRefs: TravelRevisionRef[];
} {
  return {
    itemRef: snapshot.memberRefs.item,
    actionRefs: snapshot.memberRefs.actions,
    checkpointRefs: snapshot.memberRefs.checkpoints,
  };
}

export function buildTravelEnvelope<TPayload>(
  expectedDataDir: string,
  snapshot: TripSnapshot | null,
  payload: TPayload,
  options?: { requestId?: string; itemRef?: TravelRevisionRef | null; actionRefs?: TravelRevisionRef[]; checkpointRefs?: TravelRevisionRef[] },
): TravelCommandEnvelope<TPayload> {
  const refs = snapshot ? memberRefsFromSnapshot(snapshot) : null;
  return {
    requestId: options?.requestId ?? newTravelRequestId(),
    expectedDataDir,
    itemRef: options?.itemRef !== undefined ? options.itemRef : refs?.itemRef ?? null,
    actionRefs: options?.actionRefs ?? refs?.actionRefs ?? [],
    checkpointRefs: options?.checkpointRefs ?? refs?.checkpointRefs ?? [],
    payload,
  };
}

export function buildCreateEnvelope(
  expectedDataDir: string,
  payload: TravelCreatePayload,
  requestId?: string,
): TravelCommandEnvelope<TravelCreatePayload> {
  return {
    requestId: requestId ?? newTravelRequestId(),
    expectedDataDir,
    itemRef: null,
    actionRefs: [],
    checkpointRefs: [],
    payload,
  };
}

async function invokeTravelWriteParsed(cmd: string, req: TravelCommandEnvelope<unknown>): Promise<TravelMutationResult> {
  const raw = await invokeDomainWrite<unknown>(cmd, { req });
  return parseTravelMutationResult(raw);
}

export async function productivityTravelV2ReplayPlanEffect(req: TravelReplayPlanEffectRequest): Promise<TravelMutationResult> {
  return parseTravelMutationResult(await invokeDomainWrite<unknown>("productivity_travel_v2_replay_plan_effect", { req }));
}
export function productivityTravelV2ReleasePlanHistory(req: TravelReleasePlanHistoryRequest): Promise<void> {
  return invoke<void>("productivity_travel_v2_release_plan_history", { req });
}

export async function productivityTravelV2Get(req: TravelGetRequest): Promise<TripSnapshot> {
  const raw = await invoke<unknown>("productivity_travel_v2_get", { req });
  return parseTravelV2GetResponse(raw);
}

export async function productivityTravelV2ListWeek(req: TravelListWeekRequest): Promise<TravelListWeekResult> {
  const raw = await invoke<unknown>("productivity_travel_v2_list_week", { req });
  return parseTravelListWeekResponse(raw);
}

export function productivityTravelV2ListItems(req: TravelListItemsRequest) {
  return invoke<TravelListItemsResult>("productivity_travel_v2_list_items", { req });
}

export function productivityTravelV2Create(req: TravelCommandEnvelope<TravelCreatePayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_create", req);
}

export function productivityTravelV2Append(req: TravelCommandEnvelope<TravelAppendPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_append", req);
}

export function productivityTravelV2UpdateItem(req: TravelCommandEnvelope<TravelUpdateItemPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_update_item", req);
}

export function productivityTravelV2UpdatePoint(req: TravelCommandEnvelope<TravelUpdatePointPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_update_point", req);
}

export function productivityTravelV2UpdateTransportation(req: TravelCommandEnvelope<TravelTransportationPatch>) {
  return invokeTravelWriteParsed("productivity_travel_v2_update_transportation", req);
}

export function productivityTravelV2EditPlan(req: TravelCommandEnvelope<TravelEditPlanPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_edit_plan", req);
}

export function productivityTravelV2Split(req: TravelCommandEnvelope<TravelSplitPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_split", req);
}

export function productivityTravelV2SetActual(req: TravelCommandEnvelope<TravelSetActualPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_set_actual", req);
}

export function productivityTravelV2SetCheckpointCompleted(req: TravelCommandEnvelope<TravelSetCheckpointCompletedPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_set_checkpoint_completed", req);
}

export function productivityTravelV2SetJoinActual(req: TravelCommandEnvelope<TravelSetJoinActualPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_set_join_actual", req);
}

export function productivityTravelV2Finish(req: TravelCommandEnvelope<Record<string, never>>) {
  return invokeTravelWriteParsed("productivity_travel_v2_finish", req);
}

export function productivityTravelV2Reopen(req: TravelCommandEnvelope<Record<string, never>>) {
  return invokeTravelWriteParsed("productivity_travel_v2_reopen", req);
}

export function productivityTravelV2Cancel(req: TravelCommandEnvelope<TravelCancelPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_cancel", req);
}

export function productivityTravelV2DeleteStage(req: TravelCommandEnvelope<TravelDeleteStagePayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_delete_stage", req);
}

export function productivityTravelV2DeleteCheckpoint(req: TravelCommandEnvelope<TravelDeleteCheckpointPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_delete_checkpoint", req);
}

export function productivityTravelV2ClearPoint(req: TravelCommandEnvelope<TravelClearPointPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_clear_point", req);
}

export function productivityTravelV2DeleteTrip(req: TravelCommandEnvelope<Record<string, never>>) {
  return invokeTravelWriteParsed("productivity_travel_v2_delete_trip", req);
}

export function productivityTravelV2Restore(req: TravelCommandEnvelope<TravelRestorePayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_restore", req);
}

export function productivityTravelV2QueryFlight(req: TravelCommandEnvelope<TravelQueryFlightPayload>) {
  return invoke<TravelQueryFlightResult>("productivity_travel_v2_query_flight", { req });
}

export async function productivityTravelV2AdoptFlight(req: TravelCommandEnvelope<TravelAdoptFlightPayload>): Promise<TravelAdoptFlightResult> {
  const raw = await invokeDomainWrite<unknown>("productivity_travel_v2_adopt_flight", { req });
  return parseTravelAdoptFlightResult(raw, req.payload.transportationId);
}

export function productivityTravelV2RestoreAdoptionFields(req: TravelCommandEnvelope<TravelRestoreAdoptionFieldsPayload>) {
  return invokeTravelWriteParsed("productivity_travel_v2_restore_adoption_fields", req);
}

export function productivityTransportationList(req: TransportationListRequest) {
  return invoke<TransportationListResult>("productivity_transportation_list", { req });
}

export async function productivityTravelV2GetReceipt(req: TravelGetReceiptRequest): Promise<TravelGetReceiptResult> {
  const raw = await invoke<unknown>("productivity_travel_v2_get_receipt", { req });
  return parseTravelGetReceiptResponse(raw);
}

/** Convenience: first trip create with client-generated root/member ids for checkpoint-first content. */
export function buildCheckpointFirstCreatePayload(input: {
  newItemId?: string;
  listId?: string | null;
  title: string;
  plannedAtUtc: string;
  checkpointId?: string;
  pointId?: string;
  titleText?: string | null;
  description?: string | null;
  location?: string | null;
}): TravelCreatePayload {
  return {
    newItemId: input.newItemId ?? newTravelMemberId(),
    listId: input.listId ?? null,
    title: input.title,
    firstContent: {
      kind: "checkpoint",
      checkpointId: input.checkpointId ?? newTravelMemberId(),
      pointId: input.pointId ?? newTravelMemberId(),
      plannedAtUtc: input.plannedAtUtc,
      title: input.titleText ?? null,
      description: input.description ?? null,
      location: input.location ?? null,
    },
  };
}

/** Convenience: first trip create with client-generated ids for action-first content. */
export function buildActionFirstCreatePayload(input: {
  newItemId?: string;
  listId?: string | null;
  title: string;
  plannedStartAt: string;
  plannedEndAt: string;
  actionId?: string;
  transportationId?: string;
  startPointId?: string;
  endPointId?: string;
  transportationType?: import("./types").TransportationType | null;
  startLocation?: string | null;
  endLocation?: string | null;
  transportationFields?: import("./types").TravelFirstContentAction["transportationFields"];
  transportationSourceSnapshot?: Record<string, unknown> | null;
}): TravelCreatePayload {
  return {
    newItemId: input.newItemId ?? newTravelMemberId(),
    listId: input.listId ?? null,
    title: input.title,
    firstContent: {
      kind: "action",
      actionId: input.actionId ?? newTravelMemberId(),
      transportationId: input.transportationId ?? newTravelMemberId(),
      startPointId: input.startPointId ?? newTravelMemberId(),
      endPointId: input.endPointId ?? newTravelMemberId(),
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      transportationType: input.transportationType ?? null,
      startLocation: input.startLocation ?? null,
      endLocation: input.endLocation ?? null,
      transportationFields: input.transportationFields,
      transportationSourceSnapshot: input.transportationSourceSnapshot,
    },
  };
}

/** Convenience: append payload with generated member ids when omitted. */
export function buildAppendPayload(
  kind: TravelAppendPayload["kind"],
  fields: Omit<TravelAppendPayload, "kind">,
): TravelAppendPayload {
  const base: TravelAppendPayload = { kind, ...fields };
  if (kind === "checkpoint") {
    return {
      ...base,
      checkpointId: fields.checkpointId ?? newTravelMemberId(),
      pointId: fields.pointId ?? newTravelMemberId(),
    };
  }
  if (kind === "action" || kind === "flight" || kind === "train") {
    return {
      ...base,
      actionId: fields.actionId ?? newTravelMemberId(),
      transportationId: fields.transportationId ?? newTravelMemberId(),
      startPointId: fields.startPointId ?? newTravelMemberId(),
      endPointId: fields.endPointId ?? newTravelMemberId(),
    };
  }
  return base;
}

/** Convenience: split payload with generated ids when omitted. */
export function buildSplitPayload(
  fields: Omit<TravelSplitPayload, "newActionId" | "newTransportationId" | "newPointId"> &
    Partial<Pick<TravelSplitPayload, "newActionId" | "newTransportationId" | "newPointId">>,
): TravelSplitPayload {
  return {
    actionId: fields.actionId,
    splitAt: fields.splitAt,
    newActionId: fields.newActionId ?? newTravelMemberId(),
    newTransportationId: fields.newTransportationId ?? newTravelMemberId(),
    newPointId: fields.newPointId ?? newTravelMemberId(),
  };
}
