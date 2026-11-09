import { beforeEach, describe, expect, it, vi } from "vitest";

const originalPalette = vi.hoisted(() => ({
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
}));

const state = vi.hoisted(() => ({
  value: {
    dataDir: "D:/orbita",
    ui: { insightTheme: "cold", insightPalette: { ...originalPalette } },
    integrations: { credentials: { garmin: {} } },
  },
}));
const patchSettings = vi.hoisted(() => vi.fn(async (patch: { ui?: Record<string, unknown> }) => {
  if (patch.ui) state.value.ui = { ...state.value.ui, ...patch.ui };
  return state.value;
}));
const closeInsightSettings = vi.hoisted(() => vi.fn());

vi.mock("../../../core/settings", () => ({
  getSettings: () => state.value,
  patchSettings,
}));
vi.mock("../../../core/data/dir-sync", () => ({ notifyDataDirChanged: vi.fn() }));
vi.mock("../../../core/data/rebase-data-dir", () => ({ patchForDataDirChange: vi.fn() }));
vi.mock("../../../core/data/client", () => ({ isTauri: () => false }));
vi.mock("./nav", () => ({ closeInsightSettings }));
vi.mock("../shell", () => ({ requestInsightDataDirChange: vi.fn(async () => true) }));
vi.mock("./index", () => ({ isBillDirectory: () => false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../tabs/chat-rail", () => ({
  INSIGHT_CHAT_RAIL_TOGGLE_EVENT: "orbita:test-rail",
  insightChatRailCollapsed: () => false,
}));
vi.mock("./global-tab", () => ({
  globalTabHtml: '<div class="insight-settings-panel" data-tab-panel="global"><input id="insight-data-dir"></div>',
  bindGlobalTab: (root: HTMLElement) => ({
    fill: (dataDir: string) => {
      root.querySelector<HTMLInputElement>("#insight-data-dir")!.value = dataDir;
    },
    read: () => root.querySelector<HTMLInputElement>("#insight-data-dir")!.value,
  }),
}));
vi.mock("./health-tab", () => ({
  healthTabHtml: '<div class="insight-settings-panel" data-tab-panel="health"></div>',
  bindHealthTab: () => ({
    fill: () => undefined,
    read: () => ({ lifeRingGoals: {}, healthTrackAxis: {}, garminTokenDir: "", garminSyncDays: 7, garminEmail: "", garminPassword: "" }),
    dispose: () => undefined,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  patchSettings.mockClear();
  closeInsightSettings.mockClear();
  state.value = {
    dataDir: "D:/orbita",
    ui: { insightTheme: "cold", insightPalette: { ...originalPalette } },
    integrations: { credentials: { garmin: {} } },
  };
  document.documentElement.dataset.insightTheme = "cold";
  document.documentElement.style.setProperty("--insight-primary", originalPalette.primary);
});

describe("Insight appearance settings cancellation", () => {
  it("restores the persisted palette after live preview is cancelled", async () => {
    const { mountInsightSettingsPage } = await import("./page");
    const root = document.createElement("div");
    const handle = mountInsightSettingsPage(root, { generation: 0, dataDirKey: "default" });
    handle.activate();
    const rail = document.createElement("div");
    handle.getSecondaryRailDescriptor().renderContent(rail);
    root.append(rail);

    root.querySelector<HTMLButtonElement>('[data-tab="appearance"]')!.click();
    const primary = root.querySelector<HTMLInputElement>('[data-insight-palette-hex="primary"]')!;
    primary.value = "#abcdef";
    primary.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.documentElement.style.getPropertyValue("--insight-primary")).toBe("#ABCDEF");

    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();

    expect(closeInsightSettings).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue("--insight-primary")).toBe(originalPalette.primary);
  });
});
