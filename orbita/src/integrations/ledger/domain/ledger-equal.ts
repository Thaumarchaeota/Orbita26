import { isActiveEntry, normEntry } from "./entry";
import type { Entry } from "../types";

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

function seqKey(e: Entry): string {
  return (e.seq || "").trim() || `z${String(e.source_line).padStart(9, "0")}`;
}

export function commitOrderIds(entries: Entry[]): string[] {
  return entries
    .filter(isActiveEntry)
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const sa = seqKey(a);
      const sb = seqKey(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    })
    .map((e) => e.id);
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
