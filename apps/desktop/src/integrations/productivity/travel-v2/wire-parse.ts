import type { RevisionRef } from "../types";
import type {
  CanonicalTravelPoint,
  TravelActionActualBoundary,
  TravelActionActualProjection,
  TravelActionPlan,
  TravelAdoptFlightResult,
  TravelAdoptionReport,
  TravelCapabilities,
  TravelCheckpointRoot,
  TravelGetReceiptResult,
  TravelListWeekResult,
  TravelMemberRefs,
  TravelMutationResult,
  TravelPoint,
  TravelPointAttachmentKind,
  TravelPointRole,
  TravelProfileSnapshot,
  TravelRevisionRef,
  Transportation,
  TravelItemSummary,
  TravelSegment,
  TripSnapshot,
} from "./types";

/** Default action title on the Rust read model (TRAVEL_ACTION_TITLE). */
const DEFAULT_ACTION_TITLE = "出行安排";

export class TravelWireParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TravelWireParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TravelWireParseError(`${label}: expected object`);
  return value;
}

function readString(value: unknown, field: string, { optional = false }: { optional?: boolean } = {}): string {
  if (value == null) {
    if (optional) return "";
    throw new TravelWireParseError(`missing string field: ${field}`);
  }
  if (typeof value !== "string") throw new TravelWireParseError(`invalid string field: ${field}`);
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new TravelWireParseError("invalid nullable string");
  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TravelWireParseError(`invalid number field: ${field}`);
  }
  return value;
}

function readOptionalNumber(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TravelWireParseError(`invalid boolean field: ${field}`);
  return value;
}

function parseRevisionRef(value: unknown, label: string): TravelRevisionRef {
  const o = requireRecord(value, label);
  return {
    id: readString(o.id, `${label}.id`),
    expectedRevision: readNumber(o.expectedRevision, `${label}.expectedRevision`),
  };
}

function parseActualBoundary(
  atUtc: string | null,
  pendingAtUtc: string | null,
): TravelActionActualBoundary {
  return {
    atUtc,
    pendingAtUtc,
    origin: null,
    autoFillBlock: false,
  };
}

function parseActionActualProjection(value: unknown): TravelActionActualProjection {
  const o = isRecord(value) ? value : {};
  const startAt = readNullableString(o.startAtUtc);
  const endAt = readNullableString(o.endAtUtc);
  const pendingStart = readNullableString(o.pendingStartAtUtc);
  const pendingEnd = readNullableString(o.pendingEndAtUtc);
  return {
    intervalId: readNullableString(o.intervalId),
    closedStartAtUtc: null,
    closedEndAtUtc: null,
    start: parseActualBoundary(startAt, pendingStart),
    end: parseActualBoundary(endAt, pendingEnd),
  };
}

function parseCapabilities(value: unknown): TravelCapabilities {
  const o = requireRecord(value, "capabilities");
  const canEditPlan = readBoolean(o.canEditPlan, "capabilities.canEditPlan");
  const canEditStructure = readBoolean(o.canEditStructure, "capabilities.canEditStructure");
  return {
    canEditPlan,
    canEditStructure,
    canEditText: readBoolean(o.canEditText, "capabilities.canEditText"),
    canChangeTransportationType: readBoolean(o.canChangeTransportationType, "capabilities.canChangeTransportationType"),
    canFinish: readBoolean(o.canFinish, "capabilities.canFinish"),
    canCancel: readBoolean(o.canCancel, "capabilities.canCancel"),
    canAppend: readBoolean(o.canAppend, "capabilities.canAppend"),
    canRecordActual: readBoolean(o.canRecordActual, "capabilities.canRecordActual"),
    readOnlyReason: null,
  };
}

function parseItemSummary(value: unknown): TravelItemSummary {
  const o = requireRecord(value, "item");
  const completed = readBoolean(o.completed, "item.completed");
  const cancelled = readBoolean(o.cancelled, "item.cancelled");
  let status = "进行中";
  if (cancelled) status = "已取消";
  else if (completed) status = "完成";
  return {
    id: readString(o.id, "item.id"),
    revision: readNumber(o.revision, "item.revision"),
    listId: readNullableString(o.listId),
    title: readString(o.title, "item.title"),
    completed,
    cancelled,
    status,
  };
}

