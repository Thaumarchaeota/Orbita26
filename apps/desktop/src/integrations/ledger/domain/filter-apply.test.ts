import { describe, expect, it } from "vitest";
import type { DetailItem, Entry } from "../types";
import {
  ALL_FILTERABLE_STRIPE_KINDS,
} from "../surface/filter-kinds";
import type { FilterableStripeKind } from "../surface/filter-kinds";
import {
  applyDetailFilter,
  defaultDetailFilter,
  resetDetailFilter,
  setAllTypesFilter,
  toggleTypeFilter,
  type DetailFilterState,
} from "./filter-apply";

type MutableFilter = DetailFilterState & {
  types: Set<FilterableStripeKind>;
  accounts: Set<string>;
  tags: Set<string>;
};

function txn(
  id: string,
  type: Entry["type"],
  date: string,
  postings: Entry["postings"],
  tags = "",
  metadata?: Entry["metadata"],
): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type,
    date,
    flag: "*",
    payee: "p",
    remark: "",
    tags,
    postings,
    seq: "a",
    ...(metadata ? { metadata } : {}),
  };
}

function pad(id: string, date: string, account: string): DetailItem {
  return {
    kind: "pad",
    id,
    date,
    account,
    source_account: "Equity:Opening-Balances",
    source_file: "ledger/2026.bean",
    source_line: 2,
  };
}

function balance(id: string, date: string, account: string): DetailItem {
  return {
    kind: "balance",
    id,
    date,
    account,
    amount: "100",
    currency: "CNY",
    source_file: "ledger/2026.bean",
    source_line: 3,
  };
}

const ITEMS: DetailItem[] = [
  txn("exp", "expense", "2026-08-09", [
    { account: "Expenses:Food", amount: 10, currency: "CNY" },
    { account: "Assets:Cash", amount: -10, currency: "CNY" },
  ]),
  txn("inc", "income", "2026-08-09", [
    { account: "Income:Salary", amount: -100, currency: "CNY" },
    { account: "Assets:Bank", amount: 100, currency: "CNY" },
  ]),
  txn("xfer", "transfer", "2026-08-08", [
    { account: "Assets:Bank", amount: 50, currency: "CNY" },
    { account: "Assets:Cash", amount: -50, currency: "CNY" },
  ]),
  txn("proxy", "expense", "2026-08-08", [
    { account: "Expenses:Health", amount: 20, currency: "CNY" },
    { account: "Assets:Cash", amount: -20, currency: "CNY" },
  ], "", [{ key: "bkeasy-type", value: "proxy-expense" }]),
  txn("repay", "transfer", "2026-08-07", [
    { account: "Liabilities:Credit", amount: 30, currency: "CNY" },
    { account: "Assets:Bank", amount: -30, currency: "CNY" },
  ], "", [{ key: "bkeasy-type", value: "repayment" }]),
  txn("unknown", "inv", "2026-08-07", [
    { account: "Assets:Cash", amount: 5, currency: "CNY" },
    { account: "Assets:Bank", amount: -5, currency: "CNY" },
  ]),
  txn("tagged", "expense", "2026-08-06", [
    { account: "Expenses:Food", amount: 8, currency: "CNY" },
    { account: "Assets:Cash", amount: -8, currency: "CNY" },
  ], "日常 食材"),
  txn("multi", "expense", "2026-08-05", [
    { account: "Expenses:Food", amount: 12, currency: "CNY" },
    { account: "Expenses:Transport", amount: 3, currency: "CNY" },
    { account: "Assets:Cash", amount: -15, currency: "CNY" },
  ]),
  pad("pad-food", "2026-08-08", "Expenses:Food"),
  pad("pad-cash", "2026-08-08", "Assets:Cash"),
  balance("bal-bank", "2026-08-07", "Assets:Bank"),
  balance("bal-cash", "2026-08-07", "Assets:Cash"),
];

function filterWith(overrides: Partial<MutableFilter> = {}): MutableFilter {
  const base = defaultDetailFilter() as MutableFilter;
  return { ...base, ...overrides };
}

