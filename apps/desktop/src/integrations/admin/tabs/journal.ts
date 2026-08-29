import { mountPlaceholderDestination } from "../placeholder";
import type { InsightDestination } from "../types";

export const journalDestination: InsightDestination = {
  id: "journal",
  kind: "domain",
  label: "随记",
  icon: "journal",
  mount(root) {
    return mountPlaceholderDestination(root, "随记");
  },
};
