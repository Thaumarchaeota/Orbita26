import { invoke } from "@tauri-apps/api/core";
import type { TripSnapshot } from "../../../../productivity/travel-v2/types";

export type TravelV2GetResponse = {
  status: string;
  snapshot?: TripSnapshot | null;
};

/** Wire response matches Rust TravelV2GetResponse (client.ts TripSnapshot-only wrapper is incomplete). */
export async function fetchTravelV2Trip(itemId: string, expectedDataDir: string): Promise<TripSnapshot | null> {
  const res = await invoke<TravelV2GetResponse>("productivity_travel_v2_get", {
    req: { itemId, expectedDataDir },
  });
  if (res.status !== "ok" || !res.snapshot) return null;
  return res.snapshot;
}

export function isLegacyOrNotTravelResponse(res: TravelV2GetResponse): boolean {
  return res.status === "legacy_or_not_travel";
}

export async function probeTravelV2Profile(itemId: string, expectedDataDir: string): Promise<boolean> {
  const res = await invoke<TravelV2GetResponse>("productivity_travel_v2_get", {
    req: { itemId, expectedDataDir },
  });
  return res.status === "ok" && Boolean(res.snapshot);
}

export function buildAdoptionToken(
  itemId: string,
  transportationId: string,
  expectedDataDir: string,
  queryGeneration: number,
  itemRevision: number,
): string {
  return JSON.stringify({
    itemId,
    transportationId,
    expectedDataDir,
    queryGeneration,
    itemRevision,
  });
}
