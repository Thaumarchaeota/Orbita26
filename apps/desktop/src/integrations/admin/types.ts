import type { RailDescriptor, SecondaryRailController } from "./secondary-rail";
import type { ClaimedInsightNavigation } from "../productivity/types";
import type { ProjectTaskFocusPageRequest, TaskViewState } from "./tab-host/host-api";
import type { ActiveSurface } from "./tab-host/identity";

export type NavigationState = { route: unknown; context: unknown };
export type NavigationResult =
  | { status: "applied" }
  | { status: "blocked" }
  | { status: "unavailable"; message: string }
  | { status: "failed"; error: unknown };
export type NavigationToken = {
  hostEpoch: number;
  dataDirKey: string;
  requestId: number;
  isCurrent: () => boolean;
};
export type NavigationIntent = {
  source: { surface: ActiveSurface; route: unknown };
  target: { surface: ActiveSurface; route: unknown };
  intent: "preserve-instance" | "replace-local-route";
};
export type DestinationNavigationAdapter = {
  resolveTaskView?: (state: TaskViewState) => NavigationState;
  capture: () => NavigationState;
  canNavigate: (intent: NavigationIntent) => boolean | Promise<boolean>;
  restore: (state: NavigationState, token: NavigationToken) => NavigationResult | Promise<NavigationResult>;
  restoreContext?: (context: unknown, token: NavigationToken) => void | Promise<void>;
  onVisible?: () => void;
};
export type NavigationOverlay = {
  kind: "protected" | "temporary" | "navigation-detail";
  close?: () => void | Promise<void>;
};
export type InsightNavigationContext = {
  navigate: (state: NavigationState, options?: { returnToPrevious?: boolean }) => Promise<NavigationResult>;
  replaceContext: () => void;
  registerOverlay: (overlay: NavigationOverlay) => () => void;
};

export type InsightDestinationId =
  | "home"
  | "health"
  | "health-activities"
  | "health-intake"
  | "journal"
  | "finance"
  | "finance1"
  | "work"
  | "timeline"
  | "settings"
  | "project"
  | "project-index"
  | "chat"
  | "meal"
  | "web"
  | "control-gallery"
  | "color-lab"
  | "category-palette";

export type InsightDisposeReason = "host-dispose" | "data-dir-change";

export type InsightHostContext = {
  generation: number;
  dataDirKey: string;
  secondaryRail?: SecondaryRailController;
  navigation?: InsightNavigationContext;
};

export type InsightDestinationHandle = {
  navigation?: DestinationNavigationAdapter;
  activate: () => void | Promise<void>;
  deactivate: () => void;
  getRestoreState?: () => unknown;
  restoreState?: (state: unknown) => void;
  canDispose?: (reason: InsightDisposeReason) => boolean | Promise<boolean>;
  getSecondaryRailDescriptor?: () => RailDescriptor | null;
  dispose: (reason: InsightDisposeReason) => void;
  /** Claims pending Panel object navigation only after this destination has loaded its local snapshot. */
  processPendingNavigation?: (request: ClaimedInsightNavigation, hostInstanceId: string) => Promise<void>;
  /** One-shot page command; never persisted as tab identity or restore state. */
  handlePageRequest?: (request: ProjectTaskFocusPageRequest) => void;
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
