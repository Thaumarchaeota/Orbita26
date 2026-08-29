import type { Integration } from "../../core/registry";
import { mountTicktickPanel } from "./panel";

export const ticktickIntegration: Integration = {
  id: "ticktick",
  init() {
    const root = document.getElementById("app");
    const body = document.querySelector<HTMLElement>("#shellBody");
    if (!root || !body) throw new Error("#app or #shellBody not found");
    mountTicktickPanel(body, root);
  },
};
