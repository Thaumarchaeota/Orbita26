import type { ActionSnapshot } from "../../../productivity/types";

export type RailActionStatus = "planned" | "running" | "paused" | "ended" | "overdue";

export function compareRailActions(a: ActionSnapshot, b: ActionSnapshot): number {
  if (a.ended !== b.ended) return a.ended ? 1 : -1;
  if (!a.plannedStartAt && b.plannedStartAt) return 1;
  if (a.plannedStartAt && !b.plannedStartAt) return -1;
  if (a.plannedStartAt && b.plannedStartAt) {
    const byStart = Date.parse(a.plannedStartAt) - Date.parse(b.plannedStartAt);
    if (byStart) return byStart;
  }
  return a.createdAtUtc.localeCompare(b.createdAtUtc) || a.id.localeCompare(b.id);
}

export function railActionStatus(action: ActionSnapshot, now: number): RailActionStatus {
  if (action.ended) return "ended";
  if (action.executionState === "进行中") return "running";
  if (action.executionState === "暂停") return "paused";
  if (action.executionState === "未开始" && action.plannedEndAt && Date.parse(action.plannedEndAt) < now) return "overdue";
  return "planned";
}
