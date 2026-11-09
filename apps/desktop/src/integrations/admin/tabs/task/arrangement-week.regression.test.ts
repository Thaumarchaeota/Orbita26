import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionSnapshot } from "../../../productivity/types";
import type { TravelController } from "../../../productivity/travel-v2/controller";
import type { TravelListWeekResult, TripSnapshot } from "../../../productivity/travel-v2/types";
import { mountArrangementWeek, type TravelWeekEditMode, type WeekCreate, type WeekData, type WeekMove } from "./arrangement-week";
import { renderTravelLinesForDay } from "./travel/week-render";
import type { TravelTripLine } from "./travel/week-model";
import { createInsightDialog } from "../../../../ui/insight-dialog";

const menus = vi.hoisted(() => ({ latest: null as null | { onChange: (values: Set<string>) => void; options?: Array<{ value: string; label: string; children?: Array<{ value: string; label: string }> }> }, open: false }));
vi.mock("../../../../ui/flat-select-popover", () => ({
  mountFlatSelectPopover: (options: { onChange: (values: Set<string>) => void; onOpenChange?: (open: boolean) => void; options?: Array<{ value: string; label: string; children?: Array<{ value: string; label: string }> }> }) => {
    menus.latest = options;
    let opened = false;
    return { open: async () => { opened = true; menus.open = true; options.onOpenChange?.(true); },
      isOpen: () => opened, dispose: () => { opened = false; menus.open = false; }, close: async () => { opened = false; menus.open = false; options.onOpenChange?.(false); } };
  },
}));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); menus.latest = null; menus.open = false;
});

