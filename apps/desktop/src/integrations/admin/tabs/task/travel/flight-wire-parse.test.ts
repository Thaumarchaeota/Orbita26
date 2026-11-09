import { describe, expect, it } from "vitest";
import { parseTravelAdoptionReportFromResponse, parseTravelListWeekResponse } from "../../../../productivity/travel-v2/wire-parse";
import { TravelController } from "../../../../productivity/travel-v2/controller";
import { travelWeekRange } from "./week-range";

describe("flight adoption report wire format", () => {
  const nested = {
    adopted: [{ field: "actualStart", status: "adopted" }],
    skipped: [],
    conflicting: [],
    adoptionToken: "item:transport:token",
  };

  it("parses the report at the mutation response root", () => {
    expect(parseTravelAdoptionReportFromResponse(nested, null)).toEqual(nested);
  });

  it("recovers the persisted report when an older response only includes sourceSnapshot", () => {
    expect(parseTravelAdoptionReportFromResponse(undefined, nested)).toEqual(nested);
  });
});

describe("week snapshots", () => {
  const snapshot = {
    item: { id: "trip-1", revision: 1, title: "Trip", completed: false, cancelled: false },
    profile: { schemaVersion: 1 },
    actions: [], checkpoints: [], transportations: [], points: [], canonicalPoints: [], segments: [],
    memberRefs: {},
    capabilities: { canEditPlan: true, canEditStructure: true, canEditText: true, canChangeTransportationType: true, canFinish: false, canCancel: true, canAppend: true, canRecordActual: true },
  };

  it("reads a complete snapshot alongside the existing week summary", () => {
    const result = parseTravelListWeekResponse({ items: [{ itemId: "trip-1", itemRef: { id: "trip-1", expectedRevision: 1 }, snapshot, canonicalPoints: [], segments: [] }] });
    expect(result.items[0]?.snapshot?.item.id).toBe("trip-1");
    expect(result.items[0]?.snapshot?.capabilities.canEditPlan).toBe(true);
  });

  it("keeps week prefetch separate from the selected trip and dirty edits", () => {
    const controller = new TravelController({ expectedDataDir: "isolated-test" });
    const parsed = parseTravelListWeekResponse({ items: [{ itemId: "trip-1", itemRef: { id: "trip-1", expectedRevision: 1 }, snapshot }] }).items[0]!.snapshot!;
    controller.cacheWeekSnapshot(parsed);
    expect(controller.getSnapshot("trip-1")).toBe(parsed);
    expect(controller.getState().currentSnapshot).toBeNull();
    controller.setTextDraft("trip-1", "item:title", "unsaved");
    controller.cacheWeekSnapshot({ ...parsed, item: { ...parsed.item, title: "different" } });
    expect(controller.getSnapshot("trip-1")?.item.title).toBe("Trip");
    expect(controller.getState().saveState).toBe("dirty");
    controller.dispose();
  });
});

describe("travel week range", () => {
  it("covers the 21 rendered days and the final four-hour tail in business time", () => {
    expect(travelWeekRange("2026-10-12", { baseOffset: "+08:00", replacements: [] })).toEqual({
      fromUtc: "2026-10-04T16:00:00.000Z",
      toUtc: "2026-10-25T20:00:00.000Z",
    });
  });
});
