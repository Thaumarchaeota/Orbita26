import type { InsightDestination, InsightDestinationHandle, InsightHostContext } from "../types";
import { mountTaskTab } from "./task/task-tab";

export const workDestination: InsightDestination = {
  id: "work",
  kind: "domain",
  label: "任务",
  icon: "work",
  mount(root, ctx): InsightDestinationHandle {
    return mountTaskTab(root, ctx);
  },
};