function parseProfile(value: unknown, itemId: string): TravelProfileSnapshot {
  const o = requireRecord(value, "profile");
  return {
    itemId,
    schemaVersion: readNumber(o.schemaVersion, "profile.schemaVersion"),
    cancelledAtUtc: readNullableString(o.cancelledAtUtc),
    createdAtUtc: readString(o.createdAtUtc, "profile.createdAtUtc", { optional: true }),
    updatedAtUtc: readString(o.updatedAtUtc, "profile.updatedAtUtc", { optional: true }),
  };
}

function parseActionPlan(value: unknown): TravelActionPlan {
  const o = requireRecord(value, "action");
  return {
    id: readString(o.id, "action.id"),
    revision: readNumber(o.revision, "action.revision"),
    title: readString(o.title, "action.title", { optional: true }) || DEFAULT_ACTION_TITLE,
    nameLinkMode: readString(o.nameLinkMode, "action.nameLinkMode", { optional: true }) || "default",
    plannedStartAt: readString(o.plannedStartAt, "action.plannedStartAt"),
    plannedEndAt: readString(o.plannedEndAt, "action.plannedEndAt"),
    ended: readBoolean(o.ended, "action.ended"),
    transportationId: readNullableString(o.transportationId),
    actual: parseActionActualProjection(o.actual),
    createdAtUtc: readString(o.createdAtUtc, "action.createdAtUtc", { optional: true }),
    updatedAtUtc: readString(o.updatedAtUtc, "action.updatedAtUtc", { optional: true }),
  };
}

function parseCheckpoint(value: unknown): TravelCheckpointRoot {
  const o = requireRecord(value, "checkpoint");
  return {
    id: readString(o.id, "checkpoint.id"),
    revision: readNumber(o.revision, "checkpoint.revision"),
    title: readString(o.title, "checkpoint.title"),
    description: readNullableString(o.description),
    plannedAtUtc: readNullableString(o.plannedAtUtc) ?? "",
    actualAtUtc: readNullableString(o.actualAtUtc),
    completed: readBoolean(o.completed, "checkpoint.completed"),
    createdAtUtc: readString(o.createdAtUtc, "checkpoint.createdAtUtc", { optional: true }),
    updatedAtUtc: readString(o.updatedAtUtc, "checkpoint.updatedAtUtc", { optional: true }),
  };
}

function parseTransportation(value: unknown): Transportation {
  const o = requireRecord(value, "transportation");
  return {
    id: readString(o.id, "transportation.id"),
    itemId: readString(o.itemId, "transportation.itemId", { optional: true }),
    schemaVersion: readOptionalNumber(o.schemaVersion, 1),
    transportationType: (readNullableString(o.transportationType) as Transportation["transportationType"]) ?? null,
    name: readNullableString(o.name),
    note: readNullableString(o.note),
    serviceNumber: readNullableString(o.serviceNumber),
    operator: readNullableString(o.operator),
    vehicleModel: readNullableString(o.vehicleModel),
    aircraftRegistration: readNullableString(o.aircraftRegistration),
    licensePlate: readNullableString(o.licensePlate),
    carriage: readNullableString(o.carriage),
    seat: readNullableString(o.seat),
    departureName: readNullableString(o.departureName),
    arrivalName: readNullableString(o.arrivalName),
    departureCode: readNullableString(o.departureCode),
    arrivalCode: readNullableString(o.arrivalCode),
    departureTerminal: readNullableString(o.departureTerminal),
    arrivalTerminal: readNullableString(o.arrivalTerminal),
    departureGate: readNullableString(o.departureGate),
    arrivalGate: readNullableString(o.arrivalGate),
    sourceSnapshot: isRecord(o.sourceSnapshot) ? o.sourceSnapshot : null,
    createdAtUtc: readString(o.createdAtUtc, "transportation.createdAtUtc", { optional: true }),
    updatedAtUtc: readString(o.updatedAtUtc, "transportation.updatedAtUtc", { optional: true }),
  };
}

