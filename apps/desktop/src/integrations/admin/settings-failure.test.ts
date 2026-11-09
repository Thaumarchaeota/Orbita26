import { beforeEach, describe, expect, it, vi } from "vitest";

const original = vi.hoisted(() => ({
  version: 7,
  theme: "light",
  dataDir: "D:/orbita",
  ui: {
    insightTheme: "cold",
    insightPalette: { primary: "#4B78B8" },
  },
}));
const readSettings = vi.hoisted(() => vi.fn(async () => original));
const writeSettings = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../core/data/client", () => ({
  defaultSettings: vi.fn(),
  migrateLegacyCaches: vi.fn(),
  readApps: vi.fn(async () => []),
  readBookmarks: vi.fn(async () => []),
  readLocalFiles: vi.fn(async () => []),
  readSettings,
  writeApps: vi.fn(),
  writeBookmarks: vi.fn(),
  writeLocalFiles: vi.fn(),
  writeSettings,
}));

beforeEach(() => {
  vi.resetModules();
  readSettings.mockResolvedValue(original);
  writeSettings.mockReset();
  writeSettings.mockResolvedValue(undefined);
});

describe("settings cache after a failed write", () => {
  it("keeps the previously loaded settings when saveSettings rejects", async () => {
    const { getSettings, loadSettings, saveSettings } = await import("../../core/data/settings");
    const loaded = await loadSettings();
    const next = {
      ...loaded,
      ui: { ...loaded.ui, insightPalette: { primary: "#102030" } },
    };
    writeSettings.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(saveSettings(next as never)).rejects.toThrow("disk unavailable");

    expect(getSettings()).toBe(loaded);
    expect(getSettings().ui.insightPalette).toEqual({ primary: "#4B78B8" });
  });
});
