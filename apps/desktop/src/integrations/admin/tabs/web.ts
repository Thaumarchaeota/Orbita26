import { openUrl } from "../../shell/adapter";
import type { InsightDestination, InsightDestinationHandle } from "../types";

type WebState = { url?: string };

function parseState(state: unknown): string {
  if (!state || typeof state !== "object") return "";
  const url = (state as WebState).url;
  return typeof url === "string" ? url : "";
}

export const webDestination: InsightDestination = {
  id: "web",
  kind: "workspace",
  label: "网页",
  icon: "journal",
  showInNav: false,
  mount(root) {
    let currentUrl = "";
    root.innerHTML = `
      <div class="insight-web-page">
        <div class="insight-web-bar">
          <span class="insight-web-url" data-region="url"></span>
          <button type="button" class="insight-web-open" data-region="open">系统浏览器打开</button>
        </div>
        <iframe class="insight-web-frame" data-region="frame" title="网页"></iframe>
      </div>`;
    const urlEl = root.querySelector<HTMLElement>('[data-region="url"]')!;
    const frame = root.querySelector<HTMLIFrameElement>('[data-region="frame"]')!;
    const openBtn = root.querySelector<HTMLButtonElement>('[data-region="open"]')!;

    function applyUrl(url: string) {
      currentUrl = url;
      urlEl.textContent = url;
      if (url) frame.src = url;
      else frame.removeAttribute("src");
    }

    openBtn.addEventListener("click", () => {
      if (currentUrl) void openUrl(currentUrl);
    });

    const handle: InsightDestinationHandle = {
      activate() {},
      deactivate() {},
      restoreState(state) {
        const next = parseState(state);
        if (next && next !== currentUrl) applyUrl(next);
      },
      dispose() {
        frame.src = "about:blank";
        root.innerHTML = "";
      },
    };
    return handle;
  },
};
