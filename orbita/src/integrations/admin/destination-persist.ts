import { getSettings } from "../../core/settings";
import type { InsightDestinationId } from "./types";

const STORAGE_PREFIX = "orbita.insight.dest.";

export type PersistedDestinationState = {
  destinationId: InsightDestinationId;
  destinationState?: unknown;
};

function storageKey(): string {
  const dir = getSettings().dataDir || "_default";
  return `${STORAGE_PREFIX}${dir}`;
}

export function loadPersistedDestination(): PersistedDestinationState | null {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDestinationState;
    if (!parsed?.destinationId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedDestination(state: PersistedDestinationState): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function clearPersistedDestination(): void {
  localStorage.removeItem(storageKey());
}

export const DEFAULT_DESTINATION: InsightDestinationId = "finance";
