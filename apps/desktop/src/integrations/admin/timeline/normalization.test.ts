import { afterEach, describe, expect, it, vi } from "vitest";
import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { dateTimeToUnix, unixToLocal } from "../tabs/health/format";
import { bindMaskedInput } from "../../../ui/decoupled-picker-mask";
import { drawSharedGrid } from "../tabs/health/tracks";
import { observeTimelineTheme } from "./theme";
import { mountActionTracksView } from "./action-tracks-view";
import { mountSearchableSelectPopover } from "../../../ui/searchable-select-popover";

const writes = vi.hoisted(() => ({ action: vi.fn(), session: vi.fn() }));
vi.mock("../../productivity/client", () => ({
  productivityCreateAction: writes.action, productivityCreateSession: writes.session,
  productivityListActions: vi.fn(async () => ({ actions: [] })),
  productivityListSessions: vi.fn(async () => ({ sessions: [] })),
  productivityListProjects: vi.fn(async () => ({ projects: [] })),
  productivityListItems: vi.fn(async () => ({ items: [] })),
  ...Object.fromEntries([
    "productivityAssignActionToSession", "productivityClearActionTarget", "productivityDeleteAction",
    "productivityDeleteSessionOnly", "productivityMoveActionToSession", "productivityRemoveActionFromSession",
    "productivitySetActionTarget", "productivityUpdateAction", "productivityUpdateSession",
  ].map((name) => [name, vi.fn()])),
}));
vi.mock("../../../ui/motion", () => ({
  bindDialog: () => ({ open: async () => {}, close: async () => {} }),
  openPopover: async () => {}, closePopover: async () => {}, isPopoverOpen: () => false,
}));
vi.mock("../tabs/item-compose", () => ({ mountActionExecButtons: vi.fn() }));

// Keep these regressions independent of portal animation and layout measurement.
vi.mock("../../../ui/popover-portal", () => ({
  mountPopoverPortal: (options: {
    popover: HTMLElement;
    onOpenChange?: (open: boolean) => void;
  }) => {
    document.body.appendChild(options.popover);
    let opened = false;
    return {
      isOpen: () => opened,
      open: async () => { opened = true; options.onOpenChange?.(true); },
      close: async () => { opened = false; options.onOpenChange?.(false); },
      dispose: () => options.popover.remove(),
    };
  },
}));

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-insight-theme");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  writes.action.mockReset();
  writes.session.mockReset();
});

describe("Timeline creation remains confirmation-only", () => {
  function openDraft(session: boolean) {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    }) as unknown as CanvasRenderingContext2D);
    const host = document.createElement("div");
    host.className = "timeline-app";
    const root = document.createElement("article");
    host.appendChild(root);
    document.body.appendChild(host);
    const ac = new AbortController();
    const value = {
      selectedDate: "2026-10-11",
      fromUtc: dateTimeToUnix("2026-10-11", "08:00"),
      toUtc: dateTimeToUnix("2026-10-11", "12:00"),
    };
    const handle = mountActionTracksView(root, {
      signal: ac.signal,
      clock: { get: () => value, set: vi.fn(), subscribe: () => () => {} },
    });
    cleanup.push(() => { ac.abort(); handle.dispose(); });
    const lanes = root.querySelector<HTMLElement>('[data-region="lanes"]')!;
    Object.defineProperty(lanes, "clientWidth", { value: 500 });
    Object.defineProperty(lanes, "clientHeight", { value: 180 });
    lanes.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 180, right: 500, bottom: 180, x: 0, y: 0, toJSON() {} });
    lanes.setPointerCapture = vi.fn();
    lanes.releasePointerCapture = vi.fn();
    lanes.hasPointerCapture = () => true;
    for (const [type, x] of [["pointerdown", 170], ["pointermove", 280], ["pointerup", 280]] as const) {
      const event = new MouseEvent(type, { clientX: x, clientY: 20, button: 0, ctrlKey: session, bubbles: true });
      Object.defineProperty(event, "pointerId", { value: 1 });
      lanes.dispatchEvent(event);
    }
    const form = document.querySelector<HTMLFormElement>(".action-dialog-panel")!;
    expect(form).not.toBeNull();
    return form;
  }

  it.each([false, true])("canceling a %s Session draft performs zero Create calls", (session) => {
    const form = openDraft(session);
    form.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(writes.action).not.toHaveBeenCalled();
    expect(writes.session).not.toHaveBeenCalled();
    expect(document.querySelector(".action-dialog-panel")).toBeNull();
  });

  it.each([false, true])("saving a %s Session draft sends the displayed Shanghai times", async (session) => {
    const form = openDraft(session);
    const input = (region: string) => form.querySelector<HTMLInputElement>(`[data-region="${region}"] input`)!;
    typeDigits(input("start-date"), "20261011");
    typeDigits(input("start-time"), "2357");
    typeDigits(input("end-date"), "20261012");
    typeDigits(input("end-time"), "0007");
    expect(writes.action).not.toHaveBeenCalled();
    expect(writes.session).not.toHaveBeenCalled();
    const write = session ? writes.session : writes.action;
    write.mockRejectedValue(new Error("Isolated backend boundary"));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      plannedStartAt: "2026-10-11T15:57:00.000Z",
      plannedEndAt: "2026-10-11T16:07:00.000Z",
    }));
  });
});

