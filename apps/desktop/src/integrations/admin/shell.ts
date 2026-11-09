import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  bindDataDirChanged,
  createIdempotentDataDirHandler,
  type DataDirChangeStamp,
} from "../../core/data/dir-sync";
import { getSettings } from "../../core/settings";
import {
  applyInsightLightTheme,
  insightLightThemeFromSettings,
} from "./insight-theme";
import { getConfirmDialog } from "../shell/dialog";
import { createInsightDialog } from "../../ui/insight-dialog";
import { setOverlayNavigationRegistrar } from "../../ui/overlay-navigation";
import { cancelThemeEdit, getThemeEditSession, releaseThemeEditForHostChange, savePreset } from "./appearance/theme-edit-session";
import { SETTINGS_GEAR_SVG } from "../ai/icons";
import {
  setHostDataDirGuard,
  canProceedWithDataDirChange,
  markLocalDataDirSwitchAuthorized,
  consumeLocalDataDirSwitchAuthorized,
  clearLocalDataDirSwitchAuthorized,
  pauseInsightDomainWrites,
  resumeInsightDomainWrites,
} from "./host-guards";
import { openInsightSettings } from "./settings/nav";
import { getInsightDestination, getInsightDestinations } from "./registry";
import {
  anyBlockingDraft,
  clearAllDirty,
  clearTabSession,
  contentTabKey,
  defaultTabTitle,
  destForIdentity,
  destStateForIdentity,
  hasRestorableSnapshot,
  httpWebIdentity,
  fixedSurfaceKey,
  getDirtyStatus,
  identitiesEqual,
  loadTabSession,
  mountTabStrip,
  newBlankIdentity,
  newTabInstanceKey,
  saveTabSession,
  sessionToWorkspacePanes,
  setDirtyStatus,
  waitInFlight,
  waitAllInFlight,
  type ActiveSurface,
  type ContentTabIdentity,
  type ContentTabRecord,
  type FixedDestId,
  type LeftPaneActive,
  type PaneId,
  type PaneState,
  type TabSession,
  type TabStripHandle,
  type TabStripStyle,
  type WorkspacePanes,
} from "./tab-host";
import {
  mountDragSession,
  registerDragSession,
  type DragSessionHandle,
} from "./tab-host/drag-session";
import {
  setContentTabCloser,
  setContentTabOpener,
  setLayoutRestorer,
  setProjectDeletedHandler,
  setTabStripStyleHandler,
  setTaskViewStateSelector,
  setTimelineActivator,
  setInsightHistoryNavigator,
  type TaskViewState,
} from "./tab-host/host-api";
import type {
  InsightDestinationHandle,
  InsightDestinationId,
  InsightHostContext,
  NavigationState,
  NavigationResult,
  NavigationToken,
  NavigationOverlay,
  NavigationIntent,
} from "./types";
import { NavigationHistory, NavigationChannel, sameNavigationRoute, type NavigationFrame } from "./tab-host/navigation-history";
import { bindMouseHistoryInput } from "./tab-host/mouse-history-input";
import type { OpenInsightContentTabOptions, ProjectTaskFocusPageRequest } from "./tab-host/host-api";
import { itemKey } from "./workspace-nav-persist";
import type { WorkspaceNavHandle } from "./workspace-nav";
import { DOMAIN_ICONS } from "./icons";
import {
  createSecondaryRailController,
  type SecondaryRailController,
} from "./secondary-rail";
import {
  createShellGeometryController,
  PANE_MIN,
  RAIL_MAX,
  RAIL_MIN,
  type ShellGeometryController,
} from "./shell-geometry";
import { insightChatScratchId } from "./tabs/chat-rail";
import { claimInsightItemNavigation } from "../productivity/client";
type CachedSurface = {
  root: HTMLElement;
  handle: InsightDestinationHandle;
};

const QUICK_PROJECT_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

const QUICK_CHAT_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/></svg>`;

const QUICK_TASK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/></svg>`;

const QUICK_FINANCE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;

const QUICK_MAP_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;

const QUICK_RECORD_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>`;

const QUICK_DEBUG_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z"/><path d="m14 10 3-3"/></svg>`;

const EMPTY_HANDLE: InsightDestinationHandle = {
  activate: () => {},
  deactivate: () => {},
  dispose: () => {},
};

let focusedPane: PaneId = "left";
let panes: WorkspacePanes = { left: { tabKeys: [], active: "home", width: 0 } };
let tabsByKey = new Map<string, ContentTabRecord>();
let identityToKey = new Map<string, string>();
let bootSnapshot: TabSession | null = null;
let workspaceTouched = false;
let tabStyle: TabStripStyle = "rect";
let activateToken = 0;
let hostGeneration = 0;
let activeWorkspaceKey: string | null = null;
const liveHostCtx: InsightHostContext = { generation: 0, dataDirKey: "_default" };
const cache = new Map<string, CachedSurface>();
const navigationHistory = new NavigationHistory();
const navigationChannel = new NavigationChannel();
const navigationInstances = new Map<string, string>();
const navigationOverlays: { owner: string; overlay: NavigationOverlay }[] = [];
let navigationRequest = 0;
let navigationFrameId = 0;
let navigationInstanceId = 0;
let navigationInputAbort: AbortController | null = null;
let releaseSharedOverlayNavigation: (() => void) | null = null;

function captureNavigation(surface = getFocusedActiveSurface()): NavigationFrame {
  const key = surfaceKeyFromActive(surface);
  const record = contentRecordFor(surface);
  const state = cache.get(key)?.handle.navigation?.capture();
  return {
    id: `navigation:${++navigationFrameId}`,
    hostEpoch: hostGeneration,
    dataDirKey: liveHostCtx.dataDirKey,
    surface: { ...surface },
    ...(surface.type === "content" ? { tabInstanceId: navigationInstances.get(key) } : {}),
    route: { version: 1, destination: surface.type === "home" ? "home" : surface.type === "fixed" ? surface.dest : record!.destId, value: state?.route ?? null },
    context: state?.context ?? null,
  };
}

function refreshNavigationContext(): void {
  const current = navigationHistory.current;
  if (!current || current.hostEpoch !== hostGeneration) return;
  const actual = captureNavigation();
  if (sameNavigationRoute(current, actual)) navigationHistory.replaceCurrent({ ...actual, id: current.id });
}

function navigationToken(): NavigationToken {
  const hostEpoch = hostGeneration;
  const dataDirKey = liveHostCtx.dataDirKey;
  const requestId = ++navigationRequest;
  return { hostEpoch, dataDirKey, requestId, isCurrent: () => hostEpoch === hostGeneration && dataDirKey === liveHostCtx.dataDirKey && requestId === navigationRequest };
}

async function guardNavigation(target: NavigationFrame, replaceRoute: boolean): Promise<boolean> {
  try {
  const source = captureNavigation();
  const sourceKey = surfaceKeyFromActive(source.surface);
  const targetKey = surfaceKeyFromActive(target.surface);
  const intent: NavigationIntent = {
    source: { surface: source.surface, route: source.route.value },
    target: { surface: target.surface, route: target.route.value },
    intent: replaceRoute ? "replace-local-route" : "preserve-instance",
  };
  const sourceAdapter = cache.get(sourceKey)?.handle.navigation;
  // A cached target can own a different draft from the visible source (SPEC-0014 §4).
  if (sourceAdapter && !(await sourceAdapter.canNavigate({ ...intent, intent: sourceKey === targetKey ? intent.intent : "preserve-instance" }))) return false;
  if (replaceRoute && sourceKey !== targetKey) {
    const targetAdapter = cache.get(targetKey)?.handle.navigation;
    if (targetAdapter && !(await targetAdapter.canNavigate(intent))) return false;
  }
  return true;
  } catch (error) {
    await showSurfaceActivationError("导航未完成", error);
    return false;
  }
}

async function navigateLocal(owner: string, state: NavigationState, returnToPrevious = false): Promise<NavigationResult> {
  const epoch = hostGeneration;
  return (await navigationChannel.run(async () => {
    if (epoch !== hostGeneration || surfaceKeyFromActive(getFocusedActiveSurface()) !== owner) return { status: "blocked" } as NavigationResult;
    refreshNavigationContext();
    const frame = captureNavigation();
    frame.route = { ...frame.route, value: state.route };
    frame.context = state.context;
    if (navigationHistory.current && sameNavigationRoute(navigationHistory.current, frame)) {
      refreshNavigationContext();
      return { status: "applied" } as NavigationResult;
    }
    const token = navigationToken();
    if (!(await guardNavigation(frame, true)) || !token.isCurrent()) return { status: "blocked" } as NavigationResult;
    const adapter = cache.get(owner)?.handle.navigation;
    if (!adapter) return { status: "unavailable", message: "页面导航适配器不可用" } as NavigationResult;
    try {
      const result = await adapter.restore(state, token);
      if (result.status === "applied" && token.isCurrent()) {
        navigationHistory.visit(captureNavigation(), returnToPrevious);
        syncSecondaryRail();
      }
      if (result.status === "failed") await showSurfaceActivationError("页面恢复失败", result.error);
      if (result.status === "unavailable") await showSurfaceActivationError("原页面已不可用", result.message);
      return result;
    } catch (error) { return { status: "failed", error } as NavigationResult; }
  })) ?? { status: "blocked" };
}

