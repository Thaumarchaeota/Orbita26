import { getActiveCommitItems } from "./detail-item-api";
import { isActiveEntry, normEntry } from "./entry";
import { sortForCommit } from "./seq";
import type { DetailItem, Entry } from "../types";

export { isActiveEntry };

function normEqual(a: ReturnType<typeof normEntry>, b: ReturnType<typeof normEntry>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ledgerEqual(a: Entry[], b: Entry[]): boolean {
  const ma = new Map<string, ReturnType<typeof normEntry>>();
  const mb = new Map<string, ReturnType<typeof normEntry>>();
  for (const e of a) {
    if (!isActiveEntry(e)) continue;
    ma.set(e.id, normEntry(e));
  }
  for (const e of b) {
    if (!isActiveEntry(e)) continue;
    mb.set(e.id, normEntry(e));
  }
  if (ma.size !== mb.size) return false;
  for (const [id, va] of ma) {
    const vb = mb.get(id);
    if (!vb || !normEqual(va, vb)) return false;
  }
  return true;
}

export function commitOrderIds(entries: Entry[]): string[] {
  return sortForCommit(entries.filter(isActiveEntry)).map((e) => e.id);
}

export function ledgerStateEqual(a: Entry[], b: Entry[]): boolean {
  const orderA = commitOrderIds(a);
  const orderB = commitOrderIds(b);
  if (orderA.length !== orderB.length) return false;
  for (let i = 0; i < orderA.length; i++) {
    if (orderA[i] !== orderB[i]) return false;
  }
  return ledgerEqual(a, b);
}

function normPad(item: Extract<DetailItem, { kind: "pad" }>) {
  return {
    kind: "pad" as const,
    date: item.date,
    account: item.account,
    source_account: item.source_account,
    seq: (item.seq || "").trim(),
  };
}

function normBalance(item: Extract<DetailItem, { kind: "balance" }>) {
  return {
    kind: "balance" as const,
    date: item.date,
    account: item.account,
    amount: item.amount,
    currency: item.currency,
    seq: (item.seq || "").trim(),
  };
}

function detailItemKey(item: DetailItem): string {
  return item.id || `${item.source_file}:${item.source_line}`;
}

export function detailStateEqual(a: DetailItem[], b: DetailItem[]): boolean {
  const activeA = getActiveCommitItems(a);
  const activeB = getActiveCommitItems(b);
  if (activeA.length !== activeB.length) return false;
  const ma = new Map(activeA.map((item) => [detailItemKey(item), item]));
  const mb = new Map(activeB.map((item) => [detailItemKey(item), item]));
  if (ma.size !== mb.size) return false;
  for (const [id, va] of ma) {
    const vb = mb.get(id);
    if (!vb || va.kind !== vb.kind) return false;
    if (va.kind === "pad" && vb.kind === "pad") {
      if (JSON.stringify(normPad(va)) !== JSON.stringify(normPad(vb))) return false;
      continue;
    }
    if (va.kind === "balance" && vb.kind === "balance") {
      if (JSON.stringify(normBalance(va)) !== JSON.stringify(normBalance(vb))) return false;
      continue;
    }
    if (va.kind !== "transaction" || vb.kind !== "transaction") return false;
    if (!isActiveEntry(va) || !isActiveEntry(vb)) return false;
    if (!normEqual(normEntry(va), normEntry(vb))) return false;
  }
  return true;
}
