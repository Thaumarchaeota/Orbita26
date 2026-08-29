import { beforeEach, describe, expect, it } from "vitest";
import type { Entry } from "../types";
import { renderDetailItemCard, patchTransactionCard, itemVisualKey } from "./render-cards";

function makeEntry(id: string, type: Entry["type"] = "expense"): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type,
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

describe("render-cards visual patch", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("updates stripe class on type change without replacing card", () => {
    const entry = makeEntry("e1", "expense");
    const wrap = renderDetailItemCard(entry);
    const card = wrap.querySelector<HTMLElement>(".cds-card")!;
    expect(card.classList.contains("cds-stripe-expense")).toBe(true);

    const income = { ...entry, type: "income" as const };
    patchTransactionCard(wrap, income);
    expect(card.classList.contains("cds-stripe-expense")).toBe(false);
    expect(card.classList.contains("cds-stripe-income")).toBe(true);
    expect(wrap.querySelector(".cds-card")).toBe(card);
  });

  it("includes validation error bit in visual key", () => {
    const entry = makeEntry("e1");
    const base = itemVisualKey(entry, {});
    const marked = itemVisualKey(entry, { markedErrorIds: new Set(["e1"]) });
    expect(base).not.toBe(marked);
  });

  it("patches is-validation-err on existing card", () => {
    const entry = makeEntry("e1");
    const wrap = renderDetailItemCard(entry);
    const card = wrap.querySelector<HTMLElement>(".cds-card")!;
    patchTransactionCard(wrap, entry, { markedErrorIds: new Set(["e1"]) });
    expect(card.classList.contains("is-validation-err")).toBe(true);
    patchTransactionCard(wrap, entry, {});
    expect(card.classList.contains("is-validation-err")).toBe(false);
  });

  it("shows HH:mm from time metadata and keeps empty time without placeholder text", () => {
    const withTime: Entry = {
      ...makeEntry("e1"),
      metadata: [{ key: "time", value: "2026-08-09T08:05:00+08:00" }],
    };
    const wrap = renderDetailItemCard(withTime);
    const time = wrap.querySelector<HTMLElement>("[data-role='txn-time']")!;
    expect(time.textContent).toBe("08:05");
    expect(time.classList.contains("is-empty")).toBe(false);

    patchTransactionCard(wrap, makeEntry("e1"));
    expect(time.textContent).toBe("");
    expect(time.classList.contains("is-empty")).toBe(true);
    expect(time.getAttribute("data-ghost-label")).toBe("时间");
    expect(wrap.querySelector("[data-role='txn-flag']")).toBeNull();
  });
});
