import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DateTimeValue } from "../../../../../ui/decoupled-datetime-picker";
import type { DateTimeRangeValue } from "../../../../../ui/datetime-range-display";
import type { TravelController } from "../../../../productivity/travel-v2/controller";
import type { TripSnapshot } from "../../../../productivity/travel-v2/types";
import { mountTravelRail } from "./rail";

type DialogMock = {
  title: string;
  body: HTMLElement;
  panel: HTMLFormElement;
  backdrop: HTMLElement;
  errorEl: HTMLElement;
  closed: boolean;
  disposed: boolean;
  setError: (message: string) => void;
  open: () => Promise<void>;
  close: () => Promise<void>;
  dispose: () => void;
  bindChrome: (onClose: () => void) => void;
  requestClose: () => void;
};

type RangePickerMock = {
  onChange: (value: DateTimeRangeValue) => void;
  disposed: boolean;
};

type DateTimePickerMock = {
  onChange: (value: DateTimeValue) => void;
  disposed: boolean;
};

const harness = vi.hoisted(() => ({
  dialogs: [] as DialogMock[],
  rangePickers: [] as RangePickerMock[],
  dateTimePickers: [] as DateTimePickerMock[],
  actualDateTimePickers: [] as unknown[],
  useRealDateTimePicker: false,
  queryFlight: vi.fn(async (_input: unknown) => ({ candidates: [], fetchedAtUtc: "2026-10-25T00:00:00Z", queryGeneration: 1 })),
  queueAdoptFlight: vi.fn(),
  queueAppend: vi.fn(),
}));

vi.mock("../../../../../ui/insight-dialog", () => ({
  createInsightDialog: ({ title }: { title: string }) => {
    const backdrop = document.createElement("div");
    const panel = document.createElement("form");
    const body = document.createElement("div");
    const errorEl = document.createElement("div");
    backdrop.append(panel);
    panel.append(body, errorEl);
    document.body.append(backdrop);
    let onChromeClose = () => {};
    const dialog: DialogMock = {
      title,
      body,
      panel,
      backdrop,
      errorEl,
      closed: false,
      disposed: false,
      setError(message) { errorEl.textContent = message; },
      open: async () => {},
      close: async () => { dialog.closed = true; backdrop.remove(); },
      dispose: () => { dialog.disposed = true; backdrop.remove(); },
      bindChrome: (callback) => { onChromeClose = callback; },
      requestClose: () => onChromeClose(),
    };
    harness.dialogs.push(dialog);
    return dialog;
  },
}));

vi.mock("../../../../../core/data/settings", () => ({
  getSettings: () => ({ ui: { travelEndpointSplit: { movingFrontEnd: "copy", movingRearStart: "copy" } } }),
  patchSettings: vi.fn(async () => ({ ui: { travelEndpointSplit: { movingFrontEnd: "copy", movingRearStart: "copy" } } })),
}));

vi.mock("../../../../../ui/decoupled-datetime-range-picker", () => ({
  mountDecoupledDateTimeRangePicker: (options: { onChange: (value: DateTimeRangeValue) => void }) => {
    const picker: RangePickerMock = {
      onChange: options.onChange,
      disposed: false,
    };
    harness.rangePickers.push(picker);
    return { dispose: () => { picker.disposed = true; } };
  },
}));

vi.mock("../../../../../ui/decoupled-date-picker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../ui/decoupled-date-picker")>();
  return {
    ...actual,
    mountDecoupledDatePicker: (options: Parameters<typeof actual.mountDecoupledDatePicker>[0]) => {
      if (harness.useRealDateTimePicker) return actual.mountDecoupledDatePicker(options);
      return {
        dispose: () => {},
        setValue: (value: string) => options.onSelect?.(value),
        open: () => options.onOpenChange?.(true),
        close: async () => { options.onOpenChange?.(false); },
      };
    },
  };
});

vi.mock("../../../../../ui/decoupled-datetime-picker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../ui/decoupled-datetime-picker")>();
  return {
    ...actual,
    mountDecoupledDateTimePicker: (options: Parameters<typeof actual.mountDecoupledDateTimePicker>[0]) => {
      if (harness.useRealDateTimePicker) {
        const picker = actual.mountDecoupledDateTimePicker(options);
        harness.actualDateTimePickers.push(picker);
        return picker;
      }
      const picker: DateTimePickerMock = { onChange: options.onChange, disposed: false };
      harness.dateTimePickers.push(picker);
      return { dispose: () => { picker.disposed = true; } };
    },
  };
});

vi.mock("../arrangement-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../arrangement-model")>();
  return {
    ...actual,
    instantForWall: (date: string, minute: number) => {
      const [year, month, day] = date.split("-").map(Number);
      return Date.UTC(year!, month! - 1, day!, Math.floor(minute / 60), minute % 60);
    },
  };
});

afterEach(() => {
  document.body.replaceChildren();
  harness.dialogs.length = 0;
  harness.rangePickers.length = 0;
  harness.dateTimePickers.length = 0;
  harness.actualDateTimePickers.length = 0;
  harness.useRealDateTimePicker = false;
  harness.queryFlight.mockReset();
  harness.queryFlight.mockResolvedValue({ candidates: [], fetchedAtUtc: "2026-10-25T00:00:00Z", queryGeneration: 1 });
  harness.queueAdoptFlight.mockReset();
  harness.queueAppend.mockReset();
  vi.restoreAllMocks();
});

