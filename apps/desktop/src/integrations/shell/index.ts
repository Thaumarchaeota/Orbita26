import type { Integration } from "../../core/registry";
import { mountShell } from "./view";

export const shellIntegration: Integration = {
  id: "shell",
  init() {
    const root = document.getElementById("app");
    if (!root) throw new Error("#app not found");
    mountShell(root);
  },
};