async function navigateHistory(direction: -1 | 1): Promise<void> {
  const epoch = hostGeneration;
  await navigationChannel.run(async () => {
    if (epoch !== hostGeneration) return;
    if (navigationOverlays.some(({ overlay }) => overlay.kind === "protected")) return;
    const top = navigationOverlays[navigationOverlays.length - 1]?.overlay;
    if (top?.kind === "temporary") { if (direction === -1) await top.close?.(); return; }
    refreshNavigationContext();
    const token = navigationToken();
    for (let target = navigationHistory.adjacent(direction); target; target = navigationHistory.adjacent(direction)) {
      const key = surfaceKeyFromActive(target.surface);
      if (target.hostEpoch !== hostGeneration || target.dataDirKey !== liveHostCtx.dataDirKey ||
        (target.surface.type === "content" && (!tabsByKey.has(key) || navigationInstances.get(key) !== target.tabInstanceId))) {
        navigationHistory.remove((frame) => frame.id === target!.id);
        continue;
      }
      const adapter = cache.get(key)?.handle.navigation;
      const currentTarget = captureNavigation(target.surface);
      const replaceRoute = !!adapter && !sameNavigationRoute(currentTarget, target);
      if (!(await guardNavigation(target, replaceRoute)) || !token.isCurrent()) return;
      if (adapter && replaceRoute) {
        let result: NavigationResult;
        try { result = await adapter!.restore({ route: target.route.value, context: target.context }, token); }
        catch (error) { result = { status: "failed", error }; }
        if (!token.isCurrent()) return;
        if (result.status === "unavailable") {
          navigationHistory.remove((frame) => frame.id === target!.id);
          await showSurfaceActivationError("原页面已不可用", result.message);
          continue;
        }
        if (result.status === "failed") { await showSurfaceActivationError("页面恢复失败", result.error); return; }
        if (result.status !== "applied") return;
      } else if (adapter?.restoreContext) {
        try { await adapter.restoreContext(target.context, token); }
        catch (error) { await showSurfaceActivationError("页面恢复失败", error); return; }
        if (!token.isCurrent()) return;
      }
      const result = await applySurface(target.surface, { touch: false, preparedNavigation: !!adapter });
      if (result.status === "applied" && token.isCurrent()) navigationHistory.commit(target);
      return;
    }
  }, true);
}
let tabIndicator: HTMLElement | null = null;
let leftTabStripHandle: TabStripHandle | null = null;
let rightTabStripHandle: TabStripHandle | null = null;
let leftViewport: HTMLElement | null = null;
let rightViewport: HTMLElement | null = null;
let paneGroup: HTMLElement | null = null;
let rightPaneEl: HTMLElement | null = null;
let paneDivider: HTMLElement | null = null;
let paneDividerLine: HTMLElement | null = null;
let leftTabStripSlot: HTMLElement | null = null;
let rightTabStripSlot: HTMLElement | null = null;
let shellGrid: HTMLElement | null = null;
let geometry: ShellGeometryController | null = null;
let paneLeftPreview: number | null = null;
let nav: HTMLElement | null = null;
let workspaceNav: WorkspaceNavHandle | null = null;
let unbindDataDir: (() => void) | null = null;
let dataDirFaultMessage: string | null = null;
let secondaryRail: SecondaryRailController | null = null;
let restoreLayoutBtnEl: HTMLButtonElement | null = null;
let dragSession: DragSessionHandle | null = null;

function syncRestoreLayoutButton(): void {
  if (!restoreLayoutBtnEl) return;
  restoreLayoutBtnEl.hidden = bootSnapshot === null;
}

function markWorkspaceTouched(): void {
  workspaceTouched = true;
  bootSnapshot = null;
  syncRestoreLayoutButton();
}

function rebuildIdentityIndex(): void {
  identityToKey.clear();
  for (const tab of tabsByKey.values()) {
    if (tab.identity.kind === "blank") continue;
    identityToKey.set(contentTabKey(tab.identity), tab.key);
  }
}

function getPaneState(pane: PaneId): PaneState {
  if (pane === "right") {
    if (!panes.right) throw new Error("right pane absent");
    return panes.right;
  }
  return panes.left;
}

function getPaneStateOrNull(pane: PaneId): PaneState | null {
  if (pane === "right") return panes.right ?? null;
  return panes.left;
}

function viewportForPane(pane: PaneId): HTMLElement {
  return pane === "left" ? leftViewport! : rightViewport!;
}

function paneActiveToSurface(pane: PaneId, active: string): ActiveSurface {
  if (pane === "left") {
    if (active === "home") return { type: "home" };
    if (active === "timeline") return { type: "fixed", dest: "timeline" };
    if (active.startsWith("fixed:")) {
      const dest = active.slice("fixed:".length) as FixedDestId;
      return { type: "fixed", dest };
    }
  }
  return { type: "content", key: active };
}

function getFocusedActiveSurface(): ActiveSurface {
  const state = getPaneState(focusedPane);
  return paneActiveToSurface(focusedPane, state.active);
}

function getPaneTabs(pane: PaneId): ContentTabRecord[] {
  const state = getPaneStateOrNull(pane);
  if (!state) return [];
  return state.tabKeys.map((k) => tabsByKey.get(k)).filter((t): t is ContentTabRecord => t != null);
}

function getPaneActiveSurface(pane: PaneId): ActiveSurface {
  const state = getPaneStateOrNull(pane);
  if (!state || !state.active) return { type: "home" };
  return paneActiveToSurface(pane, state.active);
}

function surfaceToLeftActive(surface: ActiveSurface): LeftPaneActive {
  switch (surface.type) {
    case "home":
      return "home";
    case "fixed":
      return surface.dest === "timeline" ? "timeline" : `fixed:${surface.dest}`;
    case "content":
      return surface.key;
  }
}

function syncSecondaryRail(): void {
  const surface = getFocusedActiveSurface();
  const key = surfaceKeyFromActive(surface);
  const entry = cache.get(key);
  const desc = entry?.handle.getSecondaryRailDescriptor?.() ?? null;
  secondaryRail?.setDescriptor(desc);
}

function syncHostContext(): void {
  liveHostCtx.generation = hostGeneration;
  liveHostCtx.dataDirKey = getSettings().dataDir || "_default";
}

function hostContext(): InsightHostContext {
  syncHostContext();
  return liveHostCtx;
}

function surfaceKeyFromActive(surface: ActiveSurface): string {
  switch (surface.type) {
    case "home":
      return "home";
    case "fixed":
      return fixedSurfaceKey(surface.dest);
    case "content":
      return surface.key;
  }
}

function surfacesEqual(a: ActiveSurface, b: ActiveSurface): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "home":
      return true;
    case "fixed":
      return b.type === "fixed" && a.dest === b.dest;
    case "content":
      return b.type === "content" && a.key === b.key;
  }
}

function setRootVisible(root: HTMLElement, visible: boolean): void {
  root.classList.toggle("is-active", visible);
  root.setAttribute("aria-hidden", visible ? "false" : "true");
}

function moveTabIndicator(navEl: HTMLElement, btn: HTMLButtonElement): void {
  if (!tabIndicator) return;
  const navRect = navEl.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  tabIndicator.style.width = `${btnRect.width}px`;
  tabIndicator.style.height = `${btnRect.height}px`;
  tabIndicator.style.transform = `translate(${btnRect.left - navRect.left}px, ${btnRect.top - navRect.top}px)`;
  tabIndicator.style.opacity = "1";
}

function contentRecordFor(surface: ActiveSurface): ContentTabRecord | undefined {
  if (surface.type !== "content") return undefined;
  return tabsByKey.get(surface.key);
}

function findTabByIdentity(identity: ContentTabIdentity): ContentTabRecord | undefined {
  if (identity.kind === "blank" || identity.kind === "fixed") return undefined;
  const idKey = contentTabKey(identity.kind === "list" ? { kind: "task-view" } : identity);
  const key = identityToKey.get(idKey);
  return key ? tabsByKey.get(key) : undefined;
}

function paneForTabKey(key: string): PaneId | undefined {
  if (panes.left.tabKeys.includes(key)) return "left";
  if (panes.right?.tabKeys.includes(key)) return "right";
  return undefined;
}

function selectTaskViewState(state: TaskViewState): void {
  const tab = findTabByIdentity({ kind: "task-view" });
  if (!tab) return;
  void activateSurface({ type: "content", key: tab.key }, { taskViewState: state });
}

function hasRightPane(): boolean {
  return Boolean(panes.right && panes.right.tabKeys.length > 0);
}

function syncRightPanePresence(): void {
  const hasRight = hasRightPane();
  if (!hasRight) {
    panes.right = undefined;
    if (focusedPane === "right") focusedPane = "left";
  }
  if (rightTabStripSlot) rightTabStripSlot.hidden = !hasRight;
  if (rightViewport) rightViewport.hidden = !hasRight;
  if (rightPaneEl) rightPaneEl.hidden = !hasRight;
  if (paneDivider) paneDivider.hidden = !hasRight;
  if (paneDividerLine) paneDividerLine.hidden = !hasRight;
  paneGroup?.classList.toggle("has-right-pane", hasRight);
  shellGrid?.classList.toggle("has-right-pane", hasRight);
}

function updatePaneChrome(): void {
  syncRightPanePresence();
  geometry?.scheduleGeometry();
}

function currentLeftDesired(): number {
  return paneLeftPreview ?? panes.left.width;
}

let paneDividerEscapeAbort: AbortController | null = null;