function mountRail(options: {
  saveState?: string;
  currentSnapshot?: TripSnapshot | null;
  editing?: boolean;
  onCreateFirstContent?: (payload: unknown) => Promise<void>;
  loadTrip?: (itemId: string) => Promise<void>;
} = {}) {
  const host = document.createElement("aside");
  document.body.append(host);
  const setEditingSelection = vi.fn();
  const loadTrip = vi.fn((itemId: string) => options.loadTrip?.(itemId) ?? Promise.resolve());
  const state = {
    currentSnapshot: options.currentSnapshot ?? null as TripSnapshot | null,
    saveState: options.saveState ?? "clean",
    queryGeneration: 1,
    expectedDataDir: "test-data",
  };
  const controller = {
    getState: () => state,
    setEditingSelection,
    loadTrip,
    getDraft: vi.fn(() => undefined),
    abandonDrafts: vi.fn(),
    queryFlight: harness.queryFlight,
    queueAdoptFlight: harness.queueAdoptFlight,
    queueAppend: harness.queueAppend,
    setTextDraft: vi.fn(),
    queueTextCommit: vi.fn(),
    queueReopen: vi.fn(),
    setRestoreBaseline: vi.fn(),
    getPlanEditGeneration: () => 0,
  } as unknown as TravelController;
  const rail = mountTravelRail({
    host,
    controller,
    getZone: () => ({ baseOffset: "+00:00", replacements: [] }),
    getDefaultQueryDate: () => "2026-10-25",
    getEditing: () => options.editing ?? false,
    onCreateFirstContent: options.onCreateFirstContent as ((payload: import("../../../../productivity/travel-v2/types").TravelCreatePayload) => Promise<void>) | undefined,
  });
  return { host, rail, controller, setEditingSelection, loadTrip, state };
}

function draftButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>(".travel-rail-draft-add")]
    .find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`Missing draft button: ${label}`);
  return button;
}

function setTripTitle(host: HTMLElement, title: string): void {
  host.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
  const input = host.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
  input.value = title;
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
}

function setRange(value: DateTimeRangeValue): void {
  harness.rangePickers[harness.rangePickers.length - 1]!.onChange(value);
}

function setPoint(value: DateTimeValue): void {
  harness.dateTimePickers[harness.dateTimePickers.length - 1]!.onChange(value);
}

