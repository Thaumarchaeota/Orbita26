import type { AppSettings } from "../../core/settings";
import {
  applyAppearance,
  applyUiPrefs,
  getSettings,
  patchSettings,
} from "../../core/settings";
import { applyThemePrefs, themeFromPrefs } from "../../core/data/theme-prefs";
import { loadAiConfig } from "../ai/config";
import { SETTINGS_GEAR_SVG } from "../ai/icons";
import { bindDialog, type MotionTrigger } from "../../ui/motion";
import { mountModalBackdrop } from "../../ui/modal-root";
import type { DidaProject } from "../ticktick/types";
import { appearanceTabHtml, bindAppearanceTab, createAppearanceState, type AppearanceState } from "./tabs/appearance";
import { navigationTabHtml, bindNavigationTab } from "./tabs/navigation";
import { lifeTabHtml, bindLifeTab } from "./tabs/life";
import { workTabHtml, bindWorkTab } from "./tabs/work";
import { aiTabHtml, bindAiTab } from "./tabs/ai";
import { tasksTabHtml, bindTasksTab } from "./tabs/tasks";
import { enhanceSettingsFormControls } from "./form-controls";

export type SettingsTabId = "appearance" | "navigation" | "life" | "work" | "ai" | "tasks";

const TAB_LABELS: { id: SettingsTabId; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "navigation", label: "导航" },
  { id: "life", label: "今日" },
  { id: "work", label: "工作区" },
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

export function mountSettingsButton(root: HTMLElement, iconSvg = SETTINGS_GEAR_SVG) {
  const mount = root.querySelector<HTMLElement>("#settingsMount") ?? root;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "top-toolkit-icon-btn";
  btn.removeAttribute("title");
  btn.dataset.tip = "设置";
  btn.innerHTML = iconSvg;
  mount.appendChild(btn);

  openDialogFn = mountSettingsDialog();
  btn.addEventListener("click", (e) => void openDialogFn!("appearance", e));

  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.key !== ",") return;
    if (isSettingsEditableTarget(e.target)) return;
    e.preventDefault();
    void openDialogFn!("appearance");
  });
}

function isSettingsEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t.isContentEditable;
}