function parseTravelPoint(value: unknown, itemId: string): TravelPoint {
  const o = requireRecord(value, "point");
  const attachmentKind = readString(o.attachmentKind, "point.attachmentKind") as TravelPointAttachmentKind;
  const role = readString(o.role, "point.role") as TravelPointRole;
  return {
    id: readString(o.id, "point.id"),
    itemId: readString(o.itemId, "point.itemId", { optional: true }) || itemId,
    schemaVersion: readOptionalNumber(o.schemaVersion, 1),
    attachmentKind,
    role,
    actionId: readNullableString(o.actionId),
    checkpointId: readNullableString(o.checkpointId),
    actionLabel: readNullableString(o.actionLabel),
    location: readNullableString(o.location),
    note: readNullableString(o.note),
    originCheckpointId: readNullableString(o.originCheckpointId),
    createdAtUtc: readString(o.createdAtUtc, "point.createdAtUtc", { optional: true }),
    updatedAtUtc: readString(o.updatedAtUtc, "point.updatedAtUtc", { optional: true }),
  };
}

function parseSegment(value: unknown): TravelSegment {
  const o = requireRecord(value, "segment");
  return {
    actionId: readString(o.actionId, "segment.actionId"),
    transportationId: readNullableString(o.transportationId),
    plannedStartAt: readString(o.plannedStartAt, "segment.plannedStartAt"),
    plannedEndAt: readString(o.plannedEndAt, "segment.plannedEndAt"),
  };
}

function flightActionIdsFrom(
  actions: TravelActionPlan[],
  transportations: { id: string; transportationType: string | null }[],
): Set<string> {
  const flightTransportIds = new Set(
    transportations.filter((item) => item.transportationType === "flight").map((item) => item.id),
  );
  return new Set(
    actions.filter((action) => action.transportationId && flightTransportIds.has(action.transportationId)).map((action) => action.id),
  );
}

function parseMemberRefs(value: unknown, item: TravelItemSummary): TravelMemberRefs {
  const o = requireRecord(value, "memberRefs");
  const itemRef: RevisionRef = {
    id: item.id,
    expectedRevision: item.revision,
  };
  const actions = Array.isArray(o.actions) ? o.actions.map((a, i) => parseRevisionRef(a, `memberRefs.actions[${i}]`)) : [];
  const checkpoints = Array.isArray(o.checkpoints)
    ? o.checkpoints.map((c, i) => parseRevisionRef(c, `memberRefs.checkpoints[${i}]`))
    : [];
  if (isRecord(o.item)) {
    return {
      item: parseRevisionRef(o.item, "memberRefs.item"),
      actions,
      checkpoints,
    };
  }
  return { item: itemRef, actions, checkpoints };
}

function boundaryIdsForActionMinute(
  plannedAtUtc: string,
  ownerId: string,
  actions: TravelActionPlan[],
  flightActionIds: ReadonlySet<string>,
): {
  ownerActionId: string | null;
  ownerCheckpointId: string | null;
  frontActionId: string | null;
  rearActionId: string | null;
  attachmentKind: TravelPointAttachmentKind;
  role: TravelPointRole;
} {
  const action = actions.find((a) => a.id === ownerId);
  const startsHere = action?.plannedStartAt === plannedAtUtc;
  const endsHere = action?.plannedEndAt === plannedAtUtc;

  if (startsHere) {
    const other = actions.find((a) => a.id !== ownerId && a.plannedEndAt === plannedAtUtc);
    const frontActionId = other && !flightActionIds.has(ownerId) && !flightActionIds.has(other.id) ? other.id : null;
    return {
      ownerActionId: ownerId,
      ownerCheckpointId: null,
      frontActionId,
      rearActionId: ownerId,
      attachmentKind: "action",
      role: endsHere ? "end" : "start",
    };
  }

  if (endsHere) {
    const other = actions.find((a) => a.id !== ownerId && a.plannedStartAt === plannedAtUtc);
    const rearActionId = other && !flightActionIds.has(ownerId) && !flightActionIds.has(other.id) ? other.id : null;
    return {
      ownerActionId: ownerId,
      ownerCheckpointId: null,
      frontActionId: ownerId,
      rearActionId,
      attachmentKind: "action",
      role: "end",
    };
  }

  return {
    ownerActionId: ownerId,
    ownerCheckpointId: null,
    frontActionId: null,
    rearActionId: null,
    attachmentKind: "action",
    role: "single",
  };
}