function submit(dialog = harness.dialogs[harness.dialogs.length - 1]!): void {
  dialog.panel.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const actionRange: DateTimeRangeValue = {
  startDate: "2026-10-25",
  startTime: "10:15",
  endDate: "2026-10-25",
  endTime: "11:45",
};

describe("TravelRail first-content draft", () => {
  it("shows all four first-content choices without calling the create boundary", async () => {
    const create = vi.fn(async (_payload: unknown) => {});
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();

    expect([...host.querySelectorAll(".travel-rail-draft-add")].map((button) => button.textContent)).toEqual([
      "添加航班", "添加火车", "添加行程", "添加检查点",
    ]);
    for (const label of ["添加航班", "添加火车", "添加行程", "添加检查点"]) {
      draftButton(host, label).click();
    }

    expect(harness.dialogs.map((dialog) => dialog.title)).toEqual([
      "查询航班", "添加火车", "添加行程", "添加检查点",
    ]);
    expect(harness.dialogs[0]!.body.querySelector(".travel-rail-transport-draft")).toBeNull();
    expect(harness.dialogs[0]!.body.querySelector("input[aria-label='航班号']")?.value).toBe("");
    expect(harness.dialogs[0]!.body.querySelector(".insight-dialog-field > .insight-dialog-label")?.textContent).toBe("航班号");
    expect(create).not.toHaveBeenCalled();
    expect(harness.queryFlight).not.toHaveBeenCalled();
    for (const dialog of harness.dialogs) dialog.requestClose();
    rail.dispose();
  });

  it("reattaches the cached rail before showing a new draft", async () => {
    const { host, rail } = mountRail();
    host.replaceChildren(document.createElement("div"));

    await expect(rail.beginNewTripDraft()).resolves.toBe(true);

    expect(host.querySelector(".travel-rail")).not.toBeNull();
    expect([...host.querySelectorAll(".travel-rail-draft-add")].map((button) => button.textContent)).toEqual([
      "添加航班", "添加火车", "添加行程", "添加检查点",
    ]);
    rail.dispose();
  });

  it("exposes the in-memory draft until the user navigates away", async () => {
    const { host, rail } = mountRail();
    expect(rail.isNewTripDraft()).toBe(false);
    await rail.beginNewTripDraft();
    expect(rail.isNewTripDraft()).toBe(true);
    const draftGeneration = rail.newTripDraftGeneration();
    expect(draftGeneration).not.toBeNull();
    rail.refresh();
    expect(rail.isNewTripDraft()).toBe(true);
    expect(rail.newTripDraftGeneration()).toBe(draftGeneration);
    expect(host.querySelectorAll(".travel-rail-draft-add")).toHaveLength(4);
    rail.setItem(null);
    await flushAsync();
    expect(rail.isNewTripDraft()).toBe(false);
    expect(rail.newTripDraftGeneration()).toBeNull();
    expect(host.querySelectorAll(".travel-rail-draft-add")).toHaveLength(0);
    rail.dispose();
  });

  it("shows separate live flight-number and date controls and creates from the selected candidate", async () => {
    harness.useRealDateTimePicker = true;
    harness.queryFlight.mockResolvedValue({
      candidates: [{ FlightNo: "CA123", FlightCompany: "国航", FlightDepcode: "PEK", FlightArrcode: "SHA",
        FlightDeptimePlanDate: "2026-10-25 10:15:00", FlightArrtimePlanDate: "2026-10-25 11:45:00",
        org_timezone: "0", dst_timezone: "0" }],
      fetchedAtUtc: "2026-10-25T00:00:00Z", queryGeneration: 1,
    });
    const create = vi.fn(async (_payload: unknown) => {});
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    draftButton(host, "添加航班").click();
    const dialog = harness.dialogs[harness.dialogs.length - 1]!;
    const number = dialog.body.querySelector<HTMLInputElement>("input[aria-label='航班号']")!;
    const date = dialog.body.querySelector<HTMLInputElement>("input[aria-label='日期']")!;
    expect(number).not.toBeNull();
    expect(number.value).toBe("");
    expect(date.value).toBe("2026-10-25");
    expect(number.closest(".insight-dialog-field")?.querySelector(".insight-dialog-label")?.textContent).toBe("航班号");
    expect(date.closest(".insight-dialog-field")?.querySelector(".insight-dialog-label")?.textContent).toBe("日期");
    expect(dialog.body.querySelector(".travel-rail-transport-draft")).toBeNull();
    number.value = "CA123";
    submit(dialog);
    await flushAsync();
    expect(harness.queryFlight).toHaveBeenCalledWith({ flightNumber: "CA123", date: "2026-10-25" });
    expect(dialog.body.querySelectorAll(".flight-result-card")).toHaveLength(1);
    (dialog.body.querySelector(".flight-result-card") as HTMLElement).click();
    submit(dialog);
    await flushAsync();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      firstContent: expect.objectContaining({
        kind: "action", plannedStartAt: "2026-10-25T10:15:00Z", plannedEndAt: "2026-10-25T11:45:00Z",
        transportationType: "flight", transportationFields: expect.objectContaining({ serviceNumber: "CA123", operator: "国航" }),
      }),
    }));
    rail.dispose();
  });

  it("uses the same query form for appended flights and blocks a stale trip selection", async () => {
    harness.useRealDateTimePicker = true;
    harness.queryFlight.mockResolvedValue({
      candidates: [
        { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "SHA",
          FlightDeptimePlanDate: "2026-10-25 10:15:00", FlightArrtimePlanDate: "2026-10-25 11:45:00",
          org_timezone: "0", dst_timezone: "0" },
        { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "PVG",
          FlightDeptimePlanDate: "2026-10-25 12:15:00", FlightArrtimePlanDate: "2026-10-25 13:45:00",
          org_timezone: "0", dst_timezone: "0" },
      ],
      fetchedAtUtc: "2026-10-25T00:00:00Z", queryGeneration: 1,
    });
    const snapshot = flightSnapshot();
    snapshot.capabilities.canAppend = true;
    const { host, rail, state } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();
    host.querySelector<HTMLButtonElement>(".travel-rail-add-row button")!.click();
    const dialog = harness.dialogs[harness.dialogs.length - 1]!;
    expect(dialog.body.querySelector(".travel-rail-transport-draft")).toBeNull();
    expect(dialog.body.querySelector<HTMLInputElement>("input[aria-label='航班号']")?.value).toBe("");
    expect(dialog.body.querySelector<HTMLInputElement>("input[aria-label='日期']")?.value).toBe("2026-10-25");
    dialog.body.querySelector<HTMLInputElement>("input[aria-label='航班号']")!.value = "CA123";
    submit(dialog);
    await flushAsync();
    (dialog.body.querySelector(".flight-result-card") as HTMLElement).click();
    submit(dialog);
    await flushAsync();
    expect(harness.queueAppend).toHaveBeenCalledWith("trip-1", expect.objectContaining({
      kind: "flight", plannedStartAt: "2026-10-25T10:15:00Z", plannedEndAt: "2026-10-25T11:45:00Z",
    }));

    host.querySelector<HTMLButtonElement>(".travel-rail-add-row button")!.click();
    const staleDialog = harness.dialogs[harness.dialogs.length - 1]!;
    staleDialog.body.querySelector<HTMLInputElement>("input[aria-label='航班号']")!.value = "CA123";
    submit(staleDialog);
    await flushAsync();
    (staleDialog.body.querySelector(".flight-result-card") as HTMLElement).click();
    state.currentSnapshot = { ...snapshot, item: { ...snapshot.item, revision: 2 } } as TripSnapshot;
    submit(staleDialog);
    await flushAsync();
    expect(harness.queueAppend).toHaveBeenCalledTimes(1);
    rail.dispose();
  });

  it("submits one checkpoint-first create with the edited title only after a valid point time", async () => {
    const create = vi.fn(async (_payload: unknown) => {});
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    setTripTitle(host, "周末出行");
    draftButton(host, "添加检查点").click();
    setPoint({ date: "2026-10-25", time: "09:30" });

    expect(create).not.toHaveBeenCalled();
    submit();
    await flushAsync();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: "周末出行",
      firstContent: expect.objectContaining({ kind: "checkpoint", plannedAtUtc: "2026-10-25T09:30:00Z" }),
    }));
    expect(harness.dialogs[harness.dialogs.length - 1]!.closed).toBe(true);
    expect(harness.dateTimePickers[harness.dateTimePickers.length - 1]!.disposed).toBe(true);
    rail.dispose();
  });

  it("creates a checkpoint from the public single-point picker without an end time", async () => {
    harness.useRealDateTimePicker = true;
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("保存失败"))
      .mockResolvedValueOnce(undefined);
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    draftButton(host, "添加检查点").click();
    const trigger = harness.dialogs[harness.dialogs.length - 1]!.body.querySelector<HTMLInputElement>(".orbita-decoupled-picker-trigger")!;
    const picker = harness.actualDateTimePickers[harness.actualDateTimePickers.length - 1] as { open: () => void };
    picker.open();
    await flushAsync();
    const dateCell = document.querySelector<HTMLButtonElement>(".orbita-date-picker-menu .orbita-mini-cal-cell[data-value]")!;
    const date = dateCell.dataset.value!;
    dateCell.click();
    await new Promise((resolve) => setTimeout(resolve, 230));
    document.querySelector<HTMLButtonElement>('.orbita-time-wheel-menu [data-part="h"][data-value="09"]')!.click();
    document.querySelector<HTMLButtonElement>('.orbita-time-wheel-menu [data-part="m"][data-value="30"]')!.click();
    document.querySelector<HTMLButtonElement>(".orbita-time-wheel-confirm")!.click();
    submit();
    await flushAsync();

    expect(create).toHaveBeenCalledTimes(1);
    expect(harness.dialogs[harness.dialogs.length - 1]!.backdrop.isConnected).toBe(true);
    expect(harness.dialogs[harness.dialogs.length - 1]!.errorEl.textContent).toBe("保存失败");
    expect(trigger.isConnected).toBe(true);
    submit();
    await flushAsync();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toMatchObject({
      firstContent: expect.objectContaining({ kind: "checkpoint", plannedAtUtc: `${date}T09:30:00Z` }),
    });
    expect(create.mock.calls[1]![0]).toMatchObject({
      firstContent: expect.objectContaining({ kind: "checkpoint", plannedAtUtc: `${date}T09:30:00Z` }),
    });
    expect(harness.dialogs[harness.dialogs.length - 1]!.closed).toBe(true);
    rail.dispose();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  it("keeps a single checkpoint time available for retry when first create fails", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("保存失败"))
      .mockResolvedValueOnce(undefined);
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    draftButton(host, "添加检查点").click();
    setPoint({ date: "2026-10-25", time: "09:30" });
    const dialog = harness.dialogs[harness.dialogs.length - 1]!;

    submit(dialog);
    await flushAsync();
    expect(create).toHaveBeenCalledTimes(1);
    expect(dialog.backdrop.isConnected).toBe(true);
    expect(dialog.errorEl.textContent).toBe("保存失败");
    expect(harness.dateTimePickers[harness.dateTimePickers.length - 1]!.disposed).toBe(false);

    submit(dialog);
    await flushAsync();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toMatchObject({
      firstContent: expect.objectContaining({ kind: "checkpoint", plannedAtUtc: "2026-10-25T09:30:00Z" }),
    });
    expect(dialog.closed).toBe(true);
    expect(harness.dateTimePickers[harness.dateTimePickers.length - 1]!.disposed).toBe(true);
    rail.dispose();
  });

  it("submits one action-first create with a validated absolute interval", async () => {
    const create = vi.fn(async (_payload: unknown) => {});
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    draftButton(host, "添加行程").click();
    setRange(actionRange);
    submit();
    await flushAsync();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: "未命名出行",
      firstContent: expect.objectContaining({
        kind: "action",
        plannedStartAt: "2026-10-25T10:15:00Z",
        plannedEndAt: "2026-10-25T11:45:00Z",
      }),
    }));
    expect(harness.dialogs[harness.dialogs.length - 1]!.closed).toBe(true);
    rail.dispose();
  });

  it("rejects an end that is not after the start before create and retains the range", async () => {
    const create = vi.fn(async (_payload: unknown) => {});
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    draftButton(host, "添加行程").click();
    setRange({ ...actionRange, startTime: "11:00", endTime: "10:00" });
    const dialog = harness.dialogs[harness.dialogs.length - 1]!;

    submit(dialog);
    await flushAsync();

    expect(create).not.toHaveBeenCalled();
    expect(dialog.errorEl.textContent).toBe("结束时间必须晚于开始时间");
    expect(dialog.backdrop.isConnected).toBe(true);
    expect(harness.rangePickers[harness.rangePickers.length - 1]!.disposed).toBe(false);

    setRange(actionRange);
    submit(dialog);
    await flushAsync();
    expect(create).toHaveBeenCalledTimes(1);
    rail.dispose();
  });

  it("keeps the title and range after create rejection and retries through the same dialog", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("保存失败"))
      .mockResolvedValueOnce(undefined);
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    setTripTitle(host, "周末出行");
    draftButton(host, "添加行程").click();
    setRange(actionRange);
    const dialog = harness.dialogs[harness.dialogs.length - 1]!;

    submit(dialog);
    await flushAsync();
    expect(dialog.backdrop.isConnected).toBe(true);
    expect(dialog.errorEl.textContent).toBe("保存失败");
    expect(harness.rangePickers[harness.rangePickers.length - 1]!.disposed).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      title: "周末出行",
      firstContent: expect.objectContaining({
        plannedStartAt: "2026-10-25T10:15:00Z",
        plannedEndAt: "2026-10-25T11:45:00Z",
      }),
    });

    submit(dialog);
    await flushAsync();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toMatchObject({
      title: "周末出行",
      firstContent: expect.objectContaining({
        plannedStartAt: "2026-10-25T10:15:00Z",
        plannedEndAt: "2026-10-25T11:45:00Z",
      }),
    });
    expect(dialog.closed).toBe(true);
    rail.dispose();
  });
});

