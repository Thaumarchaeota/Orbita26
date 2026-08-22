import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry, EntriesResponse } from "../types";
import {
  __testGetLoadGeneration,
  __testResetLedgerStore,
  beginSaveSubmit,
  enterConfirming,
  getDetailEntries,
  getLoadState,
  getSavePhase,
  getValidationSession,
  invalidateLedgerLoads,
  loadDetail,
  needsMore,
  pushEntry,
  setDetailEntries,
  softDeleteEntry,
} from "./ledger-store";
import { cloneEntries } from "../utils";

vi.mock("../api/client", () => ({
  fetchEntries: vi.fn(),
  fetchSettings: vi.fn().mockResolvedValue({ write_target: "ledger/2026.bean", reporting_currency: "CNY" }),
}));

import { fetchEntries } from "../api/client";

function makeEntry(id: string, date = "2026-01-02"): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date,
    flag: "*",
    payee: "",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
  };
}

beforeEach(() => {
  __testResetLedgerStore();
  vi.mocked(fetchEntries).mockReset();
});

describe("ledger-store generation and dataDir invalidation", () => {
  it("drops stale fetchEntries after invalidateLedgerLoads", async () => {
    let resolveLate!: (value: EntriesResponse) => void;
    vi.mocked(fetchEntries).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );

    const loadPromise = loadDetail();
    const genBefore = __testGetLoadGeneration();
    invalidateLedgerLoads();
    expect(__testGetLoadGeneration()).toBeGreaterThan(genBefore);

    resolveLate({
      entries: [makeEntry("stale-1")],
      has_more: false,
    });
    await loadPromise;

    expect(getDetailEntries()).toHaveLength(0);
    expect(getLoadState()).toBe("loading");
  });

  it("needsMore stays true for 500+ total until full load", () => {
    const resp: EntriesResponse = {
      entries: Array.from({ length: 100 }, (_, i) => makeEntry(`e${i}`)),
      total: 520,
      has_more: true,
    };
    expect(needsMore(resp, "2025-10-01", 100)).toBe(true);
    expect(needsMore({ ...resp, has_more: false, total: 520 }, "2025-10-01", 520)).toBe(false);
  });

  it("enters partial state when recent batch has more rows", async () => {
    let resolveBg!: (value: EntriesResponse) => void;
    vi.mocked(fetchEntries).mockImplementation((params) => {
      const recent = {
        entries: Array.from({ length: 50 }, (_, i) => makeEntry(`e${i}`)),
        total: 600,
        has_more: true,
      };
      if (params && "date_from" in params) return Promise.resolve(recent);
      return new Promise((resolve) => {
        resolveBg = resolve;
      });
    });

    const loadPromise = loadDetail();
    await vi.waitFor(() => expect(getLoadState()).toBe("partial"));
    expect(getDetailEntries()).toHaveLength(50);

    resolveBg!({ entries: [], has_more: false, total: 600 });
    await loadPromise;
    expect(getLoadState()).toBe("ready");
  });

  it("does not apply stale loadDetail during submitting", async () => {
    let resolveLate!: (value: EntriesResponse) => void;
    vi.mocked(fetchEntries).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );

    const entries = [makeEntry("work-1")];
    setDetailEntries(entries);
    const loadPromise = loadDetail();
    const genAtSubmit = __testGetLoadGeneration();
    beginSaveSubmit();
    expect(getSavePhase()).toBe("submitting");

    resolveLate({
      entries: [makeEntry("stale-overwrite")],
      has_more: false,
    });
    await loadPromise;

    expect(getSavePhase()).toBe("submitting");
    expect(getDetailEntries()[0]!.id).toBe("work-1");
    expect(__testGetLoadGeneration()).toBeGreaterThan(genAtSubmit);
  });
});

describe("confirming to edited on mutation", () => {
  it("reverts confirming to edited on pushEntry", () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneEntries(entries), "tok", "hash");
    pushEntry(makeEntry("e2"));
    expect(getSavePhase()).toBe("edited");
    expect(getValidationSession()).toBeNull();
  });

  it("reverts confirming to edited on soft delete", () => {
    const entries = [makeEntry("e1"), makeEntry("e2", "2026-01-03")];
    setDetailEntries(entries);
    enterConfirming(cloneEntries(entries), "tok", "hash");
    softDeleteEntry("e1");
    expect(getSavePhase()).toBe("edited");
    expect(getValidationSession()).toBeNull();
  });
});
