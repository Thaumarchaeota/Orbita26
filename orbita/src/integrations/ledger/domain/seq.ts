import { isActiveEntry } from "./entry";
import type { Entry } from "../types";

export function initialSeq(n: number): string {
  return `a${n}`;
}

export function successor(seq: string): string {
  const m = /^a(\d+)$/.exec(seq || "");
  const n = m ? parseInt(m[1], 10) + 1 : 0;
  return initialSeq(n);
}

export function seqNum(seq: string, sourceLine: number): number {
  const m = /^a(\d+)$/.exec((seq || "").trim());
  return m ? parseInt(m[1], 10) : sourceLine;
}

export function nextSeqForDate(entries: Entry[], dateStr: string, excludeId?: string): string {
  let max = "";
  for (const e of entries) {
    if (!isActiveEntry(e) || e.date !== dateStr) continue;
    if (excludeId && e.id === excludeId) continue;
    if (!max || e.seq > max) max = e.seq;
  }
  return max ? successor(max) : initialSeq(0);
}

export function compareSeqDesc(a: Entry, b: Entry): number {
  return seqNum(b.seq, b.source_line) - seqNum(a.seq, a.source_line);
}

export function sortDetailEntries(entries: Entry[]): void {
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return compareSeqDesc(a, b);
  });
}

function commitSeqKey(e: Entry): string {
  const seq = (e.seq || "").trim();
  return seq || `z${String(e.source_line).padStart(9, "0")}`;
}

export function sortForCommit(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const sa = commitSeqKey(a);
    const sb = commitSeqKey(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

export function entriesForDate(entries: Entry[], dateStr: string): Entry[] {
  return entries
    .filter((e) => isActiveEntry(e) && e.date === dateStr)
    .slice()
    .sort(compareSeqDesc);
}

export function assignDateSeq(list: Entry[]): void {
  const n = list.length;
  list.forEach((e, i) => {
    e.seq = initialSeq(n - 1 - i);
  });
}

export function moveEntryOnDate(
  entries: Entry[],
  draggedId: string,
  targetId: string,
  insertAfter: boolean,
): boolean {
  const dragged = entries.find((e) => e.id === draggedId);
  const target = entries.find((e) => e.id === targetId);
  if (!dragged || !target || dragged.id === target.id) return false;
  if (dragged.date !== target.date) return false;

  const before = entriesForDate(entries, dragged.date)
    .map((e) => e.id)
    .join("|");
  const list = entriesForDate(entries, dragged.date).filter((e) => e.id !== draggedId);
  let idx = list.findIndex((e) => e.id === targetId);
  if (idx < 0) return false;
  if (insertAfter) idx += 1;
  list.splice(idx, 0, dragged);
  if (list.map((e) => e.id).join("|") === before) return false;
  assignDateSeq(list);
  return true;
}
