import type { TravelEndpointSplitPolicy, TravelSplitPolicies } from "../../../../productivity/travel-v2/types";

const DEFAULT: TravelSplitPolicies = { movingFrontEnd: "copy", movingRearStart: "copy" };

function normalizePolicy(raw: unknown): TravelEndpointSplitPolicy {
  return raw === "front" || raw === "rear" || raw === "copy" ? raw : "copy";
}

/** Reads AppSettings.ui.travelEndpointSplit when present; does not require schema extension. */
export function travelSplitPoliciesFromUi(ui: unknown): TravelSplitPolicies {
  if (!ui || typeof ui !== "object") return DEFAULT;
  const split = (ui as Record<string, unknown>).travelEndpointSplit;
  if (!split || typeof split !== "object") return DEFAULT;
  const record = split as Record<string, unknown>;
  return {
    movingFrontEnd: normalizePolicy(record.movingFrontEnd),
    movingRearStart: normalizePolicy(record.movingRearStart),
  };
}

export function defaultTravelSplitPolicies(): TravelSplitPolicies {
  return { ...DEFAULT };
}
