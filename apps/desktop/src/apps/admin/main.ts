import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "../../ui/admin-shell.css";
import "../../ui/ticktick-icon-btn.css";
import { mountAdminShell, registerDefaultAdminTabs } from "../../integrations/admin";
import { isTauri } from "../../core/data/client";
import { initSettings } from "../../core/settings";
import { applyInsightLightTheme, insightLightThemeFromSettings } from "../../integrations/admin/insight-theme";
import { initGarminSyncing } from "../../integrations/journal/client";
import { bindLauncherDataReload } from "../../integrations/shell/reload-data";
import { initWakeRepair } from "../../ui/wake-repair";
import { installInsightUndoInput } from "../../integrations/admin/undo-input";

// Native pinch must be enabled in both admin window creation paths (see
// admin_window.rs). Keep its default page zoom disabled while allowing the
// week-view handler to consume the same wheel event for time-axis zoom.
window.addEventListener("wheel", (event) => {
  if (event.ctrlKey) event.preventDefault();
}, { capture: true, passive: false });
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ["+", "-", "=", "0"].includes(event.key)) event.preventDefault();
}, { capture: true });

const root = document.getElementById("app");
if (!root) {
  document.body.innerHTML = '<pre style="color:red;padding:1rem">#app not found</pre>';
} else {
  void (async () => {
    try {
      root.innerHTML = `<div class="admin-loading admin-loading--page"><span class="admin-spinner"></span></div>`;
      await initSettings();
      applyInsightLightTheme(insightLightThemeFromSettings());
      initGarminSyncing();
      registerDefaultAdminTabs();
      mountAdminShell(root);
      installInsightUndoInput();
      bindLauncherDataReload();
      initWakeRepair();
      if (isTauri()) {
        void getCurrentWindow().emit("frame-page-load");
        void invoke("ensure_ledger_sidecar");
      }
    } catch (e) {
      root.innerHTML = `<pre style="color:red;padding:1rem">${e instanceof Error ? e.message : String(e)}</pre>`;
    }
  })();
}