function mountSettingsDialog() {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-settings" id="settingsDialogForm">
      <div class="settings-header">
        <div class="dialog-title">设置</div>
        <div class="settings-tabs" role="tablist">
          ${TAB_LABELS.map(
            ({ id, label }) =>
              `<button type="button" class="settings-tab" data-tab="${id}" role="tab">${label}</button>`,
          ).join("")}
          <div class="settings-tab-indicator"></div>
        </div>
      </div>
      <div class="settings-body">
        <div class="settings-tab-panels">
          ${appearanceTabHtml}
          ${navigationTabHtml}
          ${lifeTabHtml}
          ${workTabHtml}
          ${aiTabHtml}
          ${tasksTabHtml}
        </div>
      </div>
      <div class="dialog-actions settings-footer">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  mountModalBackdrop(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#settingsDialogForm")!;
  const tabBtns = backdrop.querySelectorAll<HTMLButtonElement>(".settings-tab");
  const tabPanels = backdrop.querySelectorAll<HTMLElement>(".settings-tab-panel");
  const tabsEl = backdrop.querySelector<HTMLElement>(".settings-tabs")!;
  const tabIndicator = backdrop.querySelector<HTMLElement>(".settings-tab-indicator")!;

  const moveTabIndicator = (btn: HTMLButtonElement) => {
    const tabsRect = tabsEl.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    tabIndicator.style.width = `${btnRect.width}px`;
    tabIndicator.style.transform = `translateX(${btnRect.left - tabsRect.left}px)`;
    tabIndicator.style.opacity = "1";
  };

  enhanceSettingsFormControls(form);

  let appearanceState = createAppearanceState(getSettings());
  let savedSettings = getSettings();
  let resolvePending: ((value: boolean) => void) | null = null;

  const setAppearanceState = (patch: Partial<AppearanceState>) => {
    appearanceState = { ...appearanceState, ...patch };
  };

  const previewUi = () => {
    applyThemePrefs(appearanceState.themePrefs);
    applyUiPrefs({
      ...savedSettings.ui,
      blockOpacity: appearanceState.blockOpacity,
      fonts: appearanceState.fonts,
      themePrefs: appearanceState.themePrefs,
    });
  };

  const appearanceTab = bindAppearanceTab(backdrop, () => appearanceState, setAppearanceState, previewUi);
  const navigationTab = bindNavigationTab(backdrop);
  const lifeTab = bindLifeTab(backdrop);
  const workTab = bindWorkTab(backdrop, getProjects);
  const aiTab = bindAiTab(backdrop);
  const tasksTab = bindTasksTab(backdrop, getProjects);

  const switchTab = (tab: SettingsTabId) => {
    tabBtns.forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) moveTabIndicator(btn);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.tabPanel === tab);
    });
    if (tab === "tasks") tasksTab.refreshProjects();
    if (tab === "work") workTab.refreshProjects();
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab as SettingsTabId);
    });
  });
  window.addEventListener("resize", () => {
    const active = backdrop.querySelector<HTMLButtonElement>(".settings-tab.is-active");
    if (active) moveTabIndicator(active);
  });

  const fillForm = (settings: AppSettings) => {
    savedSettings = settings;
    appearanceState = createAppearanceState(settings);
    appearanceTab.fill(settings);
    navigationTab.fill(settings);
    lifeTab.fill(settings);
    workTab.fill(settings);
    aiTab.fill(settings.ai);
    tasksTab.fill(settings);
    enhanceSettingsFormControls(form);
  };

  const close = async (saved: boolean) => {
    if (!saved) applyAppearance(savedSettings);
    await tasksTab.closePickers();
    await workTab.closePickers();
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
    const navigation = navigationTab.read();
    const life = lifeTab.read();
    const ai = aiTab.read(savedSettings.ai);
    const tasks = tasksTab.read(savedSettings);
    const work = workTab.read();
    const cred = savedSettings.integrations.credentials;
    const next = await patchSettings({
      theme: themeFromPrefs(appearance.themePrefs),
      ui: {
        ...savedSettings.ui,
        themePrefs: appearance.themePrefs,
        blockOpacity: appearance.blockOpacity,
        fonts: appearance.fonts,
        lifeRingGoals: life.lifeRingGoals,
        healthTrackAxis: life.healthTrackAxis,
      },
      integrations: {
        ...savedSettings.integrations,
        v2ray: { exePath: navigation.v2rayExePath },
        zotero: {
          dataDir: navigation.zoteroDataDir,
          articleNoteDir: navigation.zoteroNoteDir,
        },
        obsidian: { vaultDir: navigation.obsidianVaultDir },
        everything: { exePath: navigation.everythingExePath },
        cursor: { exePath: navigation.cursorExePath },
        journal: { dataRoot: life.journalDataRoot },
        garmin: {
          tokenDir: life.garminTokenDir,
          syncDays: savedSettings.integrations.garmin.syncDays,
        },
        work: {
          projectNotesDir: work.projectNotesDir,
          ticktickProjectId: work.ticktickProjectId,
        },
        ticktick: {
          clientId: tasks.clientId,
          clientSecret: tasks.clientSecret,
          redirectUri: tasks.redirectUri,
          accessToken: cred.ticktick.accessToken || savedSettings.integrations.ticktick.accessToken,
          defaultProjectId: tasks.defaultProjectId,
        },
        credentials: {
          garmin: { email: life.garminEmail, password: life.garminPassword },
          ticktick: {
            clientId: tasks.clientId,
            clientSecret: tasks.clientSecret,
            accessToken: cred.ticktick.accessToken || savedSettings.integrations.ticktick.accessToken,
          },
          ai: {
            entries: Object.fromEntries(ai.entries.map((en) => [en.id, en.apiKey])),
          },
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
      void motion.open(trigger).then(() => {
        const active = backdrop.querySelector<HTMLButtonElement>(".settings-tab.is-active");
        if (active) moveTabIndicator(active);
      });
    });
}
