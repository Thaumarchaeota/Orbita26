import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInsightSettingsPage } from "./page";

const state = vi.hoisted(() => ({
  settings: {
    dataDir: "D:/orbita-data",
    ui: { insightPalette: { primary: "#4B78B8" } },
    integrations: { credentials: {} },
  },
  patchSettings: vi.fn(async (): Promise<void> => undefined),
  closeInsightSettings: vi.fn(),
}));

vi.mock("../../../core/settings", () => ({
  getSettings: () => state.settings,
  loadSettings: async () => state.settings,
  patchSettings: state.patchSettings,
}));
vi.mock("./nav", () => ({ closeInsightSettings: state.closeInsightSettings }));
vi.mock("../../../core/data/dir-sync", () => ({ notifyDataDirChanged: vi.fn() }));
vi.mock("../../../core/data/rebase-data-dir", () => ({
  patchForDataDirChange: (_current: unknown, nextDataDir: string) => ({ dataDir: nextDataDir, integrations: {} }),
}));
vi.mock("../../../core/data/client", () => ({ isTauri: () => false }));
vi.mock("../shell", () => ({
  cancelInsightDataDirChange: vi.fn(),
  presentInsightDataDirFault: vi.fn(),
  requestInsightDataDirChange: vi.fn(async () => true),
}));
vi.mock("../host-guards", () => ({ clearLocalDataDirSwitchAuthorized: vi.fn() }));
vi.mock("./index", () => ({ isBillDirectory: (value: string) => value === "bill" }));
vi.mock("../insight-theme", () => ({ enqueueInsightSettingsWrite: (task: () => Promise<unknown>) => task() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const tabMocks = vi.hoisted(() => ({
  html: (id: string, body: string) =>
    `<div class="insight-settings-panel" data-tab-panel="${id}">${body}</div>`,
  globalFill: vi.fn(),
  globalRead: vi.fn(() => "D:/orbita-data"),
  appearanceFill: vi.fn(),
  appearanceRead: vi.fn((): { primary: string } | null => ({ primary: "#4B78B8" })),
  appearanceReset: vi.fn(),
  healthFill: vi.fn(),
  healthRead: vi.fn(() => ({ lifeRingGoals: {}, healthTrackAxis: {}, garminTokenDir: "", garminSyncDays: 7, garminEmail: "", garminPassword: "" })),
  healthDispose: vi.fn(),
}));

vi.mock("./global-tab", () => ({
  globalTabHtml: tabMocks.html("global", '<input id="insight-data-dir" value="D:/orbita-data">'),
  bindGlobalTab: () => ({ fill: tabMocks.globalFill, read: tabMocks.globalRead }),
}));
vi.mock("./appearance-tab", () => ({
  appearanceTabHtml: tabMocks.html("appearance", '<input data-appearance-field="primary">'),
  bindAppearanceTab: () => ({ fill: tabMocks.appearanceFill, read: tabMocks.appearanceRead, reset: tabMocks.appearanceReset }),
}));
vi.mock("./health-tab", () => ({
  healthTabHtml: tabMocks.html("health", '<input data-health-field="days">'),
  bindHealthTab: () => ({ fill: tabMocks.healthFill, read: tabMocks.healthRead, dispose: tabMocks.healthDispose }),
}));

describe("settings temporary surface layout", () => {
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    state.patchSettings.mockReset().mockResolvedValue(undefined);
    tabMocks.globalRead.mockReturnValue("D:/orbita-data");
    tabMocks.appearanceRead.mockReturnValue({ primary: "#4B78B8" });
  });

  afterEach(() => {
    cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    document.body.replaceChildren();
  });

  function mount() {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mountInsightSettingsPage(root, {} as never);
    const host = document.createElement("aside");
    document.body.appendChild(host);
    const cleanupRail = handle.getSecondaryRailDescriptor?.().renderContent(host);
    cleanups.push(() => handle.dispose());
    if (typeof cleanupRail === "function") cleanups.push(cleanupRail);
    return { root, handle, host, cleanupRail };
  }

  function select(host: HTMLElement, key: string) {
    host.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${key}"]`)!.click();
  }

  function submit(root: HTMLElement) {
    root.querySelector<HTMLFormElement>("form.insight-settings-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  it("orders rail surfaces as general, appearance, temporary and defaults to general", () => {
    const { root, host } = mount();
    expect([...host.querySelectorAll<HTMLButtonElement>('[role="tab"][data-tab]')].map((b) => [b.dataset.tab, b.textContent?.trim()])).toEqual([
      ["general", "通用"],
      ["appearance", "外观"],
      ["temporary", "临时"],
    ]);
    expect(root.querySelector('[data-settings-surface="general"]')?.classList.contains("is-active")).toBe(true);
    expect(root.querySelector('[data-settings-surface="appearance"] .insight-settings-panel')).toBeNull();
    expect(root.querySelector('[data-settings-surface="general"] .insight-settings-panel')).toBeNull();
    expect(root.querySelector('[data-settings-surface="general"]')?.children).toHaveLength(0);
    expect(root.querySelector('[data-settings-surface="appearance"]')?.children).toHaveLength(0);
    expect(host.querySelector('[data-tab="general"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("mounts each legacy block once inside temporary and keeps its form there", () => {
    const { root, host, handle } = mount();
    select(host, "temporary");
    const temporary = root.querySelector('[data-settings-surface="temporary"]')!;
    expect(temporary.querySelectorAll('[data-tab-panel="global"]')).toHaveLength(1);
    expect(temporary.querySelectorAll('[data-tab-panel="appearance"]')).toHaveLength(1);
    expect(temporary.querySelectorAll('[data-tab-panel="health"]')).toHaveLength(1);
    expect(temporary.querySelector("form.insight-settings-form")).not.toBeNull();
    expect(root.querySelector('[data-settings-surface="general"] form')).toBeNull();
    expect(root.querySelector('[data-settings-surface="appearance"] form')).toBeNull();
    expect((temporary as HTMLElement).hidden).toBe(false);
    expect([...temporary.querySelectorAll<HTMLElement>(".insight-settings-panel")].every((panel) => !panel.hidden)).toBe(true);
    handle.activate();
    expect(tabMocks.globalFill).toHaveBeenCalledTimes(1);
    expect(tabMocks.appearanceFill).toHaveBeenCalledTimes(1);
    expect(tabMocks.healthFill).toHaveBeenCalledTimes(1);
  });

  it.each(["general", "appearance"])("does not submit hidden legacy fields from %s", async (key) => {
    const { root, host } = mount();
    select(host, key);
    submit(root);
    await Promise.resolve();
    expect(tabMocks.globalRead).not.toHaveBeenCalled();
    expect(tabMocks.appearanceRead).not.toHaveBeenCalled();
    expect(tabMocks.healthRead).not.toHaveBeenCalled();
    expect(state.patchSettings).not.toHaveBeenCalled();
    expect(state.closeInsightSettings).not.toHaveBeenCalled();
    expect(root.querySelector(`[data-settings-surface="${key}"]`)?.classList.contains("is-active")).toBe(true);
  });

  it.each(["directory", "palette"])("shows %s validation failure on temporary", async (field) => {
    const { root, host } = mount();
    if (field === "directory") tabMocks.globalRead.mockReturnValue("bill");
    else tabMocks.appearanceRead.mockReturnValue(null);
    select(host, "temporary");
    submit(root);
    await Promise.resolve();
    expect(root.querySelector('[data-settings-surface="temporary"]')?.classList.contains("is-active")).toBe(true);
    expect(root.querySelector<HTMLElement>(".insight-settings-error")?.hidden).toBe(false);
    expect(root.querySelector(".insight-settings-error")?.textContent).toContain(field === "directory" ? "bill" : "颜色");
    expect(state.patchSettings).not.toHaveBeenCalled();
  });

  it("saves the legacy form and closes only after the asynchronous save", async () => {
    const { root, host } = mount();
    let resolveSave!: () => void;
    state.patchSettings.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    select(host, "temporary");
    submit(root);
    expect(state.patchSettings).toHaveBeenCalledTimes(1);
    expect(state.patchSettings).toHaveBeenCalledWith(expect.objectContaining({ dataDir: "D:/orbita-data", ui: expect.objectContaining({ insightPalette: { primary: "#4B78B8" } }) }));
    expect(state.closeInsightSettings).not.toHaveBeenCalled();
    resolveSave();
    await vi.waitFor(() => expect(state.closeInsightSettings).toHaveBeenCalledTimes(1));
    expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
  });

  it("cancels preview and closes without saving", () => {
    const { root, host } = mount();
    select(host, "temporary");
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(tabMocks.appearanceReset).toHaveBeenCalledWith(state.settings.ui.insightPalette);
    expect(state.closeInsightSettings).toHaveBeenCalledTimes(1);
    expect(state.patchSettings).not.toHaveBeenCalled();
  });

  it.each(["general", "appearance"])("returns to temporary when a pending save fails after switching to %s", async (key) => {
    const { root, host } = mount();
    let rejectSave!: (error: Error) => void;
    state.patchSettings.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    select(host, "temporary");
    submit(root);
    select(host, key);
    rejectSave(new Error("save failed"));
    await vi.waitFor(() => {
      expect(root.querySelector('[data-settings-surface="temporary"]')?.classList.contains("is-active")).toBe(true);
      expect(root.querySelector<HTMLElement>(".insight-settings-error")?.hidden).toBe(false);
    });
    expect(root.querySelector(".insight-settings-error")?.textContent).toContain("save failed");
    expect(tabMocks.appearanceReset).toHaveBeenCalledWith(state.settings.ui.insightPalette);
    expect(state.closeInsightSettings).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
  });
});
