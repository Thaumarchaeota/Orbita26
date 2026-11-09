import { invoke } from "@tauri-apps/api/core";
import { normalizeFontPrefs } from "./fonts";
import { migrateLifeRingGoalsFromSlots, normalizeLifeRingGoals } from "./life-ring-goals";
import { normalizeLifeRingSlots } from "./life-ring-metrics";
import {
  defaultAiConfig,
  defaultIntegrations,
  defaultUiPrefs,
  DEFAULT_LIFE_RINGS,
  DEFAULT_INSIGHT_PALETTE,
  DEFAULT_TOP_GRID,
} from "./defaults";
import { normalizeGarminSyncDays } from "./garmin-sync-days";
import { normalizeHealthTrackAxisPrefs } from "./health-track-axis";
import { normalizeThemePrefs, themeFromPrefs } from "./theme-prefs";
import { validateUiThemeSettings } from "../../ui/color-system/theme-validation";
import type {
  AppEntry,
  AppItem,
  AppSettings,
  AppTheme,
  Bookmark,
  BookmarkEntry,
  LocalEntry,
  GridPrefs,
  InsightPalette,
  UiPrefs,
} from "./types";

export {
  DEFAULT_GRID_GAP,
  DEFAULT_TOP_GRID,
  DEFAULT_LIFE_RINGS,
  DEFAULT_INSIGHT_PALETTE,
  defaultAiConfig,
  defaultIntegrations,
  defaultUiPrefs,
} from "./defaults";

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

const INSIGHT_PALETTE_KEYS: (keyof InsightPalette)[] = [
  "primary", "selected", "hover", "chrome", "sidebar", "page", "surface",
  "controlSurface", "sunken", "textPrimary", "textSecondary", "border", "danger",
];

function normalizeInsightPalette(raw: unknown): InsightPalette {
  const input = raw && typeof raw === "object" ? raw as Partial<Record<keyof InsightPalette, unknown>> : {};
  const next = { ...DEFAULT_INSIGHT_PALETTE };
  for (const key of INSIGHT_PALETTE_KEYS) {
    const value = input[key];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
      next[key] = value.trim().toUpperCase();
    }
  }
  return next;
}

const WEB_PREFIX = "orbita.data.";

function webKey(name: string) {
  return `${WEB_PREFIX}${name}`;
}

function readWebBootstrap(): { dataDir: string } {
  return readWebJson("bootstrap", { dataDir: "orbita-data" });
}

function webScopedStoreKey(name: string, dataDir?: string): string {
  const dir = (dataDir ?? readWebBootstrap().dataDir ?? "orbita-data").trim() || "orbita-data";
  return `stores.${dir}.${name}`;
}

function readWebScoped<T>(name: string, fallback: T, dataDir?: string): T {
  const scoped = readWebJson<T | null>(webScopedStoreKey(name, dataDir), null);
  if (scoped != null) return scoped;
  const legacy = readWebJson<T | null>(name, null);
  if (legacy != null) {
    writeWebJson(webScopedStoreKey(name, dataDir), legacy);
    return legacy;
  }
  return fallback;
}

function writeWebScoped(name: string, value: unknown, dataDir?: string): void {
  writeWebJson(webScopedStoreKey(name, dataDir), value);
}

function readWebJson<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(webKey(name));
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeWebJson(name: string, value: unknown) {
  localStorage.setItem(webKey(name), JSON.stringify(value));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeGridLayoutPrefs(
  value: Partial<GridPrefs> | undefined,
  fallback: GridPrefs,
  colsMin: number,
  colsMax: number,
  rowsMin: number,
  rowsMax: number,
): GridPrefs {
  return {
    cols: clampInt(value?.cols, fallback.cols, colsMin, colsMax),
    rows: clampInt(value?.rows, fallback.rows, rowsMin, rowsMax),
    tileScale: clampLauncherTileScale(value?.tileScale ?? fallback.tileScale),
    colGap: clampInt(value?.colGap, fallback.colGap, 0, 24),
    rowGap: clampInt(value?.rowGap, fallback.rowGap, 0, 24),
  };
}

function normalizeBookmarkEntry(raw: unknown): BookmarkEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  if (o.kind === "folder" && Array.isArray(o.children)) {
    const children = o.children
      .map((c) => normalizeBookmarkEntry(c))
      .filter((c): c is Bookmark => !!c && c.kind === "link");
    return { kind: "folder", id, name, children };
  }
  const url = typeof o.url === "string" ? o.url : "";
  if (!url) return null;
  const icon = typeof o.icon === "string" ? o.icon : undefined;
  return { kind: "link", id, name, url, ...(icon ? { icon } : {}) };
}

