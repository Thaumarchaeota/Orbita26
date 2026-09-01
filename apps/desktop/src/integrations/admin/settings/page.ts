import "../../../ui/theme-settings.css";
import "./insight-settings.css";
import { notifyDataDirChanged } from "../../../core/data/dir-sync";
import { patchForDataDirChange } from "../../../core/data/rebase-data-dir";
import { isTauri } from "../../../core/data/client";
import { getSettings, patchSettings } from "../../../core/settings";
import type { InsightDestinationHandle, InsightHostContext } from "../types";
import { closeInsightSettings } from "./nav";
import { requestInsightDataDirChange } from "../shell";
import { invoke } from "@tauri-apps/api/core";
import { isBillDirectory } from "./index";
import { bindGlobalTab, globalTabHtml } from "./global-tab";
import { bindHealthTab, healthTabHtml } from "./health-tab";

type SettingsTabId = "global" | "health";

const TAB_LABELS: { id: SettingsTabId; label: string }[] = [
  { id: "global", label: "全局" },
  { id: "health", label: "健康" },
];

export function mountInsightSettingsPage(
  root: HTMLElement,
  _ctx: InsightHostContext,
): InsightDestinationHandle {
  const ac = new AbortController();
  const { signal } = ac;

  root.innerHTML = `
    <div class="insight-settings">
      <header class="insight-settings-header">
        <button type="button" class="insight-settings-back" data-action="back" aria-label="返回">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <h1 class="insight-settings-title">设置</h1>
      </header>
      <div class="insight-settings-tabs" role="tablist">
        ${TAB_LABELS.map(
          ({ id, label }) =>
            `<button type="button" class="insight-settings-tab${id === "global" ? " is-active" : ""}" data-tab="${id}" role="tab">${label}</button>`,
        ).join("")}
        <div class="insight-settings-tab-indicator" aria-hidden="true"></div>
      </div>
      <form class="insight-settings-form">
        <div class="insight-settings-body">
          <div class="insight-settings-panels">
            ${globalTabHtml}
            ${healthTabHtml}
          </div>
          <p class="insight-settings-error" role="status" hidden></p>
        </div>
        <footer class="insight-settings-footer">
          <button type="button" class="insight-settings-btn" data-action="cancel">取消</button>
          <button type="submit" class="insight-settings-btn insight-settings-btn-primary">保存</button>
        </footer>
      </form>
    </div>`;

  const form = root.querySelector<HTMLFormElement>(".insight-settings-form")!;
  const errorEl = root.querySelector<HTMLElement>(".insight-settings-error")!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const tabsEl = root.querySelector<HTMLElement>(".insight-settings-tabs")!;
  const tabIndicator = root.querySelector<HTMLElement>(".insight-settings-tab-indicator")!;
  const tabBtns = root.querySelectorAll<HTMLButtonElement>(".insight-settings-tab");
  const tabPanels = root.querySelectorAll<HTMLElement>(".insight-settings-panel");

  const globalTab = bindGlobalTab(root);
  const healthTab = bindHealthTab(root);

  const moveTabIndicator = (btn: HTMLButtonElement) => {
    const tabsRect = tabsEl.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    tabIndicator.style.width = `${btnRect.width}px`;
    tabIndicator.style.transform = `translateX(${btnRect.left - tabsRect.left}px)`;
    tabIndicator.style.opacity = "1";
  };

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
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        switchTab(btn.dataset.tab as SettingsTabId);
      },
      { signal },
    );
  });

  const fillForm = () => {
    const settings = getSettings();
    globalTab.fill(settings.dataDir);
    healthTab.fill(settings);
    errorEl.hidden = true;
  };

  root.querySelector('[data-action="back"]')!.addEventListener("click", () => closeInsightSettings(), { signal });
  root.querySelector('[data-action="cancel"]')!.addEventListener("click", () => closeInsightSettings(), { signal });

  form.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      const nextDataDir = globalTab.read();
      if (isBillDirectory(nextDataDir)) {
        errorEl.textContent = "请选择包含 bill 文件夹的数据根目录，而不是 bill 文件夹本身。";
        errorEl.hidden = false;
        switchTab("global");
        return;
      }
      const current = getSettings();
      const health = healthTab.read();
      const dataDirChanged = current.dataDir !== nextDataDir;

      if (dataDirChanged && !(await requestInsightDataDirChange())) return;

      submitBtn.disabled = true;
      errorEl.hidden = true;
      try {
        const withHealth = {
          ...current,
          ui: {
            ...current.ui,
            lifeRingGoals: health.lifeRingGoals,
            healthTrackAxis: health.healthTrackAxis,
          },
          integrations: {
            ...current.integrations,
            garmin: { tokenDir: health.garminTokenDir, syncDays: health.garminSyncDays },
            credentials: {
              ...current.integrations.credentials,
              garmin: {
                email: health.garminEmail,
                password: health.garminPassword,
              },
            },
          },
        };
        if (dataDirChanged) {
          await patchSettings(patchForDataDirChange(withHealth, nextDataDir));
          if (isTauri()) await invoke("restart_ledger_sidecar");
          notifyDataDirChanged();
        } else {
          await patchSettings({
            ui: withHealth.ui,
            integrations: withHealth.integrations,
          });
        }
        closeInsightSettings();
      } catch (error) {
        if (dataDirChanged) {
          try {
            await patchSettings(current);
            if (isTauri()) await invoke("restart_ledger_sidecar");
          } catch {
            /* rollback failed */
          }
        }
        errorEl.textContent = `保存失败：${String(error)}`;
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    },
    { signal },
  );

  const onResize = () => {
    const active = root.querySelector<HTMLButtonElement>(".insight-settings-tab.is-active");
    if (active) moveTabIndicator(active);
  };
  window.addEventListener("resize", onResize, { signal });

  requestAnimationFrame(() => {
    const active = root.querySelector<HTMLButtonElement>(".insight-settings-tab.is-active");
    if (active) moveTabIndicator(active);
  });

  return {
    activate() {
      fillForm();
    },
    deactivate() {},
    dispose() {
      ac.abort();
      root.innerHTML = "";
    },
  };
}
