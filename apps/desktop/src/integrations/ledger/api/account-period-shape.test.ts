import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPeriodStatsResponse } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("http://127.0.0.1:18080"),
}));

const SAMPLE: AccountPeriodStatsResponse = {
  ok: true,
  account: "Assets:Cash",
  account_kind: "asset",
  date_from: "2026-01-01",
  date_to: "2026-01-31",
  currencies: [
    {
      currency: "CNY",
      opening_balance: "100",
      inflows: "50",
      outflows: "30",
      net_change: "20",
      closing_balance: "120",
      transaction_count: 3,
    },
  ],
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

describe("account period stats response shape", () => {
  it("fetchAccountPeriodStats returns per-currency period fields", async () => {
    const { fetchAccountPeriodStats, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    const data = await fetchAccountPeriodStats({
      account: "Assets:Cash",
      date_from: "2026-01-01",
      date_to: "2026-01-31",
    });
    expect(data).toEqual(SAMPLE);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18080/api/stats/account-period?account=Assets%3ACash&date_from=2026-01-01&date_to=2026-01-31",
      { signal: undefined },
    );
  });

  it("preserves error field on failed account period stats", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, error: "账户不能为空" }),
    } as Response);
    const { fetchAccountPeriodStats, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    await expect(fetchAccountPeriodStats({ account: "" })).rejects.toThrow("账户不能为空");
  });
});
