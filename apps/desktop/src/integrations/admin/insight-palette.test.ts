import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INSIGHT_PALETTE, defaultUiPrefs, readSettings } from "../../core/data/client";
import type { InsightPalette } from "../../core/data/types";

const palette: InsightPalette = {
  primary: "#102030",
  selected: "#203040",
  hover: "#304050",
  chrome: "#405060",
  sidebar: "#506070",
  page: "#607080",
  surface: "#708090",
  controlSurface: "#8090A0",
  sunken: "#90A0B0",
  textPrimary: "#A0B0C0",
  textSecondary: "#B0C0D0",
  border: "#C0D0E0",
  danger: "#D0E0F0",
};

const basePalette = vi.hoisted(() => ({
  primary: "#4B78B8",
  selected: "#D7E3F5",
  hover: "#E5EBF3",
  chrome: "#E4EBF3",
  sidebar: "#F1F5F9",
  page: "#F8FAFC",
  surface: "#FFFFFF",
  controlSurface: "#FFFFFF",
  sunken: "#F1F5F9",
  textPrimary: "#243044",
  textSecondary: "#66758A",
  border: "#D4DCE6",
  danger: "#C0393B",
}));

const settingsState = vi.hoisted(() => ({
  value: {
    dataDir: "D:/orbita",
    ui: {
      insightTheme: "cold",
      insightPalette: { ...basePalette },
    },
  },
}));
const patchSettings = vi.hoisted(() => vi.fn(async (patch: { ui?: Record<string, unknown> }) => {
  if (patch.ui) settingsState.value.ui = { ...settingsState.value.ui, ...patch.ui };
  return settingsState.value;
}));
const loadSettings = vi.hoisted(() => vi.fn(async () => settingsState.value));

vi.mock("../../core/settings", () => ({
  getSettings: () => settingsState.value,
  loadSettings,
  patchSettings,
}));

const cssVarByKey: Record<keyof InsightPalette, string> = {
  primary: "--insight-primary",
  selected: "--insight-selected-bg",
  hover: "--insight-hover-bg",
  chrome: "--insight-chrome-bg",
  sidebar: "--insight-sidebar-bg",
  page: "--insight-page-bg",
  surface: "--insight-surface-bg",
  controlSurface: "--insight-control-surface-bg",
  sunken: "--insight-sunken-bg",
  textPrimary: "--insight-text-primary",
  textSecondary: "--insight-text-secondary",
  border: "--insight-border-color",
  danger: "--insight-danger",
};

beforeEach(() => {
  vi.resetModules();
  patchSettings.mockClear();
  loadSettings.mockClear();
  settingsState.value = {
    dataDir: "D:/orbita",
    ui: {
      insightTheme: "cold",
      insightPalette: { ...basePalette },
    },
  };
  document.documentElement.dataset.insightTheme = "cold";
  for (const cssVar of Object.values(cssVarByKey)) document.documentElement.style.removeProperty(cssVar);
  localStorage.clear();
});

describe("Insight palette", () => {
  it("exposes the thirteen requested defaults without sharing mutable state", () => {
    expect(defaultUiPrefs().insightPalette).toEqual({
      primary: "#4B78B8",
      selected: "#D7E3F5",
      hover: "#E5EBF3",
      chrome: "#E4EBF3",
      sidebar: "#F1F5F9",
      page: "#F8FAFC",
      surface: "#FFFFFF",
      controlSurface: "#FFFFFF",
      sunken: "#F1F5F9",
      textPrimary: "#243044",
      textSecondary: "#66758A",
      border: "#D4DCE6",
      danger: "#C0393B",
    });
    const first = defaultUiPrefs();
    const second = defaultUiPrefs();
    first.insightPalette.primary = "#000000";
    expect(second.insightPalette.primary).toBe("#4B78B8");
  });

  it("saves and applies all thirteen custom colors", async () => {
    const { setInsightPalette } = await import("./insight-theme");

    await setInsightPalette(palette);

    expect(patchSettings).toHaveBeenCalledWith({ ui: { insightPalette: palette } });
    expect(settingsState.value.ui.insightPalette).toEqual(palette);
    for (const [key, cssVar] of Object.entries(cssVarByKey) as [keyof InsightPalette, string][]) {
      expect(document.documentElement.style.getPropertyValue(cssVar)).toBe(palette[key]);
    }
  });

  it("renders thirteen editable color pairs and previews valid input while rejecting invalid HEX", async () => {
    const { appearanceTabHtml, bindAppearanceTab } = await import("./settings/appearance-tab");
    const root = document.createElement("div");
    root.innerHTML = appearanceTabHtml;
    const controls = bindAppearanceTab(root);
    controls.fill(palette);

    expect(root.querySelectorAll("[data-insight-palette-color]")).toHaveLength(13);
    expect(root.querySelectorAll("[data-insight-palette-hex]")).toHaveLength(13);
    expect(root.querySelector<HTMLInputElement>('[data-insight-palette-hex="primary"]')?.value).toBe(
      palette.primary,
    );

    const primary = root.querySelector<HTMLInputElement>('[data-insight-palette-hex="primary"]')!;
    primary.value = "#12";
    primary.dispatchEvent(new Event("input", { bubbles: true }));
    expect(controls.read()).toBeNull();
    expect(root.querySelector<HTMLElement>("[data-insight-palette-error]")?.hidden).toBe(false);

    primary.value = "#abcdef";
    primary.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector<HTMLElement>("[data-insight-palette-error]")?.hidden).toBe(true);
    expect(controls.read()?.primary).toBe("#ABCDEF");
    expect(document.documentElement.style.getPropertyValue("--insight-primary")).toBe("#ABCDEF");
  });

  it("restores a persisted palette and falls back field by field for invalid values", async () => {
    const dataDir = "D:/palette-test";
    localStorage.setItem("orbita.data.bootstrap", JSON.stringify({ dataDir }));
    localStorage.setItem(
      `orbita.data.stores.${dataDir}.settings.json`,
      JSON.stringify({
        version: 7,
        dataDir,
        ui: {
          insightTheme: "cold",
          insightPalette: {
            primary: " #abcdef ",
            selected: "nope",
            hover: "#12345678",
            chrome: "#405060",
          },
        },
      }),
    );

    const restored = await readSettings();
    expect(restored.ui.insightPalette).toEqual({
      ...DEFAULT_INSIGHT_PALETTE,
      primary: "#ABCDEF",
      chrome: "#405060",
    });
  });

  it("recovers the applied palette from a later settings load after a failed save", async () => {
    const { setInsightPalette } = await import("./insight-theme");
    patchSettings.mockRejectedValueOnce(new Error("write failed"));
    loadSettings.mockResolvedValueOnce({
      ...settingsState.value,
      ui: { ...settingsState.value.ui, insightPalette: { ...palette } },
    });

    await expect(setInsightPalette(palette)).rejects.toThrow("write failed");
    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue("--insight-primary")).toBe(palette.primary);
  });

  it("does not expose custom cold palette variables in another theme", async () => {
    const { applyInsightLightTheme, applyInsightPalette } = await import("./insight-theme");
    settingsState.value.ui.insightPalette = { ...palette };
    applyInsightPalette(palette);
    expect(document.documentElement.style.getPropertyValue("--insight-primary")).toBe(palette.primary);

    applyInsightLightTheme("warm");

    for (const cssVar of Object.values(cssVarByKey)) {
      expect(document.documentElement.style.getPropertyValue(cssVar)).toBe("");
    }
  });
});
