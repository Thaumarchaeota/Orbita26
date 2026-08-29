import type { Posting } from "../types";
import {
  buildAccountIndex,
  validateOpenCurrency,
} from "./account-validate";

export function validateComposerPostings(postings: Posting[]): string | null {
  const index = buildAccountIndex();
  for (let i = 0; i < postings.length; i++) {
    const p = postings[i]!;
    const account = (p.account || "").trim();
    if (!account) return `第 ${i + 1} 行须选择账户`;
    if (!index.allNames.has(account)) return `账户不存在: ${account}`;
    if (p.amount != null) {
      const cur = (p.currency || "").trim() || "CNY";
      const curErr = validateOpenCurrency(index.findRecord(account), cur);
      if (curErr) return `第 ${i + 1} 行: ${curErr}`;
    }
    if (p.cost_amount != null && Math.abs(p.cost_amount) > 0.001) {
      const cc = (p.cost_currency || "").trim();
      if (!cc) return `第 ${i + 1} 行须填写 @@ 成本币种`;
    }
  }
  return null;
}