function parseCanonicalPoint(
  value: unknown,
  actions: TravelActionPlan[],
  flightActionIds: ReadonlySet<string> = new Set(),
): CanonicalTravelPoint {
  const o = requireRecord(value, "canonicalPoint");
  const plannedAtUtc = readString(o.plannedAtUtc, "canonicalPoint.plannedAtUtc");
  const pointId = readString(o.pointId, "canonicalPoint.pointId");
  const actionLabel = readNullableString(o.actionLabel);
  const location = readNullableString(o.location);
  const note = readNullableString(o.note);
  const actualAtUtc = readNullableString(o.actualAtUtc);
  const actualFrontEndAtUtc = readNullableString(o.frontActualEndUtc) ?? readNullableString(o.actualFrontEndAtUtc);
  const actualRearStartAtUtc = readNullableString(o.rearActualStartUtc) ?? readNullableString(o.actualRearStartAtUtc);

  if (o.ownerActionId != null || o.ownerCheckpointId != null) {
    return {
      pointId,
      plannedAtUtc,
      attachmentKind: readString(o.attachmentKind, "canonicalPoint.attachmentKind", { optional: true }) as TravelPointAttachmentKind,
      role: readString(o.role, "canonicalPoint.role", { optional: true }) as TravelPointRole,
      ownerActionId: readNullableString(o.ownerActionId),
      ownerCheckpointId: readNullableString(o.ownerCheckpointId),
      frontActionId: readNullableString(o.frontActionId),
      rearActionId: readNullableString(o.rearActionId),
      actionLabel,
      location,
      note,
      actualFrontEndAtUtc,
      actualRearStartAtUtc,
      actualAtUtc,
    };
  }

  const ownerKind = readString(o.ownerKind, "canonicalPoint.ownerKind", { optional: true });
  const ownerId = readString(o.ownerId, "canonicalPoint.ownerId", { optional: true });
  if (ownerKind === "checkpoint") {
    return {
      pointId,
      plannedAtUtc,
      attachmentKind: "checkpoint",
      role: "single",
      ownerActionId: null,
      ownerCheckpointId: ownerId,
      frontActionId: null,
      rearActionId: null,
      actionLabel,
      location,
      note,
      actualFrontEndAtUtc,
      actualRearStartAtUtc,
      actualAtUtc,
    };
  }
  if (ownerKind === "action") {
    const boundary = boundaryIdsForActionMinute(plannedAtUtc, ownerId, actions, flightActionIds);
    return {
      pointId,
      plannedAtUtc,
      attachmentKind: boundary.attachmentKind,
      role: boundary.role,
      ownerActionId: boundary.ownerActionId,
      ownerCheckpointId: boundary.ownerCheckpointId,
      frontActionId: boundary.frontActionId,
      rearActionId: boundary.rearActionId,
      actionLabel,
      location,
      note,
      actualFrontEndAtUtc,
      actualRearStartAtUtc,
      actualAtUtc,
    };
  }

  throw new TravelWireParseError(`canonicalPoint: unknown ownerKind ${ownerKind}`);
}

/** Normalize a TripSnapshot-shaped wire payload into the UI model. */
export function parseTripSnapshotWire(raw: unknown): TripSnapshot {
  const o = requireRecord(raw, "snapshot");
  const item = parseItemSummary(o.item);
  const actions = Array.isArray(o.actions) ? o.actions.map(parseActionPlan) : [];
  const checkpoints = Array.isArray(o.checkpoints) ? o.checkpoints.map(parseCheckpoint) : [];
  const transportations = Array.isArray(o.transportations)
    ? o.transportations.map((t) => {
        const dto = parseTransportation(t);
        return dto.itemId ? dto : { ...dto, itemId: item.id };
      })
    : [];
  const points = Array.isArray(o.points) ? o.points.map((p) => parseTravelPoint(p, item.id)) : [];
  const segments = Array.isArray(o.segments) ? o.segments.map(parseSegment) : [];
  const canonicalPoints = Array.isArray(o.canonicalPoints)
    ? o.canonicalPoints.map((p) => parseCanonicalPoint(p, actions, flightActionIdsFrom(actions, transportations)))
    : [];
  const memberRefs = parseMemberRefs(o.memberRefs, item);
  const capabilities = parseCapabilities(o.capabilities);
  return {
    item,
    profile: parseProfile(o.profile, item.id),
    actions,
    checkpoints,
    transportations,
    points,
    canonicalPoints,
    segments,
    memberRefs,
    capabilities,
  };
}