function mountPaneDividerResize(divider: HTMLElement): void {
  paneDividerEscapeAbort?.abort();
  paneDividerEscapeAbort = new AbortController();
  let pointerId: number | null = null;
  let startX = 0;
  let startDesired = 0;
  let keyPreview = false;

  function maxLeftNow(): number {
    const geo = geometry?.last();
    if (!geo) return PANE_MIN;
    return Math.max(PANE_MIN, geo.leftWidth + geo.rightWidth - PANE_MIN);
  }

  function applyPreview(leftW: number): void {
    paneLeftPreview = Math.max(PANE_MIN, Math.min(maxLeftNow(), leftW));
    geometry?.scheduleGeometry();
  }

  function rollback(): void {
    paneLeftPreview = null;
    keyPreview = false;
    divider.classList.remove("is-dragging");
    geometry?.scheduleGeometry();
  }

  function persist(): void {
    if (paneLeftPreview === null) return;
    panes.left.width = paneLeftPreview;
    paneLeftPreview = null;
    keyPreview = false;
    markWorkspaceTouched();
    persistSession();
    geometry?.scheduleGeometry();
  }

  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-valuemin", `${PANE_MIN}`);
  divider.tabIndex = 0;

  divider.addEventListener("pointerdown", (e) => {
    if (!panes.right) return;
    e.preventDefault();
    pointerId = e.pointerId;
    startX = e.clientX;
    startDesired =
      currentLeftDesired() > 0 ? currentLeftDesired() : (geometry?.last()?.leftWidth ?? PANE_MIN);
    paneLeftPreview = startDesired;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("is-dragging");
  });

  divider.addEventListener("pointermove", (e) => {
    if (pointerId !== e.pointerId) return;
    applyPreview(startDesired + (e.clientX - startX));
  });

  const endDrag = (e: PointerEvent, save: boolean) => {
    if (pointerId !== e.pointerId) return;
    try {
      divider.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    pointerId = null;
    divider.classList.remove("is-dragging");
    if (save) persist();
    else rollback();
  };

  divider.addEventListener("pointerup", (e) => endDrag(e, true));
  divider.addEventListener("pointercancel", (e) => endDrag(e, false));

  const onPointerDragEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || pointerId === null) return;
    e.preventDefault();
    const id = pointerId;
    pointerId = null;
    try {
      divider.releasePointerCapture(id);
    } catch {
      /* already released */
    }
    rollback();
  };
  window.addEventListener("keydown", onPointerDragEscape, { signal: paneDividerEscapeAbort.signal });

  divider.addEventListener("keydown", (e) => {
    if (!panes.right) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (typeof pointerId === "number") {
        try {
          divider.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        pointerId = null;
      }
      rollback();
      return;
    }
    if (e.key === "Enter" && keyPreview) {
      e.preventDefault();
      persist();
      return;
    }
    const step = e.shiftKey ? 40 : 10;
    const maxLeft = maxLeftNow();
    let next =
      paneLeftPreview ??
      (panes.left.width > 0 ? panes.left.width : (geometry?.last()?.leftWidth ?? PANE_MIN));
    let handled = false;
    switch (e.key) {
      case "ArrowLeft":
        next -= step;
        handled = true;
        break;
      case "ArrowRight":
        next += step;
        handled = true;
        break;
      case "Home":
        next = PANE_MIN;
        handled = true;
        break;
      case "End":
        next = maxLeft;
        handled = true;
        break;
      default:
        break;
    }
    if (!handled) return;
    e.preventDefault();
    keyPreview = true;
    applyPreview(next);
  });

  divider.addEventListener("blur", () => {
    if (keyPreview && paneLeftPreview !== null) persist();
  });
}

function updateSidebarForSurface(surface: ActiveSurface): void {
  if (!nav) return;
  const fixedDest: FixedDestId | null = surface.type === "fixed" ? surface.dest : null;
  const record = contentRecordFor(surface);
  const chatActive = surface.type === "content" && record?.identity.kind === "chat";
  const projectActive =
    surface.type === "content" &&
    (record?.identity.kind === "project-index" || record?.identity.kind === "project");
  const taskActive =
    surface.type === "content" &&
    (record?.identity.kind === "task-view" || record?.identity.kind === "list");
  const settingsActive = surface.type === "content" && record?.identity.kind === "settings";
  const debugActive = surface.type === "content" && record?.identity.kind === "control-gallery";

  for (const [selector, active] of [
    ['[data-nav="chat"]', chatActive],
    ['[data-nav="project"]', projectActive],
    ['[data-nav="task"]', taskActive],
    ['[data-nav="health"]', fixedDest === "health"],
    ['[data-nav="finance"]', fixedDest === "finance"],
    ['[data-nav="finance1"]', fixedDest === "finance1"],
    ['[data-nav="debug"]', debugActive],
  ] as const) {
    const btn = nav.querySelector<HTMLButtonElement>(selector);
    btn?.classList.toggle("is-active", active);
    if (btn) {
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    }
  }

  const settingsButton = nav.querySelector<HTMLButtonElement>(".admin-settings-nav-btn");
  settingsButton?.classList.toggle("is-active", settingsActive);
  if (settingsButton) {
    if (settingsActive) settingsButton.setAttribute("aria-current", "page");
    else settingsButton.removeAttribute("aria-current");
  }
  nav.querySelectorAll<HTMLButtonElement>(".admin-tab-btn").forEach((btn) => {
    const isActive = fixedDest !== null && btn.dataset.tab === fixedDest;
    btn.classList.toggle("is-active", isActive);
    if (isActive) moveTabIndicator(nav!, btn);
  });
  if (!fixedDest && tabIndicator) tabIndicator.style.opacity = "0";

  let wsKey: string | null = null;
  if (surface.type === "content") {
    if (record?.identity.kind === "project") wsKey = itemKey("project", record.identity.id);
    else if (record?.identity.kind === "list") wsKey = itemKey("list", record.identity.id);
    else if (record?.identity.kind === "task-view") {
      const filter = (record.destState as { filter?: string })?.filter;
      if (filter && filter !== "all" && filter !== "inbox") {
        wsKey = itemKey("list", filter);
      }
    }
  }
  activeWorkspaceKey = wsKey;
  workspaceNav?.updateActive();
}

function persistSession(): void {
  if (!workspaceTouched && bootSnapshot) return;
  for (const tab of tabsByKey.values()) {
    if (tab.identity.kind !== "task-view") continue;
    const entry = cache.get(tab.key);
    if (!entry?.handle.getRestoreState) continue;
    tab.destState = entry.handle.getRestoreState() ?? {};
  }
  saveTabSession({
    v: 2,
    tabs: [...tabsByKey.values()],
    panes: {
      left: {
        tabKeys: [...panes.left.tabKeys],
        active: String(panes.left.active),
        width: panes.left.width,
      },
      ...(panes.right
        ? {
            right: {
              tabKeys: [...panes.right.tabKeys],
              active: String(panes.right.active),
              width: panes.right.width,
            },
          }
        : {}),
    },
    focusedPane,
    style: tabStyle,
  });
}

async function syncUnsavedFlag(): Promise<void> {
  try {
    await invoke("insight_set_has_unsaved", { hasUnsaved: anyBlockingDraft() });
  } catch {
    /* command may not exist */
  }
}

async function confirmAbandonDrafts(title: string, message: string): Promise<boolean> {
  if (!anyBlockingDraft()) return true;
  const confirm = getConfirmDialog();
  return confirm(title, message, undefined, { confirmLabel: "放弃修改", danger: true });
}

function disposeCachedSurface(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.handle.dispose("host-dispose");
  entry.root.remove();
  cache.delete(key);
  navigationInstances.delete(key);
  for (let index = navigationOverlays.length - 1; index >= 0; index--) {
    if (navigationOverlays[index].owner === key) navigationOverlays.splice(index, 1);
  }
}

function getOrMount(
  surfaceKey: string,
  destId: InsightDestinationId,
  panel: HTMLElement,
  restoreState?: unknown,
  viewport?: HTMLElement,
): CachedSurface {
  const mountTarget = viewport ?? panel;
  const existing = cache.get(surfaceKey);
  if (existing) {
    if (!existing.root.isConnected) {
      cache.delete(surfaceKey);
    } else {
      if (restoreState !== undefined && existing.handle.restoreState) {
        existing.handle.restoreState(restoreState);
      }
      return existing;
    }
  }

  const root = document.createElement("div");
  root.className = "insight-dest-root";
  root.dataset.dest = destId;
  root.dataset.surface = surfaceKey;
  root.setAttribute("aria-hidden", "true");
  mountTarget.appendChild(root);
  navigationInstances.set(surfaceKey, `instance:${++navigationInstanceId}`);

  const dest = getInsightDestination(destId);
  if (!dest) {
    const entry = { root, handle: EMPTY_HANDLE };
    cache.set(surfaceKey, entry);
    return entry;
  }

  const context = Object.create(hostContext()) as InsightHostContext;
  context.navigation = {
    navigate: (state, options) => navigateLocal(surfaceKey, state, options?.returnToPrevious),
    replaceContext: () => { if (surfaceKeyFromActive(getFocusedActiveSurface()) === surfaceKey) refreshNavigationContext(); },
    registerOverlay: (overlay) => {
      const entry = { owner: surfaceKey, overlay };
      navigationOverlays.push(entry);
      return () => { const index = navigationOverlays.indexOf(entry); if (index >= 0) navigationOverlays.splice(index, 1); };
    },
  };
  const handle = dest.mount(root, context);
  const entry = { root, handle };
  cache.set(surfaceKey, entry);

  if (restoreState !== undefined && handle.restoreState) {
    handle.restoreState(restoreState);
  }

  return entry;
}

