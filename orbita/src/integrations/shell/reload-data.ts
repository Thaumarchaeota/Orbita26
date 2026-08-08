import { bindDataDirChanged } from "../../core/data/dir-sync";
import { loadAiConfig } from "../ai/config";
import { loadSettings } from "../../core/settings";
import { initApps } from "./apps";
import { initBookmarks } from "./bookmarks";
import { initLocalFiles } from "./local-files";

export async function reloadUserData(): Promise<void> {
  await loadSettings();
  await Promise.all([initBookmarks(), initApps(), initLocalFiles(), loadAiConfig()]);
  window.dispatchEvent(new CustomEvent("orbita:launcher-reload"));
  window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
  window.dispatchEvent(new CustomEvent("orbita:ai-reload"));
}

export function bindLauncherDataReload(): () => void {
  return bindDataDirChanged(() => {
    void reloadUserData();
  });
}
