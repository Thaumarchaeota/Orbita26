import type { AppSettings } from "../../core/settings";
import {
  applyAppearance,
  applyUiPrefs,
  getSettings,
  patchSettings,
} from "../../core/settings";
import { loadAiConfig } from "../ai/config";
import { SETTINGS_GEAR_SVG } from "../ai/icons";
import { bindDialog, type MotionTrigger } from "../../ui/motion";
import type { DidaProject } from "../ticktick/types";
import { appearanceTabHtml, bindAppearanceTab, createAppearanceState, type AppearanceState } from "./tabs/appearance";
import { layoutTabHtml, bindLayoutTab, createLayoutState, type LayoutState } from "./tabs/layout";
import { localTabHtml, bindLocalTab } from "./tabs/local";
import { aiTabHtml, bindAiTab } from "./tabs/ai";
import { tasksTabHtml, bindTasksTab } from "./tabs/tasks";

export type SettingsTabId = "appearance" | "layout" | "local" | "ai" | "tasks";

const TAB_LABELS: { id: SettingsTabId; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "layout", label: "布局" },
  { id: "local", label: "本地" },
  { id: "ai", label: "智能体" },
  { id: "tasks", label: "任务" },
];

let ticktickProjectsProvider: (() => DidaProject[]) | null = null;

export function registerTicktickProjectsProvider(fn: () => DidaProject[]) {
  ticktickProjectsProvider = fn;
}

function getProjects(): DidaProject[] {
  return ticktickProjectsProvider?.() ?? [];
}

let openDialogFn: ((tab?: SettingsTabId, trigger?: MotionTrigger) => Promise<boolean>) | null = null;

export function openSettings(tab?: SettingsTabId, trigger?: MotionTrigger) {
  if (!openDialogFn) throw new Error("settings dialog not mounted");
  return openDialogFn(tab, trigger);
}

export function mountSettingsButton(root: HTMLElement) {
  const mount = root.querySelector<HTMLElement>("#settingsMount") ?? root;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-btn";
  btn.removeAttribute("title");
  btn.dataset.tip = "设置";
  btn.innerHTML = SETTINGS_GEAR_SVG;
  mount.appendChild(btn);

  openDialogFn = mountSettingsDialog(root);
  btn.addEventListener("click", (e) => void openDialogFn!("appearance", e));
}

function mountSettingsDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-settings" id="settingsDialogForm">
      <div class="dialog-title">设置</div>
      <div class="settings-tabs" role="tablist">
        ${TAB_LABELS.map(
          ({ id, label }) =>
            `<button type="button" class="settings-tab" data-tab="${id}" role="tab">${label}</button>`,
        ).join("")}
      </div>
      <div class="dialog-scroll">
        ${appearanceTabHtml}
        ${layoutTabHtml}
        ${localTabHtml}
        ${aiTabHtml}
        ${tasksTabHtml}
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#settingsDialogForm")!;
  const tabBtns = backdrop.querySelectorAll<HTMLButtonElement>(".settings-tab");
  const tabPanels = backdrop.querySelectorAll<HTMLElement>(".settings-tab-panel");

  let appearanceState = createAppearanceState(getSettings());
  let layoutState = createLayoutState(getSettings());
  let savedSettings = getSettings();
  let resolvePending: ((value: boolean) => void) | null = null;

  const setAppearanceState = (patch: Partial<AppearanceState>) => {
    appearanceState = { ...appearanceState, ...patch };
  };
  const setLayoutState = (patch: Partial<LayoutState>) => {
    layoutState = { ...layoutState, ...patch };
  };

  const previewUi = () => {
    applyUiPrefs({
      ...savedSettings.ui,
      blockOpacity: appearanceState.blockOpacity,
      topGrid: layoutState.topGrid,
      dockLeftGrid: layoutState.dockLeftGrid,
      fonts: appearanceState.fonts,
    });
  };

  const appearanceTab = bindAppearanceTab(backdrop, () => appearanceState, setAppearanceState, previewUi);
  const layoutTab = bindLayoutTab(backdrop, () => layoutState, setLayoutState, previewUi);
  const localTab = bindLocalTab(backdrop);
  const aiTab = bindAiTab(backdrop);
  const tasksTab = bindTasksTab(backdrop, getProjects);

  const switchTab = (tab: SettingsTabId) => {
    tabBtns.forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    tabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== tab;
    });
    if (tab === "tasks") tasksTab.refreshProjects();
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab as SettingsTabId);
    });
  });

  const fillForm = (settings: AppSettings) => {
    savedSettings = settings;
    appearanceState = createAppearanceState(settings);
    layoutState = createLayoutState(settings);
    appearanceTab.fill(settings);
    layoutTab.fill(settings);
    localTab.fill(settings);
    aiTab.fill(settings.ai);
    tasksTab.fill(settings);
  };

  const close = async (saved: boolean) => {
    if (!saved) applyAppearance(savedSettings);
    await tasksTab.closePickers();
    await motion.close();
    resolvePending?.(saved);
    resolvePending = null;
  };

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(false);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const appearance = appearanceTab.read();
    const layout = layoutTab.read();
    const local = localTab.read();
    const ai = aiTab.read(savedSettings.ai);
    const tasks = tasksTab.read(savedSettings);
    const next = await patchSettings({
      theme: appearance.theme,
      dataDir: local.dataDir,
      ui: {
        ...savedSettings.ui,
        blockOpacity: appearance.blockOpacity,
        topGrid: layout.topGrid,
        dockLeftGrid: layout.dockLeftGrid,
        fonts: appearance.fonts,
      },
      integrations: {
        v2ray: { exePath: local.v2rayExePath },
        zotero: {
          dataDir: local.zoteroDataDir,
          articleNoteDir: local.zoteroNoteDir,
        },
        obsidian: { vaultDir: local.obsidianVaultDir },
        everything: { exePath: local.everythingExePath },
        cursor: { exePath: local.cursorExePath },
        ticktick: {
          clientId: tasks.clientId,
          clientSecret: tasks.clientSecret,
          redirectUri: tasks.redirectUri,
          accessToken: savedSettings.integrations.ticktick.accessToken,
          defaultProjectId: tasks.defaultProjectId,
        },
      },
      ai,
    });
    applyAppearance(next);
    await loadAiConfig();
    window.dispatchEvent(new CustomEvent("orbita:ui-prefs"));
    window.dispatchEvent(new CustomEvent("orbita:ai-config"));
    void close(true);
  });

  return (tab?: SettingsTabId, trigger?: MotionTrigger) =>
    new Promise<boolean>((resolve) => {
      resolvePending = resolve;
      fillForm(getSettings());
      switchTab(tab ?? "appearance");
      void motion.open(trigger);
    });
}
