export type {
  InsightDestination,
  InsightDestinationHandle,
  InsightDestinationId,
  InsightHostContext,
  AdminTabDefinition,
  AdminTabId,
} from "./types";
export { registerInsightDestination, getInsightDestinations, getInsightDestination } from "./registry";
export { registerAdminTab, getAdminTabs, getAdminTab } from "./registry";
export { openAdminWindow, mountAdminButton } from "./window";
export { mountAdminShell, requestInsightDataDirChange } from "./shell";

import { registerInsightDestination } from "./registry";
import { healthDestination } from "./tabs/health";
import { journalDestination } from "./tabs/journal";
import { financeDestination } from "./tabs/finance";
import { workDestination } from "./tabs/work";

export function registerDefaultAdminTabs(): void {
  registerInsightDestination(healthDestination);
  registerInsightDestination(journalDestination);
  registerInsightDestination(financeDestination);
  registerInsightDestination(workDestination);
}
