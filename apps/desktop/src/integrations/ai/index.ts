import type { Integration } from "../../core/registry";
import { mountAiPanel } from "./panel";

export const aiIntegration: Integration = {
  id: "ai",
  init() {
    const root = document.getElementById("app");
    const body = document.querySelector<HTMLElement>("#shellBody");
    if (!root || !body) throw new Error("#app or #shellBody not found");
    mountAiPanel(body, root);
  },
};
