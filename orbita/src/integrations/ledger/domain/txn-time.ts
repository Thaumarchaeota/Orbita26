/** Transaction-level `time` metadata: optional local HH:mm, stored as +08:00. See docs/plans/v0.0.17-finance-chronological-order.md */

export const TXN_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type TxnMetadata = Array<{ key: string; value: string }>;

const TIME_META_RE = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d):00\+08:00$/;

export function countTimeMetadataKeys(metadata: TxnMetadata | undefined): number {
  return (metadata ?? []).filter((m) => m.key === "time").length;
}

export function extractValidTxnTime(
  metadata: TxnMetadata | undefined,
  transactionDate: string,
): string {
  const timeEntries = (metadata ?? []).filter((m) => m.key === "time");
  if (timeEntries.length !== 1) return "";
  const raw = timeEntries[0]!.value.trim();
  const strict = TIME_META_RE.exec(raw);
  if (!strict || strict[1] !== transactionDate) return "";
  return strict[2]!;
}

export function normalizeTimeInput(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const withSec = /^((?:[01]\d|2[0-3]):[0-5]\d):00$/.exec(s);
  return withSec ? withSec[1]! : s;
}

export function validateTxnTimeInput(raw: string): string | null {
  const s = normalizeTimeInput(raw);
  if (!s) return null;
  if (!TXN_TIME_RE.test(s)) return "时间须为 HH:mm（24 小时制，如 08:05）";
  return null;
}

export function formatTxnTimeMeta(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+08:00`;
}

export function displayTxnTime(metadata: TxnMetadata | undefined, transactionDate?: string): string {
  if (transactionDate) return extractValidTxnTime(metadata, transactionDate);
  const timeEntries = (metadata ?? []).filter((m) => m.key === "time");
  if (timeEntries.length !== 1) return "";
  const raw = timeEntries[0]!.value.trim();
  const strict = TIME_META_RE.exec(raw);
  return strict ? strict[2]! : "";
}

export function upsertTxnTimeMetadata(
  metadata: TxnMetadata | undefined,
  date: string,
  hhmmRaw: string,
): TxnMetadata {
  const base = metadata ?? [];
  if (countTimeMetadataKeys(base) > 1) {
    return base.map((m) => ({ ...m }));
  }
  const next = base.filter((m) => m.key !== "time").map((m) => ({ ...m }));
  const hhmm = normalizeTimeInput(hhmmRaw);
  if (hhmm) next.push({ key: "time", value: formatTxnTimeMeta(date, hhmm) });
  return next;
}

export function rewriteTxnTimeDate(
  metadata: TxnMetadata | undefined,
  newDate: string,
  oldDate: string,
): TxnMetadata | undefined {
  if (!metadata?.length) return metadata;
  if (countTimeMetadataKeys(metadata) > 1) {
    return metadata.map((m) => ({ ...m }));
  }
  const hhmm = extractValidTxnTime(metadata, oldDate);
  if (!hhmm) return metadata.map((m) => ({ ...m }));
  return upsertTxnTimeMetadata(metadata, newDate, hhmm);
}
