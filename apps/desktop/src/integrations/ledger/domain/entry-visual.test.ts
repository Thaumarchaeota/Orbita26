import { describe, expect, it } from "vitest";
import type { Entry } from "../types";
import { entryVisualState } from "./entry-visual";

function entry(id: string, amount = 10): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount, currency: "CNY" },
      { account: "Assets:Cash", amount: -amount, currency: "CNY" },
    ],
    seq: "a",
  };
}

describe("entryVisualState", () => {
  it("marks modified when work copy differs from baseline", () => {
    const base = entry("e1");
    const edited = { ...base, postings: base.postings.map((p, i) => (i === 0 ? { ...p, amount: 15 } : p)) };
    expect(entryVisualState(edited, [base])).toBe("modified");
  });

  it("does not treat missing baseline entry as unchanged when baseline exists", () => {
    const base = entry("e1");
    const other = entry("e2");
    expect(entryVisualState(other, [base])).toBe("unchanged");
  });
});
