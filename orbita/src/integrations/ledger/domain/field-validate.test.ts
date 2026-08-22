import { describe, expect, it } from "vitest";
import type { Entry } from "../types";
import { parseDecimalInput, validateInlinePatch, buildValidatedPatch } from "./field-validate";

function balancedEntry(): Entry {
  return {
    kind: "transaction",
    id: "e1",
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a",
  };
}

describe("parseDecimalInput", () => {
  it("rejects empty and invalid formats", () => {
    expect(parseDecimalInput("").ok).toBe(false);
    expect(parseDecimalInput("abc").ok).toBe(false);
    expect(parseDecimalInput("1.2.3").ok).toBe(false);
  });

  it("accepts precise decimals without rounding", () => {
    const r = parseDecimalInput("1234567890123.456");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1234567890123.456);
  });

  it("rejects zero by default", () => {
    expect(parseDecimalInput("0").ok).toBe(false);
    expect(parseDecimalInput("0", { allowZero: true }).ok).toBe(true);
  });
});

describe("validateInlinePatch", () => {
  it("allows temporarily unbalanced amount edits", () => {
    const entry = balancedEntry();
    const patch = { field: "amount" as const, postingIndex: 0, value: 15 };
    expect(validateInlinePatch(entry, patch)).toBeNull();
    const built = buildValidatedPatch(entry, "amount", "15", 0);
    expect("patch" in built).toBe(true);
  });

  it("still rejects invalid account", () => {
    const entry = balancedEntry();
    const patch = { field: "account" as const, postingIndex: 0, value: "No:Such" };
    expect(validateInlinePatch(entry, patch)).toMatch(/不存在/);
  });

  it("rejects illegal time and accepts empty or HH:mm", () => {
    const entry = balancedEntry();
    expect(validateInlinePatch(entry, { field: "time", value: "8:05" })).toMatch(/HH:mm/);
    expect(buildValidatedPatch(entry, "time", "24:00", 0)).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/HH:mm/) }),
    );
    expect(validateInlinePatch(entry, { field: "time", value: "" })).toBeNull();
    expect(validateInlinePatch(entry, { field: "time", value: "08:05" })).toBeNull();
    const built = buildValidatedPatch(entry, "time", "08:05", 0);
    expect(built).toEqual({ patch: { field: "time", value: "08:05" } });
  });
});