describe("applyDetailFilter type mode (§9.2)", () => {
  it("passes all kinds when typeMode is all", () => {
    const filter = filterWith({ typeMode: "all", types: new Set() });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id).sort();
    expect(ids).toEqual(
      ["bal-bank", "bal-cash", "exp", "inc", "multi", "pad-cash", "pad-food", "proxy", "repay", "tagged", "unknown", "xfer"].sort(),
    );
  });

  it("returns empty results when selected mode has empty types set", () => {
    const filter = filterWith({ typeMode: "selected", types: new Set() });
    expect(applyDetailFilter(ITEMS, filter)).toEqual([]);
  });

  it("filters by selected kinds only", () => {
    const filter = filterWith({ typeMode: "selected", types: new Set<FilterableStripeKind>(["income", "repayment"]) });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("inc");
    expect(ids).toContain("repay");
    expect(ids).not.toContain("exp");
    expect(ids).not.toContain("pad-food");
  });

  it("shows only pad when pad is the sole selected kind", () => {
    const filter = filterWith({ typeMode: "selected", types: new Set<FilterableStripeKind>(["pad"]) });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids.sort()).toEqual(["pad-cash", "pad-food"]);
  });

  it("shows only balance when balance is the sole selected kind", () => {
    const filter = filterWith({ typeMode: "selected", types: new Set<FilterableStripeKind>(["balance"]) });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toEqual(["bal-bank", "bal-cash"]);
  });

  it("set-all-types restores all mode with cleared set", () => {
    const filter = filterWith({ typeMode: "selected", types: new Set<FilterableStripeKind>(["income"]) });
    setAllTypesFilter(filter);
    expect(filter.typeMode).toBe("all");
    expect(filter.types.size).toBe(0);
    expect(applyDetailFilter(ITEMS, filter).length).toBe(ITEMS.length);
  });

  it("toggle from all enters selected with all kinds except toggled removed", () => {
    const filter = filterWith();
    toggleTypeFilter(filter, "expense");
    expect(filter.typeMode).toBe("selected");
    expect(filter.types.has("expense")).toBe(false);
    expect(filter.types.size).toBe(ALL_FILTERABLE_STRIPE_KINDS.length - 1);
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).not.toContain("exp");
    expect(ids).toContain("proxy");
  });

  it("toggle in selected mode adds and removes kinds", () => {
    const filter = filterWith({ typeMode: "selected", types: new Set<FilterableStripeKind>(["income"]) });
    toggleTypeFilter(filter, "income");
    expect(filter.types.size).toBe(0);
    expect(applyDetailFilter(ITEMS, filter)).toEqual([]);
    toggleTypeFilter(filter, "expense");
    expect(filter.types).toEqual(new Set(["expense"]));
  });

  it("reset restores default all mode", () => {
    const filter = filterWith({
      dateFrom: "2026-08-08",
      typeMode: "selected",
      types: new Set<FilterableStripeKind>(["income"]),
      accounts: new Set(["Assets:Cash"]),
      tags: new Set(["日常"]),
      tagMode: "and",
      accountMode: "and",
    });
    resetDetailFilter(filter);
    expect(filter).toMatchObject({
      dateFrom: "",
      dateTo: "",
      typeMode: "all",
      accountMode: "or",
      tagMode: "or",
    });
    expect(filter.types.size).toBe(0);
    expect(filter.accounts.size).toBe(0);
    expect(filter.tags.size).toBe(0);
  });
});

describe("applyDetailFilter account mode (§9.3)", () => {
  it("OR matches when any posting hits selected prefix", () => {
    const filter = filterWith({
      accounts: new Set(["Expenses:Food", "Income:Salary"]),
      accountMode: "or",
    });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("exp");
    expect(ids).toContain("inc");
    expect(ids).not.toContain("xfer");
  });

  it("AND requires each selected prefix to have at least one posting hit", () => {
    const filter = filterWith({
      accounts: new Set(["Expenses:Food", "Expenses:Transport"]),
      accountMode: "and",
    });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("multi");
    expect(ids).not.toContain("exp");
  });

  it("AND does not require all postings to stay inside selected set", () => {
    const filter = filterWith({
      accounts: new Set(["Expenses:Food", "Expenses:Transport"]),
      accountMode: "and",
    });
    const multi = applyDetailFilter(ITEMS, filter).find((item) => item.id === "multi");
    expect(multi?.kind).toBe("transaction");
    if (multi?.kind !== "transaction") return;
    expect(multi.postings.some((p) => p.account === "Assets:Cash")).toBe(true);
  });

  it("AND rejects transaction missing one required prefix", () => {
    const filter = filterWith({
      accounts: new Set(["Expenses:Food", "Assets:Bank"]),
      accountMode: "and",
    });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).not.toContain("exp");
    expect(ids).not.toContain("multi");
  });
});

describe("applyDetailFilter tags", () => {
  it("OR matches when any tag present", () => {
    const filter = filterWith({ tags: new Set(["食材", "薪资"]), tagMode: "or" });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("tagged");
    expect(ids).not.toContain("exp");
  });

  it("AND requires all selected tags", () => {
    const filter = filterWith({ tags: new Set(["日常", "食材"]), tagMode: "and" });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("tagged");
    expect(ids).not.toContain("exp");
  });
});

describe("applyDetailFilter balance/pad (§9.4)", () => {
  it("shows pad/balance when account filter matches target account", () => {
    const filter = filterWith({ accounts: new Set(["Expenses:Food"]) });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("pad-food");
    expect(ids).toContain("exp");
    expect(ids).not.toContain("pad-cash");
    expect(ids).not.toContain("inc");
  });

  it("hides pad/balance when account filter misses target account", () => {
    const filter = filterWith({ accounts: new Set(["Income:Salary"]) });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).not.toContain("pad-food");
    expect(ids).not.toContain("bal-bank");
    expect(ids).toContain("inc");
  });

  it("never shows pad/balance under tag filter", () => {
    const filter = filterWith({ tags: new Set(["日常"]), tagMode: "or" });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("tagged");
    expect(ids).not.toContain("pad-food");
    expect(ids).not.toContain("bal-bank");
  });

  it("still applies date filter to pad/balance", () => {
    const filter = filterWith({ dateFrom: "2026-08-07", dateTo: "2026-08-07" });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toContain("bal-bank");
    expect(ids).not.toContain("pad-food");
    expect(ids).not.toContain("exp");
  });
});

describe("applyDetailFilter combined AND groups", () => {
  it("applies date AND type AND account AND tag together", () => {
    const filter = filterWith({
      dateFrom: "2026-08-06",
      dateTo: "2026-08-06",
      typeMode: "selected",
      types: new Set<FilterableStripeKind>(["expense"]),
      accounts: new Set(["Expenses:Food"]),
      tags: new Set(["食材"]),
      tagMode: "and",
      accountMode: "or",
    });
    const ids = applyDetailFilter(ITEMS, filter).map((item) => item.id);
    expect(ids).toEqual(["tagged"]);
  });
});
