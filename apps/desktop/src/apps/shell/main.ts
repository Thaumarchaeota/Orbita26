import "../../ui/shell.css";
import { initClickThrough } from "../../ui/click-through";
import { initWakeRepair } from "../../ui/wake-repair";
import { initHoverTips } from "../../ui/hover-tip";
import { initSettings } from "../../core/settings";
import { initAiConfig } from "../../integrations/ai/config";
import { mountPanelTaskHost } from "../../integrations/productivity/panel-task-host";
import { initApps } from "../../integrations/shell/apps";
import { initBookmarks } from "../../integrations/shell/bookmarks";
import { initLocalFiles } from "../../integrations/shell/local-files";
import { bindLauncherDataReload } from "../../integrations/shell/reload-data";
import { hydrateShellStore } from "../../integrations/shell/store";
import { initIntegrations, registerIntegration } from "../../core/registry";
import { shellIntegration } from "../../integrations/shell";
import { initGarminSyncing } from "../../integrations/journal/client";
import { initGarminAutoSync } from "../../integrations/journal/garmin-auto-sync";
import { initPrivacyMode } from "../../core/privacy-mode";

registerIntegration(shellIntegration);
registerIntegration({
  id: "panel-productivity-tasks",
  init() {
    const body = document.querySelector<HTMLElement>("#shellBody");
    if (!body) throw new Error("#shellBody not found");
    mountPanelTaskHost(body);
  },
});

const root = document.getElementById("app");

function renderStartupFailure(error: unknown): void {
  console.error("Orbita shell bootstrap failed", error);
  if (!root) return;
  // The main Tauri window is transparent by design. A bootstrap error must
  // remain visible instead of leaving an indistinguishable empty window.
  root.replaceChildren();
  const panel = document.createElement("section");
  panel.style.cssText = "min-height:100vh;padding:32px;background:#f8fafc;color:#172033;font:14px/1.5 system-ui,sans-serif";
  const title = document.createElement("h1");
  title.textContent = "Orbita 启动失败";
  const detail = document.createElement("pre");
  detail.style.cssText = "margin-top:12px;white-space:pre-wrap;color:#b42318";
  detail.textContent = error instanceof Error ? error.message : String(error);
  panel.append(title, detail);
  root.appendChild(panel);
}

if (!root) {
  document.body.textContent = "#app not found";
} else {
  root.innerHTML = '<div style="min-height:100vh;background:#f8fafc;color:#475467;padding:32px;font:14px system-ui,sans-serif">正在启动 Orbita…</div>';
  void (async () => {
    try {
      await initSettings();
      initClickThrough();
      initWakeRepair();
      initHoverTips();
      hydrateShellStore();
      await Promise.all([initAiConfig(), initBookmarks(), initApps(), initLocalFiles()]);
      bindLauncherDataReload();
      await initIntegrations();
      initPrivacyMode();
      initGarminSyncing();
      initGarminAutoSync();
    } catch (error) {
      renderStartupFailure(error);
    }
  })();
}
