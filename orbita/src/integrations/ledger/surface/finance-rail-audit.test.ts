import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPeriodStatsResponse } from "../types";
import type { CardDetailSnapshot, CardDetailStore } from "./types";
import { mountFinanceRailAudit } from "./finance-rail-audit";
import { setAccounts } from "../state/accounts";

const fetchAccountPeriodStats = vi.fn();

vi.mock("../api/client", () => ({
  fetchAccountPeriodStats: (...args: unknown[]) => fetchAccountPeriodStats(...args),
}));

function seedAccounts() {
  setAccounts({
    assets: [
      {
        name: "Assets:Cash",
        label: "现金",
        label_path: ["Assets", "Cash"],
        brief: "",
        open_date: "",
        extra: "",
        id: "1",
        source_file: "a.bean",
        source_line: 1,
      },
    ],
    liabilities: [
      {
        name: "Liabilities:Card",
        label: "信用卡",
        label_path: ["Liabilities", "Card"],
        brief: "",
        open_date: "",
        extra: "",
        id: "2",
        source_file: "a.bean",
        source_line: 2,
      },
    ],
    expenses: [],
    income: [],
  });
}

function balanceResponse(account: string): AccountPeriodStatsResponse {
  return {
    ok: true,
    account,
    account_kind: account.startsWith("Liabilities:") ? "liability" : "asset",
    currencies: [{ currency: "CNY", balance: "100", transaction_count: 0 }],
  };
}

function periodResponse(account: string): AccountPeriodStatsResponse {
  return {
    ok: true,
    account,
    account_kind: "asset",
    date_from: "2026-01-01",
    date_to: "2026-01-31",
    currencies: [
      {
        currency: "CNY",
        opening_balance: "100",
        inflows: "50",
        outflows: "30",
        net_change: "20",
        closing_balance: "120",
        transaction_count: 3,
      },
    ],
  };
}

function makeStore(filter: { dateFrom: string; dateTo: string }): CardDetailStore & {
  emitFilter: () => void;
  emitRendered: () => void;
} {
  const filterListeners = new Set<() => void>();
  const renderedListeners = new Set<() => void>();
  const snapshot = {
    filter: { ...filter },
  } as CardDetailSnapshot;

  return {
    getSnapshot: () => snapshot,
    getFilterSnapshot: () => snapshot.filter,
    subscribe: (fn) => {
      renderedListeners.add(fn);
      return () => renderedListeners.delete(fn);
    },
    subscribeFilter: (fn) => {
      filterListeners.add(fn);
      return () => filterListeners.delete(fn);
    },
    subscribeRendered: (fn) => {
      renderedListeners.add(fn);
      return () => renderedListeners.delete(fn);
    },
    dispatch: () => {},
    handleSave: async () => {},
    consumeMergeFocus: () => "",
    dispose: () => {
      filterListeners.clear();
      renderedListeners.clear();
    },
    emitFilter: () => filterListeners.forEach((fn) => fn()),
    emitRendered: () => renderedListeners.forEach((fn) => fn()),
  };
}

function selectKind(host: HTMLElement, kind: "assets" | "liabilities"): void {
  host.querySelector<HTMLButtonElement>('[data-role="audit-account-kind"]')?.click();
  document
    .querySelector<HTMLButtonElement>(`.orbita-simple-select-option[data-value="${kind}"]`)
    ?.click();
}

function selectAccount(host: HTMLElement, name: string): void {
  const kind = name.startsWith("Liabilities:") ? "liabilities" : "assets";
  selectKind(host, kind);
  const accountMount = host.querySelector<HTMLElement>('[data-role="audit-account-mount"]')!;
  accountMount.querySelector<HTMLElement>(".orbita-account-select-trigger")!.click();
  const search = document.querySelector<HTMLInputElement>(".orbita-account-select-search")!;
  search.value = name.split(":").pop() ?? name;
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const opt = document.querySelector<HTMLButtonElement>(
    `.orbita-account-select-option[data-name="${name}"]`,
  );
  opt?.click();
}

