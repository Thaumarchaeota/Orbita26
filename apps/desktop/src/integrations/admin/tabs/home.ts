import type { InsightDestination, InsightDestinationHandle } from "../types";

export const homeDestination: InsightDestination = {
  id: "home",
  kind: "workspace",
  label: "主页",
  icon: "work",
  showInNav: false,
  mount(root) {
    root.innerHTML = `<div class="admin-home-page" aria-label="主页"></div>`;
    const handle: InsightDestinationHandle = {
      activate() {},
      deactivate() {},
      dispose() {
        root.innerHTML = "";
      },
    };
    return handle;
  },
};