function deactivateFocusedSurface(nextSurfaceKey?: string): void {
  const key = surfaceKeyFromActive(getFocusedActiveSurface());
  if (key === nextSurfaceKey) return;
  const entry = cache.get(key);
  if (!entry) return;
  try {
    entry.handle.deactivate();
  } catch (error) {
    console.error("Insight surface deactivation failed", error);
  }
}

function setPaneSurfaceVisible(pane: PaneId, surfaceKey: string, visible: boolean): void {
  const entry = cache.get(surfaceKey);
  if (!entry) return;
  setRootVisible(entry.root, visible);
}

function hideOtherSurfacesInPane(pane: PaneId, keepKey: string): void {
  const vp = viewportForPane(pane);
  for (const child of vp.querySelectorAll<HTMLElement>(".insight-dest-root")) {
    if (child.dataset.surface !== keepKey) setRootVisible(child, false);
  }
}

type ActivateOpts = {
  restoreState?: unknown;
  touch?: boolean;
  history?: "visit" | "align" | "none";
  taskViewState?: TaskViewState;
  pageRequest?: ProjectTaskFocusPageRequest;
  preparedNavigation?: boolean;
};

async function showSurfaceActivationError(title: string, error: unknown): Promise<void> {
  try {
    const detail = error instanceof Error ? error.message : String(error);
    await getConfirmDialog()(
      title,
      detail || "页面加载时发生错误。",
      undefined,
      { confirmLabel: "确定", danger: false, info: true },
    );
  } catch (dialogError) {
    console.error("Insight activation error notice failed", dialogError);
  }
}

function resolvePaneForSurface(surface: ActiveSurface): PaneId {
  if (surface.type === "content") {
    const pane = paneForTabKey(surface.key);
    if (pane) return pane;
  }
  return "left";
}

async function activateSurface(
  surface: ActiveSurface,
  opts?: ActivateOpts & { pane?: PaneId; focus?: boolean },
): Promise<NavigationResult> {
  const epoch = hostGeneration;
  return (await navigationChannel.run(async () => {
    if (epoch !== hostGeneration) return { status: "blocked" } as NavigationResult;
    syncHostContext();
    refreshNavigationContext();
    const token = navigationToken();
    const key = surfaceKeyFromActive(surface);
    if (surface.type === "content" && !tabsByKey.has(key)) return { status: "unavailable", message: "标签已关闭" } as NavigationResult;
    const target = captureNavigation(surface);
    const adapter = cache.get(key)?.handle.navigation;
    const requestedState = opts?.taskViewState ? adapter?.resolveTaskView?.(opts.taskViewState) : undefined;
    if (requestedState) { target.route = { ...target.route, value: requestedState.route }; target.context = requestedState.context; }
    const replaceRoute = !!opts?.pageRequest || (!!requestedState && !sameNavigationRoute(captureNavigation(surface), target));
    if (!(await guardNavigation(target, replaceRoute))) return { status: "blocked" } as NavigationResult;
    if (!token.isCurrent()) return { status: "blocked" } as NavigationResult;
    if (requestedState && replaceRoute) {
      let restored: NavigationResult;
      try { restored = await adapter!.restore(requestedState, token); }
      catch (error) { restored = { status: "failed", error }; }
      if (restored.status === "failed") await showSurfaceActivationError("页面恢复失败", restored.error);
      if (restored.status !== "applied" || !token.isCurrent()) return restored;
    }
    const result = await applySurface(surface, { ...opts, preparedNavigation: !!requestedState && replaceRoute });
    if (result.status === "applied" && token.isCurrent() && opts?.focus !== false) {
      if (opts?.history === "align") navigationHistory.replaceCurrent(captureNavigation());
      else if (opts?.history !== "none") navigationHistory.visit(captureNavigation());
      if (requestedState) { syncSecondaryRail(); persistSession(); }
    }
    return result;
  })) ?? { status: "blocked" };
}

async function applySurface(
  surface: ActiveSurface,
  opts?: ActivateOpts & { pane?: PaneId; focus?: boolean },
): Promise<NavigationResult> {
  const pane = opts?.pane ?? resolvePaneForSurface(surface);
  const record = contentRecordFor(surface);
  if (surface.type === "content" && !record) return { status: "unavailable", message: "标签已关闭" };
  const shouldFocus = opts?.focus !== false;

  const existingKey = surfaceKeyFromActive(surface);
  const cached = cache.get(existingKey);
  const paneSurface = getPaneActiveSurface(pane);
  if (
    cached?.root.isConnected &&
    surfacesEqual(paneSurface, surface) &&
    opts?.restoreState === undefined &&
    cached.root.classList.contains("is-active") &&
    pane === focusedPane
  ) {
    return { status: "applied" };
  }

  const token = ++activateToken;
  const surfaceKey = surfaceKeyFromActive(surface);
  const destId: InsightDestinationId =
    surface.type === "home"
      ? "home"
      : surface.type === "fixed"
        ? surface.dest
        : record!.destId;

  const vp = viewportForPane(pane);
  const alreadyMounted = cached?.root.isConnected ?? false;
  const restoreState =
    opts?.restoreState ??
    (!alreadyMounted && surface.type === "content" ? record!.destState : undefined);

  let entry: CachedSurface | null = null;
  try {
    syncHostContext();
    entry = getOrMount(surfaceKey, destId, vp, restoreState, vp);
    if (token !== activateToken) return { status: "blocked" };
    // Prepare while the source stays visible; a rejected load must not commit the route (SPEC-0014 §3).
    if (shouldFocus && !opts?.preparedNavigation) await entry.handle.activate();
    if (token !== activateToken) return { status: "blocked" };
    if (opts?.pageRequest) entry.handle.handlePageRequest?.(opts.pageRequest);
    if (shouldFocus) deactivateFocusedSurface(surfaceKey);
    if (pane === "left") panes.left.active = surfaceToLeftActive(surface);
    else if (panes.right && surface.type === "content") panes.right.active = surface.key;
    if (shouldFocus) focusedPane = pane;
    hideOtherSurfacesInPane(pane, surfaceKey);
    setRootVisible(entry.root, true);
    entry.handle.navigation?.onVisible?.();
    if (opts?.touch !== false) {
      markWorkspaceTouched();
    }
    updateSidebarForSurface(getFocusedActiveSurface());
    leftTabStripHandle?.refresh();
    rightTabStripHandle?.refresh();
    updatePaneChrome();
    if (opts?.touch !== false) {
      persistSession();
    }
    void syncUnsavedFlag();
    syncSecondaryRail();

    return { status: "applied" };
  } catch (error) {
    if (token !== activateToken) {
      console.error("Insight surface activation failed after it became inactive", error);
      return { status: "failed", error };
    }

    await showSurfaceActivationError("页面打开失败", error);
    return { status: "failed", error };
  }
}

async function focusPane(pane: PaneId): Promise<void> {
  if (focusedPane === pane) return;
  deactivateFocusedSurface();
  focusedPane = pane;
  syncSecondaryRail();
  const surface = getPaneActiveSurface(pane);
  const key = surfaceKeyFromActive(surface);
  const entry = cache.get(key);
  if (entry) {
    try {
      await entry.handle.activate();
    } catch (error) {
      console.error("Insight pane focus activation failed", error);
    }
  }
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
  updateSidebarForSurface(getFocusedActiveSurface());
  persistSession();
}

function ensureRightPane(activeKey?: string): void {
  if (!panes.right) {
    panes.right = { tabKeys: [], active: activeKey ?? "", width: 0 };
  }
}

function moveTab(key: string, targetPane: PaneId, index: number): void {
  const tab = tabsByKey.get(key);
  if (!tab) return;
  const sourcePane = paneForTabKey(key);
  if (!sourcePane || sourcePane === targetPane) {
    const state = getPaneState(targetPane);
    const keys = state.tabKeys.filter((k) => k !== key);
    const clamped = Math.max(0, Math.min(index, keys.length));
    keys.splice(clamped, 0, key);
    state.tabKeys = keys;
    markWorkspaceTouched();
    leftTabStripHandle?.refresh();
    rightTabStripHandle?.refresh();
    updatePaneChrome();
    persistSession();
    return;
  }
  const source = getPaneState(sourcePane);
  source.tabKeys = source.tabKeys.filter((k) => k !== key);
  if (targetPane === "right") ensureRightPane(key);
  const target = getPaneState(targetPane);
  const keys = target.tabKeys.filter((k) => k !== key);
  const clamped = Math.max(0, Math.min(index, keys.length));
  keys.splice(clamped, 0, key);
  target.tabKeys = keys;
  target.active = key;
  const entry = cache.get(key);
  if (entry) viewportForPane(targetPane).appendChild(entry.root);
  if (sourcePane === "right" && source.tabKeys.length === 0) {
    panes.right = undefined;
    if (focusedPane === "right") focusedPane = "left";
  } else if (source.active === key) {
    if (sourcePane === "left") {
      source.active = source.tabKeys[0] ?? "home";
    } else if (source.tabKeys[0]) {
      source.active = source.tabKeys[0];
    }
  }
  markWorkspaceTouched();
  updatePaneChrome();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
  void activateSurface({ type: "content", key }, { pane: targetPane, focus: true });
}

