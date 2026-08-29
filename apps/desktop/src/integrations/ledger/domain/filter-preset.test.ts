import { describe, expect, it } from "vitest";
import { defaultDetailFilter } from "./filter-apply";
import {
  deserializePresetToFilterState,
  diagnoseFilterPreset,
  isIsoDate,
  resolveRelativeDatePreset,
  serializeFilterState,
  validateAbsoluteDateRange,
  type FilterPreset,
} from "./filter-preset";

const NOW = new Date(2026, 7, 22);

describe("filter preset serialization", () => {
  it("round-trips absolute date and selected types", () => {
    const filter = {
      ...defaultDetailFilter(),
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      typeMode: "selected" as const,
      types: new Set(["expense", "income"] as const),
      accounts: new Set(["Assets:Cash"]),
      accountMode: "and" as const,
      tags: new Set(["trip"]),
      tagMode: "and" as const,
    };
    const preset = serializeFilterState(filter, "p1", "日常", {
      mode: "absolute",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    const restored = deserializePresetToFilterState(preset, NOW);
    expect(restored.dateFrom).toBe("2026-01-01");
    expect(restored.dateTo).toBe("2026-01-31");
    expect(restored.typeMode).toBe("selected");
    expect([...restored.types]).toEqual(["expense", "income"]);
    expect([...restored.accounts]).toEqual(["Assets:Cash"]);
    expect(restored.accountMode).toBe("and");
    expect([...restored.tags]).toEqual(["trip"]);
    expect(restored.tagMode).toBe("and");
  });

  it("resolves relative presets using Shanghai calendar date", () => {
    const shanghaiEvening = new Date("2026-08-21T18:00:00.000Z");
    expect(resolveRelativeDatePreset("today", shanghaiEvening)).toEqual({
      dateFrom: "2026-08-22",
      dateTo: "2026-08-22",
    });
    expect(resolveRelativeDatePreset("last7", shanghaiEvening)).toEqual({
      dateFrom: "2026-08-16",
      dateTo: "2026-08-22",
    });
  });

  it("resolves relative presets", () => {
    expect(resolveRelativeDatePreset("today", NOW)).toEqual({
      dateFrom: "2026-08-22",
      dateTo: "2026-08-22",
    });
    expect(resolveRelativeDatePreset("last7", NOW)).toEqual({
      dateFrom: "2026-08-16",
      dateTo: "2026-08-22",
    });
    expect(resolveRelativeDatePreset("thisMonth", NOW)).toEqual({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-22",
    });
    expect(resolveRelativeDatePreset("thisYear", NOW)).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-08-22",
    });
    expect(resolveRelativeDatePreset("all", NOW)).toEqual({ dateFrom: "", dateTo: "" });
  });

  it("deserializes relative preset dates", () => {
    const preset: FilterPreset = {
      id: "p2",
      name: "近7天",
      date: { mode: "relative", preset: "last7" },
      typeMode: "all",
      types: [],
      accounts: [],
      accountMode: "or",
      tags: [],
      tagMode: "or",
    };
    const restored = deserializePresetToFilterState(preset, NOW);
    expect(restored.dateFrom).toBe("2026-08-16");
    expect(restored.dateTo).toBe("2026-08-22");
    expect(restored.typeMode).toBe("all");
  });

  it("round-trips pad and balance types", () => {
    const preset: FilterPreset = {
      id: "p4",
      name: "Pad/Balance",
      date: { mode: "all" },
      typeMode: "selected",
      types: ["pad", "balance"],
      accounts: [],
      accountMode: "or",
      tags: [],
      tagMode: "or",
    };
    const restored = deserializePresetToFilterState(preset, NOW);
    expect([...restored.types].sort()).toEqual(["balance", "pad"]);
  });

  it("skips unknown stripe kinds when deserializing", () => {
    const preset: FilterPreset = {
      id: "p3",
      name: "坏类型",
      date: { mode: "all" },
      typeMode: "selected",
      types: ["expense", "not-a-kind"],
      accounts: [],
      accountMode: "or",
      tags: [],
      tagMode: "or",
    };
    const restored = deserializePresetToFilterState(preset, NOW);
    expect([...restored.types]).toEqual(["expense"]);
  });

  it("validates absolute ISO dates and order", () => {
    expect(isIsoDate("2026-01-01")).toBe(true);
    expect(isIsoDate("2026/01/01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(validateAbsoluteDateRange("2026-01-01", "2026-01-31")).toBeNull();
    expect(validateAbsoluteDateRange("2026/01/01", "2026-01-31")).toContain("from");
    expect(validateAbsoluteDateRange("2026-02-01", "2026-01-01")).toContain("晚于");
  });

  it("diagnoses corrupt presets with locatable paths", () => {
    const diags = diagnoseFilterPreset(
      {
        id: "bad-format",
        name: "坏格式",
        date: { mode: "absolute", from: "2026/01/01", to: "2026-01-31" },
      },
      0,
    );
    expect(diags[0]?.path).toBe("filter_presets[0].date.from");
    expect(diags[0]?.preset_id).toBe("bad-format");
  });
});
