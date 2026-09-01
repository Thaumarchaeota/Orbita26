import { mountTimelinePage } from "../timeline/page";
import type { InsightDestination } from "../types";

export const timelineDestination: InsightDestination = {
  id: "timeline",
  kind: "domain",
  label: "时间线",
  icon: "timeline",
  showInNav: true,
  mount(root, ctx) {
    return mountTimelinePage(root, ctx);
  },
};