function openNewContentTab(
  identity: ContentTabIdentity,
  title?: string,
  targetPane?: PaneId,
  activateOpts?: ActivateOpts,
): void {
  const pane = targetPane ?? focusedPane;
  const key = identity.kind === "task-view" ? contentTabKey(identity) : newTabInstanceKey();
  const record: ContentTabRecord = {
    key,
    identity,
    title: title ?? defaultTabTitle(identity),
    destId: destForIdentity(identity),
    destState: destStateForIdentity(identity),
  };
  if (pane === "right") ensureRightPane(key);
  tabsByKey.set(key, record);
  rebuildIdentityIndex();
  const state = getPaneState(pane);
  state.tabKeys.push(key);
  const vp = viewportForPane(pane);
  const entry = getOrMount(key, record.destId, vp, record.destState, vp);
  setRootVisible(entry.root, false);
  markWorkspaceTouched();
  updatePaneChrome();
  persistSession();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
  void activateSurface({ type: "content", key }, { pane, focus: true, ...activateOpts });
}

function replaceTabIdentity(
  record: ContentTabRecord,
  identity: ContentTabIdentity,
  title?: string,
): void {
  disposeCachedSurface(record.key);
  record.identity = identity;
  record.title = title ?? defaultTabTitle(identity);
  record.destId = destForIdentity(identity);
  record.destState = destStateForIdentity(identity);
  const pane = paneForTabKey(record.key) ?? "left";
  const vp = viewportForPane(pane);
  const entry = getOrMount(record.key, record.destId, vp, record.destState, vp);
  setRootVisible(entry.root, false);
  markWorkspaceTouched();
  persistSession();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
}

function openContentTabToPane(
  identity: ContentTabIdentity,
  pane: PaneId,
  opts?: { title?: string; taskFilter?: string; insertIndex?: number },
): boolean {
  if (identity.kind === "fixed") return false;
  if (pane !== "left" && pane !== "right") return false;
  let resolved = identity;
  if (resolved.kind === "list") resolved = { kind: "task-view" };
  const existing = findTabByIdentity(resolved);
  const createdRight = pane === "right" && !panes.right;
  const insertIndex =
    opts?.insertIndex ?? (getPaneStateOrNull(pane)?.tabKeys.length ?? 0);
  try {
    if (existing) {
      if (opts?.taskFilter) selectTaskViewState({ view: "list", filter: opts.taskFilter });
      else if (opts?.title && opts.title !== existing.title) {
        existing.title = opts.title;
        markWorkspaceTouched();
        persistSession();
      }
      const sourcePane = paneForTabKey(existing.key);
      if (sourcePane === pane) {
        void activateSurface({ type: "content", key: existing.key }, { pane, focus: true });
        return true;
      }
      if (createdRight) ensureRightPane(existing.key);
      moveTab(existing.key, pane, insertIndex);
      return true;
    }
    if (createdRight) ensureRightPane();
    openNewContentTab(resolved, opts?.title, pane);
    if (opts?.taskFilter) selectTaskViewState({ view: "list", filter: opts.taskFilter });
    return true;
  } catch {
    if (createdRight && panes.right && panes.right.tabKeys.length === 0) {
      panes.right = undefined;
      updatePaneChrome();
    }
    return false;
  }
}

function navigateFromSidebar(identity: ContentTabIdentity, title?: string): void {
  if (identity.kind === "fixed") {
    if (identity.dest === "work") {
      identity = { kind: "task-view" };
    } else {
      void activateSurface({ type: "fixed", dest: identity.dest });
      return;
    }
  }

  const existing = findTabByIdentity(identity);
  if (existing) {
    if (title && title !== existing.title) {
      existing.title = title;
      markWorkspaceTouched();
      persistSession();
    }
    const pane = paneForTabKey(existing.key) ?? "left";
    void activateSurface({ type: "content", key: existing.key }, { pane, focus: true });
    return;
  }

  const focusedSurface = getFocusedActiveSurface();
  if (focusedSurface.type === "home" || focusedSurface.type === "fixed") {
    openNewContentTab(identity, title);
    return;
  }

  const currentRecord = contentRecordFor(focusedSurface);
  if (!currentRecord) {
    openNewContentTab(identity, title);
    return;
  }

  if (currentRecord.identity.kind === "blank") {
    replaceTabIdentity(currentRecord, identity, title);
    void activateSurface({ type: "content", key: currentRecord.key }, { focus: true });
    return;
  }

  openNewContentTab(identity, title);
}

function openJournalTab(entryId: string, title?: string): void {
  navigateFromSidebar({ kind: "journal", id: entryId }, title);
}

function openContentTab(identity: ContentTabIdentity, title?: string, options?: OpenInsightContentTabOptions): void {
  if (identity.kind === "journal") {
    openJournalTab(identity.id, title);
    return;
  }
  if (identity.kind === "list") {
    const tab = findTabByIdentity({ kind: "task-view" });
    if (tab) void activateSurface({ type: "content", key: tab.key }, { taskViewState: { view: "list", filter: identity.id } });
    else openNewContentTab({ kind: "task-view" }, title, undefined, { taskViewState: { view: "list", filter: identity.id } });
    return;
  }
  if (identity.kind === "project" && options?.focusTaskId) {
    const tab = findTabByIdentity(identity);
    const request: ProjectTaskFocusPageRequest = {
      kind: "focus-project-task",
      projectId: identity.id,
      taskId: options.focusTaskId,
      generation: hostContext().generation,
    };
    if (tab) void activateSurface({ type: "content", key: tab.key }, { pageRequest: request });
    else openNewContentTab(identity, title, undefined, { pageRequest: request });
    return;
  }
  navigateFromSidebar(identity, title);
}

function syncJournalTabAfterCreate(draftId: string, entryId: string, title: string): void {
  const tab = [...tabsByKey.values()].find(
    (t) => t.identity.kind === "journal" && t.identity.id === draftId,
  );
  if (!tab) return;
  tabsByKey.delete(tab.key);
  tab.identity = { kind: "journal", id: entryId };
  tab.title = title;
  tab.destState = { entryId };
  tabsByKey.set(tab.key, tab);
  rebuildIdentityIndex();
  markWorkspaceTouched();
  persistSession();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
}

function syncContentTabTitle(surfaceKey: string, title: string): void {
  const tab = tabsByKey.get(surfaceKey);
  if (!tab || !title) return;
  if (tab.title === title) return;
  tab.title = title;
  markWorkspaceTouched();
  persistSession();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
}

function openBlankTab(): void {
  const identity = newBlankIdentity();
  const key = newTabInstanceKey();
  const record: ContentTabRecord = {
    key,
    identity,
    title: defaultTabTitle(identity),
    destId: "home",
    destState: {},
  };
  const pane = focusedPane;
  if (pane === "right") ensureRightPane(key);
  tabsByKey.set(key, record);
  getPaneState(pane).tabKeys.push(key);
  const vp = viewportForPane(pane);
  getOrMount(key, "home", vp, {}, vp);
  markWorkspaceTouched();
  updatePaneChrome();
  persistSession();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
  void activateSurface({ type: "content", key }, { pane, focus: true });
}

async function closeContentTab(key?: string): Promise<void> {
  await navigationChannel.run(() => applyCloseContentTab(key));
}

async function applyCloseContentTab(key?: string): Promise<void> {
  let tabKey = key;
  if (tabKey === undefined || tabKey === "settings") {
    const settingsTab = findTabByIdentity({ kind: "settings" });
    if (!settingsTab) return;
    tabKey = settingsTab.key;
  }

  const waited = await waitInFlight(tabKey);
  let status = getDirtyStatus(tabKey);
  if (!waited && status.inFlight) return;
  if (tabsByKey.get(tabKey)?.identity.kind === "settings") {
    const handle = cache.get(tabKey)?.handle;
    if (handle?.canDispose && !(await handle.canDispose("host-dispose"))) return;
  }
  if (tabsByKey.get(tabKey)?.identity.kind === "settings" && !(await confirmThemeEditorDisposition())) return;
  status = getDirtyStatus(tabKey);
  if (status.dirty || status.failed) {
    const confirm = getConfirmDialog();
    const ok = await confirm(
      "关闭标签",
      "有未保存的修改。继续编辑将保留标签与草稿。",
      undefined,
      { confirmLabel: "放弃修改", danger: true },
    );
    if (!ok) return;
  }

  const pane = paneForTabKey(tabKey);
  if (!pane) return;
  const state = getPaneState(pane);
  const idx = state.tabKeys.indexOf(tabKey);
  if (idx < 0) return;

  const wasActive =
    (pane === "left" && state.active === tabKey) ||
    (pane === "right" && panes.right?.active === tabKey);

  disposeCachedSurface(tabKey);
  setDirtyStatus(tabKey, { dirty: false, inFlight: false, failed: false });
  tabsByKey.delete(tabKey);
  navigationHistory.remove((frame) => frame.surface.type === "content" && frame.surface.key === tabKey);
  rebuildIdentityIndex();
  state.tabKeys.splice(idx, 1);
  if (wasActive) state.active = pane === "left" ? "home" : "";
  markWorkspaceTouched();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();

  if (pane === "right" && state.tabKeys.length === 0) {
    panes.right = undefined;
    if (focusedPane === "right") focusedPane = "left";
    updatePaneChrome();
    if (wasActive) {
      const leftState = panes.left;
      if (leftState.tabKeys.length === 0 || leftState.active === "home" || leftState.active === "timeline") {
        void activateSurface(
          leftState.active === "timeline"
            ? { type: "fixed", dest: "timeline" }
            : { type: "home" },
          { pane: "left", focus: true, history: "align" },
        );
      } else {
        void activateSurface({ type: "content", key: String(leftState.active) }, { pane: "left", focus: true, history: "align" });
      }
    }
  } else if (wasActive) {
    if (state.tabKeys.length === 0) {
      if (pane === "left") {
        void activateSurface({ type: "home" }, { pane: "left", focus: pane === focusedPane, history: "align" });
      }
    } else {
      const prevIdx = Math.max(0, idx - 1);
      const nextKey = state.tabKeys[prevIdx] ?? state.tabKeys[0];
      state.active = nextKey;
      void activateSurface({ type: "content", key: nextKey }, { pane, focus: pane === focusedPane, history: "align" });
    }
  }

  updatePaneChrome();
  persistSession();
  void syncUnsavedFlag();
  syncSecondaryRail();
}

