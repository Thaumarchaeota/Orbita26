import type { AccountGroup, AccountRecord, AccountsResponse } from "../types";
import { accountDisplayLabel, accountDisplaySubtitle } from "./category-display";

export { accountDisplayLabel, accountDisplaySubtitle };

let accounts: AccountsResponse = {
  expenses: [],
  income: [],
  assets: [],
  liabilities: [],
  equity: [],
};

let allAccountList: string[] = [];

const GROUP_KEYS: AccountGroup[] = ["expenses", "income", "assets", "liabilities", "equity"];
// Keep pre-Equity in-memory fixtures/loaders readable while the API always returns five groups.
type AccountsInput = Omit<AccountsResponse, "equity"> & Partial<Pick<AccountsResponse, "equity">>;

export function getAccounts(): AccountsResponse {
  return accounts;
}

export function getAllAccountList(): string[] {
  return allAccountList;
}

export function getAccountRecords(group: AccountGroup): AccountRecord[] {
  return accounts[group] || [];
}

export function getAccountNames(group: AccountGroup): string[] {
  return getAccountRecords(group).map((item) => item.name);
}

export function setAccounts(acc: AccountsInput): void {
  accounts = {
    expenses: acc.expenses || [],
    income: acc.income || [],
    assets: acc.assets || [],
    liabilities: acc.liabilities || [],
    equity: acc.equity || [],
  };
  allAccountList = GROUP_KEYS.flatMap((key) => getAccountRecords(key).map((item) => item.name)).sort();
}
