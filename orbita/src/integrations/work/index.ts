import type { Integration } from "../../core/registry";
import { mountWorkPanel } from "./work-panel";

export const workIntegration: Integration = {
  id: "work",
  init() {
    const zone = document.querySelector<HTMLElement>("#workZone");
    if (!zone) return;
    mountWorkPanel(zone);
  },
};