async function confirmThemeEditorDisposition(): Promise<boolean> {
  const session = getThemeEditSession();
  if (!session) return true;
  if (!session.dirty && !session.saving && !session.error) {
    cancelThemeEdit(session.sessionId);
    return true;
  }
  const dialog = createInsightDialog({
    title: "色彩编辑尚未保存",
    bodyHtml: '<p>保存草稿、放弃本次编辑，或继续编辑。</p>',
    submitLabel: "保存",
    cancelLabel: "继续编辑",
    extraActionsHtml: '<button type="button" class="insight-dialog-btn insight-dialog-btn-danger" data-action="discard">放弃修改</button>',
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      void dialog.close().then(() => resolve(value));
    };
    dialog.bindChrome(() => finish(false));
    dialog.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      if (dialog.busy) return;
      dialog.setBusy(true);
      void savePreset(session.sessionId).then(() => finish(true), (error) => {
        dialog.setBusy(false);
        dialog.setError(`保存失败：${String(error)}`);
      });
    });
    dialog.panel.querySelector<HTMLButtonElement>('[data-action="discard"]')?.addEventListener("click", () => {
      try { cancelThemeEdit(session.sessionId); finish(true); }
      catch (error) { dialog.setError(`放弃失败：${String(error)}`); }
    });
    void dialog.open();
  });
}

async function disposeAll(reason: "host-dispose" | "data-dir-change"): Promise<void> {
  if (reason === "host-dispose") {
    releaseSharedOverlayNavigation?.(); releaseSharedOverlayNavigation = null;
    navigationInputAbort?.abort();
    setInsightHistoryNavigator(null);
  }
  activateToken += 1;
  navigationRequest += 1;
  navigationHistory.reset();
  navigationInstances.clear();
  navigationOverlays.length = 0;
  releaseThemeEditForHostChange();
  secondaryRail?.setDescriptor(null);
  workspaceNav?.dispose();
  workspaceNav = null;
  for (const [, entry] of cache) {
    entry.handle.dispose(reason);
    entry.root.remove();
  }
  cache.clear();
  tabsByKey.clear();
  identityToKey.clear();
  panes = { left: { tabKeys: [], active: "home", width: 0 } };
  focusedPane = "left";
  bootSnapshot = null;
  workspaceTouched = false;
  syncRestoreLayoutButton();
  clearAllDirty();
  activeWorkspaceKey = null;
  hostGeneration += 1;
  updatePaneChrome();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
}

async function canDisposeAll(reason: "host-dispose" | "data-dir-change"): Promise<boolean> {
  for (const key of tabsByKey.keys()) {
    await waitInFlight(key);
  }
  for (const [, entry] of cache) {
    if (entry.handle.canDispose) {
      const ok = await entry.handle.canDispose(reason);
      if (!ok) return false;
    }
  }
  if (!(await confirmThemeEditorDisposition())) return false;
  return true;
}

// SPEC-0001 X01 / ADR 0034 §9: after persist, drop both panes, drafts, and layout snapshot; no second confirm.
async function applyDataDirSessionCleanup(): Promise<void> {
  await disposeAll("data-dir-change");
  clearTabSession();
  if (leftViewport) leftViewport.innerHTML = "";
  if (rightViewport) rightViewport.innerHTML = "";
  updatePaneChrome();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
  void activateSurface({ type: "home" }, { pane: "left", focus: true });
}

async function refreshSettingsAfterRemoteDirChange(): Promise<"ok" | "unknown"> {
  try {
    const settings = await import("../../core/settings");
    if (typeof settings.loadSettings !== "function") return "ok";
    await settings.loadSettings();
    const dir = settings.getSettings()?.dataDir;
    if (!dir || !String(dir).trim()) return "unknown";
    return "ok";
  } catch {
    return "unknown";
  }
}

function holdOldTabsUnwritable(message: string): void {
  pauseInsightDomainWrites();
  void showSurfaceActivationError("数据目录切换", message);
}

async function onDataDirChanged(stamp: DataDirChangeStamp): Promise<void> {
  window.dispatchEvent(new Event("orbita:insight-abort-chat"));
  const local = consumeLocalDataDirSwitchAuthorized();
  if (!local) {
    if (
      !(await confirmAbandonDrafts(
        "切换数据目录",
        "有未保存的修改。继续编辑将保留标签与草稿。",
      ))
    ) {
      const target = stamp.dataDir;
      const current = getSettings().dataDir;
      if (target && current && target !== current) {
        holdOldTabsUnwritable(
          "其他窗口已切换数据目录。当前标签仍属旧目录，已暂停写入，不能当作新目录内容编辑。",
        );
      }
      return;
    }
    if (!(await canDisposeAll("data-dir-change"))) {
      holdOldTabsUnwritable("数据目录已切换，但本窗口仍有不能丢弃的未保存内容。已暂停领域写入。");
      return;
    }
    if ((await refreshSettingsAfterRemoteDirChange()) === "unknown") {
      holdOldTabsUnwritable("无法确认当前数据目录。已暂停领域写入，并回到主页。");
      await applyDataDirSessionCleanup();
      return;
    }
  } else {
    await waitAllInFlight();
  }

  await applyDataDirSessionCleanup();
  if (!dataDirFaultMessage) resumeInsightDomainWrites();
  if (dataDirFaultMessage) {
    const message = dataDirFaultMessage;
    dataDirFaultMessage = null;
    await showSurfaceActivationError("数据目录切换失败", message);
  }
}

function makeStripCallbacks(pane: PaneId) {
  const paneActive = () => {
    if (pane === "right" && !panes.right) return { type: "home" } as ActiveSurface;
    return getPaneActiveSurface(pane);
  };
  const paneTabs = () => {
    if (pane === "right" && !panes.right) return [];
    return getPaneTabs(pane);
  };
  return {
    getActive: paneActive,
    getTabs: paneTabs,
    getStyle: () => tabStyle,
    onSelectHome: () => {
      void focusPane("left");
      void activateSurface({ type: "home" }, { pane: "left", focus: true });
    },
    onSelectTimeline: () => {
      void focusPane("left");
      void activateSurface({ type: "fixed", dest: "timeline" }, { pane: "left", focus: true });
    },
    onNewTab: () => {
      void focusPane(pane);
      openBlankTab();
    },
    onSelectTab: (key: string) => {
      void focusPane(pane);
      void activateSurface({ type: "content", key }, { pane, focus: true });
    },
    onCloseTab: (key: string) => {
      void closeContentTab(key);
    },
    onReorder: (keys: string[]) => {
      const state = getPaneStateOrNull(pane);
      if (!state) return;
      state.tabKeys = keys.filter((k) => tabsByKey.has(k));
      markWorkspaceTouched();
      persistSession();
    },
    onMoveTab: (key: string, targetPane: PaneId, index: number) => {
      moveTab(key, targetPane, index);
    },
    onFocusPane: () => {
      void focusPane(pane);
    },
  };
}

function mountTabStripHosts(leftSlot: HTMLElement, rightSlot: HTMLElement): void {
  const sessionOpts = dragSession ? { dragSession } : {};
  leftTabStripHandle = mountTabStrip(
    leftSlot,
    makeStripCallbacks("left"),
    {
      showAnchors: true,
      paneId: "left",
      ...sessionOpts,
    },
  );
  rightTabStripHandle = mountTabStrip(
    rightSlot,
    makeStripCallbacks("right"),
    {
      showAnchors: false,
      showNewTab: false,
      paneId: "right",
      ...sessionOpts,
    },
  );
  const restoreAnchor = leftSlot.querySelector(".insight-tab-strip-rest");
  if (restoreLayoutBtnEl && restoreAnchor) restoreAnchor.before(restoreLayoutBtnEl);
}

let leftPaneEl: HTMLElement | null = null;

async function applySession(session: TabSession): Promise<void> {
  navigationRequest++;
  navigationHistory.reset();
  tabsByKey.clear();
  for (const tab of session.tabs) tabsByKey.set(tab.key, tab);
  rebuildIdentityIndex();
  panes = sessionToWorkspacePanes(session);
  focusedPane = session.focusedPane === "right" && panes.right ? "right" : "left";
  tabStyle = session.style;
  updatePaneChrome();

  for (const tab of session.tabs) {
    const pane = paneForTabKey(tab.key) ?? "left";
    const vp = viewportForPane(pane);
    const entry = getOrMount(tab.key, tab.destId, vp, tab.destState, vp);
    setRootVisible(entry.root, false);
  }

  const leftSurface = paneActiveToSurface("left", panes.left.active);
  await applySurface(leftSurface, { pane: "left", focus: focusedPane === "left" });
  if (panes.right && panes.right.tabKeys.length > 0) {
    const rightSurface = paneActiveToSurface("right", panes.right.active);
    await applySurface(rightSurface, { pane: "right", focus: focusedPane === "right" });
  }
  markWorkspaceTouched();
  leftTabStripHandle?.refresh();
  rightTabStripHandle?.refresh();
  navigationHistory.reset(captureNavigation());
}