describe("TravelRail point axis", () => {
  it("lights only the completed front half of a shared point", async () => {
    const sharedPoint = {
      pointId: "point-shared", plannedAtUtc: "2026-10-25T10:00:00Z", attachmentKind: "action" as const,
      role: "end" as const, ownerActionId: null, ownerCheckpointId: null, frontActionId: "action-front",
      rearActionId: "action-rear", actionLabel: null, location: null, note: null,
      actualFrontEndAtUtc: "2026-10-25T10:00:00Z", actualRearStartAtUtc: null, actualAtUtc: null,
    };
    const snapshot = {
      item: { id: "trip-1", revision: 1, listId: null, title: "Trip", completed: false, status: "active", cancelled: false },
      profile: { itemId: "trip-1", schemaVersion: 1, cancelledAtUtc: null, createdAtUtc: "", updatedAtUtc: "" },
      actions: [], checkpoints: [], transportations: [], points: [], canonicalPoints: [sharedPoint], segments: [],
      memberRefs: { item: { id: "trip-1", revision: 1 }, actions: [], checkpoints: [] },
      capabilities: { canEditStructure: false, canEditPlan: false, canEditText: true, canChangeTransportationType: false,
        canRecordActual: false, canFinish: false, canCancel: false, canAppend: false },
    } as unknown as TripSnapshot;
    const { host, rail } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();

    const circle = host.querySelector<HTMLElement>(".travel-rail-point-circle")!;
    expect(circle.classList.contains("has-actual")).toBe(false);
    expect(circle.classList.contains("has-partial-actual")).toBe(true);
    expect(circle.querySelector(".travel-rail-actual-half.front.is-lit")).not.toBeNull();
    expect(circle.querySelector(".travel-rail-actual-half.rear.is-lit")).toBeNull();
    rail.dispose();
  });

  it("does not expose transportation type selection when only text editing is allowed", async () => {
    const start = {
      pointId: "start", plannedAtUtc: "2026-10-25T10:00:00Z", attachmentKind: "action" as const,
      role: "start" as const, ownerActionId: "action-1", ownerCheckpointId: null, frontActionId: null,
      rearActionId: "action-1", actionLabel: null, location: null, note: null,
      actualFrontEndAtUtc: null, actualRearStartAtUtc: null, actualAtUtc: null,
    };
    const end = { ...start, pointId: "end", plannedAtUtc: "2026-10-25T11:00:00Z", role: "end" as const,
      ownerActionId: null, frontActionId: "action-1", rearActionId: null };
    const snapshot = {
      item: { id: "trip-1", revision: 1, listId: null, title: "Trip", completed: false, status: "active", cancelled: false },
      profile: { itemId: "trip-1", schemaVersion: 1, cancelledAtUtc: null, createdAtUtc: "", updatedAtUtc: "" },
      actions: [{ id: "action-1", revision: 1, title: "Flight", nameLinkMode: "manual", plannedStartAt: start.plannedAtUtc,
        plannedEndAt: end.plannedAtUtc, ended: false, transportationId: "transport-1",
        actual: { start: { atUtc: null }, end: { atUtc: null }, intervalId: null, closedStartAtUtc: null, closedEndAtUtc: null },
        createdAtUtc: "", updatedAtUtc: "" }], checkpoints: [],
      transportations: [{ id: "transport-1", itemId: "trip-1", schemaVersion: 1, transportationType: "flight",
        name: null, note: null, serviceNumber: "CA123", operator: null, vehicleModel: null, aircraftRegistration: null,
        licensePlate: null, carriage: null, seat: null, departureName: null, arrivalName: null, departureCode: null,
        arrivalCode: null, departureTerminal: null, arrivalTerminal: null, departureGate: null, arrivalGate: null,
        sourceSnapshot: null }],
      points: [], canonicalPoints: [start, end],
      segments: [{ actionId: "action-1", transportationId: "transport-1", plannedStartAt: start.plannedAtUtc, plannedEndAt: end.plannedAtUtc }],
      memberRefs: { item: { id: "trip-1", revision: 1 }, actions: [], checkpoints: [] },
      capabilities: { canEditStructure: false, canEditPlan: false, canEditText: true, canChangeTransportationType: false,
        canRecordActual: false, canFinish: false, canCancel: false, canAppend: false },
    } as unknown as TripSnapshot;
    const { host, rail } = mountRail({ currentSnapshot: snapshot, editing: true });
    rail.setItem("trip-1");
    await flushAsync();

    expect(host.textContent).not.toContain("类型");
    const editableTextField = host.querySelector<HTMLButtonElement>(
      ".travel-rail-flight-number .orbita-inline-text-field__display",
    );
    expect(editableTextField).not.toBeNull();
    expect(editableTextField!.disabled).toBe(false);
    editableTextField!.click();
    expect(host.querySelector(".travel-rail-flight-number .orbita-inline-text-field__input")).not.toBeNull();
    expect(host.querySelector(".travel-rail-segment-fields")).toBeNull();
    expect(host.querySelector(".travel-rail-segment-fields .orbita-select-field")).toBeNull();
    rail.dispose();
  });

  it("renders an untyped checkpoint as one state circle and keeps an empty gap as a non-action connector", async () => {
    const point = (pointId: string, plannedAtUtc: string) => ({
      pointId, plannedAtUtc, attachmentKind: "checkpoint" as const, role: "single" as const,
      ownerActionId: null, ownerCheckpointId: pointId, frontActionId: null, rearActionId: null,
      actionLabel: null, location: null, note: null, actualFrontEndAtUtc: null,
      actualRearStartAtUtc: null, actualAtUtc: null,
    });
    const snapshot = {
      item: { id: "trip-1", revision: 1, listId: null, title: "Trip", completed: false, status: "active", cancelled: false },
      profile: { itemId: "trip-1", schemaVersion: 1, cancelledAtUtc: null, createdAtUtc: "", updatedAtUtc: "" },
      actions: [], checkpoints: [], transportations: [], points: [],
      canonicalPoints: [point("cp-1", "2026-10-25T09:00:00Z"), point("cp-2", "2026-10-25T10:00:00Z")],
      segments: [], memberRefs: { item: { id: "trip-1", revision: 1 }, actions: [], checkpoints: [] },
      capabilities: { canEditStructure: false, canEditPlan: false, canEditText: true, canChangeTransportationType: false,
        canRecordActual: false, canFinish: false, canCancel: false, canAppend: false },
    } as unknown as TripSnapshot;
    const { host, rail } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();

    const circles = host.querySelectorAll(".travel-rail-point-circle");
    expect(circles).toHaveLength(2);
    expect(circles[0]!.querySelector("svg")).toBeNull();
    expect(host.querySelector(".travel-rail-gap")).not.toBeNull();
    expect(host.querySelector(".travel-rail-gap.solid")).toBeNull();
    expect(host.querySelector(".travel-rail-segment")).toBeNull();
    rail.dispose();

    snapshot.canonicalPoints[0].actualAtUtc = "2026-10-25T09:00:00Z";
    snapshot.canonicalPoints[1].actualAtUtc = "2026-10-25T10:00:00Z";
    const completed = mountRail({ currentSnapshot: snapshot });
    completed.rail.setItem("trip-1");
    await flushAsync();
    expect(completed.host.querySelector(".travel-rail-gap.solid")).not.toBeNull();
    expect(completed.host.querySelector(".travel-rail-segment")).toBeNull();
    completed.rail.dispose();
  });

  it("styles completed gap and action connectors solid in the rail stylesheet", () => {
    const css = readFileSync(resolve(process.cwd(), "src/integrations/admin/tabs/task/travel/rail.css"), "utf8");
    expect(css).toMatch(/\.travel-rail-gap::before[\s\S]*?border-left:\s*var\(--travel-rail-axis-width\) dashed/);
    expect(css).toMatch(/\.travel-rail-gap\.solid::before[\s\S]*?border-left-style:\s*solid/);
    expect(css).toMatch(/\.travel-rail-segment-line[\s\S]*?border-left:\s*var\(--travel-rail-axis-width\) dashed/);
    expect(css).toMatch(/\.travel-rail-segment-line\.solid[\s\S]*?border-left-style:\s*solid/);
    expect(css).toMatch(/\.travel-rail-actual-half\.front[\s\S]*?clip-path:\s*inset\(0 50% 0 0\)/);
    expect(css).toMatch(/\.travel-rail-actual-half\.rear[\s\S]*?clip-path:\s*inset\(0 0 0 50%\)/);
  });
});

