import { describe, expect, it } from "vitest";
import {
  extractValidTxnTime,
  displayTxnTime,
  formatTxnTimeMeta,
  normalizeTimeInput,
  rewriteTxnTimeDate,
  upsertTxnTimeMetadata,
  validateTxnTimeInput,
} from "./txn-time";

describe("txn-time", () => {
  it("accepts empty and zero-padded HH:mm", () => {
    expect(validateTxnTimeInput("")).toBeNull();
    expect(validateTxnTimeInput("00:00")).toBeNull();
    expect(validateTxnTimeInput("23:59")).toBeNull();
    expect(validateTxnTimeInput("08:05:00")).toBeNull();
  });

  it("rejects illegal time", () => {
    for (const raw of ["8:05", "24:00", "12:60", "08:05:01", "08:05 PM"]) {
      expect(validateTxnTimeInput(raw)).toMatch(/HH:mm/);
    }
  });

  it("writes and clears time without dropping other metadata", () => {
    const base = [
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
    ];
    const withTime = upsertTxnTimeMetadata(base, "2026-01-02", "08:05");
    expect(withTime).toEqual([
      ...base,
      { key: "time", value: "2026-01-02T08:05:00+08:00" },
    ]);
    expect(displayTxnTime(withTime)).toBe("08:05");
    const cleared = upsertTxnTimeMetadata(withTime, "2026-01-02", "");
    expect(cleared.some((m) => m.key === "time")).toBe(false);
    expect(cleared).toEqual(base);
  });

  it("rewrites time date prefix when transaction date changes", () => {
    const meta = upsertTxnTimeMetadata([], "2026-01-02", "18:20");
    const next = rewriteTxnTimeDate(meta, "2026-01-03", "2026-01-02");
    expect(next).toEqual([{ key: "time", value: "2026-01-03T18:20:00+08:00" }]);
  });

  it("formats metadata with +08:00 seconds", () => {
    expect(formatTxnTimeMeta("2026-05-19", "14:32")).toBe("2026-05-19T14:32:00+08:00");
    expect(normalizeTimeInput("14:32:00")).toBe("14:32");
  });

  it("treats duplicate, malformed, and date-mismatched legacy time as no time", () => {
    expect(
      extractValidTxnTime([{ key: "time", value: "2026-01-02T08:05:00+08:00" }], "2026-01-03"),
    ).toBe("");
    expect(
      extractValidTxnTime([{ key: "time", value: "2026-01-02T24:00:00+08:00" }], "2026-01-02"),
    ).toBe("");
    expect(
      extractValidTxnTime(
        [
          { key: "time", value: "2026-01-02T08:05:00+08:00" },
          { key: "time", value: "2026-01-02T08:06:00+08:00" },
        ],
        "2026-01-02",
      ),
    ).toBe("");
  });
});
