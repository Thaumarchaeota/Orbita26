import { describe, expect, it } from "vitest";
import { validateActionRange } from "./action-range";

describe("validateActionRange", () => {
  it("rejects a partial start-only range without iso fields", () => {
    const result = validateActionRange({
      startDate: "2026-10-06",
      startTime: "09:00",
      endDate: "",
      endTime: "10:00",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.endDate).toBeTruthy();
      expect(result).not.toHaveProperty("startIso");
      expect(result).not.toHaveProperty("endIso");
    }
  });

  it("rejects invalid time values", () => {
    const result = validateActionRange({
      startDate: "2026-10-06",
      startTime: "25:99",
      endDate: "2026-10-06",
      endTime: "10:00",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.startTime).toBeTruthy();
      expect(result).not.toHaveProperty("startIso");
    }
  });

  it("rejects ranges where end is not after start", () => {
    const result = validateActionRange({
      startDate: "2026-10-06",
      startTime: "12:00",
      endDate: "2026-10-06",
      endTime: "09:00",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("结束须晚于开始");
      expect(result).not.toHaveProperty("startIso");
      expect(result).not.toHaveProperty("endIso");
    }
  });

  it("accepts a complete valid range with both iso timestamps", () => {
    const result = validateActionRange({
      startDate: "2026-10-06",
      startTime: "09:00",
      endDate: "2026-10-06",
      endTime: "10:00",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startIso).toBe("2026-10-06T01:00:00.000Z");
      expect(result.endIso).toBe("2026-10-06T02:00:00.000Z");
    }
  });
});