function flightSnapshot(overrides: { departureCode?: string | null; arrivalCode?: string | null; operator?: string | null } = {}): TripSnapshot {
  const start = {
    pointId: "start", plannedAtUtc: "2026-10-25T10:00:00Z", attachmentKind: "action" as const,
    role: "start" as const, ownerActionId: "action-1", ownerCheckpointId: null, frontActionId: null,
    rearActionId: "action-1", actionLabel: null, location: null, note: null,
    actualFrontEndAtUtc: null, actualRearStartAtUtc: null, actualAtUtc: null,
  };
  const end = { ...start, pointId: "end", plannedAtUtc: "2026-10-25T11:00:00Z", role: "end" as const,
    ownerActionId: null, frontActionId: "action-1", rearActionId: null };
  return {
    item: { id: "trip-1", revision: 1, listId: null, title: "Trip", completed: false, status: "active", cancelled: false },
    profile: { itemId: "trip-1", schemaVersion: 1, cancelledAtUtc: null, createdAtUtc: "", updatedAtUtc: "" },
    actions: [{ id: "action-1", revision: 1, title: "Flight", nameLinkMode: "manual", plannedStartAt: start.plannedAtUtc,
      plannedEndAt: end.plannedAtUtc, ended: false, transportationId: "transport-1",
      actual: { start: { atUtc: null, pendingAtUtc: null }, end: { atUtc: null, pendingAtUtc: null }, intervalId: null, closedStartAtUtc: null, closedEndAtUtc: null },
      createdAtUtc: "", updatedAtUtc: "" }], checkpoints: [],
    transportations: [{ id: "transport-1", itemId: "trip-1", schemaVersion: 1, transportationType: "flight",
      name: null, note: null, serviceNumber: "CA123", operator: overrides.operator ?? "手填航司", vehicleModel: null, aircraftRegistration: null,
      licensePlate: null, carriage: null, seat: null, departureName: null, arrivalName: null,
      departureCode: overrides.departureCode === undefined ? "PEK" : overrides.departureCode,
      arrivalCode: overrides.arrivalCode === undefined ? "SHA" : overrides.arrivalCode,
      departureTerminal: null, arrivalTerminal: null, departureGate: null, arrivalGate: null,
      sourceSnapshot: null }],
    points: [
      { id: "p-start", itemId: "trip-1", schemaVersion: 1, attachmentKind: "action", actionId: "action-1", checkpointId: null, role: "start", actionLabel: "起飞", location: null, note: null, originCheckpointId: null, createdAtUtc: "", updatedAtUtc: "" },
      { id: "p-end", itemId: "trip-1", schemaVersion: 1, attachmentKind: "action", actionId: "action-1", checkpointId: null, role: "end", actionLabel: "降落", location: null, note: null, originCheckpointId: null, createdAtUtc: "", updatedAtUtc: "" },
    ], canonicalPoints: [start, end],
    segments: [{ actionId: "action-1", transportationId: "transport-1", plannedStartAt: start.plannedAtUtc, plannedEndAt: end.plannedAtUtc }],
    memberRefs: { item: { id: "trip-1", revision: 1 }, actions: [], checkpoints: [] },
    capabilities: { canEditStructure: false, canEditPlan: true, canEditText: true, canChangeTransportationType: false,
      canRecordActual: true, canFinish: false, canCancel: false, canAppend: false },
  } as unknown as TripSnapshot;
}

