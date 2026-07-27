import { invoke } from "@tauri-apps/api/core";
import type {
  AiConfig,
  AppEntry,
  AppItem,
  AppSettings,
  AppTheme,
  Bookmark,
  BookmarkEntry,
  Integrations,
  LocalEntry,
  GridPrefs,
  UiPrefs,
} from "./types";

export const DEFAULT_BOOKMARKS_GRID: GridPrefs = { cols: 6, rows: 3 };
export const DEFAULT_APPS_GRID: GridPrefs = { cols: 2, rows: 5 };

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

const WEB_PREFIX = "orbita.data.";

function webKey(name: string) {
  return `${WEB_PREFIX}${name}`;
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

export function defaultAiConfig(): AiConfig {
  const id = "deepseek-default";
  return {
    defaultPrompt: "",
    activeEntryId: id,
    activeModel: "deepseek-chat",
    entries: [
      {
        id,
        name: "DeepSeek",
        apiKey: "",
        baseUrl: "https://api.deepseek.com",
        models: ["deepseek-chat", "deepseek-reasoner"],
      },
    ],
  };
}

export function defaultIntegrations(): Integrations {
  return {
    v2ray: { exePath: "" },
    zotero: {
      dataDir: "",
      articleNoteDir: "",
    },
  };
}

export function defaultUiPrefs(): UiPrefs {
  return {
    engineId: "google",
    localTab: "file",
    activeConversationId: null,
    blockOpacity: 12,
    bookmarksGrid: { ...DEFAULT_BOOKMARKS_GRID },
    appsGrid: { ...DEFAULT_APPS_GRID },
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeGridPrefs(
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

function normalizeSettings(raw: Partial<AppSettings> & { dataDir: string; theme?: string }): AppSettings {
  const base = defaultSettings(raw.dataDir);
  return {
    version: typeof raw.version === "number" ? raw.version : 0,
    theme: normalizeTheme(raw.theme),
    dataDir: raw.dataDir,
    ui: {
      ...base.ui,
      ...(raw.ui ?? {}),
      localTab:
        raw.ui?.localTab === "literature" || raw.ui?.localTab === "note" || raw.ui?.localTab === "file"
          ? raw.ui.localTab
          : base.ui.localTab,
      activeConversationId: raw.ui?.activeConversationId ?? null,
      blockOpacity: clampBlockOpacity(raw.ui?.blockOpacity),
      bookmarksGrid: normalizeGridPrefs(raw.ui?.bookmarksGrid, DEFAULT_BOOKMARKS_GRID, 3, 12, 1, 8),
      appsGrid: normalizeGridPrefs(raw.ui?.appsGrid, DEFAULT_APPS_GRID, 1, 4, 1, 10),
    },
    integrations: {
      v2ray: { ...base.integrations.v2ray, ...(raw.integrations?.v2ray ?? {}) },
      zotero: { ...base.integrations.zotero, ...(raw.integrations?.zotero ?? {}) },
    },
    ai: {
      ...base.ai,
      ...(raw.ai ?? {}),
      entries: raw.ai?.entries?.length ? raw.ai.entries : base.ai.entries,
    },
  };
}

export async function readSettings(): Promise<AppSettings> {
  if (isTauri()) {
    const raw = await invoke<AppSettings>("read_settings");
    return normalizeSettings(raw);
  }
  const bootstrap = readWebJson<{ dataDir: string }>("bootstrap", { dataDir: "orbita-data" });
  const raw = readWebJson<Partial<AppSettings> | null>("settings.json", null);
  if (!raw) {
    const s = defaultSettings(bootstrap.dataDir);
    writeWebJson("settings.json", s);
    writeWebJson("bootstrap", { dataDir: s.dataDir });
    return s;
  }
  return normalizeSettings({
    ...raw,
    dataDir: raw.dataDir ?? bootstrap.dataDir,
    theme: raw.theme ?? "light",
  });
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  const next = normalizeSettings(settings);
  next.version = Math.max(next.version, 1);
  if (isTauri()) {
    await invoke("write_settings", { settings: next });
    return;
  }
  writeWebJson("bootstrap", { dataDir: next.dataDir });
  writeWebJson("settings.json", next);
}

export async function readBookmarks(): Promise<BookmarkEntry[]> {
  if (isTauri()) {
    const raw = await invoke<unknown[]>("read_bookmarks");
    return normalizeBookmarks(raw);
  }
  return normalizeBookmarks(readWebJson<unknown[]>("bookmarks.json", []));
}

export async function writeBookmarks(items: BookmarkEntry[]): Promise<void> {
  const next = normalizeBookmarks(items);
  if (isTauri()) {
    await invoke("write_bookmarks", { items: next });
    return;
  }
  writeWebJson("bookmarks.json", next);
}

export async function readApps(): Promise<AppEntry[]> {
  if (isTauri()) {
    const raw = await invoke<unknown[]>("read_apps");
    return normalizeApps(raw);
  }
  return normalizeApps(readWebJson<unknown[]>("apps.json", []));
}

export async function writeApps(items: AppEntry[]): Promise<void> {
  const next = normalizeApps(items);
  if (isTauri()) {
    await invoke("write_apps", { items: next });
    return;
  }
  writeWebJson("apps.json", next);
}

export async function readLocalFiles(): Promise<LocalEntry[]> {
  if (isTauri()) {
    const raw = await invoke<unknown[]>("read_local_files");
    return normalizeLocalEntries(raw);
  }
  return normalizeLocalEntries(readWebJson<unknown[]>("local-files.json", []));
}

export async function writeLocalFiles(items: LocalEntry[]): Promise<void> {
  const next = normalizeLocalEntries(items);
  if (isTauri()) {
    await invoke("write_local_files", { items: next });
    return;
  }
  writeWebJson("local-files.json", next);
}

export async function migrateLegacyCaches(): Promise<void> {
  if (!isTauri()) return;
  await invoke("migrate_legacy_caches");
}
