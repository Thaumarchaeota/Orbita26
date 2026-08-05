import "./ui/shell.css";
import { initClickThrough } from "./ui/click-through";
import { initHoverTips } from "./ui/hover-tip";
import { initSettings } from "./core/settings";
import { initAiConfig } from "./integrations/ai/config";
import { initApps } from "./integrations/shell/apps";
import { initBookmarks } from "./integrations/shell/bookmarks";
import { initLocalFiles } from "./integrations/shell/local-files";
import { hydrateShellStore } from "./integrations/shell/store";
import { journalIntegration } from "./integrations/journal";
import { initIntegrations, registerIntegration } from "./core/registry";
import { shellIntegration } from "./integrations/shell";
import { aiIntegration } from "./integrations/ai";
import { ticktickIntegration } from "./integrations/ticktick";
import { initGarminAutoSync } from "./integrations/journal/garmin-auto-sync";
import { initPrivacyMode } from "./core/privacy-mode";

registerIntegration(shellIntegration);
registerIntegration(journalIntegration);
registerIntegration(aiIntegration);
registerIntegration(ticktickIntegration);

void (async () => {
  await initSettings();
  initClickThrough();
  initHoverTips();
  hydrateShellStore();
  await Promise.all([initAiConfig(), initBookmarks(), initApps(), initLocalFiles()]);
  await initIntegrations();
  initPrivacyMode();
  initGarminAutoSync();
})();
