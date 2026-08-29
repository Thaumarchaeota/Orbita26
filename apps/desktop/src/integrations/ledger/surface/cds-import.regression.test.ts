import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountCdsCsvModal } from "./cds-csv-modal";
import type { Transaction } from "../domain/ledger-item";

vi.mock("../views/import/csv", () => ({
  handleImportFile: vi.fn(),
}));

import { handleImportFile } from "../views/import/csv";

function makeDraft(id = "csv-1"): Transaction {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 0,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "shop",
    remark: "csv",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
    _is_new: true,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.getElementById("orbita-modal-root")?.remove();
  sessionStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  vi.mocked(handleImportFile).mockReset();
});

describe("CSV import regression", () => {
  it("import modal opens backdrop", async () => {
    const ac = new AbortController();
    const modal = mountCdsCsvModal(ac, {
      resetFilters: () => {},
      scrollToEntry: () => {},
      onMerge: () => "",
    });

    const openDone = modal.open();
    await vi.waitFor(() => {
      const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop");
      expect(backdrop?.classList.contains("is-open")).toBe(true);
    });
    await openDone;

    modal.dispose();
    ac.abort();
  });

  it("select CSV then merge focuses merged entry", async () => {
    const ac = new AbortController();
    const drafts = [makeDraft("focus-me")];
    vi.mocked(handleImportFile).mockResolvedValue({ status: "ok", drafts });

    let merged: Transaction[] | null = null;
    let focusId = "";
    const modal = mountCdsCsvModal(ac, {
      resetFilters: () => {},
      scrollToEntry: (id) => {
        focusId = id;
      },
      onMerge: (next, orderMode) => {
        merged = next;
        expect(orderMode).toBe("forward");
        return "focus-me";
      },
    });

    const openDone = modal.open();
    const backdrop = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dialog-backdrop.is-open");
      if (!el) throw new Error("modal not open");
      return el;
    });
    await openDone;

    const fileInput = backdrop.querySelector<HTMLInputElement>(".import-file-input")!;
    const file = new File(["date,amount\n2026-08-09,10"], "test.csv", { type: "text/csv" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(backdrop.querySelector(".import-confirm-btn")?.disabled).toBe(false);
    });

    backdrop.querySelector<HTMLButtonElement>(".import-confirm-btn")!.click();

    await vi.waitFor(() => {
      expect(merged?.length).toBe(1);
      expect(focusId).toBe("focus-me");
      expect(backdrop.hasAttribute("hidden")).toBe(true);
    });

    modal.dispose();
    ac.abort();
  });
});
