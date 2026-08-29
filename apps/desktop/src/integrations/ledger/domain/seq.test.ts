import { describe, expect, it } from "vitest";
import { nextSeqForDate, sortDetailEntries, sortForCommit } from "./seq";
import type { Entry } from "../types";

function entry(id: string, date: string, seq: string, time?: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: Number(id.replace(/\D/g, "")) || 1,
    type: "expense",
    date,
    flag: "*",
    payee: id,
    remark: "",
    tags: "",
    postings: [],
    metadata: time ? [{ key: "time", value: `${date}T${time}:00+08:00` }] : [],
    seq,
  };
}

describe("chronological Finance ordering", () => {
  it("uses date DESC in the UI, then valid time ASC, then numeric seq with no-time last", () => {
    const items = [
      entry("older", "2026-01-01", "a0", "08:00"),
      entry("late", "2026-01-02", "a2", "18:20"),
      entry("early", "2026-01-02", "a10", "08:05"),
      entry("same-minute-a10", "2026-01-02", "a10", "09:00"),
      entry("same-minute-a2", "2026-01-02", "a2", "09:00"),
      entry("no-time-a10", "2026-01-02", "a10"),
      entry("no-time-a2", "2026-01-02", "a2"),
    ];

    sortDetailEntries(items);
    expect(items.map((item) => item.id)).toEqual([
      "early",
      "same-minute-a2",
      "same-minute-a10",
      "late",
      "no-time-a2",
      "no-time-a10",
      "older",
    ]);
  });

  it("uses date ASC with the same intra-day order for the file candidate", () => {
    const items = [
      entry("newer", "2026-01-02", "a0", "08:00"),
      entry("no-time", "2026-01-01", "a0"),
      entry("early", "2026-01-01", "a10", "08:05"),
      entry("earlier", "2026-01-01", "a2", "08:00"),
    ];

    expect(sortForCommit(items).map((item) => item.id)).toEqual([
      "earlier",
      "early",
      "no-time",
      "newer",
    ]);
  });

  it("allocates the next numeric seq after a10 instead of comparing strings", () => {
    expect(nextSeqForDate([entry("a9", "2026-01-02", "a9"), entry("a10", "2026-01-02", "a10")], "2026-01-02")).toBe("a11");
  });
});
