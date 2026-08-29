import { getWriteTarget } from "../state/write-target";
import { isBalanceItem, isPadItem, isTransactionItem } from "./detail-item";
import { entryForApi, isActiveEntry } from "./entry";
import type { BalanceItem, DetailItem, PadItem } from "../types";

export function padItemForApi(item: PadItem) {
  return {
    kind: "pad" as const,
    id: item.id,
    source_file: item.source_file || getWriteTarget(),
    source_line: item.source_line,
    date: item.date,
    account: item.account,
    source_account: item.source_account,
    seq: item.seq || "",
  };
}

export function balanceItemForApi(item: BalanceItem) {
  return {
    kind: "balance" as const,
    id: item.id,
    source_file: item.source_file || getWriteTarget(),
    source_line: item.source_line,
    date: item.date,
    account: item.account,
    amount: item.amount,
    currency: item.currency,
    seq: item.seq || "",
  };
}

export function detailItemForApi(item: DetailItem) {
  if (isPadItem(item)) return padItemForApi(item);
  if (isBalanceItem(item)) return balanceItemForApi(item);
  return { kind: "transaction" as const, ...entryForApi(item) };
}

export function getWriteTargetItems(items: DetailItem[]): DetailItem[] {
  const target = getWriteTarget();
  return items.filter((item) => item.source_file === target);
}

export function getActiveCommitItems(items: DetailItem[]): DetailItem[] {
  return getWriteTargetItems(items).filter((item) => {
    if (isTransactionItem(item)) return isActiveEntry(item);
    return true;
  });
}
