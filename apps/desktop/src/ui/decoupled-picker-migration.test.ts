import { afterEach, describe, expect, it, vi } from "vitest";
import { mountDecoupledDatePicker } from "./decoupled-date-picker";
import { mountDecoupledDateTimeRangePicker } from "./decoupled-datetime-range-picker";
import { mountDecoupledTimePicker } from "./decoupled-time-picker";
import { createPickerGroup, mountTaskDateField, mountTaskTimeField } from "../integrations/ticktick/form-pickers";

describe("decoupled date/time migration contract", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("keeps custom anchors caller-owned and reports portal open/close", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const states: boolean[] = [];
    const picker = mountDecoupledDatePicker({ anchor, value: "2026-10-18", onOpenChange: (open) => states.push(open) });

    expect(document.body.querySelector(".orbita-decoupled-picker-trigger")).toBeNull();
    expect(anchor.getAttribute("aria-expanded")).toBeNull();
    await picker.open();
    expect(picker.getValue()).toBe("2026-10-18");
    await picker.close();
    expect(states).toEqual([true, false]);
    picker.dispose();
    expect(anchor.isConnected).toBe(true);
  });

  it("keeps datetime-range default trigger a button and custom setters silent", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const picker = mountDecoupledDateTimeRangePicker({ defaultTrigger: { container: host }, onChange });
    expect(host.querySelector("button.orbita-decoupled-picker-trigger")).not.toBeNull();
    expect(host.querySelector("input")).toBeNull();
    picker.setValue({ startDate: "2026-10-18", startTime: "09:37", endDate: "2026-10-18", endTime: "10:02" });
    expect(onChange).not.toHaveBeenCalled();
    expect(picker.getValue().startTime).toBe("09:37");
    picker.dispose();
  });

  it("toggles the datetime-range default button while public open remains ensure-open", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const states: boolean[] = [];
    const picker = mountDecoupledDateTimeRangePicker({ defaultTrigger: { container: host }, onOpenChange: (open) => states.push(open) });
    const button = host.querySelector<HTMLButtonElement>("button.orbita-decoupled-picker-trigger")!;

    button.click();
    await vi.waitFor(() => expect(states[states.length - 1]).toBe(true));
    button.click();
    await vi.waitFor(() => expect(states[states.length - 1]).toBe(false));
    await picker.open();
    await picker.open();
    expect(states.filter(Boolean)).toHaveLength(2);
    expect(states[states.length - 1]).toBe(true);
    await picker.close();
    picker.dispose();
  });

  it("preserves empty and arbitrary-minute time values through external setters", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const picker = mountDecoupledTimePicker({ defaultTrigger: { container: host }, value: "09:37" });
    expect(picker.getValue()).toBe("09:37");
    picker.setValue("");
    expect(picker.getValue()).toBe("");
    picker.dispose();
  });

  it("keeps TickTick labels in sync and preserves toggle/group-close behavior", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const group = createPickerGroup();
    const date = mountTaskDateField(host, "日期", "task-date", "2026-10-18", group);
    const time = mountTaskTimeField(host, "开始", "task-time", "09:00", group);
    const dateButton = date.root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;
    const timeButton = time.root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;

    time.setValue("12:34");
    expect(time.root.querySelector(".ticktick-picker-label")?.textContent).toBe("12:34");
    dateButton.click();
    await vi.waitFor(() => expect(dateButton.getAttribute("aria-expanded")).toBe("true"));
    dateButton.click();
    await vi.waitFor(() => expect(dateButton.getAttribute("aria-expanded")).toBe("false"));
    dateButton.click();
    await vi.waitFor(() => expect(dateButton.getAttribute("aria-expanded")).toBe("true"));
    timeButton.click();
    await vi.waitFor(() => expect(dateButton.getAttribute("aria-expanded")).toBe("false"));
    await vi.waitFor(() => expect(timeButton.getAttribute("aria-expanded")).toBe("true"));

    date.dispose();
    time.dispose();
    expect(dateButton.isConnected).toBe(true);
  });
});
