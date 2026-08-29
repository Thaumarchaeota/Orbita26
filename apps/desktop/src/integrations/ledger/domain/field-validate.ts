import { DEFAULT_CURRENCY, REMARK_MAX_LENGTH } from "../constants";
import type { EntryFieldPatch } from "../state/ledger-store";
import type { Entry, Posting } from "../types";
import {
  buildAccountIndex,
  validateOpenCurrency,
} from "./account-validate";
import { validateTxnTimeInput } from "./txn-time";
const DECIMAL_RE = /^(?:-)?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export type DecimalParseResult =
  | { ok: true; value: number }
  | { ok: false; message: string };

export function parseDecimalInput(raw: string, opts?: { allowZero?: boolean }): DecimalParseResult {
  const s = raw.trim();
  if (!s) return { ok: false, message: "请填写金额" };
  if (!DECIMAL_RE.test(s)) return { ok: false, message: "金额格式无效" };
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, message: "金额超出范围" };
  if (!opts?.allowZero && value === 0) return { ok: false, message: "金额不能为 0" };
  return { ok: true, value };
}

export function parseOptionalDecimalInput(raw: string): DecimalParseResult | { ok: true; value: null } {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  return parseDecimalInput(s, { allowZero: true });
}

function postingCurrency(p: Posting): string {
  return (p.currency || "").trim() || DEFAULT_CURRENCY;
}

function applyPatchToEntry(entry: Entry, patch: EntryFieldPatch): Entry {
  const clone: Entry = {
    ...entry,
    postings: entry.postings.map((p) => ({ ...p })),
  };
  switch (patch.field) {
    case "date":
      clone.date = patch.value;
      break;
    case "flag":
      clone.flag = patch.value;
      break;
    case "time":
      break;
    case "remark":
      clone.remark = patch.value;
      break;
    case "payee":
      clone.payee = patch.value;
      break;
    case "tags":
      clone.tags = patch.value;
      break;
    case "type":
      clone.type = patch.value;
      break;
    case "account": {
      const posting = clone.postings[patch.postingIndex];
      if (posting) posting.account = patch.value;
      break;
    }
    case "amount": {
      const posting = clone.postings[patch.postingIndex];
      if (posting) posting.amount = patch.value;
      break;
    }
    case "currency": {
      const posting = clone.postings[patch.postingIndex];
      if (posting) posting.currency = patch.value;
      break;
    }
    case "cost_amount": {
      const posting = clone.postings[patch.postingIndex];
      if (posting) posting.cost_amount = patch.value;
      break;
    }
    case "cost_currency": {
      const posting = clone.postings[patch.postingIndex];
      if (posting) posting.cost_currency = patch.value;
      break;
    }
  }
  return clone;
}

export function validateInlinePatch(entry: Entry, patch: EntryFieldPatch): string | null {
  const index = buildAccountIndex();

  if (patch.field === "account") {
    const account = patch.value.trim();
    if (!account) return "须选择账户";
    if (!index.allNames.has(account)) return `账户不存在: ${account}`;
    const cur = postingCurrency(entry.postings[patch.postingIndex]!);
    const curErr = validateOpenCurrency(index.findRecord(account), cur);
    if (curErr) return curErr;
  }

  if (patch.field === "currency") {
    const cur = patch.value.trim();
    if (!cur) return "须填写币种";
    if (!CURRENCY_RE.test(cur)) return "币种须为三位大写字母";
    const account = entry.postings[patch.postingIndex]?.account ?? "";
    const curErr = validateOpenCurrency(index.findRecord(account), cur);
    if (curErr) return curErr;
  }

  if (patch.field === "time") {
    return validateTxnTimeInput(patch.value);
  }

  const preview = applyPatchToEntry(entry, patch);

  if (patch.field === "cost_amount" || patch.field === "cost_currency") {
    const posting = preview.postings[patch.postingIndex];
    if (posting && posting.cost_amount != null && Math.abs(posting.cost_amount) > 0.001) {
      const cc = (posting.cost_currency || "").trim();
      if (!cc) return "须填写 @@ 成本币种";
      if (!CURRENCY_RE.test(cc)) return "成本币种须为三位大写字母";
    }
  }

  return null;
}

export function buildValidatedPatch(
  entry: Entry,
  field: EntryFieldPatch["field"],
  raw: string,
  postingIndex: number,
): { patch: EntryFieldPatch } | { error: string } {
  switch (field) {
    case "date":
    case "flag":
    case "payee":
    case "tags":
      return { patch: { field, value: raw } as EntryFieldPatch };
    case "time": {
      const err = validateTxnTimeInput(raw);
      if (err) return { error: err };
      return { patch: { field: "time", value: raw } };
    }
    case "remark":
      return { patch: { field: "remark", value: raw.slice(0, REMARK_MAX_LENGTH) } };
    case "type":
      return { patch: { field: "type", value: raw as Entry["type"] } };
    case "account": {
      const patch: EntryFieldPatch = { field: "account", postingIndex, value: raw };
      const err = validateInlinePatch(entry, patch);
      return err ? { error: err } : { patch };
    }
    case "amount": {
      const parsed = parseDecimalInput(raw);
      if (!parsed.ok) return { error: parsed.message };
      const patch: EntryFieldPatch = { field: "amount", postingIndex, value: parsed.value };
      const err = validateInlinePatch(entry, patch);
      return err ? { error: err } : { patch };
    }
    case "currency": {
      const patch: EntryFieldPatch = { field: "currency", postingIndex, value: raw.trim() };
      const err = validateInlinePatch(entry, patch);
      return err ? { error: err } : { patch };
    }
    case "cost_amount": {
      const parsed = parseOptionalDecimalInput(raw);
      if (!parsed.ok) return { error: parsed.message };
      const patch: EntryFieldPatch = {
        field: "cost_amount",
        postingIndex,
        value: parsed.value,
      };
      const err = validateInlinePatch(entry, patch);
      return err ? { error: err } : { patch };
    }
    case "cost_currency": {
      const patch: EntryFieldPatch = {
        field: "cost_currency",
        postingIndex,
        value: raw.trim(),
      };
      const err = validateInlinePatch(entry, patch);
      return err ? { error: err } : { patch };
    }
    default:
      return { error: "未知字段" };
  }
}