function mountTime(value: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const handle = mountDecoupledTimePicker({ defaultTrigger: { container }, value, onChange });
  cleanup.push(handle.dispose);
  return { handle, onChange, input: container.querySelector<HTMLInputElement>("input")! };
}

function confirmTime() {
  document.querySelector<HTMLButtonElement>(".orbita-time-panel-confirm")!.click();
}

function typeDigits(input: HTMLInputElement, value: string) {
  input.setSelectionRange(0, 0);
  for (const digit of value.replace(/\D/g, "")) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: digit, bubbles: true }));
  }
}

function eraseDigits(input: HTMLInputElement, positions: number[]) {
  for (const position of positions) {
    input.setSelectionRange(position, position);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  }
}

describe("Timeline date/time migration preserves draft semantics", () => {
  it("does not quantize an existing arbitrary minute when opening and confirming", () => {
    const { handle, onChange } = mountTime("09:07");
    handle.open();
    confirmTime();
    expect(handle.getValue()).toBe("09:07");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps an empty time empty when opening and confirming without wheel interaction", () => {
    const { handle, onChange } = mountTime("");
    handle.open();
    confirmTime();
    expect(handle.getValue()).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a complete manually typed minute when confirming an already open menu", () => {
    const { handle, input } = mountTime("09:00");
    handle.open();
    typeDigits(input, "1043");
    expect(handle.getValue()).toBe("10:43");
    confirmTime();
    expect(handle.getValue()).toBe("10:43");
  });

  it("commits the five-minute wheel choice only on confirmation", () => {
    const { handle, onChange } = mountTime("09:07");
    handle.open();
    document.querySelector<HTMLButtonElement>('.orbita-time-wheel-item[data-part="m"][data-value="15"]')!.click();
    expect(handle.getValue()).toBe("09:07");
    expect(onChange).not.toHaveBeenCalled();
    confirmTime();
    expect(handle.getValue()).toBe("09:15");
    expect(onChange).toHaveBeenLastCalledWith("09:15");
  });

  it("discards an unconfirmed wheel choice on close", async () => {
    const { handle, input, onChange } = mountTime("09:07");
    handle.open();
    document.querySelector<HTMLButtonElement>('.orbita-time-wheel-item[data-part="m"][data-value="30"]')!.click();
    await handle.close();
    expect(handle.getValue()).toBe("09:07");
    expect(input.value).toBe("09:07");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("publishes a cleared time without restoring the old value on confirmation", () => {
    const { handle, input, onChange } = mountTime("09:07");
    handle.open();
    eraseDigits(input, [0, 1, 3, 4]);
    expect(handle.getValue()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
    confirmTime();
    expect(handle.getValue()).toBe("");
  });

  it("does not publish illegal minutes", () => {
    const { handle, input, onChange } = mountTime("09:07");
    typeDigits(input, "0960");
    input.dispatchEvent(new Event("blur"));
    expect(handle.getValue()).toBe("09:07");
    expect(input.value).toBe("09:07");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["Backspace", "Delete"])("allows clearing a whole selected time with %s", (key) => {
    const { handle, input, onChange } = mountTime("09:07");
    input.setSelectionRange(0, input.value.length);
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(input.value).toBe("");
    expect(handle.getValue()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("deletes a partial selection across the colon without removing the colon or committing an incomplete time", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const onCommit = vi.fn(() => true);
    const mask = bindMaskedInput(input, { kind: "time", value: "09:07", placeholder: "HH:mm", onCommit });
    cleanup.push(mask.dispose);
    input.setSelectionRange(1, 4);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(input.value[2]).toBe(":");
    expect(input.value[0]).toBe("0");
    expect(input.value[4]).toBe("7");
    expect(onCommit).not.toHaveBeenCalled();
    input.dispatchEvent(new Event("blur"));
    expect(input.value).toBe("09:07");
  });

  it("keeps a date clear when Enter closes an already open calendar", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onChange = vi.fn();
    const handle = mountDecoupledDatePicker({ defaultTrigger: { container }, value: "2026-10-11", onChange });
    cleanup.push(handle.dispose);
    handle.open();
    const input = container.querySelector<HTMLInputElement>("input")!;
    eraseDigits(input, [0, 1, 2, 3, 5, 6, 8, 9]);
    expect(handle.getValue()).toBe("");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handle.getValue()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("continues interpreting a cross-day draft in Shanghai business time", () => {
    const start = dateTimeToUnix("2026-10-11", "23:57");
    const end = dateTimeToUnix("2026-10-12", "00:07");
    expect(new Date(start * 1000).toISOString()).toBe("2026-10-11T15:57:00.000Z");
    expect(end - start).toBe(10 * 60);
    expect(unixToLocal(end)).toEqual({ date: "2026-10-12", time: "00:07" });
  });
});

describe("Timeline canvas theme isolation", () => {
  function draw(timeline: boolean) {
    const host = document.createElement("div");
    if (timeline) host.className = "timeline-app";
    const canvas = document.createElement("canvas");
    canvas.style.setProperty("--insight-border-subtle", "#123456");
    canvas.style.setProperty("--insight-text-secondary", "#654321");
    canvas.style.setProperty("--insight-font-role-label", "12px");
    canvas.style.setProperty("--insight-weight-regular", "400");
    canvas.style.setProperty("--insight-weight-semibold", "600");
    host.appendChild(canvas);
    document.body.appendChild(host);
    const labels: Array<{ color: unknown; font: unknown }> = [];
    const ctx = {
      canvas, strokeStyle: "", fillStyle: "", font: "", lineWidth: 0,
      textBaseline: "alphabetic", clearRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      fillText() { labels.push({ color: this.fillStyle, font: this.font }); },
    };
    drawSharedGrid(ctx as unknown as CanvasRenderingContext2D, dateTimeToUnix("2026-10-11", "09:00"), dateTimeToUnix("2026-10-11", "11:00"), 500, 100);
    return { ctx, labels, host };
  }

  it("uses current theme values on the Timeline canvas", () => {
    document.documentElement.setAttribute("data-insight-theme", "cold");
    const { ctx, labels } = draw(true);
    expect(ctx.strokeStyle).toBe("#123456");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.color === "#654321")).toBe(true);
    expect(labels.every((label) => String(label.font).includes("12px"))).toBe(true);
  });

  it("keeps the existing Health canvas styling even inside an Insight document", () => {
    document.documentElement.setAttribute("data-insight-theme", "cold");
    const { ctx, labels } = draw(false);
    expect(ctx.strokeStyle).toBe("rgba(15, 23, 42, 0.045)");
    expect(labels.some((label) => label.color === "rgba(107, 114, 128, 0.38)")).toBe(true);
    expect(labels.every((label) => String(label.font).includes("10px system-ui"))).toBe(true);
  });

  it("leaves a Panel document on its existing styling", () => {
    const { ctx } = draw(true);
    expect(ctx.strokeStyle).toBe("rgba(15, 23, 42, 0.045)");
  });

  it("repaints after a palette change and disconnects on disposal", async () => {
    document.documentElement.setAttribute("data-insight-theme", "cold");
    const { host } = draw(true);
    const repaint = vi.fn();
    const dispose = observeTimelineTheme(host, repaint);
    document.documentElement.style.setProperty("--insight-text-secondary", "#112233");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repaint).toHaveBeenCalled();
    repaint.mockClear();
    dispose();
    document.documentElement.style.setProperty("--insight-text-secondary", "#334455");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repaint).not.toHaveBeenCalled();
  });
});

describe("Timeline target menu isolation", () => {
  it("opts into a local portal class while leaving other callers unchanged and removing both on dispose", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const options = { anchor, options: [{ value: "one", label: "Task" }], selected: new Set<string>(), onChange: vi.fn() };
    const ordinary = mountSearchableSelectPopover(options);
    const local = mountSearchableSelectPopover({ ...options, className: "timeline-target-regression" });
    cleanup.push(ordinary.dispose, local.dispose);
    const menus = [...document.querySelectorAll<HTMLElement>(".orbita-searchable-select")];
    expect(menus).toHaveLength(2);
    expect(menus.filter((menu) => menu.classList.contains("timeline-target-regression"))).toHaveLength(1);
    ordinary.dispose();
    local.dispose();
    expect(document.querySelector(".orbita-searchable-select")).toBeNull();
  });
});
