import { getModalRoot } from "../../../ui/modal-root";
import type { CardStripesSettings } from "../types";

export const CARD_STRIPE_KEYS = [
  "expense",
  "proxy_expense",
  "income",
  "transfer",
  "repayment",
  "pad",
  "balance",
] as const;

export type CardStripeKey = (typeof CARD_STRIPE_KEYS)[number];

export const CARD_STRIPE_LABELS: Record<CardStripeKey, string> = {
  expense: "支出",
  proxy_expense: "代支出",
  income: "收入",
  transfer: "转账",
  repayment: "还款",
  pad: "Pad",
  balance: "Balance",
};

export const DEFAULT_CARD_STRIPE_COLORS: Record<CardStripeKey, string> = {
  expense: "#D48806",
  proxy_expense: "#E8B35A",
  income: "#4A8A62",
  transfer: "#4A5A8A",
  repayment: "#7AA3D4",
  pad: "#6A6A6A",
  balance: "#6A6A6A",
};

function stripeKeyToCssVar(key: CardStripeKey): string {
  return `--cds-stripe-${key.replace(/_/g, "-")}`;
}

/** Apply Finance card stripe colors to `.ledger-app` and modal root (portaled pickers). */
export function syncFinanceCardStripes(
  root: HTMLElement,
  overrides?: CardStripesSettings,
): void {
  const portalRoot = getModalRoot();
  for (const key of CARD_STRIPE_KEYS) {
    const value = overrides?.[key] ?? DEFAULT_CARD_STRIPE_COLORS[key];
    if (!value) continue;
    const varName = stripeKeyToCssVar(key);
    root.style.setProperty(varName, value);
    portalRoot.style.setProperty(varName, value);
  }
  root.style.setProperty("--finance-control-radius", "8px");
  root.style.setProperty("--admin-radius-sm", "6px");
  portalRoot.style.setProperty("--cds-stripe-unknown", "#D4D4D4");
  portalRoot.style.setProperty("--finance-control-radius", "8px");
  portalRoot.style.setProperty("--admin-radius-sm", "6px");
}
