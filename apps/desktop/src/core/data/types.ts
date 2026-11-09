import type { FontPrefs } from "./fonts";
import type { HealthTrackAxisPrefs } from "./health-track-axis";
import type { LifeRingGoals } from "./life-ring-goals";
import type { LifeRingSlots } from "./life-ring-metrics";
import type { ThemePrefs } from "./theme-prefs";
import type { UiThemeSettings } from "../../ui/color-system/theme-types";

export type GridPrefs = {
  cols: number;
  rows: number;
  tileScale: number;
  colGap: number;
  rowGap: number;
};

export type LifeRingColors = {
  sleep: string;
  ring2: string;
  ring3: string;
};

export type InsightLightTheme = "cold" | "warm" | "blue" | `${number}`;

export type InsightPalette = {
  primary: string;
  selected: string;
  hover: string;
  chrome: string;
  sidebar: string;
  page: string;
  surface: string;
  controlSurface: string;
  sunken: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  danger: string;
};

export type TravelEndpointSplitPolicy = "copy" | "front" | "rear";

export type TravelEndpointSplitPrefs = {
  movingFrontEnd: TravelEndpointSplitPolicy;
  movingRearStart: TravelEndpointSplitPolicy;
};

export type UiPrefs = {
  engineId: string;
  localTab: "file" | "literature" | "note";
  activeConversationId: string | null;
  themePrefs: ThemePrefs;
  insightTheme: InsightLightTheme;
  insightPalette: InsightPalette;
  blockOpacity: number;
  topGrid: GridPrefs;
  lifeRings: LifeRingColors;
  lifeRingSlots: LifeRingSlots;
  lifeRingGoals: LifeRingGoals;
  fonts: FontPrefs;
  healthTrackAxis: HealthTrackAxisPrefs;
  insightThemePresets?: UiThemeSettings["insightThemePresets"];
  appliedInsightTheme?: UiThemeSettings["appliedInsightTheme"];
  insightThemeLibraryRevision?: number;
  travelEndpointSplit?: TravelEndpointSplitPrefs;
};

export type V2rayIntegration = { exePath: string };
export type ZoteroIntegration = { dataDir: string; articleNoteDir: string };
export type ObsidianIntegration = { vaultDir: string };
export type EverythingIntegration = { exePath: string };
export type CursorIntegration = { exePath: string };

export type TicktickIntegration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  defaultProjectId: string;
};

export type JournalIntegration = { dataRoot: string };
export type BKeasyIntegration = { dataRoot: string };
export type GarminIntegration = { tokenDir: string; syncDays: number };

export type WorkIntegration = {
  projectNotesDir: string;
  ticktickProjectId: string;
};

export type GarminCredentials = { email: string; password: string };
export type TicktickCredentials = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
};
export type AiCredentials = { entries: Record<string, string> };
export type VariflightCredentials = { apiKey: string };

export type IntegrationsCredentials = {
  garmin: GarminCredentials;
  ticktick: TicktickCredentials;
  ai: AiCredentials;
  variflight: VariflightCredentials;
};

export type Integrations = {
  v2ray: V2rayIntegration;
  zotero: ZoteroIntegration;
  obsidian: ObsidianIntegration;
  everything: EverythingIntegration;
  cursor: CursorIntegration;
  ticktick: TicktickIntegration;
  journal: JournalIntegration;
  bkeasy: BKeasyIntegration;
  garmin: GarminIntegration;
  work: WorkIntegration;
  credentials: IntegrationsCredentials;
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
  searchEntryId?: string;
};

export type AppTheme = "light" | "dark" | "transparent-light" | "transparent-dark";

export function isTransparentTheme(theme: AppTheme): boolean {
  return theme === "transparent-light" || theme === "transparent-dark";
}

export type { ThemePrefs, OpaqueThemePrefs, TransparentThemePrefs, ThemeMode, SurfaceMode } from "./theme-prefs";

export type AppSettings = {
  version: number;
  theme: AppTheme;
  dataDir: string;
  ui: UiPrefs;
  integrations: Integrations;
  ai: AiConfig;
};

export type JournalEntry = Record<string, unknown> & {
  id: string;
  kind: string;
  date: string;
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

export type LocalFileLeaf = {
  kind: "file" | "folder";
  id: string;
  name: string;
  path: string;
  color?: string;
};

export type LocalEntryKind = LocalFileLeaf["kind"];

export type LocalGroup = {
  kind: "group";
  id: string;
  name: string;
  children: LocalEntry[];
  color?: string;
};

export type LocalEntry = LocalFileLeaf | LocalGroup;
export type LocalFileItem = LocalFileLeaf;
