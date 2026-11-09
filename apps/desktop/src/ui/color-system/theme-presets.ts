import { DEFAULT_INSIGHT_PALETTE } from "../../core/data/defaults";
import { INSIGHT_PALETTE_PRESETS } from "../../core/data/insight-palettes";
import { compositeHex, hexToOklch } from "./color";
import { UI_THEME_ROLES, type ThemePreset, type UiThemeDocument, type UiThemeRoleId } from "./theme-types";

const WARM_PALETTE = {
  primary: "#8B6B4F", selected: "#EDE9E3", hover: "#F3F0EB", chrome: "#EEEAE4", sidebar: "#F6F3EE", page: "#FAF9F7",
  surface: "#FFFFFF", controlSurface: "#FFFFFF", sunken: "#F3EFE9", textPrimary: "#27292F", textSecondary: "#787280", border: "#D9D4CC", danger: "#B91C1C",
};
const BLUE_PALETTE = {
  primary: "#3B82F6", selected: "#E4EDFC", hover: "#EDF2F9", chrome: "#E5EBF3", sidebar: "#F1F5FA", page: "#F8FAFC",
  surface: "#FFFFFF", controlSurface: "#FFFFFF", sunken: "#EEF3F9", textPrimary: "#1F2937", textSecondary: "#6B7280", border: "#CBD5E1", danger: "#B91C1C",
};
type LegacyPalette = typeof DEFAULT_INSIGHT_PALETTE;
function derivedRoleColor(role: UiThemeRoleId, palette: LegacyPalette): string {
  const card = palette.surface;
  const values: Partial<Record<UiThemeRoleId, string>> = {
    "brand.primaryForeground": "#FFFFFF",
    "brand.primaryHover": compositeHex(palette.textPrimary, palette.primary, 0.16),
    "border.weekGrid": palette.border,
    "text.placeholder": compositeHex(palette.textSecondary, card, 0.62),
    "text.disabled": compositeHex(palette.textSecondary, card, 0.45),
    "state.selection.foreground": palette.textPrimary,
    "state.focus.ring": palette.primary,
    "state.focus.foreground": palette.textPrimary,
    "state.neutral.hover": palette.hover,
    "state.hover.sidebar": palette.hover,
    "state.hover.page": palette.hover,
    "state.neutral.pressed": compositeHex(palette.primary, palette.hover, 0.18),
    "state.disabled.surface": palette.sunken,
    "state.disabled.foreground": compositeHex(palette.textSecondary, card, 0.45),
    "semantic.danger.surface": compositeHex(palette.danger, card, 0.10),
    "semantic.success.foreground": "#237A45", "semantic.success.surface": "#E8F5EC",
    "semantic.warning.foreground": "#8A5A00", "semantic.warning.surface": "#FFF4D6",
    "semantic.info.foreground": "#28618A", "semantic.info.surface": "#EAF4FB",
  };
  return values[role] ?? palette.textPrimary;
}

export function themeFromLegacyPalette(palette: LegacyPalette, metadata: UiThemeDocument["metadata"]): UiThemeDocument {
  const colors = {} as Record<UiThemeRoleId, { oklch: ReturnType<typeof hexToOklch> }>;
  for (const role of Object.keys(UI_THEME_ROLES) as UiThemeRoleId[]) {
    const legacyKey = UI_THEME_ROLES[role].legacy as keyof LegacyPalette | undefined;
    const hex = legacyKey ? palette[legacyKey] : derivedRoleColor(role, palette);
    colors[role] = { oklch: hexToOklch(hex) };
  }
  return { schemaVersion: 1, engineVersion: 1, metadata, colors, stateRules: { hoverAlpha: 1, pressedAlpha: 1, disabledAlpha: 1, focusAlpha: 0.3 }, selection: { mode: "relative", lightnessDelta: -0.04 } };
}

function presetFromPalette(id: string, name: string, palette: LegacyPalette): ThemePreset {
  const theme = themeFromLegacyPalette(palette, { id, name, revision: 1, updatedAt: "" });
  return { id, name, revision: 1, builtin: true, theme };
}

const builtinPresets: ThemePreset[] = [
  presetFromPalette("legacy:cold", "Cold", DEFAULT_INSIGHT_PALETTE),
  presetFromPalette("legacy:warm", "Warm", WARM_PALETTE),
  presetFromPalette("legacy:blue", "Blue", BLUE_PALETTE),
  ...INSIGHT_PALETTE_PRESETS.map((preset) => presetFromPalette(`legacy:${preset.id}`, preset.name, preset.palette)),
];

export const UI_THEME_PRESETS: readonly ThemePreset[] = builtinPresets;
export const DEFAULT_UI_THEME = builtinPresets[0]!.theme;
export function findUiThemePreset(id: string): ThemePreset | undefined { return UI_THEME_PRESETS.find((preset) => preset.id === id); }
