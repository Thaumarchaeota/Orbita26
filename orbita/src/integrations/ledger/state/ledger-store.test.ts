import { beforeEach, describe, expect, it } from "vitest";
import type { DetailItem, Entry } from "../types";
import { cloneDetailItems } from "../utils";
import {
  __testResetLedgerStore,
  beginSaveCheck,
  beginSaveSubmit,
  createNewTransaction,
  enterConfirming,
  getDetailEntries,
  getDetailItems,
  getSavePhase,
  getValidationSession,
  mergeCsvBatch,
  onSavePhaseChanged,
  pushEntry,
  recomputeSavePhase,
  returnToConfirmingAfterSubmitFailure,
  setDetailEntries,
  softDeleteEntry,
  touchWorkCopy,
  undoDeleteEntry,
  updateEntryField,
} from "./ledger-store";

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

function makePad(id: string): DetailItem {
  return {
    kind: "pad",
    id,
    source_file: "ledger/2026.bean",
    source_line: 2,
    date: "2026-01-02",
    account: "Assets:Cash",
    source_account: "Equity:Opening-Balances",
    seq: "a1",
  };
}

beforeEach(() => {
  __testResetLedgerStore();
});

describe("save state machine token invalidation", () => {
  it("clears validation session when work copy mutates after confirming", () => {
    const entries = [makeEntry("e1"), makePad("pad1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-1", "hash-1");
    expect(getSavePhase()).toBe("confirming");
    expect(getValidationSession()).toEqual({ token: "token-1", hash: "hash-1" });

    pushEntry(makeEntry("e2"));
    expect(getSavePhase()).toBe("edited");
    expect(getValidationSession()).toBeNull();
  });

  it("keeps confirming when work copy unchanged", () => {
    const entries = [makeEntry("e1"), makePad("pad1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-1", "hash-1");
    touchWorkCopy();
    expect(getSavePhase()).toBe("confirming");
    expect(getValidationSession()).not.toBeNull();
  });

  it("invalidates token on soft delete", () => {
    const entries = [makeEntry("e1"), makeEntry("e2", "2026-01-03")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-2", "hash-2");
    softDeleteEntry("e1");
    expect(getSavePhase()).toBe("edited");
    expect(getValidationSession()).toBeNull();
  });

  it("rejects mutations during checking without changing work copy", () => {
    const entries = [makeEntry("e1"), makePad("pad1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-3", "hash-3");
    beginSaveCheck();
    const before = cloneDetailItems(getDetailItems());

    expect(pushEntry(makeEntry("e2"))).toEqual({ ok: false, reason: "save-in-progress" });
    expect(softDeleteEntry("e1")).toEqual({ ok: false, reason: "save-in-progress" });
    expect(undoDeleteEntry("e1")).toEqual({ ok: false, reason: "save-in-progress" });
    expect(
      updateEntryField("e1", { field: "remark", value: "blocked" }),
    ).toEqual({ ok: false, reason: "save-in-progress" });
    expect(
      createNewTransaction({
        type: "expense",
        date: "2026-01-02",
        flag: "*",
        payee: "",
        remark: "",
        tags: "",
        postings: makeEntry("x").postings,
      }),
    ).toBe("");
    expect(mergeCsvBatch([], "forward")).toBe("");

    expect(getDetailItems()).toEqual(before);
    expect(getValidationSession()).toEqual({ token: "token-3", hash: "hash-3" });
  });

  it("rejects mutations during submitting without changing work copy", () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-4", "hash-4");
    beginSaveSubmit();
    const beforeCount = getDetailEntries().length;
    pushEntry(makeEntry("e2"));
    expect(getDetailEntries()).toHaveLength(beforeCount);
  });
});

describe("save validate and submit phases", () => {
  it("enters confirming after validate success", () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    beginSaveCheck();
    expect(getSavePhase()).toBe("checking");

    enterConfirming(cloneDetailItems(entries), "token-ok", "hash-ok");
    expect(getSavePhase()).toBe("confirming");
    expect(getValidationSession()).toEqual({ token: "token-ok", hash: "hash-ok" });
  });

  it("returns to confirming after atomic write failure", () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-commit", "hash-commit");
    beginSaveSubmit();
    expect(getSavePhase()).toBe("submitting");

    returnToConfirmingAfterSubmitFailure();
    expect(getSavePhase()).toBe("confirming");
    expect(getValidationSession()).toEqual({ token: "token-commit", hash: "hash-commit" });
  });

  it("recomputeSavePhase does not notify when phase unchanged", () => {
    setDetailEntries([makeEntry("e1")]);
    let notifyCount = 0;
    onSavePhaseChanged(() => {
      notifyCount += 1;
    });
    recomputeSavePhase();
    recomputeSavePhase();
    expect(notifyCount).toBe(0);
  });
});

describe("transaction time metadata", () => {
  it("sets, updates and clears time without changing date or seq", () => {
    const entry = makeEntry("e1");
    entry.metadata = [
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
    ];
    entry.seq = "a3";
    setDetailEntries([entry]);
    expect(updateEntryField("e1", { field: "time", value: "08:05" }).ok).toBe(true);
    const set = getDetailEntries()[0]!;
    expect(set.date).toBe("2026-01-02");
    expect(set.seq).toBe("a3");
    expect(set.flag).toBe("*");
    expect(set.metadata).toEqual([
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
      { key: "time", value: "2026-01-02T08:05:00+08:00" },
    ]);

    expect(updateEntryField("e1", { field: "time", value: "18:20" }).ok).toBe(true);
    expect(getDetailEntries()[0]!.metadata?.find((m) => m.key === "time")?.value).toBe(
      "2026-01-02T18:20:00+08:00",
    );

    expect(updateEntryField("e1", { field: "time", value: "" }).ok).toBe(true);
    const cleared = getDetailEntries()[0]!;
    expect(cleared.metadata?.some((m) => m.key === "time")).toBe(false);
    expect(cleared.metadata).toEqual([
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
    ]);
  });
});

