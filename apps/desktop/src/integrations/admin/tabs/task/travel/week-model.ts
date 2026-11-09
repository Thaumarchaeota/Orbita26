import type {
  CanonicalTravelPoint,
  TravelListWeekResult,
  TravelSegment,
  TransportationType,
  TripSnapshot,
} from "../../../../productivity/travel-v2/types";
import type { BusinessZone } from "../arrangement-model";

export const TRAVEL_LANE_WIDTH = 24;
export const TRAVEL_HIT = 24;

export type TravelTripLine = {
  itemId: string;
  color?: string;
  completed: boolean;
  lane: number;
  start: number;
  end: number;
  segments: TravelSegmentView[];
  points: TravelPointView[];
};

export type TravelSegmentView = {
  actionId: string;
  transportationId: string | null;
  transportationType: TransportationType | null;
  plannedStartAt: string;
  plannedEndAt: string;
  startMs: number;
  endMs: number;
};

export type TravelPointView = {
  pointId: string;
  plannedAtUtc: string;
  atMs: number;
  attachmentKind: CanonicalTravelPoint["attachmentKind"];
  role: CanonicalTravelPoint["role"];
  ownerActionId: string | null;
  ownerCheckpointId: string | null;
  frontActionId: string | null;
  rearActionId: string | null;
  isShared: boolean;
};

export type TravelWeekBuildInput = {
  list: TravelListWeekResult;
  snapshotForItem: (itemId: string) => TripSnapshot | null | undefined;
  colorForItem?: (itemId: string) => string;
  zone: BusinessZone;
  hourPx?: number;
};

function typeForAction(snapshot: TripSnapshot | null | undefined, actionId: string): TransportationType | null {
  if (!snapshot) return null;
  const action = snapshot.actions.find((a) => a.id === actionId);
  if (!action?.transportationId) return null;
  return snapshot.transportations.find((t) => t.id === action.transportationId)?.transportationType ?? null;
}

function segmentsForItem(list: TravelListWeekResult, itemId: string, snapshot: TripSnapshot | null | undefined): TravelSegmentView[] {
  const actionIds = new Set(snapshot?.actions.map((a) => a.id) ?? []);
  const fromSnapshot = snapshot?.segments ?? [];
  const fromList = (list.segments ?? []).filter((s) => actionIds.size === 0 || actionIds.has(s.actionId));
  const source = snapshot ? fromSnapshot : fromList;
  return source
    .filter((s) => actionIds.size === 0 || actionIds.has(s.actionId))
    .map((s) => ({
      actionId: s.actionId,
      transportationId: s.transportationId,
      transportationType: typeForAction(snapshot, s.actionId),
      plannedStartAt: s.plannedStartAt,
      plannedEndAt: s.plannedEndAt,
      startMs: Date.parse(snapshot?.item.completed ? (snapshot.actions.find(a => a.id === s.actionId)?.actual.start.atUtc ?? snapshot.actions.find(a => a.id === s.actionId)?.actual.start.pendingAtUtc ?? "") : s.plannedStartAt),
      endMs: Date.parse(snapshot?.item.completed ? (snapshot.actions.find(a => a.id === s.actionId)?.actual.end.atUtc ?? snapshot.actions.find(a => a.id === s.actionId)?.actual.end.pendingAtUtc ?? "") : s.plannedEndAt),
    }))
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.actionId.localeCompare(b.actionId));
}

function pointsForItem(list: TravelListWeekResult, itemId: string, snapshot: TripSnapshot | null | undefined): TravelPointView[] {
  const fromSnapshot = snapshot?.canonicalPoints ?? [];
  const fromList = (list.canonicalPoints ?? []).filter((p) =>
    fromSnapshot.length ? fromSnapshot.some((c) => c.pointId === p.pointId) : true,
  );
  const source = snapshot ? fromSnapshot : fromList;
  return source
    .flatMap((p) => {
      const actuals = p.attachmentKind === "checkpoint" ? [p.actualAtUtc] : [p.actualFrontEndAtUtc, p.actualRearStartAtUtc];
      const values = snapshot?.item.completed ? [...new Set(actuals.filter((v): v is string => Boolean(v)))] : [p.plannedAtUtc];
      return values.map((value) => ({
      pointId: p.pointId,
      plannedAtUtc: p.plannedAtUtc,
      atMs: Date.parse(value),
      attachmentKind: p.attachmentKind,
      role: p.role,
      ownerActionId: p.ownerActionId,
      ownerCheckpointId: p.ownerCheckpointId,
      frontActionId: p.frontActionId,
      rearActionId: p.rearActionId,
      isShared: Boolean(p.frontActionId && p.rearActionId),
      }));
    })
    .filter((p) => Number.isFinite(p.atMs))
    .sort((a, b) => a.atMs - b.atMs || a.pointId.localeCompare(b.pointId));
}

