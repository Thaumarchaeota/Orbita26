import type { AppTheme } from "./types";

export type SurfaceMode = "light" | "dark";
export type ThemeMode = "opaque" | "transparent";

export type OpaqueThemePrefs = {
  palette: string;
  hue: number;
  surface: SurfaceMode;
};

export type TransparentThemePrefs = {
  surface: SurfaceMode;
  tint: string;
  hue: number;
};

export type ThemePrefs = {
  mode: ThemeMode;
  opaque: OpaqueThemePrefs;
  transparent: TransparentThemePrefs;
};

export const PALETTE_PRESETS: Record<string, { label: string; color: string; h: number; s: number; l: number }> = {
  ocean: { label: "海洋蓝", color: "#1565c0", h: 212, s: 80, l: 42 },
  slate: { label: "石板灰", color: "#475569", h: 215, s: 16, l: 40 },
  violet: { label: "紫罗兰", color: "#6366f1", h: 239, s: 84, l: 67 },
  teal: { label: "青绿", color: "#0891b2", h: 192, s: 91, l: 36 },
};

export const GLASS_TINT_PRESETS: Record<
  string,
  { label: string; color: string; h: number; s: number; lDark: number; lLight: number }
> = {
  ink: { label: "墨蓝", color: "#0e1219", h: 222, s: 26, lDark: 12, lLight: 97 },
  slate: { label: "石板", color: "#1a2230", h: 218, s: 18, lDark: 18, lLight: 96 },
  fog: { label: "雾蓝", color: "#161c24", h: 212, s: 14, lDark: 14, lLight: 97 },
  graphite: { label: "石墨", color: "#181a1e", h: 225, s: 10, lDark: 16, lLight: 96 },
  dusk: { label: "暮霭", color: "#14161c", h: 238, s: 12, lDark: 13, lLight: 97 },
  moss: { label: "苔灰", color: "#141a18", h: 168, s: 14, lDark: 14, lLight: 96 },
  sand: { label: "沙岩", color: "#1c1a18", h: 32, s: 10, lDark: 15, lLight: 96 },
};

const OPAQUE_PALETTE_VARS = [
  "--time",
  "--muted",
  "--border",
  "--border-active",
  "--shadow",
  "--input-ph",
  "--btn-bg",
  "--btn-hover",
  "--focus",
  "--toggle-color",
  "--text",
  "--surface",
  "--surface-active",
] as const;

const GLASS_TINT_VARS = ["--glass-tint-h", "--glass-tint-s", "--glass-tint-l", "--glass-alpha-panel"] as const;

export function defaultThemePrefs(): ThemePrefs {
  return {
    mode: "opaque",
    opaque: { palette: "ocean", hue: 212, surface: "light" },
    transparent: { surface: "light", tint: "ink", hue: 222 },
  };
}

function clampHue(value: unknown, fallback = 222): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return ((n % 360) + 360) % 360;
}

function normalizeSurface(value: unknown, fallback: SurfaceMode): SurfaceMode {
  return value === "dark" ? "dark" : fallback === "dark" ? "dark" : "light";
}

function normalizePalette(value: unknown): string {
  const id = typeof value === "string" ? value : "ocean";
  return id in PALETTE_PRESETS || id === "custom" ? id : "ocean";
}

function normalizeGlassTint(value: unknown): string {
  const id = typeof value === "string" ? value : "ink";
  return id in GLASS_TINT_PRESETS || id === "custom" ? id : "ink";
}

export function themeFromPrefs(prefs: ThemePrefs): AppTheme {
  if (prefs.mode === "transparent") {
    return prefs.transparent.surface === "dark" ? "transparent-dark" : "transparent-light";
  }
  return prefs.opaque.surface === "dark" ? "dark" : "light";
}

export function prefsFromTheme(theme: AppTheme): ThemePrefs {
  const base = defaultThemePrefs();
  if (theme === "transparent-light") {
    return {
      mode: "transparent",
      opaque: base.opaque,
      transparent: { surface: "light", tint: "ink", hue: 222 },
    };
  }
  if (theme === "transparent-dark") {
    return {
      mode: "transparent",
      opaque: base.opaque,
      transparent: { surface: "dark", tint: "ink", hue: 222 },
    };
  }
  if (theme === "dark") {
    return { mode: "opaque", opaque: { ...base.opaque, surface: "dark" }, transparent: base.transparent };
  }
  return { mode: "opaque", opaque: { ...base.opaque, surface: "light" }, transparent: base.transparent };
}

export function normalizeThemePrefs(raw?: Partial<ThemePrefs>, legacyTheme?: AppTheme): ThemePrefs {
  const fromLegacy = legacyTheme ? prefsFromTheme(legacyTheme) : defaultThemePrefs();
  const mode: ThemeMode = raw?.mode === "transparent" ? "transparent" : raw?.mode === "opaque" ? "opaque" : fromLegacy.mode;
  const opaqueRaw = raw?.opaque;
  const transparentRaw = raw?.transparent;
  const palette = normalizePalette(opaqueRaw?.palette ?? fromLegacy.opaque.palette);
  const hue = clampHue(opaqueRaw?.hue ?? fromLegacy.opaque.hue, 212);
  const opaqueSurface = normalizeSurface(opaqueRaw?.surface, fromLegacy.opaque.surface);
  const transparentSurface = normalizeSurface(transparentRaw?.surface, fromLegacy.transparent.surface);
  const tint = normalizeGlassTint(transparentRaw?.tint ?? fromLegacy.transparent.tint);
  const transparentHue = clampHue(transparentRaw?.hue ?? fromLegacy.transparent.hue, 222);
  return {
    mode,
    opaque: { palette, hue, surface: opaqueSurface },
    transparent: { surface: transparentSurface, tint, hue: transparentHue },
  };
}