describe("TravelRail flight refresh", () => {
  it.each([["bus", "线路", "serviceNumber"], ["metro", "线路", "serviceNumber"], ["taxi", "备注", "note"], ["bike", "备注", "note"], ["walk", "备注", "note"]] as const)("places the %s field beside its type without duplication", async (type, placeholder, key) => {
    const snapshot = flightSnapshot();
    snapshot.transportations[0]!.transportationType = type;
    snapshot.transportations[0]!.serviceNumber = null;
    snapshot.capabilities.canChangeTransportationType = true;
    const { host, rail, controller } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();
    const heading = host.querySelector<HTMLElement>(".travel-rail-segment-heading")!;
    expect(heading.querySelector(".travel-rail-segment-name.is-empty")?.textContent).toContain(placeholder);
    expect(host.querySelector(".travel-rail-segment-fields")).toBeNull();
    expect(host.querySelectorAll(`[data-travel-field="transportation:transport-1:${key}"]`)).toHaveLength(0);
    heading.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    const input = heading.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    input.value = "123路";
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(heading.querySelector(".travel-rail-segment-name")?.classList.contains("is-empty")).toBe(false);
    expect(controller.queueTextCommit).toHaveBeenCalled();
    rail.dispose();
  });
  it("uses the text above duration as the only transportation type selector", async () => {
    const snapshot = flightSnapshot();
    snapshot.transportations[0]!.transportationType = "train";
    snapshot.capabilities.canChangeTransportationType = true;
    const { host, rail, controller } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();
    const trigger = host.querySelector<HTMLButtonElement>("button.travel-rail-segment-type")!;
    expect(trigger.textContent).toBe("火车");
    expect(trigger.parentElement?.nextElementSibling?.classList.contains("travel-rail-segment-duration")).toBe(true);
    expect(host.querySelector(".travel-rail-segment-fields .orbita-select-field")).toBeNull();
    trigger.click();
    await flushAsync();
    const option = [...document.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")].find((el) => el.textContent?.includes("步行"));
    expect(option).toBeDefined();
    option!.click();
    expect(controller.queueTextCommit).toHaveBeenCalled();
    rail.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  });
  it("reopens a completed trip when its completion checkbox is clicked", async () => {
    const snapshot = flightSnapshot();
    snapshot.item.completed = true;
    const { host, rail, controller } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();
    const checkbox = host.querySelector<HTMLButtonElement>('[aria-label="撤销完成"]');
    expect(checkbox?.disabled).toBe(false);
    checkbox!.click();
    expect(controller.queueReopen).toHaveBeenCalledWith("trip-1");
    rail.dispose();
  });
  it("shows a refresh control on existing flights and removes the old query UI", async () => {
    const { host, rail } = mountRail({ currentSnapshot: flightSnapshot() });
    rail.setItem("trip-1");
    await flushAsync();
    expect(host.querySelector(".travel-rail-flight-refresh, [aria-label='刷新航班']")).not.toBeNull();
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "查询航班")).toBe(false);
    expect(host.querySelector(".travel-rail-flight-query")).toBeNull();
    rail.dispose();
  });

  it("opens a first-add query dialog with only number and date, then lets the user pick among segments", async () => {
    harness.queryFlight.mockResolvedValue({
      candidates: [
        { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "SHA",
          FlightDeptimePlanDate: "2026-10-25 10:15:00", FlightArrtimePlanDate: "2026-10-25 11:45:00", org_timezone: "0", dst_timezone: "0" },
        { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "PVG",
          FlightDeptimePlanDate: "2026-10-25 12:15:00", FlightArrtimePlanDate: "2026-10-25 13:45:00", org_timezone: "0", dst_timezone: "0" },
      ],
      fetchedAtUtc: "2026-10-25T00:00:00Z",
      queryGeneration: 1,
    });
    const create = vi.fn(async (_payload: unknown) => {});
    const { host, rail } = mountRail({ onCreateFirstContent: create });
    await rail.beginNewTripDraft();
    draftButton(host, "添加航班").click();
    const queryDialog = harness.dialogs[0]!;
    queryDialog.body.querySelector<HTMLInputElement>("input[aria-label='航班号']")!.value = "CA123";
    submit(queryDialog);
    await flushAsync();
    expect(queryDialog.body.querySelectorAll(".flight-result-card")).toHaveLength(2);
    expect(create).not.toHaveBeenCalled();
    (queryDialog.body.querySelector(".flight-result-card") as HTMLElement).click();
    submit(queryDialog);
    await flushAsync();
    expect(queryDialog.closed).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    rail.dispose();
  });

  it("confirms unique IATA diffs with selectedFields and writes nothing on cancel", async () => {
    harness.queryFlight.mockResolvedValue({
      candidates: [{
        FlightNo: "CA123",
        FlightCompany: "国航",
        FlightDepcode: "PEK",
        FlightArrcode: "SHA",
        FlightDeptimePlanDate: "2026-10-25 18:00:00",
        FlightArrtimePlanDate: "2026-10-25 20:00:00",
        org_timezone: "0",
        dst_timezone: "0",
      }],
      fetchedAtUtc: "2026-10-25T00:00:00Z",
      queryGeneration: 1,
    });
    const snapshot = flightSnapshot();
    const { host, rail } = mountRail({ currentSnapshot: snapshot });
    rail.setItem("trip-1");
    await flushAsync();
    host.querySelector<HTMLButtonElement>("[aria-label='刷新航班']")!.click();
    await flushAsync();
    const diff = harness.dialogs.find((dialog) => dialog.title === "确认更新航班")!;
    diff.requestClose();
    expect(harness.queueAdoptFlight).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>("[aria-label='刷新航班']")!.click();
    await flushAsync();
    const confirm = harness.dialogs.find((dialog) => dialog.title === "确认更新航班" && !dialog.closed)!;
    submit(confirm);
    expect(harness.queueAdoptFlight).toHaveBeenCalledWith("trip-1", expect.objectContaining({
      selectedFields: expect.arrayContaining(["operator"]),
    }));
    rail.dispose();
  });

  it("shows the up-to-date message without adopting when there is no mapped diff", async () => {
    harness.queryFlight.mockResolvedValue({
      candidates: [{
        FlightNo: "CA123",
        FlightCompany: "手填航司",
        FlightDepcode: "PEK",
        FlightArrcode: "SHA",
        transportationType: "flight",
      }],
      fetchedAtUtc: "2026-10-25T00:00:00Z",
      queryGeneration: 1,
    });
    const { host, rail } = mountRail({ currentSnapshot: flightSnapshot() });
    rail.setItem("trip-1");
    await flushAsync();
    host.querySelector<HTMLButtonElement>("[aria-label='刷新航班']")!.click();
    await flushAsync();
    expect(harness.dialogs.some((dialog) => dialog.body.textContent?.includes("当前信息已是最新"))).toBe(true);
    expect(harness.queueAdoptFlight).not.toHaveBeenCalled();
    rail.dispose();
  });

  it("does not auto-pick zero or multiple IATA matches", async () => {
    const { host, rail } = mountRail({ currentSnapshot: flightSnapshot() });
    rail.setItem("trip-1");
    await flushAsync();
    harness.queryFlight.mockResolvedValueOnce({
      candidates: [{ FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "CAN" }],
      fetchedAtUtc: "2026-10-25T00:00:00Z",
      queryGeneration: 1,
    });
    host.querySelector<HTMLButtonElement>("[aria-label='刷新航班']")!.click();
    await flushAsync();
    expect(harness.dialogs.at(-1)?.body.textContent).toContain("没有与当前起降机场三字码匹配");

    harness.queryFlight.mockResolvedValueOnce({
      candidates: [
        { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "SHA" },
        { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "SHA", FlightHTerminal: "T2" },
      ],
      fetchedAtUtc: "2026-10-25T00:00:00Z",
      queryGeneration: 1,
    });
    host.querySelector<HTMLButtonElement>("[aria-label='刷新航班']")!.click();
    await flushAsync();
    expect(harness.dialogs.at(-1)?.body.textContent).toContain("找到多条匹配航段");
    expect(harness.queueAdoptFlight).not.toHaveBeenCalled();
    rail.dispose();
  });

  it("does not adopt if query context changes before confirm", async () => {
    harness.queryFlight.mockResolvedValue({
      candidates: [{
        FlightNo: "CA123",
        FlightCompany: "国航",
        FlightDepcode: "PEK",
        FlightArrcode: "SHA",
        FlightDeptimePlanDate: "2026-10-25 18:00:00",
        FlightArrtimePlanDate: "2026-10-25 20:00:00",
        org_timezone: "0",
        dst_timezone: "0",
      }],
      fetchedAtUtc: "2026-10-25T00:00:00Z",
      queryGeneration: 1,
    });
    const { host, rail, state } = mountRail({ currentSnapshot: flightSnapshot() });
    rail.setItem("trip-1");
    await flushAsync();
    host.querySelector<HTMLButtonElement>("[aria-label='刷新航班']")!.click();
    await flushAsync();
    state.queryGeneration = 2;
    submit(harness.dialogs.find((dialog) => dialog.title === "确认更新航班" && !dialog.closed)!);
    expect(harness.queueAdoptFlight).not.toHaveBeenCalled();
    expect(harness.dialogs.some((dialog) => dialog.body.textContent?.includes("请重新刷新"))).toBe(true);
    rail.dispose();
  });
});