export function buildTravelTripLines(input: TravelWeekBuildInput): TravelTripLine[] {
  const { list, snapshotForItem, colorForItem } = input;
  const lines: Omit<TravelTripLine, "lane">[] = [];
  for (const ref of list.items) {
    const snapshot = snapshotForItem(ref.itemId);
    // Completion and actual boundaries require the authoritative snapshot.
    if (!snapshot) continue;
    const segments = segmentsForItem(list, ref.itemId, snapshot);
    const points = pointsForItem(list, ref.itemId, snapshot);
    if (!segments.length && !points.length) continue;
    const start = Math.min(
      ...segments.map((s) => s.startMs),
      ...points.map((p) => p.atMs),
    );
    const end = Math.max(
      ...segments.map((s) => s.endMs),
      ...points.map((p) => p.atMs),
    );
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    lines.push({
      itemId: ref.itemId,
      color: colorForItem?.(ref.itemId) ?? "var(--insight-primary)",
      completed: snapshot?.item.completed ?? false,
      start,
      end,
      segments,
      points,
    });
  }
  lines.sort((a, b) => a.start - b.start || a.itemId.localeCompare(b.itemId));
  const lanes: TravelTripLine[][] = [];
  const result: TravelTripLine[] = [];
  for (const base of lines) {
    let lane = 0;
    const pad = TRAVEL_HIT / 2 / (input.hourPx ?? 56) * 3_600_000;
    while (lanes[lane]?.some((other) => {
      const spans = (line: Omit<TravelTripLine, "lane">) => line.completed
        ? [...line.segments.map(s => ({ start: s.startMs, end: s.endMs })), ...line.points.map(p => ({ start: p.atMs, end: p.atMs }))]
        : [{ start: line.start, end: line.end }];
      return spans(base).some(a => spans(other).some(b => a.start - pad < b.end + pad && b.start - pad < a.end + pad));
    })) lane++;
    const entry: TravelTripLine = { ...base, lane };
    (lanes[lane] ??= []).push(entry);
    result.push(entry);
  }
  return result;
}

export function travelLaneInset(lines: TravelTripLine[], start: number, end: number): number {
  const active = lines.filter((l) => l.completed
    ? l.segments.some(s => s.startMs < end && s.endMs > start) || l.points.some(p => p.atMs > start && p.atMs < end)
    : l.start < end && l.end > start);
  if (!active.length) return 0;
  return (Math.max(...active.map((l) => l.lane)) + 1) * TRAVEL_LANE_WIDTH;
}

/** Actions connected by planned end === next start (minute). */
export type TravelDragPreview = {
  itemId: string;
  kind: "segment" | "checkpoint" | "actionBoundary" | "sharedBoundary" | "append";
  actionIds: string[];
  checkpointId?: string | null;
  boundaryActionId?: string;
  boundarySide?: "start" | "end";
  frontActionId?: string;
  rearActionId?: string;
  sharedZone?: "both" | "frontEnd" | "rearStart";
  appendStartMs?: number;
  appendEndMs?: number;
};

function shiftIso(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString();
}

function pointMovesWithActions(point: TravelPointView, actionIds: Set<string>): boolean {
  if (point.ownerActionId && actionIds.has(point.ownerActionId)) return true;
  if (point.rearActionId && actionIds.has(point.rearActionId)) return true;
  if (point.frontActionId && actionIds.has(point.frontActionId)) return true;
  return false;
}

function lineExtents(
  segments: TravelSegmentView[],
  points: TravelPointView[],
): { start: number; end: number } {
  const times = [...segments.map((s) => s.startMs), ...segments.map((s) => s.endMs), ...points.map((p) => p.atMs)];
  return { start: Math.min(...times), end: Math.max(...times) };
}

