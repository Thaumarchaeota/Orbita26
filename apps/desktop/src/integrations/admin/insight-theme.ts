import { getSettings, loadSettings, patchSettings } from "../../core/settings";
import type { AppSettings, InsightLightTheme, InsightPalette } from "../../core/data/types";
import { resolveUiRoles } from "../../ui/color-system/theme-resolve";
import { importLegacyTheme } from "../../ui/color-system/theme-legacy";
import { validateUiThemeDocument } from "../../ui/color-system/theme-validation";
import type { AppliedUiThemeSnapshot } from "../../ui/color-system/theme-types";

export type { InsightLightTheme };

let insightWriteQueue: Promise<void> = Promise.resolve();
let latestInsightThemeRequest = 0;
let latestInsightPaletteRequest = 0;
let previewOwner: string | null = null;
let previewProperties: string[] = [];

const PALETTE_CSS_VARS: Record<keyof InsightPalette, string> = {
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

const PALETTE_KEYS = Object.keys(PALETTE_CSS_VARS) as (keyof InsightPalette)[];

function normalizeInsightPalette(value: unknown, fallback: InsightPalette): InsightPalette {
  const input = value && typeof value === "object" ? value as Partial<Record<keyof InsightPalette, unknown>> : {};
  return PALETTE_KEYS.reduce((next, key) => {
    const candidate = input[key];
    next[key] = typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate.trim())
      ? candidate.trim().toUpperCase()
      : fallback[key];
    return next;
  }, {} as InsightPalette);
}

/** Serialize every Insight settings write, including the settings page's form save. */
export function enqueueInsightSettingsWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = insightWriteQueue.then(task);
  insightWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

export function normalizeInsightLightTheme(value: unknown): InsightLightTheme {
  if (value === "warm" || value === "blue" || value === "cold") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 30) return String(value) as InsightLightTheme;
  if (typeof value === "string" && /^(?:[1-9]|[12]\d|30)$/.test(value)) return value as InsightLightTheme;
  return "cold";
}

export function applyInsightPalette(palette: unknown): void {
  clearInsightThemePreviewLayer();
  const applied = getSettings().ui.appliedInsightTheme;
  if (applied) { applyInsightThemeSnapshot(applied); return; }
  const root = document.documentElement;
  const settings = getSettings();
  const activeTheme = normalizeInsightLightTheme(root.dataset.insightTheme === "managed"
    ? settings.ui.insightTheme : root.dataset.insightTheme ?? settings.ui.insightTheme);
  const source = palette && typeof palette === "object" ? palette as Partial<InsightPalette> : settings.ui.insightPalette;
  // Before the first explicit save, legacy settings still need the entire role
  // output (including focus/disabled/context values). This adapts in memory only.
  const resolved = resolveUiRoles(importLegacyTheme({ theme: activeTheme, palette: source }).theme);
  for (const [name, value] of Object.entries(resolved.cssVariables)) root.style.setProperty(name, value);
}

export function applyInsightLightTheme(theme: InsightLightTheme): void {
  clearInsightThemePreviewLayer();
  const applied = getSettings().ui.appliedInsightTheme;
  if (applied) { applyInsightThemeSnapshot(applied); return; }
  const next = normalizeInsightLightTheme(theme);
  document.documentElement.dataset.insightTheme = next;
  document.querySelector(".admin-app")?.setAttribute("data-insight-theme", next);
  // Keep the theme on html so body-mounted Insight portals inherit it;
  // Panel has its own document and is never styled by this helper.
  applyInsightPalette(getSettings().ui?.insightPalette);
}

