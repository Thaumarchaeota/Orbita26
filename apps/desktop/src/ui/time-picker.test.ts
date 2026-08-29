import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidHhMm, mountTimePicker as mountTimePickerImpl, normalizeHhMm, type TimePickerHandle } from "./time-picker";

const mountedPickers: TimePickerHandle[] = [];

function mountTimePicker(...args: Parameters<typeof mountTimePickerImpl>): TimePickerHandle {
  const picker = mountTimePickerImpl(...args);
  mountedPickers.push(picker);
  return picker;
}

function chevronBtnOpen(picker: TimePickerHandle): boolean {
  return picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.classList.contains("is-open") ?? false;
}

describe("time-picker", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    while (mountedPickers.length > 0) mountedPickers.pop()!.dispose();
    document.body.replaceChildren();
  });

  it("validates HH:mm and rejects :60", () => {
    expect(isValidHhMm("09:30")).toBe(true);
    expect(isValidHhMm("9:05")).toBe(true);
    expect(normalizeHhMm("9:05")).toBe("09:05");
    expect(isValidHhMm("12:60")).toBe(false);
    expect(normalizeHhMm("12:60")).toBe("");
    expect(isValidHhMm("24:00")).toBe(false);
  });

  it("renders dual scroll columns with headers and selection band", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountTimePicker(host, { value: "08:00" });

    picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.click();

    expect(document.querySelectorAll(".orbita-time-wheel-col")).toHaveLength(2);
    expect(document.querySelector(".orbita-time-wheel-band")).not.toBeNull();
    expect(document.querySelector("#orbita-time-hour-label")?.textContent).toBe("时");
    expect(document.querySelector("#orbita-time-min-label")?.textContent).toBe("分");
    expect(document.querySelector(".orbita-time-panel-hours")).toBeNull();
    expect(document.querySelector(".orbita-time-panel-confirm")).not.toBeNull();
    expect(document.querySelectorAll(".orbita-time-wheel-scroll .orbita-time-wheel-item")).toHaveLength(28);
  });

  it("shows editable panel input without duplicate title", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountTimePicker(host, { value: "14:30" });

    picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.click();

    const panelInput = document.querySelector<HTMLInputElement>(".orbita-time-panel-input");
    expect(panelInput).not.toBeNull();
    expect(panelInput?.value).toBe("14:30");
  });

  it("commits when hour then minute are confirmed and closes panel", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const changes: string[] = [];
    const picker = mountTimePicker(host, { onChange: (v) => changes.push(v) });

    picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.click();
    document.querySelector<HTMLButtonElement>("[data-part='h'][data-value='14']")?.click();
    expect(changes).toHaveLength(0);

    document.querySelector<HTMLButtonElement>("[data-part='m'][data-value='30']")?.click();
    expect(changes).toHaveLength(0);

    document.querySelector<HTMLButtonElement>(".orbita-time-panel-confirm")?.click();
    expect(picker.getValue()).toBe("14:30");
    expect(changes).toEqual(["14:30"]);
    expect(chevronBtnOpen(picker)).toBe(false);
  });

  it("clear commits empty value and closes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const changes: string[] = [];
    const picker = mountTimePicker(host, { value: "09:15", onChange: (v) => changes.push(v) });

    picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.click();
    document.querySelector<HTMLButtonElement>(".orbita-time-panel-clear")?.click();

    expect(picker.getValue()).toBe("");
    expect(changes).toEqual([""]);
    expect(chevronBtnOpen(picker)).toBe(false);
  });

  it("escape closes without committing draft changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const changes: string[] = [];
    const picker = mountTimePicker(host, { onChange: (v) => changes.push(v) });

    picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.click();
    document.querySelector<HTMLButtonElement>("[data-part='h'][data-value='14']")?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(picker.getValue()).toBe("");
    expect(changes).toHaveLength(0);
  });

  it("commits typed HH:mm including non-preset minutes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const changes: string[] = [];
    const picker = mountTimePicker(host, { onChange: (v) => changes.push(v) });
    const input = picker.root.querySelector<HTMLInputElement>(".orbita-time-picker-input")!;
    input.value = "9:07";
    input.dispatchEvent(new FocusEvent("blur"));

    expect(picker.getValue()).toBe("09:07");
    expect(changes).toContain("09:07");
  });

  it("moves hour selection with arrow keys", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountTimePicker(host);

    picker.root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")?.click();
    const hourScroll = document.querySelector<HTMLElement>(".orbita-time-wheel-scroll[data-part='h']")!;
    hourScroll.focus();
    hourScroll.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(document.querySelector<HTMLElement>(".orbita-time-wheel-item.is-selected[data-part='h']")?.dataset.value).toBe("00");
    expect(document.querySelector<HTMLInputElement>(".orbita-time-panel-input")?.value).toBe("00:--");
  });
});
