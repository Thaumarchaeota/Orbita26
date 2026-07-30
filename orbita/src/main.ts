import "./ui/shell.css";
import { initClickThrough } from "./ui/click-through";
import { initWakeRepair } from "./ui/wake-repair";
import { initSettings } from "./core/settings";
import { initAiConfig } from "./integrations/ai/config";
import { initApps } from "./integrations/shell/apps";
import { initBookmarks } from "./integrations/shell/bookmarks";
import { initLocalFiles } from "./integrations/shell/local-files";
import { hydrateShellStore } from "./integrations/shell/store";
import { initIntegrations, registerIntegration } from "./core/registry";
import { shellIntegration } from "./integrations/shell";
import { aiIntegration } from "./integrations/ai";
import { ticktickIntegration } from "./integrations/ticktick";

registerIntegration(shellIntegration);
registerIntegration(aiIntegration);
registerIntegration(ticktickIntegration);

void (async () => {
  await initSettings();
  initClickThrough();
  initWakeRepair();
  hydrateShellStore();
  await Promise.all([initAiConfig(), initBookmarks(), initApps(), initLocalFiles()]);
  await initIntegrations();
})();
