import "../../../ui/theme-settings.css";
import "./insight-settings.css";
import { notifyDataDirChanged } from "../../../core/data/dir-sync";
import { patchForDataDirChange } from "../../../core/data/rebase-data-dir";
import { isTauri } from "../../../core/data/client";
import { getSettings, loadSettings, patchSettings } from "../../../core/settings";
import type { InsightDestinationHandle, InsightDisposeReason, InsightHostContext } from "../types";
import type { RailDescriptor } from "../secondary-rail";
import { closeInsightSettings } from "./nav";
import {
  cancelInsightDataDirChange,
  presentInsightDataDirFault,
  requestInsightDataDirChange,
} from "../shell";
import { clearLocalDataDirSwitchAuthorized } from "../host-guards";
import { invoke } from "@tauri-apps/api/core";
import { isBillDirectory } from "./index";
import { bindGlobalTab, globalTabHtml } from "./global-tab";
import { bindHealthTab, healthTabHtml, type HealthSettingsDraft } from "./health-tab";
import { enqueueInsightSettingsWrite } from "../insight-theme";
import { mountThemeEditorPanel } from "../appearance/theme-editor-panel";
import { getThemeEditSession, bindThemeEditDirtyOwner } from "../appearance/theme-edit-session";

type SettingsTabId = "general" | "temporary" | "color-management";

async function readPersistedDataDir(): Promise<string | null> {
  try {
    if (typeof loadSettings !== "function") return null;
    const settings = await loadSettings();
    const dir = settings?.dataDir;
    return typeof dir === "string" && dir.trim() ? dir : null;
  } catch {
    return null;
  }
}

const TAB_LABELS: { id: SettingsTabId; label: string }[] = [
  { id: "general", label: "通用" },
  { id: "temporary", label: "临时" },
  { id: "color-management", label: "色彩管理" },
];

