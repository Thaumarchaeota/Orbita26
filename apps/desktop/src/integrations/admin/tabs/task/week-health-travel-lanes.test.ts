import { describe, expect, it } from "vitest";
import type { WeekHealthResponse, WeekHealthSource } from "../../../productivity/types";
import { healthInset, healthLines } from "./week-health-render";

function source(id: string, start: number, end: number): WeekHealthSource {
  return { id, start, end, kind: "activity", revision: 1, wakeDate: null, title: id, activityType: null, slot: null, segments: null };
}

describe("travel and health lane allocation", () => {
  it("keeps overlapping health lines distinct even when only one overlaps travel", () => {
    const base = Date.parse("2026-10-28T00:00:00Z");
    const hour = 3_600_000;
    const data: WeekHealthResponse = { plans: [], catalog: null, sources: [source("a", base, base + hour), source("b", base + hour / 2, base + 2 * hour), source("c", base + hour / 2, base + 2 * hour)] };
    const travel = (start: number, end: number) => start < base + hour / 4 && end > base ? 24 : 0;
    const lines = healthLines(data, 56, new Map(), travel);
    expect(lines.map(line => line.lane)).toEqual([1, 0, 2]);
    expect(healthInset(lines, base + hour / 2, base + hour)).toBe(72);
    expect(healthLines(data, 56, new Map()).map(line => line.lane)).toEqual([0, 1, 2]);
  });
});
