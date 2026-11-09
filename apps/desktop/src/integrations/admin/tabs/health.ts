import type { InsightDestination, InsightDestinationHandle } from "../types";
import type { RailDescriptor } from "../secondary-rail";
import { openInsightContentTab } from "../tab-host/host-api";
import { createActivityPageHost, mountActivityListSection } from "./health/activity-page";
import { mountMealHistorySection } from "./health/meal-history";
import "./health/health.css";
import "./health/activity-page.css";

export type HealthPage = "activities" | "intake";

function openHealthPage(page: HealthPage): void {
  openInsightContentTab({ kind: "health-page", page });
}

function healthRailDescriptor(selectedKey: HealthPage): RailDescriptor {
  return {
    kind: "health",
    title: "健康",
    selectedKey,
    onSelect: (key) => {
      if (key === "activities" || key === "intake") openHealthPage(key);
    },
    renderContent(host) {
      const row = (key: HealthPage, label: string) =>
        `<div class="insight-chat-rail-row"><button type="button" class="insight-chat-rail-item${selectedKey === key ? " is-active" : ""}" data-select="${key}"${selectedKey === key ? ' aria-current="page"' : ""}>${label}</button></div>`;
      host.innerHTML = `${row("activities", "所有活动")}${row("intake", "所有摄入")}`;
      const onClick = (event: Event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-select]");
        const page = button?.dataset.select;
        if (page === "activities" || page === "intake") openHealthPage(page);
      };
      host.addEventListener("click", onClick);
      return () => {
        host.removeEventListener("click", onClick);
        host.innerHTML = "";
      };
    },
  };
}

function mountHealthPage(root: HTMLElement, page: HealthPage): InsightDestinationHandle {
  root.classList.add("health-app");
  const ac = new AbortController();
  const host = createActivityPageHost(root, ac.signal);
  const list = page === "activities"
    ? mountActivityListSection(root, host, ac.signal)
    : mountMealHistorySection(root, ac.signal);

  return {
    activate() {
      void list.reload();
    },
    deactivate() {},
    dispose() {
      ac.abort();
      root.innerHTML = "";
      root.classList.remove("health-app");
    },
    getSecondaryRailDescriptor: () => healthRailDescriptor(page),
  };
}

export const healthDestination: InsightDestination = {
  id: "health",
  kind: "domain",
  label: "健康",
  icon: "health",
  mount(root) {
    root.innerHTML = `<div class="insight-chat-page health-app"></div>`;
    return {
      activate() {},
      deactivate() {},
      dispose() { root.innerHTML = ""; },
      getSecondaryRailDescriptor: () => healthRailDescriptor("activities"),
    };
  },
};

export const healthActivitiesDestination: InsightDestination = {
  id: "health-activities",
  kind: "workspace",
  label: "所有活动",
  icon: "health",
  showInNav: false,
  mount(root) { return mountHealthPage(root, "activities"); },
};

export const healthIntakeDestination: InsightDestination = {
  id: "health-intake",
  kind: "workspace",
  label: "所有摄入",
  icon: "health",
  showInNav: false,
  mount(root) { return mountHealthPage(root, "intake"); },
};
