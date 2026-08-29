import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../domain/ledger-item";
import { entryVisualState } from "../domain/entry-visual";
import {
  __testResetLedgerStore,
  beginSaveSubmit,
  ensureLoadReady,
  getBaseline,
  getDetailEntries,
  getSavePhase,
  mergeCsvBatch,
  setDetailEntries,
} from "./ledger-store";

vi.mock("../api/client", () => ({
  fetchEntries: vi.fn(),
  fetchSettings: vi.fn().mockResolvedValue({ write_target: "ledger/2026.bean", reporting_currency: "CNY" }),
}));

import { fetchEntries } from "../api/client";

function draft(id: string): Transaction {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 0,
    date: "2026-01-05",
    flag: "*",
    payee: "导入",
    remark: "",
    tags: [],
    postings: [
      { account: "Assets:Cash", amount: "-12.00", currency: "CNY", cost_amount: null, cost_currency: null },
      { account: "Expenses:Food", amount: "12.00", currency: "CNY", cost_amount: null, cost_currency: null },
    ],
    metadata: [],
    type: "expense",
    seq: "",
  };
}

beforeEach(() => {
  __testResetLedgerStore();
  vi.mocked(fetchEntries).mockReset();
});

describe("CSV merge staging", () => {
  it("mergeCsvBatch marks drafts _is_new and keeps them out of baseline", () => {
    setDetailEntries([]);
    mergeCsvBatch([draft("txn_0123456789ABCDEFGHJKMNPQ")], "forward");
    const merged = getDetailEntries();
    expect(merged).toHaveLength(1);
    expect(merged[0]!._is_new).toBe(true);
    expect(entryVisualState(merged[0]!, getBaseline())).toBe("new");
    expect(getBaseline()).toHaveLength(0);
  });

  it("keeps CSV time metadata after merge", () => {
    setDetailEntries([]);
    const withTime = draft("txn_0123456789ABCDEFGHJKMNPQ");
    withTime.metadata = [
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
      { key: "time", value: "2026-01-05T08:05:00+08:00" },
    ];
    mergeCsvBatch([withTime], "forward");
    expect(getDetailEntries()[0]!.metadata).toEqual(withTime.metadata);
  });

  it("ensureLoadReady returns false while loadState stays partial", async () => {
    const { loadDetail } = await import("./ledger-store");
    const make = (id: string) => ({
      kind: "transaction" as const,
      id,
      source_file: "ledger/2026.bean",
      source_line: 1,
      type: "expense" as const,
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
    });

    vi.mocked(fetchEntries)
      .mockResolvedValueOnce({
        entries: Array.from({ length: 50 }, (_, i) => make(`e${i}`)),
        total: 200,
        has_more: true,
      })
      .mockRejectedValueOnce(new Error("bg fail"));

    await loadDetail();
    expect(getSavePhase()).toBe("unedited");
    const ready = await ensureLoadReady();
    expect(ready).toBe(false);
  });

  it("beginSaveSubmit stays in submitting until markSaveSucceeded", () => {
    beginSaveSubmit();
    expect(getSavePhase()).toBe("submitting");
  });
});
