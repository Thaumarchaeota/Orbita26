import type { BusinessTimeZoneResponse } from "../../../../productivity/types";
import { addDays, instantForWall } from "../arrangement-model";

/** Match the 21 day week columns, including their four-hour next-day tail. */
export function travelWeekRange(visibleFirstDay: string, zone: BusinessTimeZoneResponse | null): { fromUtc: string; toUtc: string } {
  const first = addDays(visibleFirstDay, -7);
  if (!zone) {
    const startMs = Date.parse(`${first}T00:00:00.000Z`);
    return { fromUtc: new Date(startMs).toISOString(), toUtc: new Date(startMs + 21 * 86_400_000 + 4 * 3_600_000).toISOString() };
  }
  return {
    fromUtc: new Date(instantForWall(first, 0, zone)).toISOString(),
    toUtc: new Date(instantForWall(addDays(first, 21), 4 * 60, zone)).toISOString(),
  };
}
