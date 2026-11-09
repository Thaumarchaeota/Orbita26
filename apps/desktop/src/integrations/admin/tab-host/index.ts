export type {
  FixedDestId,
  ContentTabIdentity,
  ActiveSurface,
  ContentTabRecord,
  PaneId,
  LeftPaneActive,
  PaneState,
  WorkspacePanes,
} from "./identity";
export {
  contentTabKey,
  defaultTabTitle,
  destForIdentity,
  destStateForIdentity,
  fixedSurfaceKey,
  identitiesEqual,
  newBlankIdentity,
  newTabInstanceKey,
  httpWebIdentity,
} from "./identity";

export type { TabSession, TabSessionV1, TabStripStyle, PaneSnapshot } from "./session-persist";
export {
  loadTabSession,
  saveTabSession,
  clearTabSession,
  emptyTabSession,
  sanitizeTabSession,
  sanitizeTabRecord,
  sanitizeActiveSurface,
  hasRestorableSnapshot,
  sessionToWorkspacePanes,
} from "./session-persist";

export type { DirtyStatus } from "./dirty";
export { setDirtyStatus, getDirtyStatus, anyBlockingDraft, waitInFlight, waitAllInFlight, clearAllDirty } from "./dirty";

export type { TabReorderOptions, TabReorderHandle } from "./reorder";
export {
  computeInsertIndex,
  reorderKeys,
  siblingTranslateX,
  mountTabReorder,
} from "./reorder";

export type { TabStripCallbacks, TabStripHandle, TabStripOptions } from "./tab-strip";
export { mountTabStrip } from "./tab-strip";

export {
  setContentTabOpener,
  setContentTabCloser,
  openInsightContentTab,
  closeInsightContentTab,
  setTaskViewScopeSelector,
  selectTaskViewScope,
  setTaskViewStateSelector,
  selectTaskViewState,
  setTimelineActivator,
  setLayoutRestorer,
  hasRestorableLayout,
  applyRestoredLayout,
} from "./host-api";
export type { TaskViewState } from "./host-api";