describe("finance-rail-audit", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    seedAccounts();
    fetchAccountPeriodStats.mockReset();
  });

  it("fetches balance without dates when filter range is empty", async () => {
    fetchAccountPeriodStats.mockResolvedValue(balanceResponse("Assets:Cash"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "", dateTo: "" });
    const ac = new AbortController();
    mountFinanceRailAudit(host, ac.signal, store);

    selectAccount(host, "Assets:Cash");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalled());

    expect(fetchAccountPeriodStats).toHaveBeenCalledWith(
      { account: "Assets:Cash" },
      ac.signal,
    );
    const results = host.querySelector('[data-role="audit-results"]')!;
    expect(results.textContent).toContain("100 CNY");
    expect(results.querySelector(".finance-rail-audit-grid")).toBeNull();
  });

  it("uses store filter dates when follow filter date is on", async () => {
    fetchAccountPeriodStats.mockResolvedValue(periodResponse("Assets:Cash"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    const ac = new AbortController();
    mountFinanceRailAudit(host, ac.signal, store);

    selectAccount(host, "Assets:Cash");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalled());

    expect(fetchAccountPeriodStats).toHaveBeenCalledWith(
      {
        account: "Assets:Cash",
        date_from: "2026-01-01",
        date_to: "2026-01-31",
      },
      ac.signal,
    );
    const grid = host.querySelector(".finance-rail-audit-grid");
    expect(grid).toBeTruthy();
    expect(grid?.textContent).toContain("期初");
    expect(grid?.textContent).toContain("120 CNY");
  });

  it("ignores rendered-only updates when following filter date", async () => {
    fetchAccountPeriodStats.mockResolvedValue(periodResponse("Assets:Cash"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    mountFinanceRailAudit(host, new AbortController().signal, store);
    selectAccount(host, "Assets:Cash");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalledTimes(1));

    store.emitRendered();
    await Promise.resolve();
    expect(fetchAccountPeriodStats).toHaveBeenCalledTimes(1);
  });

  it("refetches immediately on filter date change while following", async () => {
    fetchAccountPeriodStats.mockResolvedValue(periodResponse("Assets:Cash"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    const ac = new AbortController();
    mountFinanceRailAudit(host, ac.signal, store);
    selectAccount(host, "Assets:Cash");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalledTimes(1));

    store.getFilterSnapshot().dateFrom = "2026-02-01";
    store.getFilterSnapshot().dateTo = "2026-02-28";
    store.emitFilter();
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalledTimes(2));

    expect(fetchAccountPeriodStats).toHaveBeenLastCalledWith(
      {
        account: "Assets:Cash",
        date_from: "2026-02-01",
        date_to: "2026-02-28",
      },
      ac.signal,
    );
  });

  it("shows date picker and uses custom range when follow is off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 12, 0, 0));
    fetchAccountPeriodStats.mockResolvedValue(periodResponse("Assets:Cash"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    const ac = new AbortController();
    mountFinanceRailAudit(host, ac.signal, store);

    const follow = host.querySelector<HTMLButtonElement>('[data-role="audit-follow-filter-date"]')!;
    follow.click();

    const dateMount = host.querySelector<HTMLElement>('[data-role="audit-date-mount"]')!;
    expect(dateMount.hidden).toBe(false);

    dateMount.querySelector<HTMLButtonElement>(".orbita-date-range-picker-btn")?.click();
    document
      .querySelector<HTMLButtonElement>('.orbita-mini-cal-cell[data-value="2026-08-10"]')
      ?.click();
    document
      .querySelector<HTMLButtonElement>('.orbita-mini-cal-cell[data-value="2026-08-20"]')
      ?.click();

    selectAccount(host, "Assets:Cash");
    vi.useRealTimers();
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalled());

    expect(fetchAccountPeriodStats).toHaveBeenCalledWith(
      {
        account: "Assets:Cash",
        date_from: "2026-08-10",
        date_to: "2026-08-20",
      },
      ac.signal,
    );
    vi.useRealTimers();
  });

  it("discards stale responses when account changes quickly", async () => {
    let resolveFirst: (v: AccountPeriodStatsResponse) => void = () => {};
    const first = new Promise<AccountPeriodStatsResponse>((resolve) => {
      resolveFirst = resolve;
    });
    fetchAccountPeriodStats
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        ok: true,
        account: "Liabilities:Card",
        account_kind: "liability",
        currencies: [{ currency: "CNY", balance: "200", transaction_count: 0 }],
      });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "", dateTo: "" });
    const ac = new AbortController();
    mountFinanceRailAudit(host, ac.signal, store);

    selectAccount(host, "Assets:Cash");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalledTimes(1));

    selectAccount(host, "Liabilities:Card");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(host.querySelector('[data-role="audit-results"]')?.textContent).toContain("200 CNY"),
    );

    resolveFirst({
      ok: true,
      account: "Assets:Cash",
      account_kind: "asset",
      currencies: [{ currency: "CNY", balance: "999", transaction_count: 0 }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('[data-role="audit-results"]')?.textContent).toContain("200 CNY");
    expect(host.querySelector('[data-role="audit-results"]')?.textContent).not.toContain("999");
  });

  it("uses liability labels in period grid", async () => {
    fetchAccountPeriodStats.mockResolvedValue({
      ok: true,
      account: "Liabilities:Card",
      account_kind: "liability",
      date_from: "2026-01-01",
      date_to: "2026-01-31",
      currencies: [
        {
          currency: "CNY",
          opening_balance: "0",
          inflows: "10",
          outflows: "5",
          net_change: "5",
          closing_balance: "5",
          transaction_count: 2,
        },
      ],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = makeStore({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    mountFinanceRailAudit(host, new AbortController().signal, store);
    selectAccount(host, "Liabilities:Card");
    await vi.waitFor(() => expect(fetchAccountPeriodStats).toHaveBeenCalled());

    const grid = host.querySelector(".finance-rail-audit-grid")!;
    expect(grid.textContent).toContain("消费");
    expect(grid.textContent).toContain("还款");
    expect(grid.textContent).toContain("欠款变化");
  });
});
