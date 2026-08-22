import { beforeEach, describe, expect, it } from "vitest";
import { mountCardDetailFilters } from "./filters";
import { createLedgerCardStore } from "./ledger-card-store";
import { setDetailEntries, __testResetLedgerStore } from "../state/ledger-store";
import type { Entry } from "../types";

function makeEntry(id: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "shop",
    remark: "标题",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  __testResetLedgerStore();
});

describe("type filter portal sync", () => {
  it("updates is-selected after panel moved to modal root", async () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();

    const filterInner = document.createElement("div");
    filterInner.className = "finance-chrome-filter-inner";
    filterInner.innerHTML = `
      <div class="type-filters finance-type-filter" data-role="detail-type-filter">
        <button type="button" class="finance-type-filter-trigger">
          <span class="finance-type-filter-label">类型 · 全部</span>
        </button>
        <div class="finance-type-filter-panel motion-popover" role="group">
          <button type="button" class="finance-type-filter-option is-selected" data-detail-type="expense" data-stripe="expense">
            <span class="finance-type-filter-stripe"></span><span class="finance-type-filter-text">支出</span>
          </button>
          <button type="button" class="finance-type-filter-option is-selected" data-detail-type="income" data-stripe="income">
            <span class="finance-type-filter-stripe"></span><span class="finance-type-filter-text">收入</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(filterInner);

    const filters = mountCardDetailFilters(filterInner, store, () => {});
    const panel = document.getElementById("orbita-modal-root")!.querySelector(
      ".finance-type-filter-panel",
    ) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(filterInner.contains(panel)).toBe(false);

    const expenseBtn = panel.querySelector<HTMLButtonElement>('[data-detail-type="expense"]')!;
    expenseBtn.click();
    expect(expenseBtn.classList.contains("is-selected")).toBe(false);
    expect(expenseBtn.getAttribute("aria-pressed")).toBe("false");
    expect(
      panel.querySelector<HTMLButtonElement>('[data-detail-type="income"]')!.classList.contains(
        "is-selected",
      ),
    ).toBe(true);

    filters.dispose();
    store.dispose();
  });
});
