import type { InsightDestination, InsightDestinationId } from "./types";

const destinations: InsightDestination[] = [];

export function registerInsightDestination(dest: InsightDestination): void {
  if (destinations.some((d) => d.id === dest.id)) {
    throw new Error(`insight destination already registered: ${dest.id}`);
  }
  destinations.push(dest);
}

export function getInsightDestinations(): readonly InsightDestination[] {
  return destinations;
}

export function getInsightDestination(id: InsightDestinationId): InsightDestination | undefined {
  return destinations.find((d) => d.id === id);
}

/** @deprecated use registerInsightDestination */
export function registerAdminTab(tab: {
  id: InsightDestinationId;
  label: string;
  mount: (panel: HTMLElement) => void | (() => void);
}): void {
  registerInsightDestination({
    id: tab.id,
    kind: "domain",
    label: tab.label,
    icon: "",
    mount(root) {
      const result = tab.mount(root);
      return {
        activate() {},
        deactivate() {},
        dispose() {
          if (typeof result === "function") result();
          else root.innerHTML = "";
        },
      };
    },
  });
}

/** @deprecated use getInsightDestinations */
export function getAdminTabs() {
  return getInsightDestinations().map((d) => ({ id: d.id, label: d.label }));
}

/** @deprecated use getInsightDestination */
export function getAdminTab(id: InsightDestinationId) {
  const d = getInsightDestination(id);
  if (!d) return undefined;
  return { id: d.id, label: d.label, mount: (panel: HTMLElement) => d.mount(panel, { generation: 0, dataDirKey: "" }) };
}
