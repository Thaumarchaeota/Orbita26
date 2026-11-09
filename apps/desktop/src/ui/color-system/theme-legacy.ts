import { DEFAULT_INSIGHT_PALETTE } from "../../core/data/defaults";
import { INSIGHT_PALETTE_PRESETS } from "../../core/data/insight-palettes";
import type { InsightLightTheme, InsightPalette } from "../../core/data/types";
import { findUiThemePreset, themeFromLegacyPalette } from "./theme-presets";
import type { UiThemeDocument } from "./theme-types";

export type LegacyThemeImport = Readonly<{ presetId: string; theme: UiThemeDocument; source: "legacy-cold-palette" | "legacy-builtin" }>;
const asLegacyCustom = (theme: UiThemeDocument): UiThemeDocument => ({ ...theme, selection: { mode: "custom", lightnessDelta: -0.04 } });

/** Imports the branch that legacy runtime actually displayed; a dormant cold palette never overrides a named preset. */
export function importLegacyTheme(input: { theme: InsightLightTheme | string; palette?: Partial<InsightPalette> | null }): LegacyThemeImport {
  const id = input.theme === "cold" ? "legacy:cold" : `legacy:${input.theme}`;
  if (input.theme !== "cold") {
    const named = findUiThemePreset(id);
    if (named) return { presetId: id, theme: asLegacyCustom(named.theme), source: "legacy-builtin" };
    const numbered = INSIGHT_PALETTE_PRESETS.find((preset) => preset.id === input.theme);
    if (numbered) return { presetId: id, theme: asLegacyCustom(themeFromLegacyPalette(numbered.palette, { ...numbered, id, revision: 1, updatedAt: "" })), source: "legacy-builtin" };
    return { presetId: "legacy:cold", theme: asLegacyCustom(themeFromLegacyPalette(DEFAULT_INSIGHT_PALETTE, { id: "legacy:cold", name: "Cold", revision: 1, updatedAt: "" })), source: "legacy-builtin" };
  }
  const palette = { ...DEFAULT_INSIGHT_PALETTE };
  for (const key of Object.keys(palette) as (keyof InsightPalette)[]) {
    const value = input.palette?.[key];
    if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim())) palette[key] = value.trim().toUpperCase();
  }
  const isCustom = Object.keys(DEFAULT_INSIGHT_PALETTE).some((key) => palette[key as keyof InsightPalette] !== DEFAULT_INSIGHT_PALETTE[key as keyof InsightPalette]);
  const importedId = isCustom ? "legacy:imported-cold" : "legacy:cold";
  return {
    presetId: importedId,
    theme: { ...themeFromLegacyPalette(palette, { id: importedId, name: isCustom ? "Cold (legacy custom)" : "Cold", revision: 1, updatedAt: "" }), selection: { mode: "custom", lightnessDelta: -0.04 } },
    source: "legacy-cold-palette",
  };
}
