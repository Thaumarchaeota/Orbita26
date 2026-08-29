import { mountPlaceholderDestination } from "../placeholder";
import type { InsightDestination } from "../types";

export const healthDestination: InsightDestination = {
  id: "health",
  kind: "domain",
  label: "健康",
  icon: "health",
  mount(root) {
    return mountPlaceholderDestination(root, "健康");
  },
};
