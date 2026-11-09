import type { InsightDestination } from "../types";

export const financeDestination: InsightDestination = {
  id: "finance",
  kind: "domain",
  label: "记账",
  icon: "finance",
  mount(root: HTMLElement) {
    root.replaceChildren();
    return {
      activate() {},
      deactivate() {},
      dispose() {},
    };
  },
};