export function normalizeBookmarks(items: unknown[]): BookmarkEntry[] {
  return items.map(normalizeBookmarkEntry).filter((e): e is BookmarkEntry => !!e);
}

function normalizeAppEntry(raw: unknown): AppEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  if (o.kind === "folder" && Array.isArray(o.children)) {
    const children = o.children
      .map((c) => normalizeAppEntry(c))
      .filter((c): c is AppItem => !!c && c.kind === "app");
    return { kind: "folder", id, name, children };
  }
  const path = typeof o.path === "string" ? o.path : "";
  if (!path) return null;
  const icon = typeof o.icon === "string" ? o.icon : undefined;
  return { kind: "app", id, name, path, ...(icon ? { icon } : {}) };
}

export function normalizeApps(items: unknown[]): AppEntry[] {
  return items.map(normalizeAppEntry).filter((e): e is AppEntry => !!e);
}

function normalizeLocalEntry(raw: unknown): LocalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  if (o.kind === "group" && Array.isArray(o.children)) {
    const children = o.children
      .map(normalizeLocalEntry)
      .filter((c): c is LocalEntry => !!c);
    const color = typeof o.color === "string" && o.color ? o.color : undefined;
    return { kind: "group", id, name, children, ...(color ? { color } : {}) };
  }
  const path = typeof o.path === "string" ? o.path : "";
  const kind = o.kind === "folder" ? "folder" : "file";
  if (!path) return null;
  const color = typeof o.color === "string" && o.color ? o.color : undefined;
  return { kind, id, name, path, ...(color ? { color } : {}) };
}

export function normalizeLocalEntries(items: unknown[]): LocalEntry[] {
  return items.map(normalizeLocalEntry).filter((e): e is LocalEntry => !!e);
}

function clampLauncherTileScale(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 100;
  return Math.max(70, Math.min(130, n));
}

function syncCredentials(settings: AppSettings): AppSettings {
  const cred = settings.integrations.credentials;
  const tick = settings.integrations.ticktick;
  if (!cred.ticktick.clientId && tick.clientId) cred.ticktick.clientId = tick.clientId;
  if (!cred.ticktick.clientSecret && tick.clientSecret) cred.ticktick.clientSecret = tick.clientSecret;
  if (!cred.ticktick.accessToken && tick.accessToken) cred.ticktick.accessToken = tick.accessToken;
  for (const entry of settings.ai.entries) {
    if (!cred.ai.entries[entry.id] && entry.apiKey) cred.ai.entries[entry.id] = entry.apiKey;
    if (cred.ai.entries[entry.id]) entry.apiKey = cred.ai.entries[entry.id];
  }
  tick.clientId = cred.ticktick.clientId || tick.clientId;
  tick.clientSecret = cred.ticktick.clientSecret || tick.clientSecret;
  tick.accessToken = cred.ticktick.accessToken || tick.accessToken;
  return settings;
}

function normalizeLifeRings(raw: Partial<AppSettings["ui"]["lifeRings"]> | undefined) {
  return {
    sleep: typeof raw?.sleep === "string" && raw.sleep ? raw.sleep : DEFAULT_LIFE_RINGS.sleep,
    ring2: typeof raw?.ring2 === "string" && raw.ring2 ? raw.ring2 : DEFAULT_LIFE_RINGS.ring2,
    ring3: typeof raw?.ring3 === "string" && raw.ring3 ? raw.ring3 : DEFAULT_LIFE_RINGS.ring3,
  };
}

