import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailItem, Entry, EntriesResponse } from "../types";
import {
  __testResetLedgerStore,
  invalidateLedgerLoads,
  loadDetail,
  setDetailEntries,
} from "../state/ledger-store";
import { createLedgerCardStore, __testFlushFilterDerive } from "./ledger-card-store";

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
    __testFlushFilterDerive(store);
    const filtered = store.getSnapshot().items;
    expect(filtered.some((item) => item.id === "exp")).toBe(false);
    expect(filtered.some((item) => item.id === "proxy")).toBe(true);
    store.dispose();
  });

  it("filters pad/balance by selected type kind", () => {
    setDetailEntries([makeEntry("exp"), makePad("pad1"), makeEntry("inc", "income")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "set-type-mode", mode: "selected" });
    store.dispatch({ type: "toggle-type", stripeKind: "income" });
    __testFlushFilterDerive(store);
    const ids = store.getSnapshot().items.map((item) => item.id);
    expect(ids).toContain("inc");
    expect(ids).not.toContain("pad1");
    expect(ids).not.toContain("exp");
    store.dispose();
  });

  it("set-all-types restores all transaction kinds", () => {
    setDetailEntries([makeEntry("exp"), makeEntry("inc", "income")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "toggle-type", stripeKind: "income" });
    expect(store.getSnapshot().filter.typeMode).toBe("selected");
    store.dispatch({ type: "set-all-types" });
    expect(store.getSnapshot().filter.typeMode).toBe("all");
    __testFlushFilterDerive(store);
    expect(store.getSnapshot().items.length).toBe(2);
    store.dispose();
  });

  it("reset-filters restores defaultDetailFilter", () => {
    setDetailEntries([makeEntry("exp")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "set-date-from", value: "2026-08-01" });
    store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    store.dispatch({ type: "set-accounts", accounts: new Set(["Assets:Cash"]) });
    store.dispatch({ type: "reset-filters" });
    const { filter } = store.getSnapshot();
    expect(filter.typeMode).toBe("all");
    expect(filter.dateFrom).toBe("");
    expect(filter.accounts.size).toBe(0);
    __testFlushFilterDerive(store);
    expect(store.getSnapshot().items.length).toBe(1);
    store.dispose();
  });

  it("selected type mode with empty set yields zero items", () => {
    setDetailEntries([makeEntry("exp"), makePad("pad1")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "set-type-mode", mode: "selected" });
    __testFlushFilterDerive(store);
    const ids = store.getSnapshot().items.map((item) => item.id);
    expect(ids).toEqual([]);
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

  it("publishes filter input synchronously before rendered derive", async () => {
    setDetailEntries([makeEntry("e1"), makeEntry("e2", "income")]);
    const store = createLedgerCardStore() as ReturnType<typeof createLedgerCardStore> & {
      __testDeriveCount?: () => number;
    };
    await vi.waitFor(() => expect(store.getSnapshot().loadState).not.toBe("loading"));
    let filterNotifyAt = 0;
    let renderedNotifyAt = 0;
    const unsubFilter = store.subscribeFilter(() => {
      filterNotifyAt += 1;
    });
    const unsubRendered = store.subscribeRendered(() => {
      renderedNotifyAt += 1;
    });
    const deriveBefore = store.__testDeriveCount?.() ?? 0;
    renderedNotifyAt = 0;
    filterNotifyAt = 0;
    store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    expect(store.getFilterSnapshot().typeMode).toBe("selected");
    expect(filterNotifyAt).toBe(1);
    expect(renderedNotifyAt).toBe(0);
    expect(store.__testDeriveCount?.()).toBe(deriveBefore);
    __testFlushFilterDerive(store);
    expect(renderedNotifyAt).toBe(1);
    expect(store.getSnapshot().items.map((item) => item.id)).toEqual(["e2"]);
    unsubFilter();
    unsubRendered();
    store.dispose();
  });

  it("coalesces rapid filter changes into a single rendered derive", () => {
    const items = Array.from({ length: 120 }, (_, i) => makeEntry(`e${i}`));
    setDetailEntries(items);
    const store = createLedgerCardStore() as ReturnType<typeof createLedgerCardStore> & {
      __testDeriveCount?: () => number;
    };
    __testFlushFilterDerive(store);
    const deriveBefore = store.__testDeriveCount?.() ?? 0;
    for (let i = 0; i < 40; i++) {
      store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    }
    expect((store.__testDeriveCount?.() ?? 0) - deriveBefore).toBe(0);
    __testFlushFilterDerive(store);
    expect((store.__testDeriveCount?.() ?? 0) - deriveBefore).toBe(1);
    store.dispose();
  });

  it("does not rerun full filter on repeated getSnapshot without input change", () => {
    setDetailEntries([makeEntry("e1"), makeEntry("e2")]);
    const store = createLedgerCardStore() as ReturnType<typeof createLedgerCardStore> & {
      __testDeriveCount?: () => number;
    };
    store.dispatch({ type: "toggle-type", stripeKind: "income" });
    __testFlushFilterDerive(store);
    const deriveAfterFlush = store.__testDeriveCount?.() ?? 0;
    const first = store.getSnapshot();
    const second = store.getSnapshot();
    expect(first.items).toBe(second.items);
    expect(store.__testDeriveCount?.()).toBe(deriveAfterFlush);
    store.dispose();
  });
});
