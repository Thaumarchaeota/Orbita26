import { getWriteTarget } from "../state/write-target";
import type { Entry, Posting } from "../types";

export function normalizePosting(p: Posting): Posting {
  return {
    ...p,
    amount: p.amount == null ? null : Number(p.amount),
    currency: (p.currency || "").trim(),
    price_amount: p.price_amount ?? null,
    price_currency: (p.price_currency || "").trim(),
    cost_amount: p.cost_amount ?? null,
    cost_currency: (p.cost_currency || "").trim(),
    lot_amount: p.lot_amount ?? null,
    lot_currency: (p.lot_currency || "").trim(),
    lot_date: (p.lot_date || "").trim(),
  };
}

export function normalizeEntry(e: Entry): Entry {
  return {
    ...e,
    kind: "transaction",
    flag: (e.flag || "*").trim() || "*",
    payee: (e.payee || "").trim(),
    remark: (e.remark || "").trim(),
    tags: (e.tags || "").trim(),
    seq: (e.seq || "").trim(),
    metadata: (e.metadata ?? []).map((m) => ({
      key: (m.key || "").trim(),
      value: String(m.value ?? ""),
    })),
    postings: (e.postings || []).map(normalizePosting),
  };
}

export function normAmount(a: number | null): string | null {
  if (a == null) return null;
  return (Math.round(Number(a) * 100) / 100).toFixed(2);
}

function normMetadata(metadata: Entry["metadata"]) {
  return (metadata ?? [])
    .map((m) => ({ key: (m.key || "").trim(), value: String(m.value ?? "") }))
    .filter((m) => m.key)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function normEntry(e: Entry) {
  return {
    type: e.type,
    date: e.date,
    flag: (e.flag || "*").trim() || "*",
    payee: (e.payee || "").trim(),
    remark: (e.remark || "").trim(),
    tags: (e.tags || "").trim(),
    source_file: getWriteTarget(),
    metadata: normMetadata(e.metadata),
    postings: e.postings.map((p) => ({
      account: (p.account || "").trim(),
      amount: p.amount == null ? null : normAmount(p.amount),
      currency: ((p.currency || "").trim() || (p.amount == null ? "" : "CNY")),
      price_amount: p.price_amount == null ? null : normAmount(p.price_amount),
      price_currency: (p.price_currency || "").trim(),
      cost_amount: p.cost_amount ?? null,
      cost_currency: (p.cost_currency || "").trim(),
      lot_amount: p.lot_amount == null ? null : normAmount(p.lot_amount),
      lot_currency: (p.lot_currency || "").trim(),
      lot_date: (p.lot_date || "").trim(),
    })),
  };
}

export function entryForApi(e: Entry) {
  return {
    id: e.id,
    source_file: getWriteTarget(),
    source_line: e.source_line,
    type: e.type,
    date: e.date,
    flag: e.flag || "*",
    payee: e.payee || "",
    remark: e.remark || "",
    tags: e.tags || "",
    seq: e.seq || "",
    postings: e.postings.map((p) => ({
      account: p.account,
      amount: p.amount,
      currency: p.amount == null ? (p.currency || "").trim() : ((p.currency || "").trim() || "CNY"),
      price_amount: p.price_amount ?? null,
      price_currency: (p.price_currency || "").trim(),
      cost_amount: p.cost_amount ?? null,
      cost_currency: (p.cost_currency || "").trim(),
      lot_amount: p.lot_amount ?? null,
      lot_currency: (p.lot_currency || "").trim(),
      lot_date: (p.lot_date || "").trim(),
    })),
    metadata: (e.metadata ?? []).map((m) => ({
      key: (m.key || "").trim(),
      value: String(m.value ?? ""),
    })),
  };
}

export function buildPostingsFromSimple(
  type: string,
  account1: string,
  account2: string,
  amount: number,
  currency: string,
): Posting[] {
  const cur = currency || "CNY";
  const amt = amount;
  if (type === "expense") {
    return [
      { account: account2, amount: -amt, currency: cur },
      { account: account1, amount: amt, currency: cur },
    ];
  }
  return [
    { account: account1, amount: -amt, currency: cur },
    { account: account2, amount: amt, currency: cur },
  ];
}

export function isActiveEntry(e: Entry): boolean {
  return !e._deleted;
}

export function postingCostKey(entryId: string, pi: number): string {
  return `${entryId}:${pi}`;
}

export function hasPostingCost(p: Posting): boolean {
  if (p.cost_amount != null && Math.abs(Number(p.cost_amount)) > 0.001) return true;
  if (p.price_amount != null && Math.abs(Number(p.price_amount)) > 0.001) return true;
  if (p.lot_amount != null && Math.abs(Number(p.lot_amount)) > 0.001) return true;
  return false;
}

export function formatPostingCostLabel(p: Posting): string | null {
  if (p.cost_amount != null && (p.cost_currency || "").trim()) {
    return `@@ ${p.cost_amount} ${p.cost_currency || p.currency || "CNY"}`;
  }
  if (p.price_amount != null && (p.price_currency || "").trim()) {
    return `@ ${p.price_amount} ${p.price_currency || p.currency || "CNY"}`;
  }
  if (p.lot_amount != null && (p.lot_currency || "").trim()) {
    const date = (p.lot_date || "").trim();
    return `{${p.lot_amount} ${p.lot_currency}${date ? `, ${date}` : ""}}`;
  }
  return null;
}
