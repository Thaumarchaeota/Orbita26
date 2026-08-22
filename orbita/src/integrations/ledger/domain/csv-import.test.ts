import { describe, expect, it, vi } from "vitest";
import { CSV_HEADERS } from "../constants";
import type { AccountIndex, AccountRecord } from "../types";
import {
  assignImportSeq,
  parseCsvImport,
  transactionDraftToEntry,
  type CsvImportOrder,
} from "./csv-import";

vi.mock("./orbita-id", () => ({
  newOrbitaId: vi.fn(() => "txn_0123456789ABCDEFGHJKMNPQ"),
}));

const HEADER = CSV_HEADERS.join(",");

function rec(name: string, extra = "CNY"): AccountRecord {
  return {
    name,
    label: name,
    label_path: [],
    brief: "",
    open_date: "2026-01-01",
    extra,
    id: name,
    source_file: "category.bean",
    source_line: 1,
  };
}

function mockIndex(): AccountIndex {
  const records = [
    rec("Assets:Cash"),
    rec("Expenses:Food"),
    rec("Income:Salary"),
    rec("Liabilities:Card"),
  ];
  return {
    allNames: new Set(records.map((r) => r.name)),
    findRecord: (n) => records.find((r) => r.name === n),
  };
}

function row(
  date: string,
  type: string,
  amount: string,
  from: string,
  to: string,
  time = "",
  payee = "",
  remark = "",
  tags = "",
): string {
  return `${date},${time},${type},${amount},CNY,${from},${to},${payee},${remark},${tags}`;
}

describe("parseCsvImport", () => {
  it("strips BOM and parses valid expense row", () => {
    const text = `\uFEFF${HEADER}\n${row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food", "", "午餐")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]!.date).toBe("2026-01-02");
    expect(result.drafts[0]!.postings[0]!.amount).toBe("-20.00");
    expect(result.drafts[0]!.postings[1]!.amount).toBe("20.00");
  });

  it("accepts empty time and omits time metadata", () => {
    const text = `${HEADER}\n${row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts[0]!.metadata.some((m) => m.key === "time")).toBe(false);
  });

  it("writes time metadata for valid HH:mm", () => {
    const text = `${HEADER}\n${row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food", "08:05")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts[0]!.metadata).toContainEqual({
      key: "time",
      value: "2026-01-02T08:05:00+08:00",
    });
  });

  it("rejects invalid time formats", () => {
    for (const time of ["8:05", "24:00", "12:60", "08:05:00", "08:05 PM"]) {
      const text = `${HEADER}\n${row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food", time)}`;
      const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.field === "time")).toBe(true);
    }
  });

  it("rejects legacy 9-column header", () => {
    const legacy =
      "date,type,amount,currency,from_account,to_account,payee,remark,tags\n" +
      row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food");
    const result = parseCsvImport(legacy, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("10 列");
  });

  it("parses quoted tags with commas", () => {
    const text = `${HEADER}\n2026-01-02,,expense,20.00,CNY,Assets:Cash,Expenses:Food,,,"food,travel"`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts[0]!.tags).toEqual(["food", "travel"]);
  });

  it("rejects empty file", () => {
    const result = parseCsvImport("", mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toBe("文件为空");
  });

  it("rejects bad header", () => {
    const result = parseCsvImport("date,type,amount\n", mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("表头");
  });

  it("collects row errors without partial drafts", () => {
    const text = [
      HEADER,
      row("bad-date", "expense", "20.00", "Assets:Cash", "Expenses:Food"),
      row("2026-01-02", "expense", "0", "Assets:Cash", "Expenses:Food"),
      row("2026-01-02", "expense", "10.00", "Missing:Acct", "Expenses:Food"),
    ].join("\n");
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some((e) => e.field === "date")).toBe(true);
    expect(result.errors.some((e) => e.field === "amount")).toBe(true);
    expect(result.errors.some((e) => e.field === "from_account")).toBe(true);
  });

  it("preserves large decimal amounts without rounding", () => {
    const text = `${HEADER}\n${row("2026-01-02", "expense", "1234567890123.456", "Assets:Cash", "Expenses:Food")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts[0]!.postings[1]!.amount).toBe("1234567890123.456");
  });

  it("accepts three decimal places", () => {
    const text = `${HEADER}\n${row("2026-01-02", "expense", "10.001", "Assets:Cash", "Expenses:Food")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts[0]!.postings[1]!.amount).toBe("10.001");
  });

  it("rejects invalid amount strings", () => {
    const text = `${HEADER}\n${row("2026-01-02", "expense", "1,234.56", "Assets:Cash", "Expenses:Food")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(false);
  });

  it("parses income row with correct posting signs", () => {
    const text = `${HEADER}\n${row("2026-01-02", "income", "5000.00", "Income:Salary", "Assets:Cash", "18:20")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drafts[0]!.postings[0]!.account).toBe("Income:Salary");
    expect(result.drafts[0]!.postings[0]!.amount).toBe("-5000.00");
    expect(result.drafts[0]!.postings[1]!.amount).toBe("5000.00");
    expect(result.drafts[0]!.metadata).toContainEqual({
      key: "time",
      value: "2026-01-02T18:20:00+08:00",
    });
  });
});