/** The sole temporary writer; preview manager passes only parsed allowlisted variables. */
export function applyInsightThemePreviewLayer(owner: string, variables: Record<string, string>): void {
  const root = document.documentElement;
  clearInsightThemePreviewLayer();
  previewOwner = owner;
  for (const [name, value] of Object.entries(variables)) {
    const valid = isThemeColorVariable(name) && /^(?:#[\da-f]{6}|rgba?\([\d.,% ]+\)|color-mix\(.+\))$/i.test(value);
    if (!valid) throw new Error(`主题预览变量不在白名单中：${name}`);
    root.style.setProperty(name, value);
    previewProperties.push(name);
  }
  root.dataset.insightColorPreview = owner;
}

function isThemeColorVariable(name: string): boolean {
  return name === "--orbita-lab-selection" || name === "--orbita-lab-focus" || /^--(?:insight|admin)-(?:primary|primary-hover|selected-bg|hover-bg|hover-[a-z]+|pressed-[a-z]+|chrome-bg|sidebar-bg|page-bg|surface-bg|control-surface-bg|sunken-bg|text-primary|text-secondary|text-placeholder|text-disabled|border-color|danger(?:-bg|-surface)?|success(?:-bg)?|warning(?:-bg)?|info(?:-bg)?|focus-ring|titlebar|tab-strip-bg|sidebar|content-bg|tab-active-bg|chat-list-bg|card-bg|composer-bg|surface-subtle|surface-(?:page|panel|elevated|sunken)|border-subtle|divider|control-(?:hover|pressed|selected)|tab-hover-bg|nav-hover|nav-active|list-selected|icon-default|icon-active|user-bubble(?:-text)?|md-(?:code|inline-code|table-head|table-border)|input-border|on-primary|accent(?:-hover|-bg)?|chrome|surface|border|text|muted|hover|state-[a-z-]+)$/i.test(name);
}

export function applyInsightThemeSnapshot(snapshot: AppliedUiThemeSnapshot): void {
  const theme = validateUiThemeDocument(snapshot.theme);
  const resolved = resolveUiRoles(theme);
  clearInsightThemePreviewLayer();
  const root = document.documentElement;
  root.dataset.insightTheme = "managed";
  document.querySelector(".admin-app")?.setAttribute("data-insight-theme", "managed");
  for (const [name, value] of Object.entries(resolved.cssVariables)) root.style.setProperty(name, value);
}

export function restoreCurrentInsightAppearance(): void {
  const settings = getSettings();
  if (settings.ui.appliedInsightTheme) applyInsightThemeSnapshot(settings.ui.appliedInsightTheme);
  else applyInsightLightTheme(insightLightThemeFromSettings());
}

export function clearInsightThemePreviewLayer(owner?: string): void {
  if (owner && previewOwner !== owner) return;
  if (!previewOwner) return;
  const root = document.documentElement;
  for (const name of previewProperties) root.style.removeProperty(name);
  previewProperties = [];
  delete root.dataset.insightColorPreview;
  previewOwner = null;
  window.dispatchEvent(new CustomEvent("orbita:insight-preview-ended"));
}

export function getActiveInsightPreviewOwner(): string | null { return previewOwner; }

export function insightLightThemeFromSettings(): InsightLightTheme {
  try {
    return normalizeInsightLightTheme(getSettings().ui?.insightTheme);
  } catch {
    return "cold";
  }
}

function refreshInsightAppearanceFromSettings(): void {
  clearInsightThemePreviewLayer();
  restoreCurrentInsightAppearance();
}

if (typeof window !== "undefined") {
  window.addEventListener("orbita:settings-changed", refreshInsightAppearanceFromSettings);
}

export async function setInsightLightTheme(theme: InsightLightTheme): Promise<void> {
  const next = normalizeInsightLightTheme(theme);
  const requestId = ++latestInsightThemeRequest;
  const previous = getSettings().ui.insightTheme;
  applyInsightLightTheme(next);
  try {
    // patchSettings merges ui at runtime; submit only this field so concurrent palette changes survive.
    await enqueueInsightSettingsWrite(() =>
      patchSettings({ ui: { insightTheme: next } as AppSettings["ui"] }).then(() => undefined),
    );
  } catch (error) {
    if (requestId !== latestInsightThemeRequest) throw error;
    try {
      const recovered = await loadSettings();
      applyInsightLightTheme(recovered.ui.insightTheme);
    } catch {
      applyInsightLightTheme(previous);
    }
    throw error;
  }
}

export async function setInsightPalette(palette: InsightPalette): Promise<void> {
  const current = getSettings().ui.insightPalette;
  const next = normalizeInsightPalette(palette, current);
  const requestId = ++latestInsightPaletteRequest;
  applyInsightPalette(next);
  try {
    await enqueueInsightSettingsWrite(() =>
      patchSettings({ ui: { insightPalette: next } as AppSettings["ui"] }).then(() => undefined),
    );
  } catch (error) {
    if (requestId !== latestInsightPaletteRequest) throw error;
    try {
      const recovered = await loadSettings();
      applyInsightPalette(recovered.ui.insightPalette);
    } catch {
      applyInsightPalette(current);
    }
    throw error;
  }
}
