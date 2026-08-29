import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountDateRangePicker, resolveDateRangeShortcut } from "./date-range-picker";

function clickDate(value: string): void {
  const cell = document.querySelector<HTMLButtonElement>(`.orbita-mini-cal-cell[data-value="${value}"]`);
  cell?.click();
}

function clickShortcut(id: string): void {
  const btn = document.querySelector<HTMLButtonElement>(`[data-shortcut="${id}"]`);
  btn?.click();
}

describe("date-range-picker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 12, 0, 0));
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("commits the first click synchronously and keeps the popover open", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const changes: Array<{ from: string; to: string }> = [];
    const picker = mountDateRangePicker(host, {
      onChange: (v) => changes.push(v),
    });

    picker.root.querySelector<HTMLButtonElement>(".orbita-date-range-picker-btn")?.click();
    clickDate("2026-08-15");
    expect(picker.getValue()).toEqual({ from: "2026-08-15", to: "2026-08-15" });
    expect(changes.at(-1)).toEqual({ from: "2026-08-15", to: "2026-08-15" });
    expect(changes).toHaveLength(1);
    expect(document.querySelector('[data-action="confirm"]')).toBeNull();
    expect(picker.root.querySelector(".orbita-date-range-picker-btn")?.classList.contains("is-open")).toBe(true);
    picker.dispose();
  });

  it("reverse second click restarts from earlier date", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountDateRangePicker(host);

    picker.root.querySelector<HTMLButtonElement>(".orbita-date-range-picker-btn")?.click();
    clickDate("2026-08-20");
    clickDate("2026-08-10");
    expect(picker.getValue()).toEqual({ from: "2026-08-10", to: "2026-08-10" });

    clickDate("2026-08-25");
    expect(picker.getValue()).toEqual({ from: "2026-08-10", to: "2026-08-25" });
    picker.dispose();
  });

  it("resolves shortcuts relative to Shanghai today", () => {
    const now = new Date("2026-08-21T18:00:00.000Z");
    expect(resolveDateRangeShortcut("today", now)).toEqual({ from: "2026-08-22", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("last7", now)).toEqual({ from: "2026-08-16", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("thisMonth", now)).toEqual({ from: "2026-08-01", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("thisYear", now)).toEqual({ from: "2026-01-01", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("all", now)).toEqual({ from: "", to: "" });
  });

  it("resolves shortcuts relative to today", () => {
    expect(resolveDateRangeShortcut("today")).toEqual({ from: "2026-08-22", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("last7")).toEqual({ from: "2026-08-16", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("thisMonth")).toEqual({ from: "2026-08-01", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("thisYear")).toEqual({ from: "2026-01-01", to: "2026-08-22" });
    expect(resolveDateRangeShortcut("all")).toEqual({ from: "", to: "" });
  });

  it("marks range endpoints active and interior in-range", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountDateRangePicker(host);

    picker.root.querySelector<HTMLButtonElement>(".orbita-date-range-picker-btn")?.click();
    clickDate("2026-08-10");
    expect(document.querySelector('.orbita-mini-cal-cell[data-value="2026-08-10"]')?.classList.contains("is-active")).toBe(true);

    clickDate("2026-08-15");
    const start = document.querySelector('.orbita-mini-cal-cell[data-value="2026-08-10"]');
    const mid = document.querySelector('.orbita-mini-cal-cell[data-value="2026-08-12"]');
    const end = document.querySelector('.orbita-mini-cal-cell[data-value="2026-08-15"]');
    expect(start?.classList.contains("is-active")).toBe(true);
    expect(end?.classList.contains("is-active")).toBe(true);
    expect(mid?.classList.contains("is-in-range")).toBe(true);
    expect(mid?.classList.contains("is-active")).toBe(false);
    picker.dispose();
  });

  it("applies shortcut buttons immediately and keeps the popover open", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountDateRangePicker(host);

    picker.root.querySelector<HTMLButtonElement>(".orbita-date-range-picker-btn")?.click();
    clickShortcut("last7");
    expect(picker.getValue()).toEqual({ from: "2026-08-16", to: "2026-08-22" });
    expect(picker.root.querySelector(".orbita-date-range-picker-btn")?.classList.contains("is-open")).toBe(true);
    picker.dispose();
  });
});
