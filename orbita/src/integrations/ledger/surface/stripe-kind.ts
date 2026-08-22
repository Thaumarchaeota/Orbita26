import { isBalanceItem, isPadItem, isTransactionItem } from "../domain/detail-item";
import type { DetailItem, Entry } from "../types";

export type StripeKind =
  | "expense"
  | "proxy-expense"
  | "income"
  | "transfer"
  | "repayment"
  | "unknown"
  | "pad"
  | "balance";

const META_STRIPE: Record<string, StripeKind> = {
  expense: "expense",
  "proxy-expense": "proxy-expense",
  income: "income",
  transfer: "transfer",
  repayment: "repayment",
};

function stripeFromTransaction(item: Entry): StripeKind {
  const meta = item.metadata?.find((m) => m.key === "bkeasy-type")?.value;
  if (meta && meta in META_STRIPE) return META_STRIPE[meta]!;
  if (item.type === "expense") return "expense";
  if (item.type === "income") return "income";
  if (item.type === "transfer") return "transfer";
  return "unknown";
}

export function resolveStripeKind(item: DetailItem): StripeKind {
  if (isPadItem(item)) return "pad";
  if (isBalanceItem(item)) return "balance";
  if (isTransactionItem(item)) return stripeFromTransaction(item);
  return "unknown";
}
