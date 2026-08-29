import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import {
  __testResetLedgerStore,
  enterConfirming,
  getSavePhase,
  getValidationSession,
  setDetailEntries,
} from "../state/ledger-store";
import { cloneEntries } from "../utils";
import { createLedgerCardStore } from "./ledger-card-store";

function makeEntry(id: string, date = "2026-08-09"): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date,
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
  __testResetLedgerStore();
});

describe("ledger card store Phase C", () => {
  it("invalidates validation token on update-entry dispatch", () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneEntries(entries), "tok", "hash");
    const store = createLedgerCardStore();
    store.dispatch({ type: "update-entry", id: "e1", patch: { field: "remark", value: "新标题" } });
    expect(getSavePhase()).toBe("edited");
    expect(getValidationSession()).toBeNull();
    store.dispose();
  });

  it("soft-delete and undo-delete via dispatch", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "soft-delete", id: "e1" });
    const deleted = store.getSnapshot().items.find((i) => i.id === "e1") as Entry;
    expect(deleted._deleted).toBe(true);
    store.dispatch({ type: "undo-delete", id: "e1" });
    const restored = store.getSnapshot().items.find((i) => i.id === "e1") as Entry;
    expect(restored._deleted).toBeFalsy();
    store.dispose();
  });

  it("soft-delete removes unsaved _is_new entry from work copy", () => {
    setDetailEntries([]);
    const store = createLedgerCardStore();
    store.dispatch({
      type: "create-transaction",
      draft: {
        type: "expense",
        date: "2026-08-09",
        flag: "*",
        payee: "",
        remark: "临时",
        tags: "",
        postings: [
          { account: "Expenses:Food", amount: 5, currency: "CNY" },
          { account: "Assets:Cash", amount: -5, currency: "CNY" },
        ],
      },
    });
    const id = store.getSnapshot().items[0]!.id;
    expect(store.getSnapshot().isDirty).toBe(true);
    store.dispatch({ type: "soft-delete", id });
    expect(store.getSnapshot().items.some((i) => i.id === id)).toBe(false);
    expect(store.getSnapshot().isDirty).toBe(false);
    store.dispose();
  });

  it("create-transaction adds to work copy with _is_new", () => {
    setDetailEntries([]);
    const store = createLedgerCardStore();
    store.dispatch({
      type: "create-transaction",
      draft: {
        type: "expense",
        date: "2026-08-09",
        flag: "*",
        payee: "",
        remark: "测试",
        tags: "",
        postings: [
          { account: "Expenses:Food", amount: 5, currency: "CNY" },
          { account: "Assets:Cash", amount: -5, currency: "CNY" },
        ],
      },
    });
    const snap = store.getSnapshot();
    expect(snap.isDirty).toBe(true);
    const txn = snap.items.find((i) => i.kind !== "pad") as Entry;
    expect(txn._is_new).toBe(true);
    expect(txn.remark).toBe("测试");
    store.dispose();
  });

  it("snapshot items remain deeply frozen after dispatch", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    store.dispatch({ type: "update-entry", id: "e1", patch: { field: "payee", value: "x" } });
    const snap = store.getSnapshot();
    expect(() => {
      (snap.items[0] as Entry).payee = "hack";
    }).toThrow();
    store.dispose();
  });

  it("stops notifying after dispose", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    let count = 0;
    store.subscribe(() => {
      count += 1;
    });
    store.dispose();
    store.dispatch({ type: "soft-delete", id: "e1" });
    expect(count).toBe(0);
  });
});
