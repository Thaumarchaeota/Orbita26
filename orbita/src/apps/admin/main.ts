import { invoke } from "@tauri-apps/api/core";
import "../../ui/admin-shell.css";
import { mountAdminShell, registerDefaultAdminTabs } from "../../integrations/admin";
import { isTauri } from "../../core/data/client";
import { initSettings } from "../../core/settings";
import { bindLauncherDataReload } from "../../integrations/shell/reload-data";

const root = document.getElementById("app");
if (!root) {
  document.body.innerHTML = '<pre style="color:red;padding:1rem">#app not found</pre>';
} else {
  void (async () => {
    try {
      root.innerHTML = `<div class="admin-loading admin-loading--page"><span class="admin-spinner"></span></div>`;
      await initSettings();
      registerDefaultAdminTabs();
      mountAdminShell(root);
      bindLauncherDataReload();
      if (isTauri()) void invoke("ensure_ledger_sidecar");
    } catch (e) {
      root.innerHTML = `<pre style="color:red;padding:1rem">${e instanceof Error ? e.message : String(e)}</pre>`;
    }
  })();
}
