import type { DetailItem, Entry } from "../types";

function txn(
  id: string,
  source_line: number,
  type: Entry["type"],
  date: string,
  payee: string,
  remark: string,
  tags: string,
  seq: string,
  postings: Entry["postings"],
  metadata?: Entry["metadata"],
): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line,
    type,
    date,
    flag: "*",
    payee,
    remark,
    tags,
    seq,
    postings,
    ...(metadata ? { metadata } : {}),
  };
}

/** Phase A static fixtures; committed-shaped only — replaced by Store snapshot in Phase B. */
export const CARD_DETAIL_FIXTURES: DetailItem[] = [
  txn("txn_fixture_20260809_01", 10, "expense", "2026-08-09", "盒马鲜生", "周末采购", "日常 食材 周末 超市", "a", [
    { account: "Expenses:Food:Grocery", amount: 128.5, currency: "CNY", cost_amount: 128.5, cost_currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -128.5, currency: "CNY" },
  ]),
  txn("txn_fixture_20260809_02", 12, "income", "2026-08-09", "雇主", "八月工资", "薪资", "b", [
    { account: "Income:Salary", amount: -15000, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: 15000, currency: "CNY" },
  ]),
  txn("txn_fixture_20260809_03", 14, "expense", "2026-08-09", "星巴克", "咖啡", "餐饮", "c", [
    { account: "Expenses:Food:Dining", amount: 38, currency: "CNY" },
    { account: "Assets:Cash", amount: -38, currency: "CNY" },
  ]),
  txn("txn_fixture_20260809_04", 16, "transfer", "2026-08-09", "", "零钱归集", "", "d", [
    { account: "Assets:Bank:CMB", amount: 200, currency: "CNY" },
    { account: "Assets:Cash", amount: -200, currency: "CNY" },
  ]),
  txn("txn_fixture_20260808_01", 20, "expense", "2026-08-08", "美团", "外卖晚餐", "餐饮", "e", [
    { account: "Expenses:Food:Dining", amount: 52.8, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -52.8, currency: "CNY" },
  ]),
  txn("txn_fixture_20260808_02", 22, "transfer", "2026-08-08", "", "还信用卡", "", "f", [
    { account: "Liabilities:Credit:CMB", amount: 3200, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -3200, currency: "CNY" },
  ], [{ key: "bkeasy-type", value: "repayment" }]),
  txn("txn_fixture_20260808_03", 24, "expense", "2026-08-08", "滴滴", "机场接送", "交通", "g", [
    { account: "Expenses:Transport:Taxi", amount: 86, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -86, currency: "CNY" },
  ]),
  txn("txn_fixture_20260808_04", 26, "income", "2026-08-08", "闲鱼", "二手出售", "闲置", "h", [
    { account: "Income:Other", amount: -120, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: 120, currency: "CNY" },
  ]),
  {
    kind: "pad",
    id: "pad_fixture_20260808",
    source_file: "ledger/2026.bean",
    source_line: 28,
    date: "2026-08-08",
    account: "Expenses:Food",
    source_account: "Equity:Opening-Balances",
    seq: "i",
  },
  txn("txn_fixture_20260807_01", 30, "expense", "2026-08-07", "地铁", "通勤", "交通", "j", [
    { account: "Expenses:Transport:Metro", amount: 6, currency: "CNY" },
    { account: "Assets:Cash", amount: -6, currency: "CNY" },
  ]),
  txn("txn_fixture_20260807_02", 32, "expense", "2026-08-07", "便利店", "早餐", "餐饮", "k", [
    { account: "Expenses:Food:Dining", amount: 15.5, currency: "CNY" },
    { account: "Assets:Cash", amount: -15.5, currency: "CNY" },
  ]),
  txn("txn_fixture_20260807_03", 34, "expense", "2026-08-07", "京东", "日用品", "家居", "l", [
    { account: "Expenses:Household", amount: 89.9, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -89.9, currency: "CNY" },
  ]),
  {
    kind: "balance",
    id: "balance_fixture_20260807",
    source_file: "ledger/2026.bean",
    source_line: 36,
    date: "2026-08-07",
    account: "Assets:Bank:CMB",
    amount: "28560.50",
    currency: "CNY",
    seq: "m",
  },
  txn("txn_fixture_20260806_01", 38, "expense", "2026-08-06", "电影院", "观影", "娱乐", "n", [
    { account: "Expenses:Entertainment", amount: 78, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -78, currency: "CNY" },
  ]),
  txn("txn_fixture_20260806_02", 40, "expense", "2026-08-06", "加油站", "加油", "交通", "o", [
    { account: "Expenses:Transport:Fuel", amount: 320, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -320, currency: "CNY" },
  ]),
  txn("txn_fixture_20260806_03", 42, "transfer", "2026-08-06", "", "给家人转账", "家庭", "p", [
    { account: "Assets:Bank:CMB", amount: -1000, currency: "CNY" },
    { account: "Assets:Cash", amount: 1000, currency: "CNY" },
  ]),
  txn("txn_fixture_20260805_01", 44, "expense", "2026-08-05", "医院", "代家人体检", "健康", "q", [
    { account: "Expenses:Health", amount: 560, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -560, currency: "CNY" },
  ], [{ key: "bkeasy-type", value: "proxy-expense" }]),
  txn("txn_fixture_20260805_02", 46, "expense", "2026-08-05", "书店", "技术书", "学习", "r", [
    { account: "Expenses:Education", amount: 128, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -128, currency: "CNY" },
  ]),
  txn("txn_fixture_20260805_03", 48, "income", "2026-08-05", "客户 A", "设计稿预付", "freelance", "s", [
    { account: "Income:Freelance", amount: -2000, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: 2000, currency: "CNY" },
  ]),
  txn("txn_fixture_20260804_01", 50, "expense", "2026-08-04", "超市", "一周食材", "食材", "t", [
    { account: "Expenses:Food:Grocery", amount: 215.3, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -215.3, currency: "CNY" },
  ]),
  txn("txn_fixture_20260804_02", 52, "expense", "2026-08-04", "话费", "八月套餐", "通讯", "u", [
    { account: "Expenses:Utilities:Phone", amount: 99, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -99, currency: "CNY" },
  ]),
  txn("txn_fixture_20260803_01", 54, "expense", "2026-08-03", "健身房", "月卡续费", "健康", "v", [
    { account: "Expenses:Health:Fitness", amount: 299, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -299, currency: "CNY" },
  ]),
  txn("txn_fixture_20260803_02", 56, "expense", "2026-08-03", "公交", "通勤", "交通", "w", [
    { account: "Expenses:Transport:Bus", amount: 2, currency: "CNY" },
    { account: "Assets:Cash", amount: -2, currency: "CNY" },
  ]),
  txn("txn_fixture_20260802_01", 58, "expense", "2026-08-02", "餐厅", "朋友聚餐", "社交 餐饮", "x", [
    { account: "Expenses:Food:Dining", amount: 268, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -268, currency: "CNY" },
  ]),
  txn("txn_fixture_20260802_02", 60, "transfer", "2026-08-02", "", "信用卡还款", "", "y", [
    { account: "Liabilities:Credit:CMB", amount: 1500, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -1500, currency: "CNY" },
  ]),
  txn("txn_fixture_20260801_01", 62, "expense", "2026-08-01", "房租", "八月房租", "住房", "z", [
    { account: "Expenses:Housing:Rent", amount: 4500, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: -4500, currency: "CNY" },
  ]),
  txn("txn_fixture_20260801_02", 64, "income", "2026-08-01", "雇主", "住房补贴", "薪资", "a0", [
    { account: "Income:Salary:Allowance", amount: -800, currency: "CNY" },
    { account: "Assets:Bank:CMB", amount: 800, currency: "CNY" },
  ]),
];
