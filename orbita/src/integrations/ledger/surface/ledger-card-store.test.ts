import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailItem, Entry, EntriesResponse } from "../types";
import {
  __testResetLedgerStore,
  invalidateLedgerLoads,
  loadDetail,
  setDetailEntries,
} from "../state/ledger-store";
import { createLedgerCardStore } from "./ledger-card-store";

vi.mock("../api/client", () => ({
  fetchEntries: vi.fn(),
  fetchStats: vi.fn().mockResolvedValue({ ok: true, accounts: [] }),
  fetchSettings: vi.fn().mockResolvedValue({ write_target: "ledger/2026.bean", reporting_currency: "CNY" }),
}));

import { fetchEntries } from "../api/client";

function makeEntry(
  id: string,
  type: Entry["type"] = "expense",
  date = "2026-08-09",
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
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a",
  };
}

function makePad(id: string, date = "2026-08-09"): DetailItem {
  return {
    kind: "pad",
    id,
    date,
    account: "Assets:Cash",
    source_account: "Expenses:Food",
    source_file: "ledger/2026.bean",
    source_line: 2,
  };
}

beforeEach(() => {
  __testResetLedgerStore();
  vi.mocked(fetchEntries).mockReset();
});

describe("ledger card store (Phase B)", () => {
  it("reflects ledger-store items as frozen snapshot", () => {
    setDetailEntries([makeEntry("e1"), makePad("pad1")]);
    const store = createLedgerCardStore();
    const snap = store.getSnapshot();
    expect(snap.items.length).toBe(2);
    expect(snap.loadState).toBe("partial");
    expect(() => {
      (snap.items as DetailItem[]).pop();
    }).toThrow();
    store.dispose();
  });

  it("notifies when background load completes", async () => {
    let resolveBg!: (value: EntriesResponse) => void;
    vi.mocked(fetchEntries).mockImplementation((params) => {
      if (params && "date_from" in params) {
        return Promise.resolve({
          entries: [makeEntry("recent")],
          has_more: true,
          total: 2,
        });
      }
      return new Promise((resolve) => {
        resolveBg = resolve;
      });
    });

    const store = createLedgerCardStore();
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });

    await loadDetail();
    expect(store.getSnapshot().loadState).toBe("partial");
    const beforeBg = notifyCount;

    resolveBg!({ entries: [makeEntry("older", "income", "2026-08-01")], has_more: false });
    await vi.waitFor(() => expect(store.getSnapshot().loadState).toBe("ready"));
    expect(notifyCount).toBeGreaterThan(beforeBg);
    expect(store.getSnapshot().items.length).toBe(2);
    store.dispose();
  });

  it("filters by stripe kind not raw entry type", () => {
    const proxy = makeEntry("proxy");
    proxy.metadata = [{ key: "bkeasy-type", value: "proxy-expense" }];
    setDetailEntries([makeEntry("exp"), proxy]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    const filtered = store.getSnapshot().items;
    expect(filtered.some((item) => item.id === "exp")).toBe(false);
    expect(filtered.some((item) => item.id === "proxy")).toBe(true);
    store.dispose();
  });

  it("keeps pad/balance when type filter active", () => {
    setDetailEntries([makeEntry("exp"), makePad("pad1"), makeEntry("inc", "income")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "toggle-type", stripeKind: "income" });
    const ids = store.getSnapshot().items.map((item) => item.id);
    expect(ids).toContain("pad1");
    expect(ids).toContain("exp");
    expect(ids).not.toContain("inc");
    store.dispose();
  });

  it("stops receiving ledger notifications after dispose", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    let count = 0;
    store.subscribe(() => {
      count += 1;
    });
    setDetailEntries([makeEntry("e1"), makeEntry("e2")]);
    store.dispose();
    setDetailEntries([makeEntry("e3")]);
    expect(count).toBe(1);
  });

  it("survives invalidateLedgerLoads without stale data", async () => {
    let resolveLate!: (value: EntriesResponse) => void;
    vi.mocked(fetchEntries).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );

    const loadPromise = loadDetail();
    invalidateLedgerLoads();
    resolveLate({ entries: [makeEntry("stale")], has_more: false });

    await loadPromise;
    const store = createLedgerCardStore();
    expect(store.getSnapshot().items.length).toBe(0);
    store.dispose();
  });
});
