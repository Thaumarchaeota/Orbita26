export type {
  InsightDestination,
  InsightDestinationHandle,
  InsightDestinationId,
  InsightHostContext,
  AdminTabDefinition,
  AdminTabId,
} from "./types";
export { registerInsightDestination, getInsightDestinations, getInsightDestination } from "./registry";
export { openAdminWindow, mountAdminButton } from "./window";
export { mountAdminShell, requestInsightDataDirChange } from "./shell";

import { registerInsightDestination } from "./registry";
import { healthDestination } from "./tabs/health";
import { journalDestination } from "./tabs/journal";
import { financeDestination } from "./tabs/finance";
import { workDestination } from "./tabs/work";
import { settingsDestination } from "./tabs/settings";
import { timelineDestination } from "./tabs/timeline";

export function registerDefaultAdminTabs(): void {
  registerInsightDestination(healthDestination);
  registerInsightDestination(journalDestination);
  registerInsightDestination(financeDestination);
  registerInsightDestination(workDestination);
  registerInsightDestination(timelineDestination);
  registerInsightDestination(settingsDestination);
}
