import { getWriteTarget } from "../state/write-target";
import type { Entry, Posting } from "../types";

export function normalizePosting(p: Posting): Posting {
  return {
    ...p,
    cost_amount: p.cost_amount ?? null,
    cost_currency: (p.cost_currency || "").trim(),
  };
}

export function normalizeEntry(e: Entry): Entry {
  return {
    ...e,
    postings: (e.postings || []).map(normalizePosting),
  };
}

export function normAmount(a: number): string {
  return (Math.round(Number(a) * 100) / 100).toFixed(2);
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
    postings: e.postings.map((p) => ({
      account: (p.account || "").trim(),
      amount: normAmount(p.amount),
      currency: ((p.currency || "").trim() || "CNY"),
      cost_amount: p.cost_amount ?? null,
      cost_currency: (p.cost_currency || "").trim(),
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
      currency: (p.currency || "").trim() || "CNY",
      cost_amount: p.cost_amount ?? null,
      cost_currency: (p.cost_currency || "").trim(),
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
  return p.cost_amount != null && Math.abs(Number(p.cost_amount)) > 0.001;
}