function mount(
  actions: ActionSnapshot[] = [],
  create = vi.fn(async (_request: WeekCreate) => {}),
  move = vi.fn(async (_request: WeekMove) => {}),
  extras: {
    getSelection?: () => { kind: "action" | "session"; id: string } | null;
    draggedActionId?: string;
    draggedCheckpointId?: string;
    onDeleteAction?: (action: ActionSnapshot) => void;
    travel?: {
      list: TravelListWeekResult;
      snapshot: TripSnapshot;
      mode: () => TravelWeekEditMode | null;
      controller: TravelController;
      onExit: () => void;
      onSelect?: () => Promise<boolean>;
      onEnter?: () => void;
    };
  } = {},
) {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  host.setPointerCapture = vi.fn();
  host.releasePointerCapture = vi.fn();
  const data: WeekData = { actions, sessions: [], targets: new Map(), zone: { baseOffset: "+00:00", replacements: [] } };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return 700; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 400);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => Number.parseFloat(host.style.getPropertyValue("--arrangement-grid-height")));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains("arrangement-days") ? 100 - (host.querySelector(".arrangement-grid-scroll")?.scrollTop ?? 0) : 100;
    return { x: 0, y: top, left: 0, top, width: 700, height: 400, right: 700, bottom: top + 400, toJSON() {} };
  });
  vi.spyOn(host, "getClientRects").mockImplementation(() => {
    if (host.hidden) return [] as unknown as DOMRectList;
    return [{ width: 700, height: 400, top: 0, left: 0, bottom: 400, right: 700, x: 0, y: 0, toJSON() {} }] as unknown as DOMRectList;
  });
  const onDeleteAction = extras.onDeleteAction ?? vi.fn();
  const onError = vi.fn();
  const onMoveCheckpoint = vi.fn(async () => {});
  const handle = mountArrangementWeek({ host, getData: () => data, getSelection: extras.getSelection ?? (() => null), getDay: () => "2026-10-12",
    onDay: vi.fn(), onSelect: vi.fn(), onCreate: create, onMove: move, onError, onDeleteAction,
    captureActionBaseline: (id) => ({ action: { id, expectedRevision: 1 }, targetOwningRoot: null, currentSession: null, currentSessionMembers: [] }),
    getDraggedActionId: () => extras.draggedActionId ?? null,
    getDraggedActionBaseline: () => extras.draggedActionId ? ({ action: { id: extras.draggedActionId, expectedRevision: 1 }, targetOwningRoot: null, currentSession: null, currentSessionMembers: [] }) : null,
    getDraggedCheckpointBaseline: () => extras.draggedCheckpointId ? ({ expectedDataDir: "test", checkpoint: { id: extras.draggedCheckpointId, expectedRevision: 1 }, currentSession: null, expectedCurrentCheckpoints: [], sessions: new Map() }) : null,
    onMoveCheckpoint,
    ...(extras.travel ? {
      getTravelListWeek: () => extras.travel!.list,
      getTravelSnapshot: () => extras.travel!.snapshot,
      getTravelEditMode: () => extras.travel!.mode(),
      getTravelController: () => extras.travel!.controller,
      onTravelExitEdit: extras.travel.onExit,
      onTravelSelect: extras.travel.onSelect,
      onTravelEnterEdit: extras.travel.onEnter,
    } : {}),
  });
  disposers.push(handle.dispose);
  const scroll = host.querySelector<HTMLElement>(".arrangement-grid-scroll")!;
  scroll.scrollTop = 0;
  return { host, data, handle, scroll, create, move, onDeleteAction, onError, onMoveCheckpoint };
}
function pointer(target: HTMLElement, type: string, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function action(id: string, start: string, end: string): ActionSnapshot {
  return { id, title: "测试", targetKind: "item", targetId: "item", plannedStartAt: start, plannedEndAt: end,
    intervals: [], ended: false, revision: 1 } as unknown as ActionSnapshot;
}

function travelFixture() {
  let editing = true;
  const start = "2026-10-05T10:00:00.000Z";
  const end = "2026-10-05T11:00:00.000Z";
  const canonicalPoints = [
    { pointId: "start", plannedAtUtc: start, attachmentKind: "action", role: "start", ownerActionId: "stage", ownerCheckpointId: null, frontActionId: null, rearActionId: null, actionLabel: null, location: null, note: null, actualFrontEndAtUtc: null, actualRearStartAtUtc: null, actualAtUtc: null },
    { pointId: "end", plannedAtUtc: end, attachmentKind: "action", role: "end", ownerActionId: "stage", ownerCheckpointId: null, frontActionId: null, rearActionId: null, actionLabel: null, location: null, note: null, actualFrontEndAtUtc: null, actualRearStartAtUtc: null, actualAtUtc: null },
  ];
  const list = {
    items: [{ itemId: "trip", item: { id: "trip", revision: 1 } }],
    segments: [{ actionId: "stage", transportationId: null, plannedStartAt: start, plannedEndAt: end }],
    canonicalPoints,
  } as unknown as TravelListWeekResult;
  const snapshot = {
    item: { id: "trip", revision: 1, listId: null, title: "行程", completed: false, status: "active", cancelled: false },
    actions: [{ id: "stage", revision: 1, title: "交通", nameLinkMode: "manual", plannedStartAt: start, plannedEndAt: end, ended: false, transportationId: null, actual: {}, createdAtUtc: start, updatedAtUtc: start }],
    checkpoints: [], transportations: [], points: [], canonicalPoints,
    segments: [{ actionId: "stage", transportationId: null, plannedStartAt: start, plannedEndAt: end }],
    capabilities: { canEditStructure: true, canEditPlan: true, canEditText: true, canChangeTransportationType: true, canRecordActual: true, canFinish: true, canCancel: true, canAppend: true },
  } as unknown as TripSnapshot;
  const controller = { getPlanEditGeneration: () => 1, queueEditPlan: vi.fn(), queueAppend: vi.fn() } as unknown as TravelController;
  const onExit = vi.fn(() => { editing = false; });
  return {
    list, snapshot, controller, onExit,
    mode: () => ({ editingItemId: editing ? "trip" : null, selectedItemId: "trip" }),
    setEditing: (value: boolean) => { editing = value; },
  };
}

function escapeKey(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

describe("week gesture regressions", () => {
  it("keeps the drop target mounted without rendering a preview and snaps the drop", async () => {
    const unscheduled = { ...action("drag-action", "", ""), plannedStartAt: null, plannedEndAt: null } as unknown as ActionSnapshot;
    const existing = action("existing", "2026-10-05T10:15:00.000Z", "2026-10-05T11:15:00.000Z");
    const { host, scroll, move, onError } = mount([unscheduled, existing], undefined, undefined, { draggedActionId: unscheduled.id });
    scroll.scrollTop = 400;
    let dragTarget = scroll;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    const transfer = { types: ["application/orbita-arrangement-action"], getData: (type: string) => type === "application/orbita-arrangement-action" ? unscheduled.id : "" };
    const sendDrag = (type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: y });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      dragTarget.dispatchEvent(event);
    };
    sendDrag("dragover", 90);
    sendDrag("drop", 90);
    expect(move).not.toHaveBeenCalled();
    expect(host.querySelector(".arrangement-action.is-preview")).toBeNull();
    sendDrag("dragover", 100 - 400 + 56 * 10 + 14);
    expect(host.querySelector(".arrangement-action.is-preview")).toBeNull();
    document.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(host.querySelector(".arrangement-action.is-preview")).toBeNull();
    expect(move).not.toHaveBeenCalled();
    dragTarget = host.querySelector<HTMLElement>(".arrangement-grid-scroll")!;
    sendDrag("dragover", 100 - 400 + 56 * 10 + 14);
    expect(onError.mock.calls).toEqual([]);
    expect(host.querySelector(".arrangement-grid-scroll")).toBe(dragTarget);
    expect(host.querySelector(".arrangement-action.is-preview")).toBeNull();
    sendDrag("drop", 100 - 400 + 56 * 11);
    await flushAsync();
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ id: unscheduled.id, start: "2026-10-05T11:00:00.000Z", end: "2026-10-05T12:00:00.000Z" }));
  });
  it("drops an unscheduled checkpoint at the snapped time instead of midnight", async () => {
    const { data, scroll, onMoveCheckpoint } = mount([], undefined, undefined, { draggedCheckpointId: "cp" });
    scroll.scrollTop = 400;
    data.checkpoints = [{ id: "cp", targetKind: "item", targetId: "item", actualAtUtc: null }] as NonNullable<WeekData["checkpoints"]>;
    data.targets.set("item:item", { kind: "item", id: "item", title: "Item", path: "Item", color: "#4879ED", available: true, archived: false });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 50, clientY: 100 - 400 + 56 * 10 + 14 });
    Object.defineProperty(event, "dataTransfer", { value: { getData: (type: string) => type === "application/orbita-arrangement-checkpoint" ? "cp" : "" } });
    scroll.dispatchEvent(event);
    await flushAsync();
    expect(onMoveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ id: "cp", plannedAtUtc: "2026-10-05T10:15:00.000Z" }));
  });
  it("keeps the preview on a five-minute boundary when clamped inside a session", async () => {
    const pending = { ...action("pending", "", ""), plannedStartAt: null, plannedEndAt: null } as unknown as ActionSnapshot;
    const { host, data, scroll, move } = mount([pending], undefined, undefined, { draggedActionId: pending.id });
    data.sessions.push({ id: "session", plannedStartAt: "2026-10-05T09:02:00.000Z", plannedEndAt: "2026-10-05T11:04:00.000Z" } as WeekData["sessions"][number]);
    scroll.scrollTop = 400;
    const sessionElement = document.createElement("div");
    sessionElement.dataset.sessionId = "session";
    vi.spyOn(document, "elementFromPoint").mockReturnValue(sessionElement);
    const transfer = { types: ["application/orbita-arrangement-action"], getData: (type: string) => type === "application/orbita-arrangement-action" ? pending.id : "" };
    for (const type of ["dragover", "drop"]) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: 100 - 400 + 56 * (10 + 55 / 60) });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      scroll.dispatchEvent(event);
      if (type === "dragover") expect(host.querySelector(".arrangement-action.is-preview")).toBeNull();
    }
    await flushAsync();
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ start: "2026-10-05T10:00:00.000Z", end: "2026-10-05T11:00:00.000Z", sessionId: "session" }));
  });
  it("draws one shared travel connector across action gaps without making the gap an action", () => {
    const startA = Date.parse("2026-10-05T10:00:00.000Z");
    const endA = Date.parse("2026-10-05T11:00:00.000Z");
    const startB = Date.parse("2026-10-05T12:00:00.000Z");
    const endB = Date.parse("2026-10-05T13:00:00.000Z");
    const iso = (value: number) => new Date(value).toISOString();
    const point = (pointId: string, atMs: number) => ({
      pointId, plannedAtUtc: iso(atMs), atMs, attachmentKind: "action" as const, role: "single" as const,
      ownerActionId: null, ownerCheckpointId: null, frontActionId: null, rearActionId: null, isShared: false,
    });
    const line: TravelTripLine = {
      itemId: "trip", completed: false, lane: 0, start: startA, end: endB,
      points: [point("first-start", startA), point("first-end", endA), point("second-start", startB), point("second-end", endB)],
      segments: [
        { actionId: "first", transportationId: null, transportationType: null, plannedStartAt: iso(startA), plannedEndAt: iso(endA), startMs: startA, endMs: endA },
        { actionId: "second", transportationId: null, transportationType: null, plannedStartAt: iso(startB), plannedEndAt: iso(endB), startMs: startB, endMs: endB },
      ],
    };
    const html = renderTravelLinesForDay([line], {
      date: "2026-10-05",
      start: Date.parse("2026-10-05T00:00:00.000Z"),
      end: Date.parse("2026-10-06T00:00:00.000Z"),
    }, { baseOffset: "+00:00", replacements: [] }, 56, null, null);
    const host = document.createElement("div");
    host.innerHTML = html;
    const connectors = [...host.querySelectorAll<HTMLElement>("[data-travel-connector]")];
    expect(connectors).toHaveLength(3);
    expect(Number.parseFloat(connectors[1]?.style.height ?? "0")).toBeGreaterThan(36);
    expect(Number.parseFloat(connectors[1]?.style.height ?? "0")).toBeLessThan(40);
    expect(connectors[1]?.dataset.travelSegment).toBeUndefined();
    expect(connectors[1]?.classList.contains("is-fade-start")).toBe(true);
    expect(connectors[1]?.classList.contains("is-fade-end")).toBe(true);
    expect(host.querySelectorAll("[data-travel-segment]")).toHaveLength(2);

    const crossDay = renderTravelLinesForDay([{
      ...line,
      start: Date.parse("2026-10-04T23:00:00.000Z"),
      end: Date.parse("2026-10-06T01:00:00.000Z"),
    }], {
      date: "2026-10-05",
      start: Date.parse("2026-10-05T00:00:00.000Z"),
      end: Date.parse("2026-10-06T00:00:00.000Z"),
    }, { baseOffset: "+00:00", replacements: [] }, 56, null, null);
    const crossHost = document.createElement("div");
    crossHost.innerHTML = crossDay;
    const crossConnectors = [...crossHost.querySelectorAll<HTMLElement>("[data-travel-connector]")];
    expect(crossConnectors[0]?.classList.contains("is-fade-start")).toBe(true);
    expect(crossConnectors[crossConnectors.length - 1]?.classList.contains("is-fade-end")).toBe(true);
  });

  it("does not append on a blank click but still appends after an actual drag", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T00:00:00.000Z"));
    const travel = travelFixture();
    const { host } = mount([], undefined, undefined, { travel });
    const y = 100 + 10 * 56;
    pointer(host, "pointerdown", y);
    pointer(host, "pointerup", y);
    expect(travel.controller.queueAppend).not.toHaveBeenCalled();

    pointer(host, "pointerdown", y);
    pointer(host, "pointermove", y + 56);
    pointer(host, "pointerup", y + 56);
    expect(travel.controller.queueAppend).toHaveBeenCalledTimes(1);
  });

  it("waits for travel navigation before entering edit and respects a blocked selection", async () => {
    const travel = travelFixture();
    let finish!: (accepted: boolean) => void;
    const onEnter = vi.fn();
    const onSelect = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { host } = mount([], undefined, undefined, { travel: { ...travel, onSelect, onEnter } });
    const segment = host.querySelector<HTMLElement>('[data-travel-segment="stage"]')!;
    segment.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(onEnter).not.toHaveBeenCalled();
    finish(false);
    await Promise.resolve();
    expect(onEnter).not.toHaveBeenCalled();
    segment.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    finish(true);
    await Promise.resolve();
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("visits every approved zoom level and only reveals half-hour ticks from 150%", () => {
    const { host, scroll } = mount();
    const zoom = () => host.querySelector<HTMLButtonElement>('[data-zoom="reset"]')!.textContent;
    const click = (direction: string) => host.querySelector<HTMLButtonElement>(`[data-zoom="${direction}"]`)!.click();
    click("out");
    expect(zoom()).toBe("67%");
    expect(host.querySelector<HTMLButtonElement>('[data-zoom="out"]')!.disabled).toBe(true);
    for (const level of [100, 136, 150, 175, 200]) {
      click("in");
      expect(zoom()).toBe(`${level}%`);
      expect(host.classList.contains("has-half-hours")).toBe(level >= 150);
      expect(host.querySelector<HTMLElement>('[data-hour="1.5"]')!.hidden).toBe(level < 150);
      expect(host.querySelector<HTMLElement>('[data-hour="1.5"]')!.style.top).toBe(`${1.5 * 56 * level / 100}px`);
      expect(host.querySelector(".arrangement-grid-scroll")).toBe(scroll);
    }
    expect(host.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.disabled).toBe(true);
    click("reset");
    expect(zoom()).toBe("100%");
    expect(host.classList.contains("has-half-hours")).toBe(false);
  });

  it("reprojects travel lines immediately when the week scale changes", () => {
    const travel = travelFixture();
    const { host } = mount([], undefined, undefined, { travel });
    const segment = () => host.querySelector<HTMLElement>(".travel-week-segment")!;
    const topBefore = Number.parseFloat(segment().style.top);
    const heightBefore = Number.parseFloat(segment().style.height);

    host.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.click();

    expect(Number.parseFloat(segment().style.top)).toBeCloseTo(topBefore * 1.36, 4);
    expect(Number.parseFloat(segment().style.height)).toBeCloseTo(heightBefore * 1.36, 4);
  });

  it("projects next-day early hours in the originating column and creates there without a blank preview", async () => {
    let finish!: () => void;
    const create = vi.fn((_request: WeekCreate) => new Promise<void>((resolve) => { finish = resolve; }));
    const { host, data, handle } = mount([], create);
    pointer(host, "pointerdown", 100 + 24.5 * 56);
    pointer(host, "pointermove", 100 + 26 * 56);
    pointer(host, "pointerup", 100 + 26 * 56);
    expect(host.querySelector('.arrangement-day[data-date="2026-10-05"] .is-preview')).not.toBeNull();
    menus.latest!.onChange(new Set(["new-item"]));
    const request = create.mock.calls[0][0];
    expect(request.start).toBe("2026-10-06T00:30:00.000Z");
    expect(request.end).toBe("2026-10-06T02:00:00.000Z");
    expect(host.querySelector(".is-preview")).not.toBeNull();
    data.actions.push(action("created", request.start, request.end));
    handle.render();
    expect(host.querySelector(".is-preview")).toBeNull();
    expect(host.querySelector<HTMLElement>('.arrangement-day[data-date="2026-10-05"] [data-action-id="created"]')!.style.top).toBe("1372px");
    finish(); await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('[data-action-id="created"]')).not.toBeNull();
  });

  it("moves an existing block into the next-day tail using the same wall-time coordinate", async () => {
    const { host, move } = mount([action("moving", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z")]);
    pointer(host.querySelector<HTMLElement>('[data-action-id="moving"]')!, "pointerdown", 100 + 10.5 * 56);
    pointer(host, "pointermove", 100 + 25.5 * 56);
    pointer(host, "pointerup", 100 + 25.5 * 56);
    expect(move.mock.calls[0][0]).toMatchObject({ start: "2026-10-06T01:00:00.000Z", end: "2026-10-06T02:00:00.000Z" });
    await Promise.resolve();
  });

  it("offers a single first-level travel create choice after a blank drag", () => {
    const { host, create } = mount();
    pointer(host, "pointerdown", 100 + 56);
    pointer(host, "pointermove", 100 + 112);
    pointer(host, "pointerup", 100 + 112);
    const values = (menus.latest?.options ?? []).map((option) => option.value);
    expect(values).toContain("travel-other");
    expect(values).not.toContain("travel");
    expect(values).not.toContain("travel-flight");
    expect(values).not.toContain("travel-train");
    const travel = menus.latest?.options?.find((option) => option.value === "travel-other");
    expect(travel?.label).toBe("新建出行");
    expect(travel?.children).toBeUndefined();
    expect(values).toContain("test-flight-card");
    menus.latest!.onChange(new Set(["travel-other"]));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ choice: "travel-other", sessionOnly: false }));
  });

  it("opens a sample flight-card dialog from the test menu without creating", async () => {
    const { host, create } = mount();
    pointer(host, "pointerdown", 100 + 56);
    pointer(host, "pointermove", 100 + 112);
    pointer(host, "pointerup", 100 + 112);
    menus.latest!.onChange(new Set(["test-flight-card"]));
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
    expect(document.querySelector(".insight-dialog-title")?.textContent).toBe("选择航班");
    expect(document.querySelectorAll(".flight-result-card")).toHaveLength(2);
  });

  it("removes a held creation preview on cancel without writing", () => {
    const { host, create } = mount();
    pointer(host, "pointerdown", 100 + 56);
    pointer(host, "pointermove", 100 + 112);
    pointer(host, "pointerup", 100 + 112);
    expect(host.querySelector(".is-preview")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.querySelector(".is-preview")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("lets an open dialog consume Escape before leaving travel edit", async () => {
    const travel = travelFixture();
    const { host } = mount([], vi.fn(async () => {}), vi.fn(async () => {}), { travel });
    const dialog = createInsightDialog({ title: "测试对话框", bodyHtml: "<p>内容</p>", submitLabel: "确认" });
    dialog.bindChrome(() => { void dialog.close(); });
    await dialog.open();

    const dialogEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    dialog.panel.dispatchEvent(dialogEscape);

    expect(dialogEscape.defaultPrevented).toBe(true);
    expect(travel.onExit).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(document.querySelector(".insight-dialog-backdrop.is-open")).toBeNull();
    escapeKey();
    expect(travel.onExit).toHaveBeenCalledTimes(1);
    void host;
  });

  it("closes an open travel time picker on Escape before exiting travel edit", async () => {
    const travel = travelFixture();
    const { host } = mount([], vi.fn(async () => {}), vi.fn(async () => {}), { travel });
    const segment = host.querySelector<HTMLElement>('[data-travel-segment="stage"]')!;
    pointer(segment, "pointerdown", 100 + 10 * 56 + 1);
    pointer(host, "pointermove", 100 + 10 * 56 + 1);
    pointer(host, "pointermove", 100 + 10 * 56 + 6);
    pointer(host, "pointerup", 100 + 10 * 56 + 6);
    const trigger = document.querySelector<HTMLInputElement>(".travel-week-time-float .orbita-decoupled-picker-trigger")!;
    trigger.click();
    await flushAsync();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    escapeKey();

    expect(travel.onExit).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await new Promise((resolve) => setTimeout(resolve, 350));
    escapeKey();
    expect(travel.onExit).toHaveBeenCalledTimes(1);
  });

  it("dismisses a held creation menu preview before leaving travel edit", () => {
    const travel = travelFixture();
    travel.setEditing(false);
    const { host } = mount([], vi.fn(async () => {}), vi.fn(async () => {}), { travel });
    pointer(host, "pointerdown", 100 + 56);
    pointer(host, "pointermove", 100 + 112);
    pointer(host, "pointerup", 100 + 112);
    expect(host.querySelector(".is-preview")).not.toBeNull();
    expect(menus.latest).not.toBeNull();
    travel.setEditing(true);

    escapeKey();

    expect(travel.onExit).not.toHaveBeenCalled();
    expect(menus.open).toBe(false);
    expect(host.querySelector(".is-preview")).toBeNull();
    escapeKey();
    expect(travel.onExit).toHaveBeenCalledTimes(1);
  });

  it("accepts native scale gesture events without rebuilding the gesture surface", () => {
    const { host, scroll } = mount();
    host.dispatchEvent(new Event("gesturestart", { cancelable: true }));
    const event = new Event("gesturechange", { cancelable: true });
    Object.defineProperties(event, { scale: { value: 1.5 }, clientY: { value: 200 } });
    host.dispatchEvent(event);
    expect(host.style.getPropertyValue("--arrangement-hour-height")).toBe("84px");
    expect(host.querySelector(".arrangement-grid-scroll")).toBe(scroll);
    expect(event.defaultPrevented).toBe(true);
  });

  it("deletes the selected action with Delete using the command-menu callback", () => {
    const selected = action("keep", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z");
    const { onDeleteAction } = mount([selected], vi.fn(async () => {}), vi.fn(async () => {}), {
      getSelection: () => ({ kind: "action", id: "keep" }),
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(onDeleteAction).toHaveBeenCalledTimes(1);
    expect(onDeleteAction).toHaveBeenCalledWith(selected);
  });

  it("does not delete when the week view is hidden or a session is selected", () => {
    const selected = action("keep", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z");
    const { host, handle, onDeleteAction } = mount([selected], vi.fn(async () => {}), vi.fn(async () => {}), {
      getSelection: () => ({ kind: "action", id: "keep" }),
    });
    host.hidden = true;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(onDeleteAction).not.toHaveBeenCalled();
    handle.dispose();
    const sessionOnly = mount([selected], vi.fn(async () => {}), vi.fn(async () => {}), {
      getSelection: () => ({ kind: "session", id: "s1" }),
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(sessionOnly.onDeleteAction).not.toHaveBeenCalled();
  });

  it("keeps the trackpad event target alive across consecutive pinch wheel events", () => {
    const { host, scroll } = mount([action("zoom", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z")]);
    scroll.scrollTop = 300;
    const wheel = () => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -10, clientY: 250 });
      Object.defineProperties(event, { ctrlKey: { value: true }, clientY: { value: 250 } });
      scroll.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    wheel(); wheel();
    expect(host.querySelector(".arrangement-grid-scroll")).toBe(scroll);
    expect(Number.parseFloat(host.style.getPropertyValue("--arrangement-hour-height"))).toBeGreaterThan(56 * 1.2);
    expect((scroll.scrollTop + 150) / Number.parseFloat(host.style.getPropertyValue("--arrangement-hour-height"))).toBeCloseTo(450 / 56);
  });
});
