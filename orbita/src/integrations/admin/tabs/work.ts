import { placeholderPanel } from "../shell";
import type { AdminTabDefinition } from "../types";

export const workTab: AdminTabDefinition = {
  id: "work",
  label: "工作",
  mount(panel) {
    placeholderPanel(panel, "工作");
  },
};
