import type { AccountGroup, AccountRecord } from "../types";
import { getAccountRecords, getAllAccountList } from "../state/accounts";

const GROUP_KEYS: AccountGroup[] = ["expenses", "income", "assets", "liabilities", "equity"];

export type AccountIndex = {
  allNames: Set<string>;
  findRecord: (name: string) => AccountRecord | undefined;
};

export function buildAccountIndex(): AccountIndex {
  return {
    allNames: new Set(getAllAccountList()),
    findRecord: findAccountRecord,
  };
}

export function findAccountRecord(name: string): AccountRecord | undefined {
  for (const g of GROUP_KEYS) {
    const found = getAccountRecords(g).find((r) => r.name === name);
    if (found) return found;
  }
  return undefined;
}

export function accountRootKind(name: string): AccountGroup | null {
  if (name.startsWith("Expenses:")) return "expenses";
  if (name.startsWith("Income:")) return "income";
  if (name.startsWith("Assets:")) return "assets";
  if (name.startsWith("Liabilities:")) return "liabilities";
  if (name.startsWith("Equity:")) return "equity";
  return null;
}

export function isAssetsOrLiabilities(name: string): boolean {
  const k = accountRootKind(name);
  return k === "assets" || k === "liabilities";
}

export function parseAllowedCurrencies(extra: string): string[] {
  const text = (extra || "").trim();
  if (!text) return [];
  return text.split(/[\s,]+/).filter((t) => /^[A-Z]{3}$/.test(t));
}

export function validateOpenCurrency(
  record: AccountRecord | undefined,
  currency: string,
): string | null {
  if (!record) return null;
  const allowed = parseAllowedCurrencies(record.extra);
  if (!allowed.length) return null;
  if (!allowed.includes(currency)) return `币种须为 ${allowed.join(" 或 ")}`;
  return null;
}

export function allowedCurrenciesForAccount(
  record: AccountRecord | undefined,
): string[] | null {
  if (!record) return null;
  const allowed = parseAllowedCurrencies(record.extra);
  return allowed.length ? allowed : null;
}

/** null = both unrestricted */
export function intersectAllowedCurrencies(
  r1: AccountRecord | undefined,
  r2: AccountRecord | undefined,
): string[] | null {
  const a = allowedCurrenciesForAccount(r1);
  const b = allowedCurrenciesForAccount(r2);
  if (!a && !b) return null;
  if (a && !b) return [...a];
  if (!a && b) return [...b];
  return a!.filter((c) => b!.includes(c));
}

export function simpleModeNeedsAdvanced(account1: string, account2: string): boolean {
  if (!account1 || !account2) return false;
  const index = buildAccountIndex();
  const common = intersectAllowedCurrencies(
    index.findRecord(account1),
    index.findRecord(account2),
  );
  if (common === null) return false;
  return common.length === 0;
}

export function expectedCsvRoots(type: "expense" | "income" | "transfer"): {
  from: (name: string) => boolean;
  to: (name: string) => boolean;
} {
  if (type === "expense") {
    return {
      from: isAssetsOrLiabilities,
      to: (n) => accountRootKind(n) === "expenses",
    };
  }
  if (type === "income") {
    return {
      from: (n) => accountRootKind(n) === "income",
      to: isAssetsOrLiabilities,
    };
  }
  return { from: isAssetsOrLiabilities, to: isAssetsOrLiabilities };
}