describe("transactionDraftToEntry metadata", () => {
  it("copies time, bkeasy-type and orbita-id into the staging entry and commit payload", async () => {
    const { buildCommitPayload } = await import("./commit");
    const { setWriteTarget } = await import("../state/write-target");
    setWriteTarget("ledger/2026.bean");
    const text = `${HEADER}\n${row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food", "08:05")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = transactionDraftToEntry(result.drafts[0]!);
    expect(entry.metadata).toEqual([
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
      { key: "time", value: "2026-01-02T08:05:00+08:00" },
    ]);
    const payload = buildCommitPayload([entry], "token", "hash");
    const item = payload.items[0];
    expect(item.kind).toBe("transaction");
    if (item.kind !== "transaction") return;
    expect(item.metadata).toEqual(entry.metadata);
  });

  it("omits time metadata when CSV time is empty", () => {
    const text = `${HEADER}\n${row("2026-01-02", "expense", "20.00", "Assets:Cash", "Expenses:Food")}`;
    const result = parseCsvImport(text, mockIndex(), "ledger/2026.bean");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = transactionDraftToEntry(result.drafts[0]!);
    expect(entry.metadata?.some((m) => m.key === "time")).toBe(false);
    expect(entry.metadata?.some((m) => m.key === "bkeasy-type")).toBe(true);
    expect(entry.metadata?.some((m) => m.key === "orbita-id")).toBe(true);
  });
});

describe("assignImportSeq", () => {
  function seqFor(order: CsvImportOrder, dates: string[]): string[] {
    const drafts = dates.map((date, i) =>
      transactionDraftToEntry({
        kind: "transaction",
        id: `txn_${String(i).padStart(26, "0")}`,
        source_file: "ledger/2026.bean",
        source_line: 0,
        date,
        flag: "*",
        payee: "",
        remark: "",
        tags: [],
        postings: [],
        metadata: [],
        type: "expense",
        seq: "",
      }),
    );
    assignImportSeq(drafts, order, []);
    return drafts.map((d) => d.seq);
  }

  it("assigns forward order within same date", () => {
    expect(seqFor("forward", ["2026-01-02", "2026-01-02", "2026-01-02"])).toEqual([
      "a0",
      "a1",
      "a2",
    ]);
  });

  it("assigns reverse order within same date", () => {
    expect(seqFor("reverse", ["2026-01-02", "2026-01-02", "2026-01-02"])).toEqual([
      "a2",
      "a1",
      "a0",
    ]);
  });

  it("assigns non-overlapping seq across two import batches", () => {
    const firstBatch = ["2026-01-02", "2026-01-02"].map((date, i) =>
      transactionDraftToEntry({
        kind: "transaction",
        id: `txn_first_${i}`,
        source_file: "ledger/2026.bean",
        source_line: 0,
        date,
        flag: "*",
        payee: "",
        remark: "",
        tags: [],
        postings: [],
        metadata: [],
        type: "expense",
        seq: "",
      }),
    );
    assignImportSeq(firstBatch, "forward", []);
    expect(firstBatch.map((d) => d.seq)).toEqual(["a0", "a1"]);

    const secondBatch = ["2026-01-02", "2026-01-02"].map((date, i) =>
      transactionDraftToEntry({
        kind: "transaction",
        id: `txn_second_${i}`,
        source_file: "ledger/2026.bean",
        source_line: 0,
        date,
        flag: "*",
        payee: "",
        remark: "",
        tags: [],
        postings: [],
        metadata: [],
        type: "expense",
        seq: "",
      }),
    );
    assignImportSeq(secondBatch, "forward", firstBatch);
    expect(secondBatch.map((d) => d.seq)).toEqual(["a2", "a3"]);
  });
});
