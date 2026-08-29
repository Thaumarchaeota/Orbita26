import { getSettings, patchSettings } from "../../core/settings";
import { createStore } from "../../core/store";
import { ENGINES, type Engine } from "./engines";
import type { LocalTab } from "./store-types";

export type { LocalTab } from "./store-types";

type ShellState = {
  engineId: string;
  localTab: LocalTab;
};

function isLocalTab(v: string): v is LocalTab {
  return v === "file" || v === "literature" || v === "note";
}

export const shellStore = createStore<ShellState>({
  engineId: "google",
  localTab: "file",
});

export function hydrateShellStore() {
  const { ui } = getSettings();
  const engineId = ENGINES.some((e) => e.id === ui.engineId) ? ui.engineId : "google";
  const localTab = isLocalTab(ui.localTab) ? ui.localTab : "file";
  shellStore.setState({ engineId, localTab });
}

export function getCurrentEngine(): Engine {
  const { engineId } = shellStore.getState();
  return ENGINES.find((e) => e.id === engineId) ?? ENGINES[1];
}

export function setEngine(engineId: string) {
  shellStore.setState({ engineId });
  void patchSettings({ ui: { ...getSettings().ui, engineId } });
}

export function setLocalTab(localTab: LocalTab) {
  shellStore.setState({ localTab });
  void patchSettings({ ui: { ...getSettings().ui, localTab } });
}
