import { describe, expect, it } from "vitest";
import type { Entry } from "../types";
import { renderDetailItemCard } from "./render-cards";

function makeEntry(id: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-03-01",
    flag: "*",
    payee: "测试",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
  };
}

describe("render-cards validation diagnostics", () => {
  it("marks card and shows expandable diagnostics for mapped errors", () => {
    const entry = makeEntry("e1");
    const diags = new Map([
      [
        "e1",
        [{ message: "Balance failed", item_ids: ["e1"], raw: "BalanceError(source=...)" }],
      ],
    ]);
    const wrap = renderDetailItemCard(entry, {
      markedErrorIds: new Set(["e1"]),
      cardDiagnostics: diags,
    });
    const card = wrap.querySelector<HTMLElement>(".cds-card")!;
    expect(card.classList.contains("is-validation-err")).toBe(true);
    const panel = wrap.querySelector<HTMLElement>("[data-role='card-validation']");
    expect(panel).toBeTruthy();
    expect(panel?.querySelector("summary")?.textContent).toBe("Balance failed");
    expect(panel?.querySelector(".cds-card-validation-raw")?.textContent).toContain("BalanceError");
  });

  it("marks multiple cards from one diagnostic item_ids", () => {
    const e1 = makeEntry("e1");
    const e2 = makeEntry("e2");
    const diags = new Map([
      [
        "e1",
        [{ message: "Multi fail", item_ids: ["e1", "e2"] }],
      ],
      [
        "e2",
        [{ message: "Multi fail", item_ids: ["e1", "e2"] }],
      ],
    ]);
    const wrap1 = renderDetailItemCard(e1, {
      markedErrorIds: new Set(["e1", "e2"]),
      cardDiagnostics: diags,
    });
    const wrap2 = renderDetailItemCard(e2, {
      markedErrorIds: new Set(["e1", "e2"]),
      cardDiagnostics: diags,
    });
    expect(wrap1.querySelector(".cds-card")!.classList.contains("is-validation-err")).toBe(true);
    expect(wrap2.querySelector(".cds-card")!.classList.contains("is-validation-err")).toBe(true);
  });
});
