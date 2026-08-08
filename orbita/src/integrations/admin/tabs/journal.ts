import { placeholderPanel } from "../shell";
import type { AdminTabDefinition } from "../types";

export const journalTab: AdminTabDefinition = {
  id: "journal",
  label: "随记",
  mount(panel) {
    placeholderPanel(panel, "随记");
  },
};
