import type { AdminTabDefinition, AdminTabId } from "./types";

const tabs: AdminTabDefinition[] = [];

export function registerAdminTab(tab: AdminTabDefinition): void {
  if (tabs.some((t) => t.id === tab.id)) {
    throw new Error(`admin tab already registered: ${tab.id}`);
  }
  tabs.push(tab);
}

export function getAdminTabs(): readonly AdminTabDefinition[] {
  return tabs;
}

export function getAdminTab(id: AdminTabId): AdminTabDefinition | undefined {
  return tabs.find((t) => t.id === id);
}
