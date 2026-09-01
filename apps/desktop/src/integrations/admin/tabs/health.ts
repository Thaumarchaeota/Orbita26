import { mountHealthOverview } from "./health/overview";
import type { InsightDestination } from "../types";

export const healthDestination: InsightDestination = {
  id: "health",
  kind: "domain",
  label: "健康",
  icon: "health",
  mount(root, ctx) {
    return mountHealthOverview(root, ctx);
  },
};
