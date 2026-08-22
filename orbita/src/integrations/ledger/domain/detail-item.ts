import { normalizeEntry } from "./entry";
import type { BalanceItem, DetailItem, Entry, PadItem } from "../types";

export function isPadItem(item: DetailItem): item is PadItem {
  return item.kind === "pad";
}

export function isBalanceItem(item: DetailItem): item is BalanceItem {
  return item.kind === "balance";
}

export function isTransactionItem(item: DetailItem): item is Entry {
  return !isPadItem(item) && !isBalanceItem(item);
}

export function normalizeDetailItem(raw: DetailItem): DetailItem {
  const kind = (raw.kind || "transaction").toString().toLowerCase();
  if (kind === "pad") {
    const p = raw as PadItem;
    return {
      kind: "pad",
      id: p.id || "",
      source_file: p.source_file || "",
      source_line: p.source_line || 0,
      date: p.date || "",
      account: (p.account || "").trim(),
      source_account: (p.source_account || "").trim(),
      seq: (p.seq || "").trim(),
    };
  }
  if (kind === "balance") {
    const b = raw as BalanceItem;
    return {
      kind: "balance",
      id: b.id || "",
      source_file: b.source_file || "",
      source_line: b.source_line || 0,
      date: b.date || "",
      account: (b.account || "").trim(),
      amount: String(b.amount ?? "0"),
      currency: (b.currency || "").trim() || "CNY",
      seq: (b.seq || "").trim(),
    };
  }
  return normalizeEntry(raw as Entry);
}
