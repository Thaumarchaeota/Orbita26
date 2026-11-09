import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountDecoupledDateTimeRangePicker } from "./decoupled-datetime-range-picker";
import type { DateTimeRangeValue } from "./datetime-range-display";

type PortalCapture = { placement?: string };
const portalCapture: PortalCapture = {};

type ChildHandle = {
  getInputDisplay: () => string;
  setValue: (v: string) => void;
  setDraft: (v: string) => void;
  open: () => void;
  close: () => Promise<void>;
  dispose: () => void;
};

const dateMounts: ChildHandle[] = [];
const timeMounts: ChildHandle[] = [];

vi.mock("./popover-portal", () => ({
  mountPopoverPortal: (opts: { placement?: string; popover: HTMLElement; onOpenChange?: (open: boolean) => void }) => {
    portalCapture.placement = opts.placement;
    let open = false;
    return {
      open: async () => {
        open = true;
        document.body.appendChild(opts.popover);
        opts.onOpenChange?.(true);
      },
      close: async () => {
        open = false;
        opts.popover.remove();
        opts.onOpenChange?.(false);
      },
      isOpen: () => open,
      dispose: () => {
        open = false;
        opts.popover.remove();
      },
    };
  },
}));

vi.mock("./decoupled-date-picker", () => ({
  mountDecoupledDatePicker: (opts: { value?: string; onChange?: (v: string) => void }) => {
    let current = opts.value ?? "";
    const handle: ChildHandle = {
      getInputDisplay: () => current,
      open: () => {},
      close: async () => {},
      setValue: (next) => {
        current = next;
      },
      setDraft: (next) => {
        current = next;
        opts.onChange?.(next);
      },
      dispose: () => {},
    };
    dateMounts.push(handle);
    return handle;
  },
}));

vi.mock("./decoupled-time-picker", () => ({
  mountDecoupledTimePicker: (opts: { value?: string; onChange?: (v: string) => void }) => {
    let current = opts.value ?? "";
    const handle: ChildHandle = {
      getInputDisplay: () => current,
      open: () => {},
      close: async () => {},
      setValue: (next) => {
        current = next;
      },
      setDraft: (next) => {
        current = next;
        opts.onChange?.(next);
      },
      dispose: () => {},
    };
    timeMounts.push(handle);
    return handle;
  },
}));

vi.mock("./datetime-range-display", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./datetime-range-display")>();
  return {
    ...actual,
    shanghaiYmd: () => "2026-10-15",
  };
});

function mountWithValue(value: DateTimeRangeValue) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const changes: DateTimeRangeValue[] = [];
  const handle = mountDecoupledDateTimeRangePicker({
    defaultTrigger: { container },
    value,
    onChange: (next) => changes.push({ ...next }),
  });
  const trigger = container.querySelector("button")!;
  const popover = () => document.body.querySelector(".orbita-datetime-range-popover") as HTMLElement;
  const confirm = () => popover().querySelector<HTMLButtonElement>(".orbita-datetime-range-confirm")!.click();
  const clear = () => popover().querySelector<HTMLButtonElement>(".orbita-datetime-range-clear")!.click();
  return { handle, trigger, popover, confirm, clear, changes };
}

describe("decoupled datetime range picker (review)", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    portalCapture.placement = undefined;
    dateMounts.length = 0;
    timeMounts.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses the default popover placement instead of pinning left", () => {
    const container = document.createElement("div");
    const handle = mountDecoupledDateTimeRangePicker({
      defaultTrigger: { container },
      value: {
        startDate: "2026-10-15",
        startTime: "09:00",
        endDate: "2026-10-15",
        endTime: "18:00",
      },
    });
    expect(portalCapture.placement).toBeUndefined();
    handle.dispose();
  });

  it("uses a non-editable button trigger styled like decoupled pickers", () => {
    const { handle, trigger } = mountWithValue({
      startDate: "2026-10-15",
      startTime: "09:00",
      endDate: "2026-10-15",
      endTime: "18:00",
    });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.querySelector("input")).toBeNull();
    expect(trigger.className).toContain("orbita-decoupled-picker-trigger");
    expect(trigger.className).toContain("orbita-decoupled-picker-trigger--datetime-range");
    expect(trigger.textContent).toBe("09:00-18:00");
    handle.dispose();
  });

  it("does not commit when confirm is pressed with a partial draft", async () => {
    const { handle, changes, confirm } = mountWithValue({
      startDate: "2026-10-15",
      startTime: "09:00",
      endDate: "2026-10-15",
      endTime: "18:00",
    });
    await handle.open();
    dateMounts[0]!.setDraft("2026-10-16");
    timeMounts[0]!.setDraft("10:00");
    dateMounts[1]!.setDraft("");
    timeMounts[1]!.setDraft("");
    confirm();
    expect(changes).toHaveLength(0);
    expect(handle.getValue().endDate).toBe("2026-10-15");
    handle.dispose();
  });

  it("clears committed value when confirm is pressed with an all-empty draft", async () => {
    const { handle, changes, confirm, trigger } = mountWithValue({
      startDate: "2026-10-15",
      startTime: "09:00",
      endDate: "2026-10-15",
      endTime: "18:00",
    });
    await handle.open();
    for (const child of [...dateMounts, ...timeMounts]) child.setDraft("");
    confirm();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
    });
    expect(trigger.textContent).toBe("选择时间");
    handle.dispose();
  });

  it("commits a complete draft on confirm", async () => {
    const { handle, changes, confirm, trigger } = mountWithValue({
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
    });
    await handle.open();
    dateMounts[0]!.setDraft("2026-10-15");
    timeMounts[0]!.setDraft("09:00");
    dateMounts[1]!.setDraft("2026-10-15");
    timeMounts[1]!.setDraft("18:00");
    confirm();
    expect(changes).toHaveLength(1);
    expect(trigger.textContent).toBe("09:00-18:00");
    handle.dispose();
  });

  it("clears via the foot clear button", async () => {
    const { handle, changes, clear, trigger } = mountWithValue({
      startDate: "2026-10-15",
      startTime: "09:00",
      endDate: "2026-10-15",
      endTime: "18:00",
    });
    await handle.open();
    clear();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.startDate).toBe("");
    expect(trigger.textContent).toBe("选择时间");
    handle.dispose();
  });
});
