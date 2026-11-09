import { describe, expect, it } from "vitest";
import type { ItemTypeSnapshot, ProjectSnapshot, SessionSnapshot } from "../../../productivity/types";
import { clampIntoSession, dateAt, instantForWall, offsetAt, snapFive, targets, type BusinessZone } from "./arrangement-model";

describe("Task action category color", () => {
  it("uses the current effective type color and retains the existing unclassified fallback", () => {
    const project = { id: "p", title: "项目", status: "进行中", tasks: [
      { id: "typed", projectId: "p", title: "有分类", status: "未做", itemTypeId: "category" },
      { id: "plain", projectId: "p", title: "无分类", status: "未做" },
    ] } as ProjectSnapshot;
    const types = [
      { id: "category", name: "分类", effectiveColor: "#123456", effectiveInactive: false },
      { id: "work", name: "work", effectiveColor: "#abcdef", effectiveInactive: false },
    ] as ItemTypeSnapshot[];
    expect(targets([], [project], types).get("task:typed")?.actionColor).toBe("#123456");
    expect(targets([], [project], types).get("task:plain")?.actionColor).toBe("#abcdef");
    expect(targets([], [project], types).get("task:typed")?.color).toBe("#abcdef");
    types[0].effectiveColor = "#654321";
    expect(targets([], [project], types).get("task:typed")?.actionColor).toBe("#654321");
  });
});

describe("arrangement business-time projection", () => {
  it("uses each replacement interval at its exact half-open boundaries", () => {
    const zone: BusinessZone = {
      baseOffset: "+08:00",
      replacements: [{ startUtc: "2026-10-15T00:00:00.000Z", endUtc: "2026-10-16T00:00:00.000Z", offset: "+09:00" }],
    };
    expect(offsetAt(Date.parse("2026-10-15T00:00:00.000Z"), zone)).toBe(540);
    expect(offsetAt(Date.parse("2026-10-16T00:00:00.000Z"), zone)).toBe(480);
    expect(dateAt(Date.parse("2026-10-15T00:00:00.000Z"), zone)).toBe("2026-10-15");
    expect(instantForWall("2026-10-15", 9 * 60, zone)).toBe(Date.parse("2026-10-15T00:00:00.000Z"));
    expect(() => instantForWall("2026-10-15", 8 * 60 + 30, zone)).toThrow("不存在或不唯一");
    expect(() => instantForWall("2026-10-16", 8 * 60 + 30, zone)).toThrow("不存在或不唯一");
  });
});

describe("U161 unscheduled Action clamping", () => {
  const session = {
    plannedStartAt: "2026-01-01T10:00:00.000Z",
    plannedEndAt: "2026-01-01T11:00:00.000Z",
  } as SessionSnapshot;

  it("snaps to five minutes then slides the full duration inside the Session", () => {
    const snapped = snapFive(Date.parse("2026-01-01T10:47:00.000Z"));
    const range = clampIntoSession(snapped, 30 * 60_000, session);
    expect(new Date(range.start).toISOString()).toBe("2026-01-01T10:30:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });

  it("shortens only when the Action is longer than the full Session", () => {
    const range = clampIntoSession(Date.parse("2026-01-01T10:45:00.000Z"), 2 * 60 * 60_000, session);
    expect(new Date(range.start).toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });
});
