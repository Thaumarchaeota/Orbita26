import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("http://127.0.0.1:18080"),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        write_target: "ledger/2026.bean",
        reporting_currency: "USD",
        card_stripes: { expense: "#D48806" },
      }),
    }),
  );
});

describe("Finance display settings API", () => {
  it("reads the reporting currency with the managed write target", async () => {
    const { fetchSettings, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    await expect(fetchSettings()).resolves.toEqual({
      write_target: "ledger/2026.bean",
      reporting_currency: "USD",
      card_stripes: { expense: "#D48806" },
    });
  });

  it("writes reporting currency while preserving the service write target", async () => {
    const { updateSettings, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    await updateSettings({ write_target: "ledger/2026.bean", reporting_currency: "EUR" });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18080/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ write_target: "ledger/2026.bean", reporting_currency: "EUR" }),
      }),
    );
  });
});
