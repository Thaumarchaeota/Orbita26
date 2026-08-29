import { extractValidTxnTime } from "./txn-time";
import { isActiveEntry } from "./entry";
import type { DetailItem, Entry } from "../types";

type ChronologicalSortable = Pick<DetailItem, "date" | "seq" | "source_line"> & {
  kind?: DetailItem["kind"];
  metadata?: Entry["metadata"];
};

function validTimeMinutes(item: ChronologicalSortable): number | null {
  if (item.kind === "pad" || item.kind === "balance") return null;
  const hhmm = extractValidTxnTime(item.metadata, item.date);
  if (!hhmm) return null;
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(3, 5), 10);
  return h * 60 + m;
}

function compareChronological(
  a: ChronologicalSortable,
  b: ChronologicalSortable,
  dateOrder: "asc" | "desc",
): number {
  if (a.date !== b.date) {
    return dateOrder === "desc"
      ? a.date < b.date
        ? 1
        : -1
      : a.date < b.date
        ? -1
        : 1;
  }

  const ta = validTimeMinutes(a);
  const tb = validTimeMinutes(b);
  if (ta !== null && tb !== null) {
    if (ta !== tb) return ta - tb;
  } else if (ta !== null && tb === null) {
    return -1;
  } else if (ta === null && tb !== null) {
    return 1;
  }

  const sa = seqNum(a.seq, a.source_line);
  const sb = seqNum(b.seq, b.source_line);
  if (sa !== sb) return sa - sb;
  return a.source_line - b.source_line;
}

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
  let maxNum = -1;
  for (const e of entries) {
    if (!isActiveEntry(e) || e.date !== dateStr) continue;
    if (excludeId && e.id === excludeId) continue;
    const m = /^a(\d+)$/.exec((e.seq || "").trim());
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxNum) maxNum = n;
  }
  return maxNum >= 0 ? successor(initialSeq(maxNum)) : initialSeq(0);
}

export function sortDetailEntries(entries: ChronologicalSortable[]): void {
  entries.sort((a, b) => compareChronological(a, b, "desc"));
}

export function sortForCommit(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => compareChronological(a, b, "asc"));
}
