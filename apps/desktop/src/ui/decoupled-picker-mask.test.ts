import { beforeEach, describe, expect, it } from "vitest";
import {
  bindMaskedInput,
  caretToDigitIndex,
  DECOUPLED_MASK_TEMPLATE,
  digitIndexToCaret,
  formatMaskDigits,
  isValidMaskDisplay,
} from "./decoupled-picker-mask";

describe("decoupled picker mask", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps date hyphens, range dash, time colon and datetime space in the template", () => {
    expect(formatMaskDigits(DECOUPLED_MASK_TEMPLATE.date, "20261011")).toBe("2026-10-11");
    expect(formatMaskDigits(DECOUPLED_MASK_TEMPLATE.range, "2026101120261018")).toBe("2026-10-11—2026-10-18");
    expect(formatMaskDigits(DECOUPLED_MASK_TEMPLATE.time, "0930")).toBe("09:30");
    expect(formatMaskDigits(DECOUPLED_MASK_TEMPLATE.datetime, "202610110930")).toBe("2026-10-11 09:30");
  });

  it("skips the range dash when mapping caret across the two dates", () => {
    const template = DECOUPLED_MASK_TEMPLATE.range;
    expect(caretToDigitIndex(template, 10)).toBe(8);
    expect(digitIndexToCaret(template, 8)).toBe(11);
  });

  it("rejects incomplete or impossible values", () => {
    expect(isValidMaskDisplay("date", "2026-13-40")).toBe(false);
    expect(isValidMaskDisplay("time", "24:00")).toBe(false);
    expect(isValidMaskDisplay("range", "2026-10-11-2026-10-18")).toBe(false);
    expect(isValidMaskDisplay("datetime", "2026-10-11 09:30")).toBe(true);
  });

  it("lets sequential digits skip the range dash and does not delete it", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const commits: string[] = [];
    const mask = bindMaskedInput(input, {
      kind: "range",
      value: "2026-10-11—2026-10-11",
      onCommit: (display) => {
        commits.push(display);
        return true;
      },
    });

    input.setSelectionRange(10, 10);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    expect(input.value.startsWith("2026-10-11—20")).toBe(true);
    expect(input.value.includes("—")).toBe(true);

    input.setSelectionRange(10, 10);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(input.value.includes("—")).toBe(true);

    mask.dispose();
    expect(commits.length).toBeGreaterThan(0);
  });
});
