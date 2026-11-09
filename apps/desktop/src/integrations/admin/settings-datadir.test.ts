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
    dataDir: "D:/orbita-old",
    ui: { insightTheme: "cold", insightPalette: { ...originalPalette } },
    integrations: { garmin: { tokenDir: "", syncDays: 7 }, credentials: { garmin: { email: "", password: "" } } },
  },
}));

const patchSettings = vi.hoisted(() => vi.fn());
const notifyDataDirChanged = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
const loadSettings = vi.hoisted(() => vi.fn(async () => state.value));
const cancelInsightDataDirChange = vi.hoisted(() => vi.fn());
const closeInsightSettings = vi.hoisted(() => vi.fn());

vi.mock("../../core/settings", () => ({
  getSettings: () => state.value,
  loadSettings,
  patchSettings,
}));
vi.mock("../../core/data/dir-sync", () => ({ notifyDataDirChanged }));
vi.mock("../../core/data/rebase-data-dir", () => ({
  patchForDataDirChange: vi.fn((_current: typeof state.value, nextDataDir: string) => ({
    dataDir: nextDataDir,
    integrations: _current.integrations,
  })),
}));
vi.mock("../../core/data/client", () => ({ isTauri: () => true }));
vi.mock("./settings/nav", () => ({ closeInsightSettings }));
vi.mock("./shell", () => ({
  requestInsightDataDirChange: vi.fn(async () => true),
  cancelInsightDataDirChange,
  presentInsightDataDirFault: vi.fn(),
}));
vi.mock("./settings/index", () => ({ isBillDirectory: () => false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./settings/global-tab", () => ({
  globalTabHtml: '<div class="insight-settings-panel is-active" data-tab-panel="global"><input id="insight-data-dir"></div>',
  bindGlobalTab: (root: HTMLElement) => ({
    fill: (dataDir: string) => {
      root.querySelector<HTMLInputElement>("#insight-data-dir")!.value = dataDir;
    },
    read: () => root.querySelector<HTMLInputElement>("#insight-data-dir")!.value.trim(),
  }),
}));
vi.mock("./settings/health-tab", () => ({
  healthTabHtml: '<div class="insight-settings-panel" data-tab-panel="health"></div>',
  bindHealthTab: () => ({
    fill: () => undefined,
    read: () => ({
      lifeRingGoals: {},
      healthTrackAxis: {},
      garminTokenDir: "",
      garminSyncDays: 7,
      garminEmail: "",
      garminPassword: "",
    }),
    dispose: () => undefined,
  }),
}));

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  patchSettings.mockReset();
  notifyDataDirChanged.mockReset();
  invoke.mockReset();
  cancelInsightDataDirChange.mockClear();
  closeInsightSettings.mockClear();
  state.value = {
    dataDir: "D:/orbita-old",
    ui: { insightTheme: "cold", insightPalette: { ...originalPalette } },
    integrations: { garmin: { tokenDir: "", syncDays: 7 }, credentials: { garmin: { email: "", password: "" } } },
  };
  loadSettings.mockImplementation(async () => state.value);
  document.body.innerHTML = "";
});

describe("Insight settings dataDir failure boundaries", () => {
  it("does not notify when patchSettings fails before a dataDir switch is saved", async () => {
    patchSettings.mockRejectedValueOnce(new Error("disk unavailable"));
    const { mountInsightSettingsPage } = await import("./settings/page");
    const root = document.createElement("div");
    const handle = mountInsightSettingsPage(root, { generation: 0, dataDirKey: "default" });
    handle.activate();

    root.querySelector<HTMLInputElement>("#insight-data-dir")!.value = "D:/orbita-new";
    root.querySelector<HTMLFormElement>(".insight-settings-form")!.requestSubmit();
    await flush();

    expect(patchSettings).toHaveBeenCalled();
    expect(notifyDataDirChanged).not.toHaveBeenCalled();
    expect(closeInsightSettings).not.toHaveBeenCalled();
    expect(root.querySelector(".insight-settings-error")?.textContent).toContain("保存失败");
  });

  it("does not notify the new dataDir after sidecar restart fails and rollback succeeds", async () => {
    patchSettings
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    invoke.mockRejectedValueOnce(new Error("sidecar restart failed"));
    loadSettings.mockResolvedValueOnce({
      ...state.value,
      dataDir: "D:/orbita-old",
    });

    const { mountInsightSettingsPage } = await import("./settings/page");
    const root = document.createElement("div");
    const handle = mountInsightSettingsPage(root, { generation: 0, dataDirKey: "default" });
    handle.activate();

    root.querySelector<HTMLInputElement>("#insight-data-dir")!.value = "D:/orbita-new";
    root.querySelector<HTMLFormElement>(".insight-settings-form")!.requestSubmit();
    await flush();

    expect(patchSettings).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("restart_ledger_sidecar");
    expect(cancelInsightDataDirChange).toHaveBeenCalled();
    expect(notifyDataDirChanged).not.toHaveBeenCalled();
    expect(closeInsightSettings).not.toHaveBeenCalled();
    expect(root.querySelector(".insight-settings-error")?.textContent).toContain("保存失败");
  });

  it("does not notify the new dataDir when rollback succeeds but persist probe is null", async () => {
    patchSettings
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    invoke.mockRejectedValueOnce(new Error("sidecar restart failed"));
    loadSettings.mockRejectedValueOnce(new Error("probe failed"));

    const { mountInsightSettingsPage } = await import("./settings/page");
    const root = document.createElement("div");
    const handle = mountInsightSettingsPage(root, { generation: 0, dataDirKey: "default" });
    handle.activate();

    root.querySelector<HTMLInputElement>("#insight-data-dir")!.value = "D:/orbita-new";
    root.querySelector<HTMLFormElement>(".insight-settings-form")!.requestSubmit();
    await flush();

    expect(notifyDataDirChanged).not.toHaveBeenCalled();
    expect(cancelInsightDataDirChange).toHaveBeenCalled();
    expect(closeInsightSettings).not.toHaveBeenCalled();
  });
});
