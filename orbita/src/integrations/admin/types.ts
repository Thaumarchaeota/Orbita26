export type AdminTabId = "health" | "journal" | "assets" | "work";

export type AdminTabDefinition = {
  id: AdminTabId;
  label: string;
  mount: (panel: HTMLElement) => void | (() => void);
};
