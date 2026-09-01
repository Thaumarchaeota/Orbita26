export type InsightDestinationId = "health" | "journal" | "finance" | "work" | "timeline" | "settings";

export type InsightDisposeReason = "host-dispose" | "data-dir-change";

export type InsightHostContext = {
  generation: number;
  dataDirKey: string;
};

export type InsightDestinationHandle = {
  activate: () => void | Promise<void>;
  deactivate: () => void;
  getRestoreState?: () => unknown;
  restoreState?: (state: unknown) => void;
  canDispose?: (reason: InsightDisposeReason) => boolean | Promise<boolean>;
  dispose: (reason: InsightDisposeReason) => void;
};

export type InsightDestination = {
  id: InsightDestinationId;
  kind: "domain" | "workspace";
  label: string;
  icon: string;
  showInNav?: boolean;
  mount: (root: HTMLElement, ctx: InsightHostContext) => InsightDestinationHandle;
};

/** @deprecated use InsightDestinationId */
export type AdminTabId = InsightDestinationId;

/** @deprecated use InsightDestination */
export type AdminTabDefinition = {
  id: InsightDestinationId;
  label: string;
  mount: (panel: HTMLElement) => void | (() => void);
};
