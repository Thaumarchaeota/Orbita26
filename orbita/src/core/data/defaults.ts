import { defaultFontPrefs } from "./fonts";
import type { AiConfig, GridPrefs, Integrations, UiPrefs } from "./types";

export const DEFAULT_GRID_GAP = 8;
export const DEFAULT_TOP_GRID: GridPrefs = { cols: 6, rows: 3, tileScale: 100, colGap: 8, rowGap: 8 };
export const DEFAULT_DOCK_LEFT_GRID: GridPrefs = { cols: 2, rows: 5, tileScale: 100, colGap: 8, rowGap: 8 };

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
  };
}

export function defaultUiPrefs(): UiPrefs {
  return {
    engineId: "google",
    localTab: "file",
    activeConversationId: null,
    blockOpacity: 12,
    topGrid: { ...DEFAULT_TOP_GRID },
    dockLeftGrid: { ...DEFAULT_DOCK_LEFT_GRID },
    fonts: defaultFontPrefs(),
  };
}
