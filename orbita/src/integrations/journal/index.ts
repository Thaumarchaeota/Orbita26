import type { Integration } from "../../core/registry";
import { mountPrimaryMood } from "./primary-mood";
import { mountTodayPanel } from "./today-panel";

export const journalIntegration: Integration = {
  id: "journal",
  init() {
    const root = document.getElementById("app");
    const today = document.querySelector<HTMLElement>("#todayZone");
    if (!root || !today) return;
    mountTodayPanel(today, root);
    mountPrimaryMood(root);
  },
};
