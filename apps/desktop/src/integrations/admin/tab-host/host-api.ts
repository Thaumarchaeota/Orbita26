import type { ContentTabIdentity } from "./identity";
import { defaultTabTitle } from "./identity";
import type { TabStripStyle } from "./session-persist";

export type OpenInsightContentTabOptions = { focusTaskId?: string };
export type ProjectTaskFocusPageRequest = { kind: "focus-project-task"; projectId: string; taskId: string; generation: number };

let opener: ((identity: ContentTabIdentity, title?: string, options?: OpenInsightContentTabOptions) => void) | null = null;
let closer: ((key?: string) => void) | null = null;
let tabStripStyleSetter: ((style: TabStripStyle) => void) | null = null;
let projectDeletedHandler: ((projectId: string) => void) | null = null;
export type TaskViewState = { view: "week" } | { view: "list"; filter: string };
let taskViewStateSelector: ((state: TaskViewState) => void) | null = null;
let timelineActivator: (() => void) | null = null;
let hasRestorableLayoutFn: (() => boolean) | null = null;
let applyRestoredLayoutFn: (() => void) | null = null;
let historyNavigator: ((direction: -1 | 1) => void) | null = null;

export function setInsightHistoryNavigator(fn: ((direction: -1 | 1) => void) | null): void {
  historyNavigator = fn;
}

/** Keyboard and a verified window-local native input bridge share this entry. */
export function navigateInsightHistory(direction: -1 | 1): void {
  historyNavigator?.(direction);
}

export function setLayoutRestorer(has: () => boolean, apply: () => void): void {
  hasRestorableLayoutFn = has;
  applyRestoredLayoutFn = apply;
}

export function hasRestorableLayout(): boolean {
  return hasRestorableLayoutFn?.() ?? false;
}

export function applyRestoredLayout(): void {
  applyRestoredLayoutFn?.();
}

export function setContentTabOpener(fn: (identity: ContentTabIdentity, title?: string, options?: OpenInsightContentTabOptions) => void): void {
  opener = fn;
}

export function setContentTabCloser(fn: (key?: string) => void): void {
  closer = fn;
}

export function setTaskViewStateSelector(fn: (state: TaskViewState) => void): void {
  taskViewStateSelector = fn;
}

export function setTaskViewScopeSelector(fn: (filter: string) => void): void {
  taskViewStateSelector = (state) => {
    if (state.view === "list") fn(state.filter);
  };
}

export function selectTaskViewState(state: TaskViewState): void {
  taskViewStateSelector?.(state);
}

export function selectTaskViewScope(filter: string): void {
  selectTaskViewState({ view: "list", filter });
}

export function setTimelineActivator(fn: () => void): void {
  timelineActivator = fn;
}

export function openInsightContentTab(identity: ContentTabIdentity, title?: string, options?: OpenInsightContentTabOptions): void {
  if (identity.kind === "fixed" && identity.dest === "timeline") {
    timelineActivator?.();
    return;
  }
  if (identity.kind === "fixed" && identity.dest === "work") {
    opener?.({ kind: "task-view" }, title ?? defaultTabTitle({ kind: "task-view" }));
    return;
  }
  if (identity.kind === "list") {
    opener?.(identity, title ?? defaultTabTitle({ kind: "task-view" }));
    return;
  }
  if (options?.focusTaskId && identity.kind !== "project") return;
  opener?.(identity, title, options);
}

export function closeInsightContentTab(key?: string): void {
  closer?.(key);
}

export function setTabStripStyleHandler(fn: (style: TabStripStyle) => void): void {
  tabStripStyleSetter = fn;
}

export function setTabStripStyle(style: TabStripStyle): void {
  tabStripStyleSetter?.(style);
}

export function setProjectDeletedHandler(fn: (projectId: string) => void): void {
  projectDeletedHandler = fn;
}

export function markProjectDeleted(projectId: string): void {
  projectDeletedHandler?.(projectId);
}
