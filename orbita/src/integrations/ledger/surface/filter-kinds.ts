import type { StripeKind } from "./stripe-kind";

export type FilterableStripeKind = Exclude<
  StripeKind,
  "pad" | "balance"
>;

export const ALL_FILTERABLE_STRIPE_KINDS: readonly FilterableStripeKind[] = [
  "expense",
  "proxy-expense",
  "income",
  "transfer",
  "repayment",
  "unknown",
];

export function isFilterableStripeKind(value: string): value is FilterableStripeKind {
  return (ALL_FILTERABLE_STRIPE_KINDS as readonly string[]).includes(value);
}
