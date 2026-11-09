import type { TravelPointRole } from "../../../../productivity/travel-v2/types";
import type { TravelTripLine } from "./week-model";

export type TravelPointHitZone = "both" | "frontEnd" | "rearStart";

export type TravelHitKind =
  | { kind: "segment"; itemId: string; actionId: string }
  | {
      kind: "point";
      itemId: string;
      pointId: string;
      checkpointId: string | null;
      shared: boolean;
      role: TravelPointRole;
      ownerActionId: string | null;
      frontActionId: string | null;
      rearActionId: string | null;
      zone: TravelPointHitZone | null;
    }
  | { kind: "empty"; itemId: string | null };

function sharedPointZone(pointEl: HTMLElement, clientY: number): TravelPointHitZone {
  const rect = pointEl.getBoundingClientRect();
  if (rect.height <= 0) return "both";
  const ratio = (clientY - rect.top) / rect.height;
  if (ratio < 1 / 3) return "frontEnd";
  if (ratio > 2 / 3) return "rearStart";
  return "both";
}

export function travelHitFromTarget(target: HTMLElement, clientY?: number): TravelHitKind | null {
  const trip = target.closest<HTMLElement>("[data-travel-item]");
  const itemId = trip?.dataset.travelItem ?? null;
  if (!itemId) return null;
  const segment = target.closest<HTMLElement>("[data-travel-segment]");
  if (segment?.dataset.travelSegment) {
    return { kind: "segment", itemId, actionId: segment.dataset.travelSegment };
  }
  const point = target.closest<HTMLElement>("[data-travel-point]");
  if (point?.dataset.travelPoint) {
    const checkpointId = point.dataset.travelCheckpoint?.trim() || null;
    const shared = point.dataset.travelShared === "1";
    const role = (point.dataset.travelRole ?? "single") as TravelPointRole;
    const ownerActionId = point.dataset.travelOwnerAction?.trim() || null;
    const frontActionId = point.dataset.travelFrontAction?.trim() || null;
    const rearActionId = point.dataset.travelRearAction?.trim() || null;
    const zone = shared && clientY != null ? sharedPointZone(point, clientY) : shared ? "both" : null;
    return {
      kind: "point",
      itemId,
      pointId: point.dataset.travelPoint,
      checkpointId,
      shared,
      role,
      ownerActionId,
      frontActionId,
      rearActionId,
      zone,
    };
  }
  return { kind: "empty", itemId };
}

export function travelSegmentAt(lines: TravelTripLine[], itemId: string, actionId: string) {
  const line = lines.find((l) => l.itemId === itemId);
  return line?.segments.find((s) => s.actionId === actionId) ?? null;
}
