import type { InsightDestinationHandle } from "./types";

export function mountPlaceholderDestination(root: HTMLElement, label: string): InsightDestinationHandle {
  root.innerHTML = `
    <div class="admin-placeholder">
      <p class="admin-placeholder-label">${label}</p>
      <p class="admin-placeholder-hint">开发中</p>
    </div>`;

  return {
    activate() {},
    deactivate() {},
    dispose() {
      root.innerHTML = "";
    },
  };
}