export function parseTravelV2GetResponse(raw: unknown): TripSnapshot {
  const o = requireRecord(raw, "getResponse");
  const status = readString(o.status, "status");
  if (status !== "ok") {
    throw new TravelWireParseError(`travel get failed: status=${status}`);
  }
  if (o.snapshot == null) {
    throw new TravelWireParseError("travel get ok but snapshot missing");
  }
  return parseTripSnapshotWire(o.snapshot);
}

export function parseTravelMutationResult(raw: unknown): TravelMutationResult {
  const o = requireRecord(raw, "mutationResult");
  if (o.snapshot == null) {
    throw new TravelWireParseError("mutation result missing snapshot");
  }
  const snapshot = parseTripSnapshotWire(o.snapshot);
  const affectedRootRefs = Array.isArray(o.affectedRootRefs)
    ? o.affectedRootRefs.map((r, i) => parseRevisionRef(r, `affectedRootRefs[${i}]`))
    : [];
  const history = o.planHistory == null ? null : requireRecord(o.planHistory, "planHistory");
  const phase = history == null ? null : readString(history.phase, "planHistory.phase");
  if (phase != null && phase !== "applied" && phase !== "undone" && phase !== "unavailable") {
    throw new TravelWireParseError("invalid plan history phase");
  }
  return {
    changed: readBoolean(o.changed, "changed"),
    snapshot,
    affectedRootRefs,
    batchId: readNullableString(o.batchId),
    ...(o.planHistoryToken == null ? {} : { planHistoryToken: readString(o.planHistoryToken, "planHistoryToken") }),
    ...(history == null ? {} : { planHistory: {
      ownerId: readString(history.ownerId, "planHistory.ownerId"),
      hostEpoch: readNumber(history.hostEpoch, "planHistory.hostEpoch"),
      requestId: readString(history.requestId, "planHistory.requestId"),
      sequence: readNumber(history.sequence, "planHistory.sequence"),
      phase: phase as "applied" | "undone" | "unavailable",
      available: readBoolean(history.available, "planHistory.available"),
    } }),
  };
}

export function parseTravelAdoptionReport(raw: unknown): TravelAdoptionReport {
  const report = requireRecord(raw, "adoptionReport");
  const mapReports = (arr: unknown) =>
    Array.isArray(arr)
      ? arr.map((entry, i) => {
          const e = requireRecord(entry, `adoptionReport[${i}]`);
          return {
            field: readString(e.field, "field"),
            status: readString(e.status, "status") as "adopted" | "skipped" | "conflicting",
            reason: readNullableString(e.reason),
          };
        })
      : [];
  return {
    adopted: mapReports(report.adopted),
    skipped: mapReports(report.skipped),
    conflicting: mapReports(report.conflicting),
    adoptionToken: readString(report.adoptionToken, "adoptionToken"),
  };
}

export function parseTravelAdoptionReportFromResponse(primary: unknown, nested: unknown): TravelAdoptionReport {
  return parseTravelAdoptionReport(primary ?? nested);
}

export function parseTravelAdoptFlightResult(raw: unknown, transportationId?: string): TravelAdoptFlightResult {
  const base = parseTravelMutationResult(raw);
  const o = requireRecord(raw, "adoptFlightResult");
  // Older command responses persisted the report only in sourceSnapshot. The
  // write and receipt may already be committed when this parser runs, so recover
  // the same report from the returned snapshot before treating the call as failed.
  const nestedReport = transportationId
    ? base.snapshot.transportations.find((transport) => transport.id === transportationId)?.sourceSnapshot?.adoptionReport
    : null;
  const report = parseTravelAdoptionReportFromResponse(o.adoptionReport, nestedReport);
  return {
    ...base,
    adoptionReport: report,
  };
}

