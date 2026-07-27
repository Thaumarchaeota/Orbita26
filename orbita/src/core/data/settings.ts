import {
  defaultSettings,
  migrateLegacyCaches,
  readApps,
  readBookmarks,
  readLocalFiles,
  readSettings,
  writeApps,
  writeBookmarks,
  writeLocalFiles,
  writeSettings,
} from "./client";
import type { AppSettings, AppTheme, UiPrefs } from "./types";

let cached: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (!cached) throw new Error("settings not loaded");
  return cached;
}

export async function loadSettings(): Promise<AppSettings> {
  cached = await readSettings();
  return cached;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const next = { ...settings, version: Math.max(settings.version, 1) };
  cached = next;
  await writeSettings(next);
}

export async function patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = cached ?? (await loadSettings());
  const next: AppSettings = {
    ...current,
    ...patch,
    ui: { ...current.ui, ...(patch.ui ?? {}) },
    integrations: {
      v2ray: { ...current.integrations.v2ray, ...(patch.integrations?.v2ray ?? {}) },
      zotero: { ...current.integrations.zotero, ...(patch.integrations?.zotero ?? {}) },
    },
    ai: {
      ...current.ai,
      ...(patch.ai ?? {}),
      entries: patch.ai?.entries ?? current.ai.entries,
    },
  };
  await saveSettings(next);
  return next;
}

export function applyUiPrefs(ui: UiPrefs) {
  const root = document.documentElement;
  const n = Math.max(0, Math.min(100, Math.round(ui.blockOpacity))) / 100;
  root.style.setProperty("--block-opacity", String(n));
  root.style.setProperty("--bookmarks-cols", String(ui.bookmarksGrid.cols));
  root.style.setProperty("--bookmarks-rows", String(ui.bookmarksGrid.rows));
  root.style.setProperty("--apps-cols", String(ui.appsGrid.cols));
  root.style.setProperty("--apps-rows", String(ui.appsGrid.rows));
  root.style.setProperty("--launcher-dock-cols", String(ui.appsGrid.cols + 4));
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function applyAppearance(settings: AppSettings) {
  applyTheme(settings.theme);
  applyUiPrefs(settings.ui);
}

export async function setTheme(theme: AppTheme) {
  await patchSettings({ theme });
  applyTheme(theme);
}

function parseLocalJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const LEGACY_KEYS = [
  "orbita.bookmarks",
  "orbita.apps",
  "orbita.local.files",
  "engine",
  "localTab",
  "orbita.ai.activeConversation",
  "orbita.ai.config",
  "orbita.settings",
] as const;

export async function migrateIfNeeded(): Promise<AppSettings> {
  let settings = cached ?? (await loadSettings());

  if (settings.version >= 1) {
    const hasLegacy =
      localStorage.getItem("orbita.bookmarks") ||
      localStorage.getItem("orbita.apps") ||
      localStorage.getItem("orbita.local.files");
    if (!hasLegacy) return settings;
  }

  const legacyBookmarks = parseLocalJson<unknown[]>("orbita.bookmarks");
  const legacyApps = parseLocalJson<unknown[]>("orbita.apps");
  const legacyLocal = parseLocalJson<unknown[]>("orbita.local.files");

  const fileBookmarks = await readBookmarks();
  const fileApps = await readApps();
  const fileLocal = await readLocalFiles();

  if (legacyBookmarks?.length && fileBookmarks.length === 0) {
    await writeBookmarks(legacyBookmarks as Awaited<ReturnType<typeof readBookmarks>>);
  }
  if (legacyApps?.length && fileApps.length === 0) {
    await writeApps(legacyApps as Awaited<ReturnType<typeof readApps>>);
  }
  if (legacyLocal?.length && fileLocal.length === 0) {
    await writeLocalFiles(legacyLocal as Awaited<ReturnType<typeof readLocalFiles>>);
  }

  const engine = localStorage.getItem("engine");
  const localTab = localStorage.getItem("localTab");
  const activeConv = localStorage.getItem("orbita.ai.activeConversation");

  const ui = { ...settings.ui };
  if (engine) ui.engineId = engine;
  if (localTab === "file" || localTab === "literature" || localTab === "note") {
    ui.localTab = localTab;
  }
  if (activeConv) ui.activeConversationId = activeConv;

  const legacyAi = parseLocalJson<AppSettings["ai"]>("orbita.ai.config");
  let ai = settings.ai;
  if (legacyAi?.entries?.length) {
    const empty = !ai.entries[0]?.apiKey;
    if (empty) ai = { ...ai, ...legacyAi, entries: legacyAi.entries };
  }

  try {
    await migrateLegacyCaches();
  } catch (err) {
    console.error("migrate caches failed", err);
  }

  settings = {
    ...settings,
    version: 1,
    ui,
    ai,
    integrations: settings.integrations ?? defaultSettings(settings.dataDir).integrations,
  };
  await saveSettings(settings);

  for (const key of LEGACY_KEYS) {
    localStorage.removeItem(key);
  }

  return settings;
}

export async function initSettings(): Promise<AppSettings> {
  await loadSettings();
  const settings = await migrateIfNeeded();
  applyAppearance(settings);
  return settings;
}
