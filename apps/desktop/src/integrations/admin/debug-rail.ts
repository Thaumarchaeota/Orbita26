import { openInsightContentTab } from "./tab-host/host-api";
import type { RailDescriptor } from "./secondary-rail";

const DEBUG_PAGES = [
  { key: "control-gallery", title: "控件对照页", identity: { kind: "control-gallery" } as const },
];

export function debugRail(current: "control-gallery"): RailDescriptor {
  return {
    kind: "insight-debug",
    title: "调试",
    selectedKey: current,
    onSelect(key) {
      const page = DEBUG_PAGES.find((item) => item.key === key);
      if (page) openInsightContentTab(page.identity, "控件");
    },
    renderContent(host) {
      host.innerHTML = DEBUG_PAGES.map(({ key, title }) =>
        `<div class="insight-chat-rail-row"><button type="button" class="insight-chat-rail-item${key === current ? " is-active" : ""}" data-debug-page="${key}" aria-current="${key === current ? "page" : "false"}">${title}</button></div>`,
      ).join("");
      const onClick = (event: Event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-debug-page]");
        const page = DEBUG_PAGES.find((item) => item.key === button?.dataset.debugPage);
        if (page) openInsightContentTab(page.identity, "控件");
      };
      host.addEventListener("click", onClick);
      return () => {
        host.removeEventListener("click", onClick);
        host.replaceChildren();
      };
    },
  };
}