export function mountInsightSettingsPage(
  root: HTMLElement,
  ctx: InsightHostContext,
): InsightDestinationHandle {
  const ac = new AbortController();
  const { signal } = ac;
  let activeTab: SettingsTabId = "general";
  let tabHost: HTMLElement | null = null;
  let formInitialized = false;

  root.innerHTML = `
    <div class="insight-chat-page insight-settings">
      <div class="insight-chat-main">
        <div class="insight-settings-surface" data-settings-surface="general"></div>
        <div class="insight-settings-surface" data-settings-surface="temporary">
        <form class="insight-settings-form">
          <div class="insight-settings-body">
            <div class="insight-settings-panels">
              ${globalTabHtml}
              ${healthTabHtml}
            </div>
            <p class="insight-settings-error" role="status" hidden></p>
          </div>
          <footer class="insight-settings-actions">
            <button type="button" class="insight-settings-action" data-action="cancel">取消</button>
            <button type="submit" class="insight-settings-action insight-settings-action-primary">保存</button>
          </footer>
        </form>
        </div>
        <div class="insight-settings-surface" data-settings-surface="color-management"><div class="insight-color-management-host"></div></div>
      </div>
    </div>`;

  const form = root.querySelector<HTMLFormElement>(".insight-settings-form")!;
  const errorEl = root.querySelector<HTMLElement>(".insight-settings-error")!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const tabSurfaces = root.querySelectorAll<HTMLElement>("[data-settings-surface]");

  const globalTab = bindGlobalTab(root);
  const healthTab = bindHealthTab(root);
  const themeManagement = mountThemeEditorPanel(root.querySelector<HTMLElement>(".insight-color-management-host")!);
  const releaseThemeDirtyOwner = bindThemeEditDirtyOwner(root.dataset.surface ?? "settings");

  function getSecondaryRailDescriptor(): RailDescriptor {
    return {
      kind: "settings",
      title: "设置",
      selectedKey: activeTab,
      onSelect: (key) => {
        navigateTab(key as SettingsTabId);
      },
      renderContent(host) {
        tabHost = host;
        host.setAttribute("role", "tablist");
        host.innerHTML = TAB_LABELS.map(
          ({ id, label }) =>
            `<div class="insight-chat-rail-row">
              <button type="button" class="insight-chat-rail-item${id === activeTab ? " is-active" : ""}" data-tab="${id}" role="tab" aria-selected="${id === activeTab ? "true" : "false"}">${label}</button>
            </div>`,
        ).join("");
        host.addEventListener("click", onTabHostClick);
        return () => {
          host.removeEventListener("click", onTabHostClick);
          host.innerHTML = "";
          tabHost = null;
        };
      },
    };
  }

  function paintTabs() {
    if (!tabHost) return;
    tabHost.querySelectorAll<HTMLButtonElement>(".insight-chat-rail-item").forEach((btn) => {
      const isActive = btn.dataset.tab === activeTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function onTabHostClick(e: Event) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".insight-chat-rail-item");
    if (!btn?.dataset.tab) return;
    navigateTab(btn.dataset.tab as SettingsTabId);
  }

  function navigateTab(tab: SettingsTabId): void {
    if (ctx.navigation) void ctx.navigation.navigate({ route: { tab }, context: null });
    else switchTab(tab);
  }

  const switchTab = (tab: SettingsTabId) => {
    activeTab = tab;
    paintTabs();
    tabSurfaces.forEach((surface) => {
      const isActive = surface.dataset.settingsSurface === tab;
      surface.classList.toggle("is-active", isActive);
      surface.hidden = !isActive;
    });
  };

  switchTab("general");

  const fillForm = () => {
    const settings = getSettings();
    globalTab.fill(settings.dataDir);
    healthTab.fill(settings);
    errorEl.hidden = true;
    errorEl.classList.remove("is-success");
  };

  const healthDraftPatch = (health: HealthSettingsDraft) => ({
    ui: {
      lifeRingGoals: health.lifeRingGoals,
      healthTrackAxis: health.healthTrackAxis,
    },
    integrations: {
      garmin: { tokenDir: health.garminTokenDir, syncDays: health.garminSyncDays },
      credentials: {
        garmin: { email: health.garminEmail, password: health.garminPassword },
        variflight: { apiKey: health.variflightApiKey },
      },
    },
  });

  let editRevision = 0;
  let savedEditRevision = 0;
  let saveRequestRevision = 0;
  let latestSavePromise: Promise<boolean> | null = null;
  const clearSaveStatus = () => {
    errorEl.hidden = true;
    errorEl.classList.remove("is-success");
  };
  const saveTemporaryDraft = async (): Promise<boolean> => {
    if (editRevision === savedEditRevision) {
      return latestSavePromise ? latestSavePromise : true;
    }
    const requestRevision = ++saveRequestRevision;
    const writtenEditRevision = editRevision;
    const draft = healthTab.read();
    errorEl.textContent = "保存中…";
    errorEl.hidden = false;
    errorEl.classList.remove("is-success");
    try {
      await enqueueInsightSettingsWrite(async () => {
        await patchSettings(healthDraftPatch(draft));
      });
      savedEditRevision = Math.max(savedEditRevision, writtenEditRevision);
      if (requestRevision === saveRequestRevision && writtenEditRevision === editRevision) {
        errorEl.textContent = "设置已保存";
        errorEl.hidden = false;
        errorEl.classList.add("is-success");
      }
      return true;
    } catch (error) {
      if (requestRevision === saveRequestRevision) {
        errorEl.textContent = `保存失败：${String(error)}`;
        errorEl.hidden = false;
        errorEl.classList.remove("is-success");
      }
      return false;
    }
  };
  const queueTemporaryDraftSave = () => {
    latestSavePromise = saveTemporaryDraft();
    return latestSavePromise;
  };

  const isHealthField = (target: EventTarget | null): target is HTMLInputElement | HTMLSelectElement => {
    if (target instanceof HTMLInputElement) {
      return !!target.closest('[data-tab-panel="health"]') && !target.readOnly && target.type !== "button" && target.type !== "submit";
    }
    return target instanceof HTMLSelectElement && !!target.closest('[data-tab-panel="health"]');
  };

  form.addEventListener("input", (event) => {
    if (!isHealthField(event.target)) return;
    editRevision += 1;
    clearSaveStatus();
  }, { signal });

  form.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement) || !isHealthField(event.target)) return;
    editRevision += 1;
    void queueTemporaryDraftSave();
  }, { signal });

  form.addEventListener("focusout", (event) => {
    if (!(event.target instanceof HTMLInputElement) || !isHealthField(event.target)) return;
    const related = event.relatedTarget;
    const passwordField = event.target.closest(".password-field");
    if (related instanceof Node && passwordField?.contains(related)) return;
    if (related instanceof HTMLElement && related.closest('[data-action="cancel"], [type="submit"]')) return;
    void queueTemporaryDraftSave();
  }, { signal });

  root.querySelector('[data-action="cancel"]')!.addEventListener(
    "click",
    () => {
      closeInsightSettings();
    },
    { signal },
  );

  form.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      if (activeTab !== "temporary") return;
      if (getThemeEditSession()) {
        errorEl.textContent = "请先在浮动编辑器中保存、保存并应用或取消主题编辑，再保存设置。";
        errorEl.hidden = false;
        switchTab("temporary");
        return;
      }
      if (!(await themeManagement.canDispose())) {
        switchTab("color-management");
        return;
      }
      const nextDataDir = globalTab.read();
      if (isBillDirectory(nextDataDir)) {
        errorEl.textContent = "请选择包含 bill 文件夹的数据根目录，而不是 bill 文件夹本身。";
        errorEl.hidden = false;
        switchTab("temporary");
        return;
      }
      const current = getSettings();
      const health = healthTab.read();
      const submittedEditRevision = editRevision;
      const dataDirChanged = current.dataDir !== nextDataDir;

      if (dataDirChanged && !(await requestInsightDataDirChange())) return;

      submitBtn.disabled = true;
      errorEl.hidden = true;
      let settingsSaved = false;
      try {
        const dataDirPatch = dataDirChanged ? patchForDataDirChange(current, nextDataDir) : {
          dataDir: current.dataDir,
          integrations: current.integrations,
        };
        const healthPatch = healthDraftPatch(health);
        const savePatch = {
          ...dataDirPatch,
          ui: healthPatch.ui,
          integrations: {
            ...dataDirPatch.integrations,
            garmin: healthPatch.integrations.garmin,
            credentials: {
              ...dataDirPatch.integrations.credentials,
              ...healthPatch.integrations.credentials,
            },
          },
        };
        await enqueueInsightSettingsWrite(() => patchSettings(savePatch).then(() => undefined));
        if (submittedEditRevision === editRevision) {
          savedEditRevision = submittedEditRevision;
          latestSavePromise = Promise.resolve(true);
        }
        settingsSaved = true;
        if (dataDirChanged) {
          if (isTauri()) await invoke("restart_ledger_sidecar");
          notifyDataDirChanged(nextDataDir);
        }
        closeInsightSettings();
      } catch (error) {
        switchTab("temporary");
        if (!dataDirChanged) {
          errorEl.textContent = `保存失败：${String(error)}`;
          errorEl.hidden = false;
          return;
        }
        if (!settingsSaved) {
          if (typeof cancelInsightDataDirChange === "function") cancelInsightDataDirChange();
          else clearLocalDataDirSwitchAuthorized();
          errorEl.textContent = `保存失败：${String(error)}`;
          errorEl.hidden = false;
          return;
        }
        let settingsRolledBack = false;
        let rollbackError: unknown;
        try {
          await enqueueInsightSettingsWrite(() =>
            patchSettings({ dataDir: current.dataDir, integrations: current.integrations }).then(() => undefined),
          );
          settingsRolledBack = true;
          if (isTauri()) await invoke("restart_ledger_sidecar");
        } catch (failedRollback) {
          rollbackError = failedRollback;
        }
        const persisted = await readPersistedDataDir();
        if (settingsRolledBack && persisted !== nextDataDir) {
          if (typeof cancelInsightDataDirChange === "function") cancelInsightDataDirChange();
          else clearLocalDataDirSwitchAuthorized();
          errorEl.textContent = `保存失败：${String(error)}`;
          errorEl.hidden = false;
          return;
        }
        if (persisted === nextDataDir) {
          const msg = `设置已指向新目录，但服务切换失败：${String(error)}${
            rollbackError ? `；回滚失败：${String(rollbackError)}` : ""
          }`;
          if (typeof presentInsightDataDirFault === "function") presentInsightDataDirFault(msg);
          notifyDataDirChanged(nextDataDir);
          closeInsightSettings();
          return;
        }
        const unknownMsg = `无法确认当前数据目录（原错误：${String(error)}${
          rollbackError ? `；回滚：${String(rollbackError)}` : ""
        }）。已暂停领域写入。`;
        if (typeof presentInsightDataDirFault === "function") presentInsightDataDirFault(unknownMsg);
        closeInsightSettings();
      } finally {
        submitBtn.disabled = false;
      }
    },
    { signal },
  );

  return {
    activate() {
      // The cached instance owns unsaved fields; revisiting only restores its selected subpage (SPEC-0014 §4.2).
      if (!formInitialized) { fillForm(); formInitialized = true; }
    },
    navigation: {
      capture: () => ({ route: { tab: activeTab }, context: null }),
      canNavigate: () => !submitBtn.disabled,
      restore(state, token) {
        if (!token.isCurrent()) return { status: "blocked" };
        const tab = (state.route as { tab?: unknown } | null)?.tab;
        if (tab !== "general" && tab !== "temporary" && tab !== "color-management" && tab !== "appearance") return { status: "unavailable", message: "设置子页不可用" };
        switchTab(tab === "appearance" ? "color-management" : tab);
        return { status: "applied" };
      },
    },
    deactivate() {},
    getSecondaryRailDescriptor,
    getRestoreState: () => ({ tab: activeTab }),
    restoreState(state) {
      if (!state || typeof state !== "object") return;
      const tab = (state as Record<string, unknown>).tab;
      if (tab === "appearance") {
        activeTab = "color-management";
        switchTab(activeTab);
      } else if (tab === "general" || tab === "temporary" || tab === "color-management") {
        activeTab = tab;
        switchTab(activeTab);
      }
    },
    async canDispose(reason: InsightDisposeReason) {
      const flushed = await queueTemporaryDraftSave();
      if (!flushed) return false;
      return reason === "data-dir-change" ? themeManagement.canDispose() : true;
    },
    dispose() {
      themeManagement.dispose();
      releaseThemeDirtyOwner();
      healthTab.dispose();
      ac.abort();
      root.innerHTML = "";
    },
  };
}