function clampBlockOpacity(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 12;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeTheme(theme?: string): AppTheme {
  if (theme === "dark") return "dark";
  if (theme === "white" || theme === "transparent-light") return "transparent-light";
  if (theme === "transparent-dark") return "transparent-dark";
  return "light";
}

export function defaultSettings(dataDir: string): AppSettings {
  return {
    version: 1,
    theme: "light",
    dataDir,
    ui: defaultUiPrefs(),
    integrations: defaultIntegrations(),
    ai: defaultAiConfig(),
  };
}

type LegacyUiPrefs = UiPrefs & {
  bookmarksGrid?: Partial<GridPrefs>;
  appsGrid?: Partial<GridPrefs>;
  launcherTileScale?: number;
  dockLeftGrid?: Partial<GridPrefs>;
};

function ensureTopDockSemantics(top: GridPrefs, dock: GridPrefs): { top: GridPrefs; dock: GridPrefs } {
  if (top.cols >= dock.cols) return { top, dock };
  return { top: { ...dock }, dock: { ...top } };
}

function fixCorruptedGridPrefs(top: GridPrefs, dock: GridPrefs): { top: GridPrefs; dock: GridPrefs } {
  let t = top;
  let d = dock;
  if (t.cols <= 4 && d.cols >= 3 && t.cols >= d.cols) {
    if (t.cols < DEFAULT_TOP_GRID.cols) t = { ...t, cols: DEFAULT_TOP_GRID.cols };
    if (d.cols > 2) d = { ...d, cols: 2 };
  }
  return ensureTopDockSemantics(t, d);
}

function migrateLauncherGridPrefs(raw: Partial<AppSettings>): Partial<AppSettings> {
  if (isTauri()) return raw;
  if ((raw.version ?? 0) >= 5 || !raw.ui) return raw;
  const legacy = raw.ui as LegacyUiPrefs;
  let top = legacy.topGrid;
  let dock = legacy.dockLeftGrid;
  const bg = legacy.bookmarksGrid;
  const ag = legacy.appsGrid;
  if (!top || !dock) {
    const bgCols = typeof bg?.cols === "number" ? bg.cols : DEFAULT_TOP_GRID.cols;
    const agCols = typeof ag?.cols === "number" ? ag.cols : 2;
    if ((raw.version ?? 0) >= 4) {
      top = top ?? ag ?? DEFAULT_TOP_GRID;
      dock = dock ?? bg ?? { cols: 2, rows: 5, tileScale: 100, colGap: 8, rowGap: 8 };
    } else if (bgCols > agCols) {
      top = top ?? bg ?? DEFAULT_TOP_GRID;
      dock = dock ?? ag ?? { cols: 2, rows: 5, tileScale: 100, colGap: 8, rowGap: 8 };
    } else {
      top = top ?? ag ?? DEFAULT_TOP_GRID;
      dock = dock ?? bg ?? { cols: 2, rows: 5, tileScale: 100, colGap: 8, rowGap: 8 };
    }
  }
  const dockFallback: GridPrefs = { cols: 2, rows: 5, tileScale: 100, colGap: 8, rowGap: 8 };
  const topNorm = normalizeGridLayoutPrefs(top, DEFAULT_TOP_GRID, 3, 12, 1, 8);
  const dockNorm = normalizeGridLayoutPrefs(dock, dockFallback, 1, 8, 1, 8);
  const fixed = fixCorruptedGridPrefs(topNorm, dockNorm);
  return {
    ...raw,
    version: 5,
    ui: {
      ...legacy,
      topGrid: fixed.top,
    },
  };
}

function normalizeSettings(raw: Partial<AppSettings> & { dataDir: string; theme?: string }): AppSettings {
  const migrated = migrateLauncherGridPrefs(raw);
  const base = defaultSettings(migrated.dataDir ?? raw.dataDir);
  const uiRaw = (migrated.ui ?? raw.ui) as LegacyUiPrefs & { dockLeftGrid?: GridPrefs } | undefined;
  const legacyScale = clampLauncherTileScale(uiRaw?.launcherTileScale);
  const topFallback: GridPrefs = { ...DEFAULT_TOP_GRID, tileScale: legacyScale };
  const topGrid = normalizeGridLayoutPrefs(uiRaw?.topGrid, topFallback, 3, 12, 1, 8);
  const legacyTheme = normalizeTheme(migrated.theme ?? raw.theme);
  const themePrefs = normalizeThemePrefs(uiRaw?.themePrefs, legacyTheme);
  const theme = themeFromPrefs(themePrefs);
  const ui: UiPrefs = {
    ...base.ui,
    ...(uiRaw ?? {}),
    engineId: typeof uiRaw?.engineId === "string" ? uiRaw.engineId : base.ui.engineId,
    localTab:
      uiRaw?.localTab === "literature" || uiRaw?.localTab === "note" || uiRaw?.localTab === "file"
        ? uiRaw.localTab
        : base.ui.localTab,
    activeConversationId: uiRaw?.activeConversationId ?? null,
    themePrefs,
    insightTheme:
      uiRaw?.insightTheme === "warm" || uiRaw?.insightTheme === "blue" || uiRaw?.insightTheme === "cold"
        || (typeof uiRaw?.insightTheme === "string" && /^(?:[1-9]|[12]\d|30)$/.test(uiRaw.insightTheme))
        ? uiRaw.insightTheme
        : "cold",
    insightPalette: normalizeInsightPalette(uiRaw?.insightPalette),
    blockOpacity: clampBlockOpacity(uiRaw?.blockOpacity),
    topGrid,
    lifeRings: normalizeLifeRings(uiRaw?.lifeRings),
    lifeRingSlots: normalizeLifeRingSlots(uiRaw?.lifeRingSlots),
    lifeRingGoals: uiRaw?.lifeRingGoals
      ? normalizeLifeRingGoals(uiRaw.lifeRingGoals)
      : migrateLifeRingGoalsFromSlots(uiRaw?.lifeRingSlots),
    fonts: normalizeFontPrefs(uiRaw?.fonts),
    healthTrackAxis: normalizeHealthTrackAxisPrefs(uiRaw?.healthTrackAxis),
  };
  if (ui.insightThemePresets !== undefined || ui.appliedInsightTheme !== undefined || ui.insightThemeLibraryRevision !== undefined) {
    validateUiThemeSettings({
      insightThemePresets: ui.insightThemePresets,
      appliedInsightTheme: ui.appliedInsightTheme,
      insightThemeLibraryRevision: ui.insightThemeLibraryRevision,
    });
  }
  const intRaw = (migrated.integrations ?? raw.integrations ?? {}) as Partial<AppSettings["integrations"]>;
  const credRaw = intRaw.credentials ?? base.integrations.credentials;
  const settings: AppSettings = {
    ...migrated,
    version: Math.max(typeof migrated.version === "number" ? migrated.version : 0, 7),
    theme,
    dataDir: migrated.dataDir ?? raw.dataDir,
    ui,
    integrations: {
      v2ray: { ...base.integrations.v2ray, ...(intRaw.v2ray ?? {}) },
      zotero: { ...base.integrations.zotero, ...(intRaw.zotero ?? {}) },
      obsidian: { ...base.integrations.obsidian, ...(intRaw.obsidian ?? {}) },
      everything: { ...base.integrations.everything, ...(intRaw.everything ?? {}) },
      cursor: { ...base.integrations.cursor, ...(intRaw.cursor ?? {}) },
      journal: { ...base.integrations.journal, ...(intRaw.journal ?? {}) },
      bkeasy: { ...base.integrations.bkeasy, ...(intRaw.bkeasy ?? {}) },
      garmin: {
        ...base.integrations.garmin,
        ...(intRaw.garmin ?? {}),
        syncDays: normalizeGarminSyncDays(
          intRaw.garmin?.syncDays ?? base.integrations.garmin.syncDays,
        ),
      },
      work: {
        ...base.integrations.work,
        ...(intRaw.work ?? {}),
        projectNotesDir:
          intRaw.work?.projectNotesDir?.trim() || base.integrations.work.projectNotesDir,
        ticktickProjectId: intRaw.work?.ticktickProjectId?.trim() ?? "",
      },
      ticktick: {
        ...base.integrations.ticktick,
        ...(intRaw.ticktick ?? {}),
        clientId: intRaw.ticktick?.clientId?.trim() ?? "",
        clientSecret: intRaw.ticktick?.clientSecret?.trim() ?? "",
        redirectUri: intRaw.ticktick?.redirectUri?.trim() || base.integrations.ticktick.redirectUri,
        accessToken: intRaw.ticktick?.accessToken ?? "",
        defaultProjectId: intRaw.ticktick?.defaultProjectId?.trim() || base.integrations.ticktick.defaultProjectId,
      },
      credentials: {
        garmin: {
          email: credRaw.garmin?.email?.trim() ?? "",
          password: credRaw.garmin?.password ?? "",
        },
        ticktick: {
          clientId: credRaw.ticktick?.clientId?.trim() ?? intRaw.ticktick?.clientId?.trim() ?? "",
          clientSecret: credRaw.ticktick?.clientSecret?.trim() ?? intRaw.ticktick?.clientSecret?.trim() ?? "",
          accessToken: credRaw.ticktick?.accessToken ?? intRaw.ticktick?.accessToken ?? "",
        },
        ai: { entries: { ...credRaw.ai?.entries } },
        variflight: { apiKey: credRaw.variflight?.apiKey ?? "" },
      },
    },
    ai: {
      ...base.ai,
      ...(raw.ai ?? {}),
      entries: raw.ai?.entries?.length ? raw.ai.entries : base.ai.entries,
    },
  };
  return syncCredentials(settings);
}

export async function readSettings(): Promise<AppSettings> {
  if (isTauri()) {
    const raw = await invoke<AppSettings>("read_settings");
    const next = normalizeSettings(raw);
    if ((raw.version ?? 0) < 7) await writeSettings(next);
    return next;
  }
  const bootstrap = readWebBootstrap();
  const raw = readWebScoped<Partial<AppSettings> | null>("settings.json", null, bootstrap.dataDir);
  if (!raw) {
    const s = defaultSettings(bootstrap.dataDir);
    writeWebScoped("settings.json", s, bootstrap.dataDir);
    writeWebJson("bootstrap", { dataDir: s.dataDir });
    return s;
  }
  const next = normalizeSettings({
    ...raw,
    dataDir: raw.dataDir ?? bootstrap.dataDir,
    theme: raw.theme ?? "light",
  });
  if ((raw.version ?? 0) < 7) writeWebScoped("settings.json", next, bootstrap.dataDir);
  return next;
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  const next = normalizeSettings(settings);
  next.version = Math.max(next.version, 7);
  if (isTauri()) {
    await invoke("write_settings", { settings: next });
    return;
  }
  writeWebJson("bootstrap", { dataDir: next.dataDir });
  writeWebScoped("settings.json", next, next.dataDir);
}

export async function readBookmarks(): Promise<BookmarkEntry[]> {
  if (isTauri()) {
    const raw = await invoke<unknown[]>("read_bookmarks");
    return normalizeBookmarks(raw);
  }
  return normalizeBookmarks(readWebScoped<unknown[]>("bookmarks.json", []));
}

export async function writeBookmarks(items: BookmarkEntry[]): Promise<void> {
  const next = normalizeBookmarks(items);
  if (isTauri()) {
    await invoke("write_bookmarks", { items: next });
    return;
  }
  writeWebScoped("bookmarks.json", next);
}

export async function readApps(): Promise<AppEntry[]> {
  if (isTauri()) {
    const raw = await invoke<unknown[]>("read_apps");
    return normalizeApps(raw);
  }
  return normalizeApps(readWebScoped<unknown[]>("apps.json", []));
}

export async function writeApps(items: AppEntry[]): Promise<void> {
  const next = normalizeApps(items);
  if (isTauri()) {
    await invoke("write_apps", { items: next });
    return;
  }
  writeWebScoped("apps.json", next);
}

export async function readLocalFiles(): Promise<LocalEntry[]> {
  if (isTauri()) {
    const raw = await invoke<unknown[]>("read_local_files");
    return normalizeLocalEntries(raw);
  }
  return normalizeLocalEntries(readWebScoped<unknown[]>("local-files.json", []));
}

export async function writeLocalFiles(items: LocalEntry[]): Promise<void> {
  const next = normalizeLocalEntries(items);
  if (isTauri()) {
    await invoke("write_local_files", { items: next });
    return;
  }
  writeWebScoped("local-files.json", next);
}

export async function migrateLegacyCaches(): Promise<void> {
  if (!isTauri()) return;
  await invoke("migrate_legacy_caches");
}
