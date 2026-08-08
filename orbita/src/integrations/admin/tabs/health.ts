import { placeholderPanel } from "../shell";
import type { AdminTabDefinition } from "../types";

export const healthTab: AdminTabDefinition = {
  id: "health",
  label: "健康",
  mount(panel) {
    placeholderPanel(panel, "健康");
  },
};
