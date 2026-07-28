export type GridPrefs = {
  cols: number;
  rows: number;
  tileScale: number;
  colGap: number;
  rowGap: number;
};

export type UiPrefs = {
  engineId: string;
  localTab: "file" | "literature" | "note";
  activeConversationId: string | null;
  blockOpacity: number;
  topGrid: GridPrefs;
  dockLeftGrid: GridPrefs;
};

export type V2rayIntegration = {
  exePath: string;
};

export type ZoteroIntegration = {
  dataDir: string;
  articleNoteDir: string;
};

export type ObsidianIntegration = {
  vaultDir: string;
};

export type TicktickIntegration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  defaultProjectId: string;
};

export type Integrations = {
  v2ray: V2rayIntegration;
  zotero: ZoteroIntegration;
  obsidian: ObsidianIntegration;
  ticktick: TicktickIntegration;
};

export type ApiEntry = {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
};

export type AiConfig = {
  defaultPrompt: string;
  activeEntryId: string;
  activeModel: string;
  entries: ApiEntry[];
};

export type AppTheme = "light" | "dark" | "transparent-light" | "transparent-dark";

export function isTransparentTheme(theme: AppTheme): boolean {
  return theme === "transparent-light" || theme === "transparent-dark";
}

export type AppSettings = {
  version: number;
  theme: AppTheme;
  dataDir: string;
  ui: UiPrefs;
  integrations: Integrations;
  ai: AiConfig;
};

export type BookmarkLink = {
  kind: "link";
  id: string;
  name: string;
  url: string;
  icon?: string;
  slot?: number;
};

export type BookmarkFolder = {
  kind: "folder";
  id: string;
  name: string;
  children: BookmarkLink[];
  slot?: number;
};

export type BookmarkEntry = BookmarkLink | BookmarkFolder;

export type Bookmark = BookmarkLink;

export type AppLink = {
  kind: "app";
  id: string;
  name: string;
  path: string;
  icon?: string;
  slot?: number;
};

export type AppFolder = {
  kind: "folder";
  id: string;
  name: string;
  children: AppLink[];
  slot?: number;
};

export type AppEntry = AppLink | AppFolder;

export type AppItem = AppLink;

export type LauncherLeafBase = {
  kind: string;
  id: string;
  name: string;
  icon?: string;
  slot?: number;
};

export type LauncherFolder<L extends LauncherLeafBase = LauncherLeafBase> = {
  kind: "folder";
  id: string;
  name: string;
  children: L[];
  slot?: number;
};

export type LauncherEntryOf<L extends LauncherLeafBase = LauncherLeafBase> = L | LauncherFolder<L>;

export type LocalEntryKind = "file" | "folder";

export type LocalFileLeaf = {
  kind: "file" | "folder";
  id: string;
  name: string;
  path: string;
  color?: string;
};

export type LocalGroup = {
  kind: "group";
  id: string;
  name: string;
  children: LocalEntry[];
  color?: string;
};

export type LocalEntry = LocalFileLeaf | LocalGroup;

export type LocalFileItem = LocalFileLeaf;

