export type { AdminTabDefinition, AdminTabId } from "./types";
export { registerAdminTab, getAdminTabs, getAdminTab } from "./registry";
export { openAdminWindow, mountAdminButton } from "./window";
export { mountAdminShell } from "./shell";

import { registerAdminTab } from "./registry";
import { healthTab } from "./tabs/health";
import { journalTab } from "./tabs/journal";
import { assetsTab } from "./tabs/assets";
import { workTab } from "./tabs/work";

export function registerDefaultAdminTabs(): void {
  registerAdminTab(healthTab);
  registerAdminTab(journalTab);
  registerAdminTab(assetsTab);
  registerAdminTab(workTab);
}
