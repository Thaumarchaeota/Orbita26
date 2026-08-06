import { defaultFontPrefs } from "./fonts";
import { DEFAULT_LIFE_RING_GOALS } from "./life-ring-goals";
import { defaultLifeRingSlots } from "./life-ring-metrics";
import { defaultThemePrefs } from "./theme-prefs";
import type { AiConfig, GridPrefs, Integrations, IntegrationsCredentials, LifeRingColors, UiPrefs } from "./types";

export const DEFAULT_GRID_GAP = 8;
export const DEFAULT_TOP_GRID: GridPrefs = { cols: 6, rows: 3, tileScale: 100, colGap: 8, rowGap: 8 };

export const DEFAULT_LIFE_RINGS: LifeRingColors = {
  sleep: "#5ac8fa",
  ring2: "#34c759",
  ring3: "#ff9500",
};

export function defaultCredentials(): IntegrationsCredentials {
  return {
    garmin: { email: "", password: "" },
    ticktick: { clientId: "", clientSecret: "", accessToken: "" },
    ai: { entries: {} },
  };
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
    garmin: { tokenDir: "" },
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
    blockOpacity: 12,
    topGrid: { ...DEFAULT_TOP_GRID },
    lifeRings: { ...DEFAULT_LIFE_RINGS },
    lifeRingSlots: defaultLifeRingSlots(),
    lifeRingGoals: { ...DEFAULT_LIFE_RING_GOALS },
    fonts: defaultFontPrefs(),
  };
}
