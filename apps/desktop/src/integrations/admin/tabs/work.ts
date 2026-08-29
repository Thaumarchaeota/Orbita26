import { mountPlaceholderDestination } from "../placeholder";
import type { InsightDestination } from "../types";

export const workDestination: InsightDestination = {
  id: "work",
  kind: "domain",
  label: "工作",
  icon: "work",
  mount(root) {
    return mountPlaceholderDestination(root, "工作");
  },
};