function bootstrapShell(): void {
  releaseSharedOverlayNavigation?.();
  releaseSharedOverlayNavigation = setOverlayNavigationRegistrar((overlay) => {
    const entry = { owner: "shared-overlay", overlay };
    navigationOverlays.push(entry);
    return () => { const index = navigationOverlays.indexOf(entry); if (index >= 0) navigationOverlays.splice(index, 1); };
  });
  navigationInputAbort?.abort();
  navigationInputAbort = new AbortController();
  setInsightHistoryNavigator((direction) => { void navigateHistory(direction); });
  window.addEventListener("keydown", (event) => {
    if (!document.hasFocus() || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void navigateHistory(event.key === "ArrowLeft" ? -1 : 1);
  }, { capture: true, signal: navigationInputAbort.signal });
  bindMouseHistoryInput((direction) => { void navigateHistory(direction); }, { signal: navigationInputAbort.signal });
  const session = loadTabSession();
  tabStyle = session.style;
  if (hasRestorableSnapshot(session)) bootSnapshot = session;
  syncRestoreLayoutButton();
  void activateSurface({ type: "home" }, { pane: "left", focus: true, touch: false });
}

export function applyRestoredLayout(): void {
  const session = bootSnapshot ?? loadTabSession();
  if (!hasRestorableSnapshot(session)) return;
  void navigationChannel.run(() => applySession(session));
}

export function shellHasRestorableLayout(): boolean {
  return bootSnapshot !== null;
}

export function mountAdminShell(root: HTMLElement): void {
  if (!getInsightDestinations().length) throw new Error("no insight destinations registered");

  root.innerHTML = `
    <div class="admin-app">
      <div class="admin-shell insight-shell-grid" id="insightShellGrid">
        <header class="insight-chrome" data-tauri-drag-region>
          <div class="insight-chrome-controls" id="insightChromeControls">
            <div class="admin-brand">
              <div class="admin-titlebar-title">Orbita</div>
              <div class="admin-brand-subtitle">Insight</div>
            </div>
            <button type="button" class="admin-chat-rail-toggle no-drag" id="adminChatRailToggle" data-tauri-drag-region="false" aria-label="收起二级栏" hidden>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/></svg>
            </button>
          </div>
          <div id="adminLeftTabStripHost" class="insight-pane-tab-slot" data-pane="left"></div>
          <div id="adminRightTabStripHost" class="insight-pane-tab-slot" data-pane="right" hidden></div>
          <button type="button" class="insight-restore-layout no-drag" id="insightRestoreLayout" data-tauri-drag-region="false" hidden>恢复原有布局</button>
          <div class="insight-frame-controls-reserve" data-tauri-drag-region></div>
        </header>
        <nav class="admin-tabs" id="adminTabs">
          <div class="admin-tab-indicator" aria-hidden="true"></div>
        </nav>
        <aside class="insight-secondary-rail" id="insightSecondaryRail" hidden>
          <div class="insight-secondary-rail-inner">
            <div class="insight-chat-rail-bar">
              <div class="insight-chat-rail-title"></div>
            </div>
            <div class="insight-chat-rail-list scroll-slim" data-rail-content></div>
          </div>
        </aside>
        <div
          class="insight-rail-resize-hit no-drag"
          id="insightSecondaryRailResize"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整二级栏宽度"
          tabindex="0"
          data-tauri-drag-region="false"
          hidden
        ></div>
        <div class="insight-rail-boundary-line" aria-hidden="true"></div>
        <div class="insight-content-scroll" id="insightContentScroll">
        <main class="insight-pane-viewport" id="adminLeftViewport" data-pane="left" role="main"></main>
        <div class="insight-pane-divider-line" id="insightPaneDividerLine" hidden></div>
        <div
          class="insight-pane-resize-hit no-drag"
          id="insightPaneDivider"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整分栏宽度"
          data-tauri-drag-region="false"
          hidden
        ></div>
        <main class="insight-pane-viewport" id="adminRightViewport" data-pane="right" hidden></main>
        </div>
        <div class="insight-pane-group" id="insightPaneGroup"></div>
      </div>
    </div>`;

  applyInsightLightTheme(insightLightThemeFromSettings());
  const chatRailToggle = root.querySelector<HTMLButtonElement>("#adminChatRailToggle")!;
  restoreLayoutBtnEl = root.querySelector<HTMLButtonElement>("#insightRestoreLayout");

  nav = root.querySelector<HTMLElement>("#adminTabs")!;
  tabIndicator = nav.querySelector<HTMLElement>(".admin-tab-indicator");
  shellGrid = root.querySelector<HTMLElement>("#insightShellGrid")!;
  const chromeControls = root.querySelector<HTMLElement>("#insightChromeControls")!;
  paneGroup = root.querySelector<HTMLElement>("#insightPaneGroup")!;
  paneDivider = root.querySelector<HTMLElement>("#insightPaneDivider")!;
  paneDividerLine = root.querySelector<HTMLElement>("#insightPaneDividerLine")!;
  leftViewport = root.querySelector<HTMLElement>("#adminLeftViewport")!;
  rightViewport = root.querySelector<HTMLElement>("#adminRightViewport")!;
  leftPaneEl = leftViewport;
  rightPaneEl = rightViewport;
  leftTabStripSlot = root.querySelector<HTMLElement>("#adminLeftTabStripHost")!;
  rightTabStripSlot = root.querySelector<HTMLElement>("#adminRightTabStripHost")!;
  const secondaryRailEl = root.querySelector<HTMLElement>("#insightSecondaryRail")!;
  const secondaryRailResize = root.querySelector<HTMLElement>("#insightSecondaryRailResize")!;

  let scheduleGeometry = () => {};
  secondaryRail = createSecondaryRailController({
    toggle: chatRailToggle,
    railHost: secondaryRailEl,
    railResize: secondaryRailResize,
    onGeometryChange: () => scheduleGeometry(),
    getEffectiveWidth: () => geometry?.last()?.R ?? 0,
    getEffectiveMin: () => RAIL_MIN,
    getEffectiveMax: () => {
      const last = geometry?.last();
      if (!last) return RAIL_MAX;
      return Math.max(RAIL_MIN, Math.min(RAIL_MAX, last.Rbudget));
    },
  });
  liveHostCtx.secondaryRail = secondaryRail;

  geometry?.dispose();
  geometry = createShellGeometryController({
    varTarget: shellGrid,
    shell: shellGrid,
    primaryNav: nav,
    chromeControls,
    getIntent: () => ({
      railExpanded: secondaryRail?.isUserExpanded() ?? false,
      Rpreferred: secondaryRail?.preferredWidth() ?? 0,
      rightVisible: hasRightPane(),
      leftDesired: currentLeftDesired(),
    }),
    onApplied: (geo) => {
      secondaryRail?.syncChrome();
      if (paneDivider) {
        paneDivider.setAttribute("aria-valuenow", `${Math.round(geo.leftWidth)}`);
        paneDivider.setAttribute("aria-valuetext", `${Math.round(geo.leftWidth)} 像素`);
        paneDivider.setAttribute(
          "aria-valuemax",
          `${Math.max(PANE_MIN, geo.leftWidth + geo.rightWidth - PANE_MIN)}`,
        );
      }
      leftTabStripHandle?.refresh();
      rightTabStripHandle?.refresh();
    },
  });
  scheduleGeometry = () => geometry?.scheduleGeometry();

  mountPaneDividerResize(paneDivider!);
  dragSession = mountDragSession({
    paneGroup: paneGroup!,
    getHasRightPane: () => Boolean(panes.right && panes.right.tabKeys.length > 0),
    getLeftStripList: () =>
      leftTabStripSlot?.querySelector<HTMLElement>(".insight-tab-strip-list") ?? null,
    getRightStripList: () =>
      rightTabStripSlot?.querySelector<HTMLElement>(".insight-tab-strip-list") ?? null,
    getTabKeys: (pane) => {
      const state = getPaneStateOrNull(pane);
      return state?.tabKeys ?? [];
    },
    getTabRecord: (key) => tabsByKey.get(key),
    paneForTabKey,
    openToPane: openContentTabToPane,
    moveTab: (key, targetPane, index) => {
      if (!tabsByKey.has(key)) return false;
      moveTab(key, targetPane, index);
      return true;
    },
    getLeftViewport: () => leftViewport,
    getRightViewport: () => rightViewport,
    getOverlayHost: () => document.body,
  });
  registerDragSession(dragSession);
  mountTabStripHosts(leftTabStripSlot!, rightTabStripSlot!);
  geometry?.applyNow();

  leftViewport.addEventListener("pointerdown", () => {
    void focusPane("left");
  });
  rightViewport?.addEventListener("pointerdown", () => {
    void focusPane("right");
  });
  const chatBtn = document.createElement("button");
  chatBtn.type = "button";
  chatBtn.className = "admin-quick-btn";
  chatBtn.dataset.nav = "chat";
  chatBtn.title = "对话";
  chatBtn.setAttribute("aria-label", "对话");
  chatBtn.innerHTML = `<span class="admin-tab-icon">${QUICK_CHAT_SVG}</span><span class="admin-tab-label">对话</span>`;
  chatBtn.addEventListener("click", () => {
    navigateFromSidebar({ kind: "chat", id: insightChatScratchId() });
  });
  nav.appendChild(chatBtn);

  const projectBtn = document.createElement("button");
  projectBtn.type = "button";
  projectBtn.className = "admin-quick-btn";
  projectBtn.dataset.nav = "project";
  projectBtn.title = "项目";
  projectBtn.setAttribute("aria-label", "项目");
  projectBtn.innerHTML = `<span class="admin-tab-icon">${QUICK_PROJECT_SVG}</span><span class="admin-tab-label">项目</span>`;
  projectBtn.addEventListener("click", () => {
    navigateFromSidebar({ kind: "project-index" });
  });
  nav.appendChild(projectBtn);

  const taskBtn = document.createElement("button");
  taskBtn.type = "button";
  taskBtn.className = "admin-quick-btn";
  taskBtn.dataset.nav = "task";
  taskBtn.title = "安排";
  taskBtn.setAttribute("aria-label", "安排");
  taskBtn.innerHTML = `<span class="admin-tab-icon">${QUICK_TASK_SVG}</span><span class="admin-tab-label">安排</span>`;
  taskBtn.addEventListener("click", () => {
    navigateFromSidebar({ kind: "task-view" });
  });
  nav.appendChild(taskBtn);

  const healthBtn = document.createElement("button");
  healthBtn.type = "button";
  healthBtn.className = "admin-quick-btn";
  healthBtn.dataset.nav = "health";
  healthBtn.title = "健康";
  healthBtn.setAttribute("aria-label", "健康");
  healthBtn.innerHTML = `<span class="admin-tab-icon">${DOMAIN_ICONS.health}</span><span class="admin-tab-label">健康</span>`;
  healthBtn.addEventListener("click", () => {
    void activateSurface({ type: "fixed", dest: "health" });
  });
  nav.appendChild(healthBtn);

  const financeBtn = document.createElement("button");
  financeBtn.type = "button";
  financeBtn.className = "admin-quick-btn";
  financeBtn.dataset.nav = "finance";
  financeBtn.title = "记账";
  financeBtn.setAttribute("aria-label", "记账");
  financeBtn.innerHTML = `<span class="admin-tab-icon">${QUICK_FINANCE_SVG}</span><span class="admin-tab-label">记账</span>`;
  financeBtn.addEventListener("click", () => {
    void activateSurface({ type: "fixed", dest: "finance" });
  });
  nav.appendChild(financeBtn);

  const finance1Btn = document.createElement("button");
  finance1Btn.type = "button";
  finance1Btn.className = "admin-quick-btn";
  finance1Btn.dataset.nav = "finance1";
  finance1Btn.title = "记账1";
  finance1Btn.setAttribute("aria-label", "记账1");
  finance1Btn.innerHTML = `<span class="admin-tab-icon">${QUICK_FINANCE_SVG}</span><span class="admin-tab-label">记账1</span>`;
  finance1Btn.addEventListener("click", () => {
    void activateSurface({ type: "fixed", dest: "finance1" });
  });
  nav.appendChild(finance1Btn);

  for (const item of [
    { nav: "map", title: "地图", icon: QUICK_MAP_SVG },
    { nav: "record", title: "记录", icon: QUICK_RECORD_SVG },
    { nav: "debug", title: "调试", icon: QUICK_DEBUG_SVG },
  ]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-quick-btn";
    btn.dataset.nav = item.nav;
    btn.title = item.title;
    btn.setAttribute("aria-label", item.title);
    btn.innerHTML = `<span class="admin-tab-icon">${item.icon}</span><span class="admin-tab-label">${item.title}</span>`;
    if (item.nav === "debug") {
      btn.addEventListener("click", () => navigateFromSidebar({ kind: "control-gallery" }));
    }
    nav.appendChild(btn);
  }

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "admin-settings-nav-btn";
  settingsBtn.id = "adminSettingsNavBtn";
  settingsBtn.title = "设置";
  settingsBtn.setAttribute("aria-label", "设置");
  settingsBtn.innerHTML = `<span class="admin-tab-icon">${SETTINGS_GEAR_SVG}</span><span class="admin-tab-label">设置</span>`;
  settingsBtn.addEventListener("click", () => {
    openInsightSettings();
  });
  nav.appendChild(settingsBtn);
  updateSidebarForSurface(getFocusedActiveSurface());
  geometry?.scheduleGeometry();


  window.addEventListener("resize", () => {
    const active = nav!.querySelector<HTMLButtonElement>(".admin-tab-btn.is-active");
    if (active) moveTabIndicator(nav!, active);
  });

  setHostDataDirGuard(async (reason) => {
    window.dispatchEvent(new Event("orbita:insight-abort-chat"));
    if (
      !(await confirmAbandonDrafts(
        "切换数据目录",
        "有未保存的修改。继续编辑将保留标签与草稿。",
      ))
    ) {
      return false;
    }
    return canDisposeAll(reason);
  });

  setTabStripStyleHandler((style) => {
    tabStyle = style;
    markWorkspaceTouched();
    persistSession();
    leftTabStripHandle?.refresh();
    rightTabStripHandle?.refresh();
  });

  restoreLayoutBtnEl?.addEventListener("click", () => {
    applyRestoredLayout();
  });
  setLayoutRestorer(shellHasRestorableLayout, applyRestoredLayout);

  setProjectDeletedHandler((projectId) => {
    const tab = findTabByIdentity({ kind: "project", id: projectId });
    const entry = tab ? cache.get(tab.key) : undefined;
    if (!entry || !tab) return;
    void (async () => {
      try {
        await entry.handle.activate();
      } catch (error) {
        console.error("Deleted project surface refresh failed", error);
        const focused = getFocusedActiveSurface();
        if (focused.type === "content" && focused.key === tab.key) {
          await showSurfaceActivationError("页面刷新失败", error);
        }
      }
    })();
  });

  unbindDataDir?.();
  unbindDataDir = bindDataDirChanged(
    createIdempotentDataDirHandler((stamp) => {
      void onDataDirChanged(stamp);
    }),
  );

  setContentTabOpener(openContentTab);
  setContentTabCloser((key) => {
    void closeContentTab(key);
  });
  setTaskViewStateSelector(selectTaskViewState);
  setTimelineActivator(() => {
    void activateSurface({ type: "fixed", dest: "timeline" });
  });

  void listen<string>("insight-external-navigation", (ev) => {
    const identity = httpWebIdentity(typeof ev.payload === "string" ? ev.payload : "");
    if (!identity) return;
    openContentTab(identity, defaultTabTitle(identity));
  });

  const navigationHostInstanceId = crypto.randomUUID();
  let navigationClaimBusy = false;
  let navigationClaimAgain = false;
  const claimAndRoutePanelItem = async (): Promise<void> => {
    navigationClaimAgain = true;
    if (navigationClaimBusy) return;
    navigationClaimBusy = true;
    try {
      while (navigationClaimAgain) {
        navigationClaimAgain = false;
        const request = await claimInsightItemNavigation({ hostInstanceId: navigationHostInstanceId });
        if (!request) continue;
        openContentTab({ kind: "task-view" }, defaultTabTitle({ kind: "task-view" }));
        const tab = findTabByIdentity({ kind: "task-view" });
        if (!tab) continue;
        await activateSurface({ type: "content", key: tab.key }, { pane: paneForTabKey(tab.key) ?? "left", focus: true });
        await cache.get(tab.key)?.handle.processPendingNavigation?.(request, navigationHostInstanceId);
      }
    } finally { navigationClaimBusy = false; }
  };
  void (async () => {
    try {
      await listen("insight-item-navigation-requested", () => {
        void claimAndRoutePanelItem().catch((error) => showSurfaceActivationError("打开 Panel 任务失败", error));
      });
    } catch (error) {
      await showSurfaceActivationError("Panel 任务导航监听启动失败", error);
      return;
    }
    // Subscribe first, then probe once for a request accepted before this shell was ready.
    try { await claimAndRoutePanelItem(); }
    catch (error) { await showSurfaceActivationError("打开 Panel 任务失败", error); }
  })();

  window.addEventListener("orbita:journal-entry-created", (ev) => {
    const detail = (ev as CustomEvent<{ draftId: string; entryId: string; title: string }>).detail;
    if (!detail?.draftId || !detail.entryId) return;
    syncJournalTabAfterCreate(detail.draftId, detail.entryId, detail.title);
  });

  window.addEventListener("orbita:insight-tab-title", (ev) => {
    const detail = (ev as CustomEvent<{ surfaceKey: string; title: string }>).detail;
    if (!detail?.surfaceKey || !detail.title) return;
    syncContentTabTitle(detail.surfaceKey, detail.title);
  });

  window.addEventListener("orbita:insight-conversation-deleted", (ev) => {
    const id = (ev as CustomEvent<{ id: string }>).detail?.id;
    if (!id) return;
    const tab = [...tabsByKey.values()].find((t) => t.identity.kind === "chat" && t.identity.id === id);
    if (tab) void closeContentTab(tab.key);
  });

  window.addEventListener("orbita:settings-changed", () => {
    applyInsightLightTheme(insightLightThemeFromSettings());
  });

  window.addEventListener("beforeunload", (e) => {
    persistSession();
    if (anyBlockingDraft()) {
      e.preventDefault();
      e.returnValue = "";
      return;
    }
    releaseThemeEditForHostChange();
    navigationInputAbort?.abort();
    setInsightHistoryNavigator(null);
    releaseSharedOverlayNavigation?.(); releaseSharedOverlayNavigation = null;
  });

  bootstrapShell();
}

export async function requestInsightDataDirChange(): Promise<boolean> {
  const ok = await canProceedWithDataDirChange();
  if (ok) markLocalDataDirSwitchAuthorized();
  else clearLocalDataDirSwitchAuthorized();
  return ok;
}

export function cancelInsightDataDirChange(): void {
  clearLocalDataDirSwitchAuthorized();
}

export function presentInsightDataDirFault(message: string): void {
  dataDirFaultMessage = message;
  pauseInsightDomainWrites();
}