/** Pointermove preview: shift planned geometry without mutating store lines. */
export function applyTravelDragPreview(lines: TravelTripLine[], preview: TravelDragPreview, deltaMs: number): TravelTripLine[] {
  return lines.map((line) => {
    if (line.itemId !== preview.itemId) return line;

    if (preview.kind === "append" && preview.appendStartMs != null && preview.appendEndMs != null) {
      const startMs = preview.appendStartMs;
      const endMs = preview.appendEndMs;
      const segments = [
        ...line.segments,
        {
          actionId: "__travel-append-preview__",
          transportationId: null,
          transportationType: null,
          plannedStartAt: new Date(startMs).toISOString(),
          plannedEndAt: new Date(endMs).toISOString(),
          startMs,
          endMs,
        },
      ];
      const { start, end } = lineExtents(segments, line.points);
      return { ...line, start, end, segments };
    }

    if (preview.kind === "checkpoint" && preview.checkpointId) {
      if (!deltaMs) return line;
      const points = line.points.map((p) =>
        p.ownerCheckpointId === preview.checkpointId
          ? { ...p, atMs: p.atMs + deltaMs, plannedAtUtc: shiftIso(p.plannedAtUtc, deltaMs) }
          : p,
      );
      const { start, end } = lineExtents(line.segments, points);
      return { ...line, start, end, points };
    }

    if (preview.kind === "actionBoundary" && preview.boundaryActionId && preview.boundarySide) {
      if (!deltaMs) return line;
      const actionId = preview.boundaryActionId;
      const side = preview.boundarySide;
      const segments = line.segments.map((s) => {
        if (s.actionId !== actionId) return s;
        if (side === "end") {
          return {
            ...s,
            endMs: s.endMs + deltaMs,
            plannedEndAt: shiftIso(s.plannedEndAt, deltaMs),
          };
        }
        return {
          ...s,
          startMs: s.startMs + deltaMs,
          plannedStartAt: shiftIso(s.plannedStartAt, deltaMs),
        };
      });
      const points = line.points.map((p) => {
        if (side === "end" && (p.frontActionId === actionId || (p.ownerActionId === actionId && p.role === "end"))) {
          return { ...p, atMs: p.atMs + deltaMs, plannedAtUtc: shiftIso(p.plannedAtUtc, deltaMs) };
        }
        if (side === "start" && (p.rearActionId === actionId || (p.ownerActionId === actionId && p.role === "start"))) {
          return { ...p, atMs: p.atMs + deltaMs, plannedAtUtc: shiftIso(p.plannedAtUtc, deltaMs) };
        }
        return p;
      });
      const { start, end } = lineExtents(segments, points);
      return { ...line, start, end, segments, points };
    }

    if (preview.kind === "sharedBoundary" && preview.frontActionId && preview.rearActionId && preview.sharedZone) {
      if (!deltaMs) return line;
      const atMs = (line.points.find((p) => p.isShared && p.frontActionId === preview.frontActionId)?.atMs ?? 0) + deltaMs;
      const atIso = new Date(atMs).toISOString();
      const zone = preview.sharedZone;
      const segments = line.segments.map((s) => {
        if (zone !== "rearStart" && s.actionId === preview.frontActionId) {
          return { ...s, endMs: atMs, plannedEndAt: atIso };
        }
        if (zone !== "frontEnd" && s.actionId === preview.rearActionId) {
          return { ...s, startMs: atMs, plannedStartAt: atIso };
        }
        return s;
      });
      const points = line.points.map((p) => {
        if (!p.isShared || p.frontActionId !== preview.frontActionId) return p;
        if (zone === "frontEnd" || zone === "both" || zone === "rearStart") {
          return { ...p, atMs, plannedAtUtc: atIso };
        }
        return p;
      });
      const { start, end } = lineExtents(segments, points);
      return { ...line, start, end, segments, points };
    }

    if (preview.kind !== "segment" || !deltaMs) return line;
    const actionIds = new Set(preview.actionIds);
    const segments = line.segments.map((s) =>
      actionIds.has(s.actionId)
        ? {
            ...s,
            startMs: s.startMs + deltaMs,
            endMs: s.endMs + deltaMs,
            plannedStartAt: shiftIso(s.plannedStartAt, deltaMs),
            plannedEndAt: shiftIso(s.plannedEndAt, deltaMs),
          }
        : s,
    );
    const points = line.points.map((p) =>
      pointMovesWithActions(p, actionIds)
        ? { ...p, atMs: p.atMs + deltaMs, plannedAtUtc: shiftIso(p.plannedAtUtc, deltaMs) }
        : p,
    );
    const { start, end } = lineExtents(segments, points);
    return { ...line, start, end, segments, points };
  });
}

export function connectedActionGroup(_itemId: string, actionId: string, snapshot: TripSnapshot): string[] {
  const ordered = [...snapshot.actions]
    .filter((a) => !a.deletedAtUtc)
    .sort((a, b) => Date.parse(a.plannedStartAt) - Date.parse(b.plannedStartAt) || a.id.localeCompare(b.id));
  const index = ordered.findIndex((a) => a.id === actionId);
  if (index < 0) return [actionId];
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
  let lo = index;
  let hi = index;
  while (lo > 0 && minute(ordered[lo - 1].plannedEndAt) === minute(ordered[lo].plannedStartAt)) lo--;
  while (hi < ordered.length - 1 && minute(ordered[hi].plannedEndAt) === minute(ordered[hi + 1].plannedStartAt)) hi++;
  return ordered.slice(lo, hi + 1).map((a) => a.id);
}
