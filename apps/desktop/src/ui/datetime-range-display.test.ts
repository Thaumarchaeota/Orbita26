import { describe, expect, it } from "vitest";
import { formatDateTimeRangeLabel, type DateTimeRangeValue } from "./datetime-range-display";

const today = "2026-10-15";

function range(partial: DateTimeRangeValue): DateTimeRangeValue {
  return partial;
}

describe("formatDateTimeRangeLabel", () => {
  it("uses hh:mm-hh:mm when start is today and the range stays on that day", () => {
    expect(formatDateTimeRangeLabel(range({
      startDate: today,
      startTime: "09:00",
      endDate: today,
      endTime: "18:00",
    }), today)).toBe("09:00-18:00");
  });

  it("uses mm-dd hh:mm-hh:mm for a same-day range this year that is not today", () => {
    expect(formatDateTimeRangeLabel(range({
      startDate: "2026-09-01",
      startTime: "09:30",
      endDate: "2026-09-01",
      endTime: "10:00",
    }), today)).toBe("09-01 09:30-10:00");
  });

  it("uses yyyy-mm-dd hh:mm-hh:mm for a same-day range outside this year", () => {
    expect(formatDateTimeRangeLabel(range({
      startDate: "2025-09-01",
      startTime: "09:30",
      endDate: "2025-09-01",
      endTime: "10:00",
    }), today)).toBe("2025-09-01 09:30-10:00");
  });

  it("omits yyyy on both spanning sides when both dates are this year", () => {
    expect(formatDateTimeRangeLabel(range({
      startDate: today,
      startTime: "22:00",
      endDate: "2026-10-16",
      endTime: "01:00",
    }), today)).toBe("10-15 22:00 - 10-16 01:00");
  });

  it("keeps yyyy on both spanning sides when either date is not this year", () => {
    expect(formatDateTimeRangeLabel(range({
      startDate: "2025-12-31",
      startTime: "22:00",
      endDate: "2026-01-01",
      endTime: "01:00",
    }), today)).toBe("2025-12-31 22:00 - 2026-01-01 01:00");
  });

  it("returns empty when the range is incomplete", () => {
    expect(formatDateTimeRangeLabel(range({
      startDate: today,
      startTime: "09:00",
      endDate: "",
      endTime: "",
    }), today)).toBe("");
  });
});
