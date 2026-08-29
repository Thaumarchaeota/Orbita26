import Papa from "papaparse";
import { CSV_HEADERS } from "../constants";
import { formatTags } from "../utils";
import type { Entry, EntryType } from "../types";
import {
  type AccountIndex,
  expectedCsvRoots,
  validateOpenCurrency,
} from "./account-validate";
import type { Transaction } from "./ledger-item";
import { newOrbitaId } from "./orbita-id";
import { nextSeqForDate, successor } from "./seq";
import { TXN_TIME_RE, formatTxnTimeMeta } from "./txn-time";

export type CsvImportOrder = "forward" | "reverse";

export type CsvRowError = {
  row: number;
  field: string | null;
  message: string;
};

export type CsvParseResult =
  | { ok: true; drafts: Transaction[] }
  | { ok: false; errors: CsvRowError[] };

const VALID_TYPES = new Set(["expense", "income", "transfer"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => !(c || "").trim());
}

function trimTrailingBlankRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && isBlankRow(rows[end - 1]!)) end -= 1;
  return rows.slice(0, end);
}

function parseCsvGrid(text: string): string[][] | { error: string } {
  const parsed = Papa.parse<string[]>(stripBom(text), { skipEmptyLines: false });
  if (parsed.errors.length) {
    const fatal = parsed.errors.find((e) => e.type !== "FieldMismatch");
    if (fatal) return { error: fatal.message || "CSV 解析失败" };
  }
  return trimTrailingBlankRows(parsed.data || []);
}

function normalizeAmount(raw: string): string | null {
  const s = raw.trim();
  if (!AMOUNT_RE.test(s)) return null;
  if (s === "0" || /^0\.0+$/.test(s)) return null;
  return s;
}

