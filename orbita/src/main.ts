import "./ui/shell.css";
import { initSettings } from "./core/settings";
import { initAiConfig } from "./integrations/ai/config";
import { initApps } from "./integrations/shell/apps";
import { initBookmarks } from "./integrations/shell/bookmarks";
import { initLocalFiles } from "./integrations/shell/local-files";
import { hydrateShellStore } from "./integrations/shell/store";
import { initIntegrations, registerIntegration } from "./core/registry";
import { shellIntegration } from "./integrations/shell";
import { aiIntegration } from "./integrations/ai";

registerIntegration(shellIntegration);
registerIntegration(aiIntegration);

void (async () => {
  await initSettings();
  hydrateShellStore();
  await Promise.all([initAiConfig(), initBookmarks(), initApps(), initLocalFiles()]);
  await initIntegrations();
})();
