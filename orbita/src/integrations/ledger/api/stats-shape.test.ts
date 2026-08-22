import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsResponse } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("http://127.0.0.1:18080"),
}));

const SAMPLE: StatsResponse = {
  ok: true,
  reporting_currency: "CNY",
  accounts: [
    {
      account: "Assets:Cash",
      balances: [{ currency: "CNY", amount: "-20" }],
      assertion_status: "pass",
      assertion_date: "2026-01-03",
    },
  ],
  month_expenses_total: 35,
  month_expenses_by_category: [{ account: "Expenses:Food", total: 35 }],
  month_income_total: 5000,
  month_income_by_category: [{ account: "Income:Salary", total: 5000 }],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE,
    }),
  );
});

describe("stats response shape", () => {
  it("fetchStats returns posting-based expense/income and balance assertions", async () => {
    const { fetchStats, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    const data = await fetchStats();
    expect(data.ok).toBe(true);
    expect(data.reporting_currency).toBe("CNY");
    expect(data.month_expenses_total).toBe(35);
    expect(data.month_income_total).toBe(5000);
    expect(data.accounts?.[0]).toMatchObject({
      account: "Assets:Cash",
      assertion_status: "pass",
      assertion_date: "2026-01-03",
    });
    expect(data.month_expenses_by_category?.[0]).toEqual({
      account: "Expenses:Food",
      total: 35,
    });
    expect(data.month_income_by_category?.[0]).toEqual({
      account: "Income:Salary",
      total: 5000,
    });
  });

  it("preserves error field on failed stats", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: "service unavailable" }),
    } as Response);
    const { fetchStats, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    await expect(fetchStats()).rejects.toThrow("service unavailable");
  });
});
