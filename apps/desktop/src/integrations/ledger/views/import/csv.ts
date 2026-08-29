import { buildAccountIndex } from "../../domain/account-validate";
import {
  type CsvImportOrder,
  type CsvParseResult,
  type CsvRowError,
  parseCsvImport,
  transactionDraftToEntry,
} from "../../domain/csv-import";
import type { Transaction } from "../../domain/ledger-item";
import { getWriteTarget } from "../../state/write-target";

export type { CsvImportOrder, CsvParseResult, CsvRowError };

export type ValidatedCsvDraft = {
  drafts: Transaction[];
};

export async function readCsvFileText(file: File): Promise<string> {
  return file.text();
}

export function validateCsvFileText(fileText: string): CsvParseResult {
  return parseCsvImport(fileText, buildAccountIndex(), getWriteTarget());
}

export async function handleImportFile(file: File | null | undefined): Promise<
  | { status: "error"; errors: CsvRowError[] }
  | { status: "success"; drafts: Transaction[] }
> {
  if (!file || !/\.csv$/i.test(file.name)) {
    return { status: "error", errors: [{ row: 0, field: null, message: "请选择 .csv 文件" }] };
  }
  try {
    const text = await readCsvFileText(file);
    const result = validateCsvFileText(text);
    if (!result.ok) return { status: "error", errors: result.errors };
    return { status: "success", drafts: result.drafts };
  } catch (e) {
    const message = e instanceof Error ? e.message : "解析失败";
    return { status: "error", errors: [{ row: 0, field: null, message }] };
  }
}

export { transactionDraftToEntry };
