import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shanghaiIsoDate } from "../core/shanghai-date";
import { mountDecoupledDatePicker } from "./decoupled-date-picker";
import { mountDecoupledDateRangePicker } from "./decoupled-date-range-picker";
import { mountDecoupledDateTimePicker } from "./decoupled-datetime-picker";
import { mountDecoupledTimePicker } from "./decoupled-time-picker";
import {
  DECOUPLED_MASK_CHARS,
  DECOUPLED_MASK_TEMPLATE,
  bindMaskedInput,
  isValidMaskDisplay,
} from "./decoupled-picker-mask";
import { mountDecoupledPickerTrigger } from "./decoupled-picker-trigger";
import { bindDecoupledTimeWheels, buildDecoupledTimeWheelsHtml } from "./decoupled-time-wheels";

describe("decoupled editable default trigger", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a masked input with kind class, fixed size, and dialog popup semantics", () => {
    const container = document.createElement("div");
    const handle = mountDecoupledPickerTrigger(
      { defaultTrigger: { container, className: "extra" } },
      "2026-10-11",
      { kind: "datetime", onCommit: () => true },
    );

    expect(handle.anchor.tagName).toBe("INPUT");
    expect(handle.anchor.className).toContain("orbita-decoupled-picker-trigger--datetime");
    expect(handle.anchor.className).toContain("extra");
    expect(handle.anchor.getAttribute("size")).toBe(String(DECOUPLED_MASK_CHARS.datetime));
    expect(handle.anchor.getAttribute("aria-haspopup")).toBe("dialog");
    expect(handle.anchor.getAttribute("aria-label")).toBe("日期时间");
    handle.dispose();
  });

  it("opens the picker on pointerdown via bindOpen", () => {
    const container = document.createElement("div");
    const handle = mountDecoupledPickerTrigger(
      { defaultTrigger: { container } },
      "09:30",
      { kind: "time", onCommit: () => true },
    );
    let opens = 0;
    handle.bindOpen(() => {
      opens += 1;
    });
    handle.anchor.dispatchEvent(new Event("pointerdown"));
    expect(opens).toBe(1);
    handle.dispose();
  });

  it("does not register bindOpen wiring for caller-owned anchors", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const handle = mountDecoupledPickerTrigger({ anchor }, "ignored");
    let opens = 0;
    handle.bindOpen(() => {
      opens += 1;
    });
    anchor.click();
    expect(opens).toBe(0);
    handle.dispose();
  });

  it("keeps the time colon when deleting at or after it", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const mask = bindMaskedInput(input, {
      kind: "time",
      value: "09:30",
      onCommit: () => true,
    });

    input.setSelectionRange(3, 3);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(input.value).toMatch(/^09:/);

    input.setSelectionRange(2, 2);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(input.value).toMatch(/:/);

    mask.dispose();
  });

  it("reverts invalid typed display on blur to the last committed value", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const mask = bindMaskedInput(input, {
      kind: "date",
      value: "2026-10-11",
      onCommit: () => true,
    });

    for (const digit of "9999") {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: digit, bubbles: true }));
    }
    expect(input.value).not.toBe("2026-10-11");
    input.dispatchEvent(new FocusEvent("blur"));
    expect(input.value).toBe("2026-10-11");

    mask.dispose();
  });

  it("uses em dash without spaces for range and one space for datetime (assumptions 1–2)", () => {
    const rangeTpl = DECOUPLED_MASK_TEMPLATE.range;
    expect(rangeTpl).toContain("—");
    expect(rangeTpl).not.toContain(" — ");
    expect(rangeTpl.split("—").length).toBe(2);
    expect(DECOUPLED_MASK_TEMPLATE.datetime).toBe("####-##-## ##:##");
    expect(isValidMaskDisplay("range", "2026-10-11-2026-10-18")).toBe(false);
    expect(isValidMaskDisplay("range", "2026-10-11—2026-10-18")).toBe(true);
    expect(isValidMaskDisplay("datetime", "2026-10-11 09:30")).toBe(true);
  });

  it("fills empty date, range, and time from the Shanghai clock; a datetime point stays empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:34:00.000Z"));

    const today = shanghaiIsoDate();
    const container = document.createElement("div");

    const datePicker = mountDecoupledDatePicker({
      defaultTrigger: { container: document.createElement("div") },
      value: "",
    });
    expect(datePicker.getValue()).toBe(today);
    datePicker.dispose();

    const rangePicker = mountDecoupledDateRangePicker({
      defaultTrigger: { container: document.createElement("div") },
      value: { from: "", to: "" },
    });
    expect(rangePicker.getValue()).toEqual({ from: today, to: today });
    rangePicker.dispose();

    const timePicker = mountDecoupledTimePicker({
      defaultTrigger: { container: document.createElement("div") },
      value: "",
    });
    expect(timePicker.getValue()).toBe("20:34");
    timePicker.dispose();

    const dateTimePicker = mountDecoupledDateTimePicker({
      defaultTrigger: { container },
    });
    expect(dateTimePicker.getValue()).toEqual({ date: "", time: "" });
    dateTimePicker.dispose();
  });

  it("re-invokes bindOpen on repeat pointerdown; picker requestOpen guards toggle-close (assumption 4)", () => {
    const container = document.createElement("div");
    const handle = mountDecoupledPickerTrigger(
      { defaultTrigger: { container } },
      "2026-10-11",
      { kind: "date", onCommit: () => true },
    );
    let openCalls = 0;
    let isOpen = false;
    handle.bindOpen(() => {
      openCalls += 1;
      if (isOpen) return;
      isOpen = true;
    });
    handle.anchor.dispatchEvent(new Event("pointerdown"));
    handle.anchor.dispatchEvent(new Event("pointerdown"));
    expect(openCalls).toBe(2);
    expect(isOpen).toBe(true);
    handle.dispose();
  });

  it("snaps wheel draft on load but does not emit until wheel interaction (assumption 5)", () => {
    const menu = document.createElement("div");
    menu.innerHTML = buildDecoupledTimeWheelsHtml();
    let changes = 0;
    const wheels = bindDecoupledTimeWheels(menu, () => {
      changes += 1;
    });
    wheels.load("09:33");
    expect(changes).toBe(0);
    expect(wheels.getDraft()).toBe("09:35");
    wheels.dispose();
  });
});
