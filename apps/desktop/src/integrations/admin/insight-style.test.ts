import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyInsightLightTheme,
  insightLightThemeFromSettings,
  normalizeInsightLightTheme,
  setInsightLightTheme,
} from "./insight-theme";
import { INSIGHT_PALETTE_PRESETS } from "../../core/data/insight-palettes";

const settingsState = vi.hoisted(() => ({
  value: { dataDir: "D:/orbita", ui: { insightTheme: "cold" } },
  throwOnRead: false,
}));

const patchSettings = vi.hoisted(() => vi.fn(async (patch: { ui?: Record<string, unknown> }) => {
  if (patch.ui) settingsState.value.ui = { ...settingsState.value.ui, ...patch.ui };
  return settingsState.value;
}));

vi.mock("../../core/settings", () => ({
  getSettings: () => {
    if (settingsState.throwOnRead) throw new Error("settings unavailable");
    return settingsState.value;
  },
  patchSettings,
}));

beforeEach(() => {
  settingsState.value = { dataDir: "D:/orbita", ui: { insightTheme: "cold" } };
  settingsState.throwOnRead = false;
  patchSettings.mockClear();
  document.documentElement.removeAttribute("data-insight-theme");
  document.body.innerHTML = '<div class="admin-app"></div>';
});

describe("Insight palette themes", () => {
  it("ships thirty numbered presets with all thirteen semantic colors", () => {
    expect(INSIGHT_PALETTE_PRESETS).toHaveLength(30);
    expect(new Set(INSIGHT_PALETTE_PRESETS.map((item) => item.id)).size).toBe(30);
    for (const item of INSIGHT_PALETTE_PRESETS) {
      expect(Object.values(item.palette)).toHaveLength(13);
      expect(Object.values(item.palette).every((value) => /^#[0-9A-F]{6}$/.test(value))).toBe(true);
    }
  });

  it("normalizes missing and invalid themes to cold", () => {
    expect(normalizeInsightLightTheme(undefined)).toBe("cold");
    expect(normalizeInsightLightTheme(null)).toBe("cold");
    expect(normalizeInsightLightTheme("rect")).toBe("cold");
    expect(normalizeInsightLightTheme("warm")).toBe("warm");
    expect(normalizeInsightLightTheme("blue")).toBe("blue");
    expect(normalizeInsightLightTheme("1")).toBe("1");
    expect(normalizeInsightLightTheme(30)).toBe("30");
    expect(normalizeInsightLightTheme("31")).toBe("cold");
  });

  it("applies and persists the selected palette theme without a geometry setting", async () => {
    await setInsightLightTheme("warm");
    expect(settingsState.value.ui).toEqual({ insightTheme: "warm" });
    expect(patchSettings).toHaveBeenCalledWith({ ui: { insightTheme: "warm" } });
    expect(document.documentElement.dataset.insightTheme).toBe("warm");
  });

  it("does not alter the palette theme when applying it again", () => {
    applyInsightLightTheme("blue");
    expect(document.documentElement.dataset.insightTheme).toBe("blue");
    applyInsightLightTheme("cold");
    expect(document.documentElement.dataset.insightTheme).toBe("cold");
  });

  it("applies a numbered preset through the same 13 CSS variables", () => {
    applyInsightLightTheme("30");
    expect(document.documentElement.dataset.insightTheme).toBe("30");
    expect(document.documentElement.style.getPropertyValue("--insight-primary")).toBe("#326477");
    expect(document.documentElement.style.getPropertyValue("--insight-danger")).toBe("#BD4042");
  });

  it("falls back to cold when settings cannot be read", () => {
    settingsState.throwOnRead = true;
    expect(insightLightThemeFromSettings()).toBe("cold");
  });
});
