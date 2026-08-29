import { describe, expect, it } from "vitest";
import type { DetailItem, Entry } from "../types";
import { CARD_DETAIL_FIXTURES } from "./fixtures";
import { cloneFrozenDetailItems } from "./snapshot-freeze";
import { createCardDetailSnapshotStore } from "./snapshot-store";
import { __testFlushFilterDerive } from "./ledger-card-store";

function snapshotFixtureFingerprint(): string {
  return JSON.stringify(CARD_DETAIL_FIXTURES);
}

describe("CardDetail snapshot store (Phase A fixtures)", () => {
  it("exposes frozen fixture items by default", () => {
    const store = createCardDetailSnapshotStore();
    const snap = store.getSnapshot();
    expect(snap.loadState).toBe("ready");
    expect(snap.items.length).toBe(CARD_DETAIL_FIXTURES.length);
    expect(() => {
      (snap.items as DetailItem[]).pop();
    }).toThrow();
    store.dispose();
  });

  it("filters by stripe kind via dispatch without mutating fixtures", () => {
    const store = createCardDetailSnapshotStore();
    store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    __testFlushFilterDerive(store);
    const filtered = store.getSnapshot().items;
    expect(
      filtered.every(
        (item) =>
          item.kind !== "transaction" || resolveStripeKindFromFixture(item) !== "expense",
      ),
    ).toBe(true);
    expect(filtered.length).toBeLessThan(CARD_DETAIL_FIXTURES.length);
    store.dispose();
  });

  it("rejects nested posting mutation on snapshot items", () => {
    const store = createCardDetailSnapshotStore();
    const snap = store.getSnapshot();
    const txn = snap.items.find((item) => item.kind === "transaction");
    expect(txn?.kind).toBe("transaction");
    if (txn?.kind !== "transaction") return;
    expect(() => {
      txn.postings[0]!.amount = 0;
    }).toThrow();
    store.dispose();
  });

  it("rejects metadata mutation on snapshot items", () => {
    const store = createCardDetailSnapshotStore();
    const snap = store.getSnapshot();
    const txn = snap.items.find(
      (item) => item.kind === "transaction" && item.metadata && item.metadata.length > 0,
    );
    expect(txn?.kind).toBe("transaction");
    if (txn?.kind !== "transaction" || !txn.metadata?.length) return;
    expect(() => {
      txn.metadata[0]!.value = "mutated";
    }).toThrow();
    store.dispose();
  });

  it("rejects top-level item field mutation", () => {
    const store = createCardDetailSnapshotStore();
    const snap = store.getSnapshot();
    const txn = snap.items.find((item) => item.kind === "transaction");
    expect(txn?.kind).toBe("transaction");
    if (txn?.kind !== "transaction") return;
    expect(() => {
      txn.payee = "mutated";
    }).toThrow();
    store.dispose();
  });

  it("does not pollute fixtures or later snapshots after mutation attempts", () => {
    const before = snapshotFixtureFingerprint();
    const store = createCardDetailSnapshotStore();
    const first = store.getSnapshot();
    const txn = first.items.find((item) => item.kind === "transaction");
    if (txn?.kind === "transaction") {
      try {
        txn.postings[0]!.amount = -1;
      } catch {
        // expected
      }
      try {
        txn.payee = "mutated";
      } catch {
        // expected
      }
    }
    const second = store.getSnapshot();
    expect(second.items.length).toBe(first.items.length);
    expect(snapshotFixtureFingerprint()).toBe(before);
    const fixtureTxn = CARD_DETAIL_FIXTURES.find((item) => item.kind === "transaction") as Entry;
    expect(fixtureTxn.postings[0]!.amount).not.toBe(-1);
    store.dispose();
  });

  it("returns independent frozen copies per getSnapshot call", () => {
    const items = cloneFrozenDetailItems(CARD_DETAIL_FIXTURES);
    const again = cloneFrozenDetailItems(CARD_DETAIL_FIXTURES);
    expect(items).not.toBe(again);
    const left = items.find((item) => item.kind === "transaction");
    const right = again.find((item) => item.kind === "transaction");
    if (left?.kind === "transaction" && right?.kind === "transaction") {
      expect(left.postings).not.toBe(right.postings);
      expect(left.postings[0]).not.toBe(right.postings[0]);
    }
  });
});

function resolveStripeKindFromFixture(item: DetailItem): string {
  if (item.kind !== "transaction") return item.kind;
  const meta = item.metadata?.find((m) => m.key === "bkeasy-type")?.value;
  if (meta) return meta;
  return item.type || "unknown";
}