export function parseTravelListWeekResponse(raw: unknown): TravelListWeekResult {
  const o = requireRecord(raw, "listWeek");
  if (Array.isArray(o.segments) || Array.isArray(o.canonicalPoints)) {
    const items = Array.isArray(o.items)
      ? o.items.map((entry, i) => {
          const e = requireRecord(entry, `items[${i}]`);
          const itemId = readString(e.itemId, "itemId");
          const itemRef = e.itemRef != null ? parseRevisionRef(e.itemRef, "itemRef") : e.item != null ? parseRevisionRef(e.item, "item") : { id: itemId, expectedRevision: 0 };
          return { itemId, item: itemRef, ...(e.snapshot != null ? { snapshot: parseTripSnapshotWire(e.snapshot) } : {}) };
        })
      : [];
    const segments = Array.isArray(o.segments) ? o.segments.map(parseSegment) : [];
    const canonicalPoints = Array.isArray(o.canonicalPoints)
      ? o.canonicalPoints.map((p) => parseCanonicalPoint(p, []))
      : [];
    return { items, segments, canonicalPoints };
  }

  const items: TravelListWeekResult["items"] = [];
  const segments: TravelSegment[] = [];
  const canonicalPoints: CanonicalTravelPoint[] = [];
  for (const entry of Array.isArray(o.items) ? o.items : []) {
    const e = requireRecord(entry, "listWeek.items[]");
    const itemId = readString(e.itemId, "itemId");
    if (e.itemRef != null) {
      items.push({ itemId, item: parseRevisionRef(e.itemRef, "itemRef"), ...(e.snapshot != null ? { snapshot: parseTripSnapshotWire(e.snapshot) } : {}) });
    } else if (e.item != null) {
      items.push({ itemId, item: parseRevisionRef(e.item, "item"), ...(e.snapshot != null ? { snapshot: parseTripSnapshotWire(e.snapshot) } : {}) });
    }
    const entryActions: TravelActionPlan[] = [];
    const entryFlightIds = new Set<string>();
    const entrySegments = Array.isArray(e.segments) ? e.segments.map(parseSegment) : [];
    for (const rawSeg of Array.isArray(e.segments) ? e.segments : []) {
      const segRecord = requireRecord(rawSeg, "segment");
      if (readNullableString(segRecord.transportationType) === "flight") {
        entryFlightIds.add(readString(segRecord.actionId, "segment.actionId"));
      }
    }
    for (const seg of entrySegments) {
      segments.push(seg);
      entryActions.push({
        id: seg.actionId,
        revision: 0,
        title: DEFAULT_ACTION_TITLE,
        nameLinkMode: "default",
        plannedStartAt: seg.plannedStartAt,
        plannedEndAt: seg.plannedEndAt,
        ended: false,
        transportationId: seg.transportationId,
        actual: parseActionActualProjection({}),
        createdAtUtc: "",
        updatedAtUtc: "",
      });
    }
    const entryPoints = Array.isArray(e.canonicalPoints) ? e.canonicalPoints : [];
    for (const p of entryPoints) {
      canonicalPoints.push(parseCanonicalPoint(p, entryActions, entryFlightIds));
    }
  }
  return { items, segments, canonicalPoints };
}

export function parseTravelGetReceiptResponse(raw: unknown): TravelGetReceiptResult {
  const o = requireRecord(raw, "receipt");
  const status = readString(o.status, "status", { optional: true });
  if (status === "not_found") {
    return { status: "not_found" };
  }
  if (o.result != null) {
    return parseTravelMutationResult(o.result);
  }
  if ("snapshot" in o && o.snapshot != null) {
    return parseTravelMutationResult(o);
  }
  return { status: "not_found" };
}

/** Unwrap `{ snapshot }` wrappers some hosts already normalize; otherwise parse as snapshot body. */
export function parseTripSnapshotResponse(raw: unknown): TripSnapshot {
  if (isRecord(raw) && raw.snapshot != null && raw.item == null) {
    return parseTripSnapshotWire(raw.snapshot);
  }
  return parseTripSnapshotWire(raw);
}
