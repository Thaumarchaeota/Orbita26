import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_CATEGORY_SCHEMES, startCategoryPalettePreview, stopCategoryPalettePreview } from "../../../../../ui/color-system";
import { mountArrangementWeek } from "../arrangement-week";
import type { TravelController } from "../../../../productivity/travel-v2/controller";
import type { TravelListWeekResult, TripSnapshot } from "../../../../productivity/travel-v2/types";
import { renderTravelLinesForDay } from "./week-render";
import type { TravelTripLine } from "./week-model";

afterEach(() => {
  stopCategoryPalettePreview("travel-week-color-test");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("travel week palette colors", () => {
  it("maps a canonical category color to the active palette display roles", () => {
    const scheme = structuredClone(BUILTIN_CATEGORY_SCHEMES[0]!);
    const slot = scheme.slots.find((entry) => entry.canonicalHex.toUpperCase() === "#4879ED")!;
    slot.main = "#A43D72";
    slot.glowPrimary = "#763050";
    slot.glowPrimaryOpacity = 0.22;
    startCategoryPalettePreview("travel-week-color-test", scheme);
    const start = Date.parse("2026-10-05T10:00:00.000Z");
    const end = Date.parse("2026-10-05T11:00:00.000Z");
    const line: TravelTripLine = {
      itemId: "trip", color: "#4879ED", completed: false, lane: 0, start, end,
      points: [], segments: [],
    };

    const html = renderTravelLinesForDay([line], {
      date: "2026-10-05", start: Date.parse("2026-10-05T00:00:00.000Z"), end: Date.parse("2026-10-06T00:00:00.000Z"),
    }, { baseOffset: "+00:00", replacements: [] }, 56, null, null);

    expect(html).toContain("--travel-color:#A43D72");
    expect(html).toContain("--orbita-timeline-glow-primary:#763050");
    expect(html).toContain("--orbita-timeline-glow-opacity:0.22");
    expect(line.color).toBe("#4879ED");
  });

  it("uses the neutral fallback for a missing canonical color", () => {
    const start = Date.parse("2026-10-05T10:00:00.000Z");
    const html = renderTravelLinesForDay([{
      itemId: "trip", color: "not-a-color", completed: false, lane: 0, start, end: start + 3_600_000, points: [], segments: [],
    } as unknown as TravelTripLine], {
      date: "2026-10-05", start: Date.parse("2026-10-05T00:00:00.000Z"), end: Date.parse("2026-10-06T00:00:00.000Z"),
    }, { baseOffset: "+00:00", replacements: [] }, 56, null, null);

    expect(html).toContain("--travel-color:#87909A");
  });

  it("repaints mounted travel lines when category appearance changes", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const host = document.createElement("div");
    document.body.append(host);
    const start = "2026-10-05T10:00:00.000Z";
    const end = "2026-10-05T11:00:00.000Z";
    const canonicalPoints = [
      { pointId: "start", plannedAtUtc: start, attachmentKind: "action", role: "start", ownerActionId: "stage", ownerCheckpointId: null, frontActionId: null, rearActionId: null, actionLabel: null, location: null, note: null, actualFrontEndAtUtc: null, actualRearStartAtUtc: null, actualAtUtc: null },
      { pointId: "end", plannedAtUtc: end, attachmentKind: "action", role: "end", ownerActionId: "stage", ownerCheckpointId: null, frontActionId: null, rearActionId: null, actionLabel: null, location: null, note: null, actualFrontEndAtUtc: null, actualRearStartAtUtc: null, actualAtUtc: null },
    ];
    const list = { items: [{ itemId: "trip", item: { id: "trip", revision: 1 } }], segments: [{ actionId: "stage", transportationId: null, plannedStartAt: start, plannedEndAt: end }], canonicalPoints } as unknown as TravelListWeekResult;
    const snapshot = {
      item: { id: "trip", revision: 1, listId: null, title: "行程", completed: false, status: "active", cancelled: false },
      actions: [{ id: "stage", revision: 1, title: "交通", plannedStartAt: start, plannedEndAt: end, ended: false, transportationId: null }],
      checkpoints: [], transportations: [], points: [], canonicalPoints,
      segments: [{ actionId: "stage", transportationId: null, plannedStartAt: start, plannedEndAt: end }],
      capabilities: { canEditStructure: true, canEditPlan: true, canEditText: true, canChangeTransportationType: true, canRecordActual: true, canFinish: true, canCancel: true, canAppend: true },
    } as unknown as TripSnapshot;
    const scheme = structuredClone(BUILTIN_CATEGORY_SCHEMES[0]!);
    scheme.slots.find((entry) => entry.canonicalHex.toUpperCase() === "#4879ED")!.main = "#A43D72";
    const handle = mountArrangementWeek({
      host,
      getData: () => ({ actions: [], sessions: [], targets: new Map(), zone: { baseOffset: "+00:00", replacements: [] } }),
      getSelection: () => null, onSelect: vi.fn(), onCreate: async () => {}, onMove: async () => {}, onError: vi.fn(),
      getDay: () => "2026-10-05", onDay: vi.fn(), captureActionBaseline: (id) => ({ action: { id, expectedRevision: 1 }, targetOwningRoot: null, currentSession: null, currentSessionMembers: [] }),
      getTravelListWeek: () => list, getTravelSnapshot: () => snapshot, getTravelColor: () => "#4879ED",
      getTravelEditMode: () => null,
      getTravelController: () => ({ getPlanEditGeneration: () => 1, queueEditPlan: vi.fn() }) as unknown as TravelController,
    });
    try {
      expect(host.querySelector<HTMLElement>(".travel-week-trip")?.style.getPropertyValue("--travel-color")).toBeTruthy();
      startCategoryPalettePreview("travel-week-color-test", scheme);
      expect(host.querySelector<HTMLElement>(".travel-week-trip")?.style.getPropertyValue("--travel-color")).toBe("#A43D72");
    } finally {
      handle.dispose();
      host.remove();
    }
  });
});