function hsl(h: number, s: number, l: number, a = 1): string {
  if (a >= 1) return `hsl(${h} ${s}% ${l}%)`;
  return `hsl(${h} ${s}% ${l}% / ${a})`;
}

function opaqueAccent(opaque: OpaqueThemePrefs): { h: number; s: number; l: number } {
  if (opaque.palette === "custom") {
    return { h: opaque.hue, s: 70, l: 42 };
  }
  const preset = PALETTE_PRESETS[opaque.palette] ?? PALETTE_PRESETS.ocean;
  return { h: preset.h, s: preset.s, l: preset.l };
}

function glassTintHsl(transparent: TransparentThemePrefs): { h: number; s: number; l: number } {
  if (transparent.tint === "custom") {
    const l = transparent.surface === "dark" ? 14 : 97;
    return { h: transparent.hue, s: 18, l };
  }
  const preset = GLASS_TINT_PRESETS[transparent.tint] ?? GLASS_TINT_PRESETS.ink;
  const l = transparent.surface === "dark" ? preset.lDark : preset.lLight;
  return { h: preset.h, s: preset.s, l };
}

export function applyOpaquePalette(root: HTMLElement, opaque: OpaqueThemePrefs) {
  const { h, s, l } = opaqueAccent(opaque);
  if (opaque.surface === "light") {
    root.style.setProperty("--text", hsl(h, Math.min(45, s), 22));
    root.style.setProperty("--time", hsl(h, s, l));
    root.style.setProperty("--muted", hsl(h, 35, 55));
    root.style.setProperty("--border", hsl(h, s, l, 0.14));
    root.style.setProperty("--border-active", hsl(h, s, l, 0.32));
    root.style.setProperty("--shadow", hsl(h, s, l, 0.08));
    root.style.setProperty("--input-ph", hsl(h, 28, 68));
    root.style.setProperty("--btn-bg", hsl(h, s, l, 0.08));
    root.style.setProperty("--btn-hover", hsl(h, s, l));
    root.style.setProperty("--focus", hsl(h, s, l, 0.4));
    root.style.setProperty("--toggle-color", hsl(h, s, l));
    root.style.setProperty("--surface", hsl(h, 30, 97));
    root.style.setProperty("--surface-active", hsl(h, 35, 94));
  } else {
    const accentL = Math.min(l + 22, 68);
    root.style.setProperty("--text", hsl(h, 25, 88));
    root.style.setProperty("--time", hsl(h, s, accentL));
    root.style.setProperty("--muted", hsl(h, 20, 62));
    root.style.setProperty("--border", hsl(h, s, accentL, 0.18));
    root.style.setProperty("--border-active", hsl(h, s, accentL, 0.38));
    root.style.setProperty("--shadow", hsl(h, s, accentL, 0.12));
    root.style.setProperty("--input-ph", hsl(h, 18, 48));
    root.style.setProperty("--btn-bg", hsl(h, s, accentL, 0.12));
    root.style.setProperty("--btn-hover", hsl(h, s, accentL, 0.6));
    root.style.setProperty("--focus", hsl(h, s, accentL, 0.45));
    root.style.setProperty("--toggle-color", hsl(h, s, accentL));
    root.style.setProperty("--surface", hsl(h, 28, 14));
    root.style.setProperty("--surface-active", hsl(h, 28, 18));
  }
}

export function clearOpaquePalette(root: HTMLElement) {
  OPAQUE_PALETTE_VARS.forEach((prop) => root.style.removeProperty(prop));
}

export function applyTransparentGlassTint(root: HTMLElement, transparent: TransparentThemePrefs) {
  const { h, s, l } = glassTintHsl(transparent);
  root.style.setProperty("--glass-tint-h", String(h));
  root.style.setProperty("--glass-tint-s", `${s}%`);
  root.style.setProperty("--glass-tint-l", `${l}%`);
  root.style.setProperty("--glass-alpha-panel", "0.76");
  root.style.setProperty(
    "--surface",
    hsl(h, s, l, transparent.surface === "dark" ? 0.42 : 0.1),
  );
  root.style.setProperty(
    "--surface-active",
    hsl(h, s, l, transparent.surface === "dark" ? 0.56 : 0.15),
  );
}

export function clearTransparentGlassTint(root: HTMLElement) {
  GLASS_TINT_VARS.forEach((prop) => root.style.removeProperty(prop));
  root.style.removeProperty("--surface");
  root.style.removeProperty("--surface-active");
}

export function applyThemePrefs(prefs: ThemePrefs) {
  const root = document.documentElement;
  const theme = themeFromPrefs(prefs);
  root.setAttribute("data-theme", theme);
  root.dataset.themeMode = prefs.mode;
  if (prefs.mode === "opaque") {
    clearTransparentGlassTint(root);
    applyOpaquePalette(root, prefs.opaque);
  } else {
    clearOpaquePalette(root);
    applyTransparentGlassTint(root, prefs.transparent);
  }
}

export function isTransparentMode(prefs: ThemePrefs): boolean {
  return prefs.mode === "transparent";
}
