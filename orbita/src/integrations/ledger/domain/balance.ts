import { EPSILON } from "../constants";
import type { Entry, Posting } from "../types";

export type BalanceResult = { ok: true } | { ok: false; message: string };

function postingCurrency(p: Posting): string {
  return (p.currency || "").trim() || "CNY";
}

export function validatePostingBalance(postings: Posting[]): BalanceResult {
  const currencies = new Set(postings.map(postingCurrency));

  if (currencies.size <= 1) {
    const totals: Record<string, number> = {};
    for (const p of postings) {
      const cur = postingCurrency(p);
      totals[cur] = (totals[cur] ?? 0) + p.amount;
    }
    for (const [cur, total] of Object.entries(totals)) {
      if (Math.abs(total) > EPSILON) {
        return { ok: false, message: `分录未配平（${cur} 合计 ${total.toFixed(2)}）` };
      }
    }
    return { ok: true };
  }

  const hasCost = postings.some(
    (p) => p.cost_amount != null && Math.abs(p.cost_amount) > EPSILON,
  );
  if (!hasCost) {
    return { ok: false, message: "跨币种须指定 @@ 成本" };
  }

  const totals: Record<string, number> = {};
  const costAnnotated = new Set<string>();

  for (const p of postings) {
    const cur = postingCurrency(p);
    totals[cur] = (totals[cur] ?? 0) + p.amount;
    if (p.cost_amount != null && Math.abs(p.cost_amount) > EPSILON) {
      const cc = (p.cost_currency || "").trim();
      if (cc) {
        totals[cc] = (totals[cc] ?? 0) + p.cost_amount;
        costAnnotated.add(cur);
      }
    }
  }

  for (const [cur, total] of Object.entries(totals)) {
    if (costAnnotated.has(cur)) continue;
    if (Math.abs(total) > EPSILON) {
      return { ok: false, message: `分录未配平（${cur} 合计 ${total.toFixed(2)}）` };
    }
  }
  return { ok: true };
}

export function previewEntryBalance(
  entry: Entry,
  field?: string,
  postingIndex?: number,
  value?: string,
): BalanceResult {
  if (postingIndex == null || postingIndex < 0 || field == null || value == null) {
    return validatePostingBalance(entry.postings);
  }
  const postings = entry.postings.map((p, i) => {
    if (i !== postingIndex) return { ...p };
    const copy = { ...p };
    if (field === "amount") copy.amount = parseFloat(value) || 0;
    else if (field === "currency") copy.currency = value;
    else if (field === "cost_amount") {
      copy.cost_amount = String(value).trim() ? parseFloat(value) || 0 : null;
    } else if (field === "cost_currency") copy.cost_currency = String(value).trim();
    else if (field === "account") copy.account = value;
    return copy;
  });
  return validatePostingBalance(postings);
}
