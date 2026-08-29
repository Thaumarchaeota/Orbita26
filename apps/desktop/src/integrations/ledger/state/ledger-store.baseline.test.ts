import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import {
  __testResetLedgerStore,
  getBaseline,
  getDetailEntries,
  loadDetail,
  updateEntryField,
} from "./ledger-store";

vi.mock("../api/client", () => ({
  fetchEntries: vi.fn(),
  fetchSettings: vi.fn().mockResolvedValue({ write_target: "ledger/2026.bean", reporting_currency: "CNY" }),
}));

import { fetchEntries } from "../api/client";

function makeEntry(id: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-01-02",
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

describe("ledger baseline", () => {
  it("establishes baseline on first partial page without waiting for background load", async () => {
    const firstPage = [makeEntry("e1"), makeEntry("e2")];
    vi.mocked(fetchEntries)
      .mockResolvedValueOnce({
        entries: firstPage,
        total: 200,
        has_more: true,
      })
      .mockImplementation(() => new Promise(() => {}));

    await loadDetail();
    expect(getBaseline()).toHaveLength(2);
    expect(getBaseline().map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("extends baseline on background load without overwriting edited snapshots", async () => {
    const firstPage = [makeEntry("e1")];
    const older = [makeEntry("e0")];
    vi.mocked(fetchEntries)
      .mockResolvedValueOnce({
        entries: firstPage,
        total: 2,
        has_more: true,
      })
      .mockResolvedValueOnce({
        entries: [...older, ...firstPage],
        total: 2,
        has_more: false,
      });

    await loadDetail();
    updateEntryField("e1", { field: "amount", postingIndex: 0, value: 15 });
    await vi.waitFor(() => expect(getBaseline()).toHaveLength(2));
    const base = getBaseline().find((e) => e.id === "e1")!;
    expect(base.postings[0]!.amount).toBe(10);
    expect(getDetailEntries().find((e) => e.id === "e1")!.postings[0]!.amount).toBe(15);
  });
});
