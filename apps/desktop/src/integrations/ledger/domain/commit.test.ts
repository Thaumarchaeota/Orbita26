import { beforeEach, describe, expect, it } from "vitest";
import { buildCommitPayload, buildValidatePayload } from "./commit";
import type { DetailItem, Entry } from "../types";
import { setWriteTarget } from "../state/write-target";

function makeTxn(id: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-03-01",
    flag: "*",
    payee: "午餐",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
  };
}

const pad: DetailItem = {
  kind: "pad",
  id: "pad-1",
  source_file: "ledger/2026.bean",
  source_line: 2,
  date: "2026-03-01",
  account: "Assets:Cash",
  source_account: "Equity:Opening-Balances",
  seq: "a1",
};

const balance: DetailItem = {
  kind: "balance",
  id: "bal-1",
  source_file: "ledger/2026.bean",
  source_line: 3,
  date: "2026-03-01",
  account: "Assets:Cash",
  amount: "100.00",
  currency: "CNY",
  seq: "a2",
};

beforeEach(() => {
  setWriteTarget("ledger/2026.bean");
});

describe("buildValidatePayload / buildCommitPayload", () => {
  it("includes pad and balance with edited transaction", () => {
    const txn = makeTxn("txn-1");
    txn.remark = "改过的备注";
    const items: DetailItem[] = [txn, pad, balance];
    const validate = buildValidatePayload(items);
    expect(validate.items).toHaveLength(3);
    expect(validate.items.map((i) => i.kind)).toEqual(["transaction", "pad", "balance"]);

    const commit = buildCommitPayload(items, "token", "hash");
    expect(commit.items).toHaveLength(3);
    expect(commit.validation_token).toBe("token");
    expect(commit.candidate_hash).toBe("hash");
  });

  it("excludes soft-deleted transactions but keeps pad/balance", () => {
    const deleted = makeTxn("txn-del");
    deleted._deleted = true;
    const items: DetailItem[] = [deleted, pad, balance, makeTxn("txn-active")];
    const payload = buildValidatePayload(items);
    expect(payload.items).toHaveLength(3);
    expect(payload.items.some((i) => "id" in i && i.id === "txn-del")).toBe(false);
    expect(payload.items.some((i) => i.kind === "pad")).toBe(true);
    expect(payload.items.some((i) => i.kind === "balance")).toBe(true);
  });

  it("filters out items from other source files", () => {
    const other = { ...makeTxn("other"), source_file: "ledger/2025.bean" };
    const items: DetailItem[] = [makeTxn("txn-1"), other, pad];
    const payload = buildValidatePayload(items);
    expect(payload.items).toHaveLength(2);
    expect(payload.items.every((i) => i.source_file === "ledger/2026.bean")).toBe(true);
  });

  it("preserves transaction metadata in commit payload", () => {
    const txn = makeTxn("txn-meta");
    txn.metadata = [
      { key: "time", value: "2026-05-19T14:32:00+08:00" },
      { key: "custom-note", value: "保留" },
    ];
    const payload = buildCommitPayload([txn], "token", "hash");
    const item = payload.items[0];
    expect(item.kind).toBe("transaction");
    if (item.kind !== "transaction") return;
    expect(item.metadata).toEqual([
      { key: "time", value: "2026-05-19T14:32:00+08:00" },
      { key: "custom-note", value: "保留" },
    ]);
  });
});
