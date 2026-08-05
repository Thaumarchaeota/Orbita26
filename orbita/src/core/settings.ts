export type { AppSettings, AppTheme, ThemePrefs, OpaqueThemePrefs, TransparentThemePrefs } from "./data/types";
export { isTransparentTheme } from "./data/types";
export { isTransparentMode, PALETTE_PRESETS, GLASS_TINT_PRESETS } from "./data/theme-prefs";
export {
  applyAppearance,
  applyTheme,
  applyUiPrefs,
  getSettings,
  initSettings,
  loadSettings,
  patchSettings,
  saveSettings,
  setTheme,
} from "./data/settings";
