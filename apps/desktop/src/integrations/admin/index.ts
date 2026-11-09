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
import { healthDestination, healthActivitiesDestination, healthIntakeDestination } from "./tabs/health";
import { journalDestination } from "./tabs/journal";
import { financeDestination } from "./tabs/finance";
import { finance1Destination } from "./tabs/finance1";
import { workDestination } from "./tabs/work";
import { settingsDestination } from "./tabs/settings";
import { timelineDestination } from "./tabs/timeline";
import { projectDestination } from "./tabs/project";
import { projectIndexDestination } from "./tabs/project-index";
import { homeDestination } from "./tabs/home";
import { chatDestination } from "./tabs/chat";
import { mealDestination } from "./tabs/meal-compose";
import { webDestination } from "./tabs/web";
import { controlGalleryDestination } from "./tabs/control-gallery";

export function registerDefaultAdminTabs(): void {
  registerInsightDestination(homeDestination);
  registerInsightDestination(healthDestination);
  registerInsightDestination(healthActivitiesDestination);
  registerInsightDestination(healthIntakeDestination);
  registerInsightDestination(journalDestination);
  registerInsightDestination(financeDestination);
  registerInsightDestination(finance1Destination);
  registerInsightDestination(workDestination);
  registerInsightDestination(timelineDestination);
  registerInsightDestination(projectDestination);
  registerInsightDestination(projectIndexDestination);
  registerInsightDestination(settingsDestination);
  registerInsightDestination(chatDestination);
  registerInsightDestination(mealDestination);
  registerInsightDestination(webDestination);
  registerInsightDestination(controlGalleryDestination);
}
