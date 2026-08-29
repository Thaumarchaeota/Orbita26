import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("http://127.0.0.1:18080"),
}));

const SAMPLE_SETTINGS = {
  write_target: "ledger/2026.bean",
  reporting_currency: "USD",
  card_stripes: { expense: "#D48806" },
  filter_presets_version: 1,
  filter_presets: [
    {
      id: "preset-1",
      name: "日常",
      date: { mode: "relative", preset: "last7" },
      typeMode: "selected",
      types: ["expense"],
      accounts: ["Assets:Cash"],
      accountMode: "or",
      tags: [],
      tagMode: "or",
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_SETTINGS,
    }),
  );
});

describe("Finance display settings API", () => {
  it("reads the reporting currency with the managed write target", async () => {
    const { fetchSettings, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    await expect(fetchSettings()).resolves.toEqual(SAMPLE_SETTINGS);
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

  it("reads filter presets from settings", async () => {
    const { fetchSettings, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    const data = await fetchSettings();
    expect(data.filter_presets_version).toBe(1);
    expect(data.filter_presets?.[0]?.id).toBe("preset-1");
  });

  it("reads settings diagnostics when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...SAMPLE_SETTINGS,
          filter_presets: [],
          diagnostics: [
            {
              code: "filter_preset_invalid",
              message: "date.from 必须是 YYYY-MM-DD 格式",
              path: "filter_presets[0].date.from",
              index: 0,
              preset_id: "bad-format",
            },
          ],
        }),
      }),
    );
    const { fetchSettings, resetLedgerApiBase } = await import("./client");
    resetLedgerApiBase();
    const data = await fetchSettings();
    expect(data.diagnostics?.[0]?.path).toBe("filter_presets[0].date.from");
    expect(data.diagnostics?.[0]?.preset_id).toBe("bad-format");
  });
});