describe("TravelRail pending leave guards", () => {
  it("does not let a pending draft guard override a newer selected item", async () => {
    const pendingLoad = () => new Promise<void>(() => {});
    const { rail, setEditingSelection, loadTrip } = mountRail({ saveState: "dirty", loadTrip: pendingLoad });
    rail.setItem("old-item");
    await flushAsync();
    const draftStart = rail.beginNewTripDraft();
    const draftGuard = harness.dialogs[harness.dialogs.length - 1]!;
    rail.setItem("new-item");
    const selectionGuard = harness.dialogs[harness.dialogs.length - 1]!;

    submit(draftGuard);
    submit(selectionGuard);
    await expect(draftStart).resolves.toBe(false);
    await flushAsync();

    expect(setEditingSelection.mock.calls[setEditingSelection.mock.calls.length - 1]).toEqual([{ itemId: "new-item" }]);
    expect(loadTrip.mock.calls.map(([itemId]) => itemId)).toEqual(["old-item", "new-item"]);
    rail.dispose();
  });

  it("does not resume a pending selection guard after dispose", async () => {
    const pendingLoad = () => new Promise<void>(() => {});
    const { rail, setEditingSelection, loadTrip } = mountRail({ saveState: "dirty", loadTrip: pendingLoad });
    rail.setItem("old-item");
    await flushAsync();
    rail.setItem("stale-item");
    const guard = harness.dialogs[harness.dialogs.length - 1]!;
    const loadCountBeforeDispose = loadTrip.mock.calls.length;

    rail.dispose();
    expect(guard.backdrop.isConnected).toBe(false);
    submit(guard);
    await flushAsync();

    expect(loadTrip.mock.calls).toHaveLength(loadCountBeforeDispose);
    expect(setEditingSelection.mock.calls).toEqual([[{ itemId: "old-item" }]]);
  });
});
