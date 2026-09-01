import { mountInsightSettingsPage } from "../settings/page";
import type { InsightDestination } from "../types";

export const settingsDestination: InsightDestination = {
  id: "settings",
  kind: "workspace",
  label: "设置",
  icon: "work",
  showInNav: false,
  mount(root, ctx) {
    return mountInsightSettingsPage(root, ctx);
  },
};
