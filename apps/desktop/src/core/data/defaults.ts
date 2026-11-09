import { DEFAULT_GARMIN_SYNC_DAYS } from "./garmin-sync-days";
import { defaultHealthTrackAxisPrefs } from "./health-track-axis";
import { defaultFontPrefs } from "./fonts";
import { DEFAULT_LIFE_RING_GOALS } from "./life-ring-goals";
import { defaultLifeRingSlots } from "./life-ring-metrics";
import { defaultThemePrefs } from "./theme-prefs";
import type { AiConfig, GridPrefs, InsightPalette, Integrations, IntegrationsCredentials, LifeRingColors, UiPrefs } from "./types";

export const DEFAULT_GRID_GAP = 8;
export const DEFAULT_TOP_GRID: GridPrefs = { cols: 6, rows: 3, tileScale: 100, colGap: 8, rowGap: 8 };

export const DEFAULT_LIFE_RINGS: LifeRingColors = {
  sleep: "#5ac8fa",
  ring2: "#34c759",
  ring3: "#ff9500",
};

export const DEFAULT_INSIGHT_PALETTE: InsightPalette = {
  primary: "#4B78B8",
  selected: "#D7E3F5",
  hover: "#E5EBF3",
  chrome: "#E4EBF3",
  sidebar: "#F1F5F9",
  page: "#F8FAFC",
  surface: "#FFFFFF",
  controlSurface: "#FFFFFF",
  sunken: "#F1F5F9",
  textPrimary: "#243044",
  textSecondary: "#66758A",
  border: "#D4DCE6",
  danger: "#C0393B",
};

export function defaultCredentials(): IntegrationsCredentials {
  return {
    garmin: { email: "", password: "" },
    ticktick: { clientId: "", clientSecret: "", accessToken: "" },
    ai: { entries: {} },
    variflight: { apiKey: "" },
  };
}

export function defaultAiConfig(): AiConfig {
  const id = "deepseek-default";
  return {
    defaultPrompt: "",
    activeEntryId: id,
    activeModel: "deepseek-chat",
    searchEntryId: "",
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
    zotero: { dataDir: "", articleNoteDir: "" },
    obsidian: { vaultDir: "" },
    everything: { exePath: "" },
    cursor: { exePath: "" },
    ticktick: {
      clientId: "",
      clientSecret: "",
      redirectUri: "http://127.0.0.1:8765/callback",
      accessToken: "",
      defaultProjectId: "inbox",
    },
    journal: { dataRoot: "" },
    bkeasy: { dataRoot: "" },
    garmin: { tokenDir: "", syncDays: DEFAULT_GARMIN_SYNC_DAYS },
    work: { projectNotesDir: "12_project-tracking", ticktickProjectId: "" },
    credentials: defaultCredentials(),
  };
}

export function defaultUiPrefs(): UiPrefs {
  return {
    engineId: "google",
    localTab: "file",
    activeConversationId: null,
    themePrefs: defaultThemePrefs(),
    insightTheme: "cold",
    insightPalette: { ...DEFAULT_INSIGHT_PALETTE },
    blockOpacity: 12,
    topGrid: { ...DEFAULT_TOP_GRID },
    lifeRings: { ...DEFAULT_LIFE_RINGS },
    lifeRingSlots: defaultLifeRingSlots(),
    lifeRingGoals: { ...DEFAULT_LIFE_RING_GOALS },
    fonts: defaultFontPrefs(),
    healthTrackAxis: defaultHealthTrackAxisPrefs(),
    travelEndpointSplit: { movingFrontEnd: "copy", movingRearStart: "copy" },
  };
}
