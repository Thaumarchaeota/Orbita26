import type { InsightDestinationId } from "../types";

let returnDestinationId: InsightDestinationId | null = null;
let activateFn: ((id: InsightDestinationId) => void) | null = null;
let getActiveId: () => InsightDestinationId | null = () => null;

export function registerInsightSettingsNav(
  fn: (id: InsightDestinationId) => void,
  getActive: () => InsightDestinationId | null,
): void {
  activateFn = fn;
  getActiveId = getActive;
}

export function openInsightSettings(): void {
  const from = getActiveId();
  if (from && from !== "settings") returnDestinationId = from;
  activateFn?.("settings");
}

export function closeInsightSettings(): void {
  const back = returnDestinationId ?? "finance";
  returnDestinationId = null;
  activateFn?.(back);
}