function parseTagsField(raw: string): string[] {
  const text = (raw || "").trim();
  if (!text) return [];
  return text
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((t) => t.trim().replace(/^#/, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function timeMetadata(date: string, time: string): { key: string; value: string } {
  return { key: "time", value: formatTxnTimeMeta(date, time) };
}

function buildPostings(
  fromAccount: string,
  toAccount: string,
  amount: string,
  currency: string,
): Transaction["postings"] {
  return [
    {
      account: fromAccount,
      amount: `-${amount}`,
      currency,
      cost_amount: null,
      cost_currency: null,
    },
    {
      account: toAccount,
      amount,
      currency,
      cost_amount: null,
      cost_currency: null,
    },
  ];
}

function rowToRecord(headers: string[], row: string[]): Record<string, string> {
  const rec: Record<string, string> = {};
  headers.forEach((h, i) => {
    rec[h] = (row[i] ?? "").trim();
  });
  return rec;
}

export function parseCsvImport(
  fileText: string,
  accountIndex: AccountIndex,
  writeTarget: string,
): CsvParseResult {
  if (!stripBom(fileText).trim()) {
    return { ok: false, errors: [{ row: 0, field: null, message: "文件为空" }] };
  }
  const grid = parseCsvGrid(fileText);
  if ("error" in grid) {
    return { ok: false, errors: [{ row: 0, field: null, message: grid.error }] };
  }
  if (!grid.length) {
    return { ok: false, errors: [{ row: 0, field: null, message: "文件为空" }] };
  }

  const header = grid[0]!.map((c) => (c || "").trim());
  if (header.length !== CSV_HEADERS.length || !CSV_HEADERS.every((h, i) => header[i] === h)) {
    return {
      ok: false,
      errors: [{ row: 1, field: null, message: "模板表头必须为 10 列固定英文字段名" }],
    };
  }

  const errors: CsvRowError[] = [];
  const drafts: Transaction[] = [];

  for (let i = 1; i < grid.length; i++) {
    const rowNum = i + 1;
    const cells = grid[i]!;
    if (isBlankRow(cells)) {
      errors.push({ row: rowNum, field: null, message: "空行" });
      continue;
    }
    if (cells.length !== CSV_HEADERS.length) {
      errors.push({ row: rowNum, field: null, message: `须为 ${CSV_HEADERS.length} 列` });
      continue;
    }

    const row = rowToRecord(CSV_HEADERS as unknown as string[], cells);
    const type = row.type as EntryType;
    if (!VALID_TYPES.has(type)) {
      errors.push({ row: rowNum, field: "type", message: "类型须为 expense、income 或 transfer" });
      continue;
    }

    const date = row.date;
    if (!DATE_RE.test(date)) {
      errors.push({ row: rowNum, field: "date", message: "日期须为 YYYY-MM-DD" });
      continue;
    }

    const timeRaw = row.time ?? "";
    if (timeRaw) {
      if (!TXN_TIME_RE.test(timeRaw)) {
        errors.push({ row: rowNum, field: "time", message: "时间须为 HH:mm（24 小时制，如 08:05）" });
        continue;
      }
    }

    const amount = normalizeAmount(row.amount);
    if (!amount) {
      errors.push({ row: rowNum, field: "amount", message: "金额须为大于 0 的十进制数" });
      continue;
    }

    const currency = row.currency;
    if (!currency) {
      errors.push({ row: rowNum, field: "currency", message: "币种必填" });
      continue;
    }

    const fromAccount = row.from_account;
    const toAccount = row.to_account;
    if (!fromAccount) {
      errors.push({ row: rowNum, field: "from_account", message: "发起账户必填" });
      continue;
    }
    if (!toAccount) {
      errors.push({ row: rowNum, field: "to_account", message: "对方账户必填" });
      continue;
    }

    const roots = expectedCsvRoots(type as "expense" | "income" | "transfer");
    if (!accountIndex.allNames.has(fromAccount)) {
      errors.push({ row: rowNum, field: "from_account", message: `账户不存在: ${fromAccount}` });
      continue;
    }
    if (!accountIndex.allNames.has(toAccount)) {
      errors.push({ row: rowNum, field: "to_account", message: `账户不存在: ${toAccount}` });
      continue;
    }
    if (!roots.from(fromAccount)) {
      errors.push({ row: rowNum, field: "from_account", message: "账户根类型与类型不匹配" });
      continue;
    }
    if (!roots.to(toAccount)) {
      errors.push({ row: rowNum, field: "to_account", message: "账户根类型与类型不匹配" });
      continue;
    }

    const fromCurErr = validateOpenCurrency(accountIndex.findRecord(fromAccount), currency);
    if (fromCurErr) {
      errors.push({ row: rowNum, field: "from_account", message: fromCurErr });
      continue;
    }
    const toCurErr = validateOpenCurrency(accountIndex.findRecord(toAccount), currency);
    if (toCurErr) {
      errors.push({ row: rowNum, field: "to_account", message: toCurErr });
      continue;
    }

    const id = newOrbitaId();
    const tags = parseTagsField(row.tags);
    const metadata: Transaction["metadata"] = [
      { key: "bkeasy-type", value: type },
      { key: "orbita-id", value: id },
    ];
    if (timeRaw) metadata.push(timeMetadata(date, timeRaw));
    drafts.push({
      kind: "transaction",
      id,
      source_file: writeTarget,
      source_line: 0,
      date,
      flag: "*",
      payee: row.payee || "",
      remark: row.remark || "",
      tags,
      postings: buildPostings(fromAccount, toAccount, amount, currency),
      metadata,
      type: type as "expense" | "income" | "transfer",
      seq: "",
    });
  }

  if (errors.length) return { ok: false, errors };
  if (!drafts.length) {
    return { ok: false, errors: [{ row: 0, field: null, message: "文件无数据行" }] };
  }
  return { ok: true, drafts };
}

export function transactionDraftToEntry(txn: Transaction): Entry {
  return {
    kind: "transaction",
    id: txn.id,
    source_file: txn.source_file,
    source_line: txn.source_line,
    type: txn.type as EntryType,
    date: txn.date,
    flag: txn.flag,
    payee: txn.payee,
    remark: txn.remark,
    tags: formatTags(txn.tags),
    postings: txn.postings.map((p) => ({
      account: p.account,
      amount: parseFloat(p.amount),
      currency: p.currency,
      cost_amount: null,
      cost_currency: "",
    })),
    // CSV time and other transaction-level keys must survive staging. docs/specs/orbita-finance.md
    metadata: (txn.metadata ?? []).map((m) => ({ key: m.key, value: m.value })),
    seq: "",
    _is_new: true,
  };
}

export function assignImportSeq(
  entries: Entry[],
  orderMode: CsvImportOrder,
  existing: Entry[],
): void {
  const byDate = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  for (const [date, group] of byDate) {
    const ordered = orderMode === "reverse" ? [...group].reverse() : group;
    let seq = nextSeqForDate(existing, date);
    for (const entry of ordered) {
      entry.seq = seq;
      seq = successor(seq);
    }
  }
}
