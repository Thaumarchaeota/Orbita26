import type { Entry } from "../../types";

export type CategorySum = {
  account: string;
  label: string;
  total: number;
};

function currentMonthPrefix(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function isMonthExpense(entry: Entry, monthPrefix: string): boolean {
  if (entry._deleted) return false;
  if (entry.type !== "expense") return false;
  return entry.date.startsWith(monthPrefix);
}

export function aggregateMonthExpenses(entries: Entry[]): number {
  const monthPrefix = currentMonthPrefix();
  let sum = 0;
  for (const entry of entries) {
    if (!isMonthExpense(entry, monthPrefix)) continue;
    for (const p of entry.postings) {
      if (p.account.startsWith("Expenses:") && p.amount > 0) {
        sum += p.amount;
      }
    }
  }
  return Math.round(sum * 100) / 100;
}

export function aggregateByCategory(
  entries: Entry[],
  labelByAccount?: Map<string, string>,
): CategorySum[] {
  const monthPrefix = currentMonthPrefix();
  const sums = new Map<string, number>();
  for (const entry of entries) {
    if (!isMonthExpense(entry, monthPrefix)) continue;
    for (const p of entry.postings) {
      if (p.account.startsWith("Expenses:") && p.amount > 0) {
        sums.set(p.account, (sums.get(p.account) || 0) + p.amount);
      }
    }
  }
  const result: CategorySum[] = [];
  for (const [account, total] of sums) {
    const label =
      labelByAccount?.get(account) || account.split(":").pop() || account;
    result.push({ account, label, total: Math.round(total * 100) / 100 });
  }
  result.sort((a, b) => b.total - a.total);
  return result.slice(0, 10);
}
