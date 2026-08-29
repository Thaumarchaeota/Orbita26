import {
  defaultDetailFilter,
  resetDetailFilter,
  setAllTypesFilter,
  toggleTypeFilter,
} from "../domain/filter-apply";
import { CARD_DETAIL_FIXTURES } from "./fixtures";
import {
  createFilterDeriveScheduler,
  deriveFilteredItems,
  freezeFilterSnapshot,
  isFilterCommand,
  type MutableFilter,
} from "./filter-render-derive";
import type {
  CardDetailCommand,
  CardDetailSnapshot,
  CardDetailStore,
} from "./types";

/** Phase A fixture store; tests and static previews. */
export function createCardDetailSnapshotStore(): CardDetailStore {
  const filter = defaultDetailFilter() as MutableFilter;
  const listeners = new Set<() => void>();
  const filterListeners = new Set<() => void>();
  const renderedListeners = new Set<() => void>();
  const deriveScheduler = createFilterDeriveScheduler();
  let disposed = false;
  let cachedFilterSnapshot = freezeFilterSnapshot(filter);
  let cachedRenderedSnapshot: CardDetailSnapshot | null = null;

  function notifyRendered(): void {
    for (const listener of renderedListeners) listener();
    for (const listener of listeners) listener();
  }

  function notifyFilter(): void {
    for (const listener of filterListeners) listener();
  }

  function buildSnapshot(): CardDetailSnapshot {
    const items = deriveFilteredItems(CARD_DETAIL_FIXTURES, filter);
    return Object.freeze({
      items,
      loadState: "ready" as const,
      error: null,
      filter: cachedFilterSnapshot,
      savePhase: "unedited" as const,
      isDirty: false,
      validationErrors: Object.freeze([]),
      globalValidationErrors: Object.freeze([]),
      globalValidationError: null,
      focusRequest: null,
      balanceAudit: Object.freeze({
        loadState: "ready" as const,
        error: null,
        accounts: Object.freeze([]),
      }),
    });
  }

  function recomputeRendered(): void {
    cachedRenderedSnapshot = buildSnapshot();
  }

  function scheduleFilterDerive(): void {
    deriveScheduler.schedule(() => {
      recomputeRendered();
      notifyRendered();
    });
  }

  function publishFilterInput(): void {
    cachedFilterSnapshot = freezeFilterSnapshot(filter);
    notifyFilter();
    scheduleFilterDerive();
  }

  recomputeRendered();

  function getSnapshot(): CardDetailSnapshot {
    const base = cachedRenderedSnapshot!;
    if (base.filter === cachedFilterSnapshot) return base;
    return Object.freeze({ ...base, filter: cachedFilterSnapshot });
  }

  function flushRenderedDerive(): void {
    deriveScheduler.flush();
  }

  function getFilterSnapshot() {
    return cachedFilterSnapshot;
  }

  function dispatch(command: CardDetailCommand): void {
    if (disposed) return;
    switch (command.type) {
      case "set-date-from":
        filter.dateFrom = command.value;
        break;
      case "set-date-to":
        filter.dateTo = command.value;
        break;
      case "set-date-range":
        filter.dateFrom = command.from;
        filter.dateTo = command.to;
        break;
      case "set-type-mode":
        filter.typeMode = command.mode;
        if (command.mode === "all") filter.types.clear();
        break;
      case "toggle-type":
        toggleTypeFilter(filter, command.stripeKind);
        break;
      case "set-all-types":
        setAllTypesFilter(filter);
        break;
      case "set-accounts":
        filter.accounts.clear();
        for (const account of command.accounts) filter.accounts.add(account);
        break;
      case "set-account-mode":
        filter.accountMode = command.mode;
        break;
      case "set-tags":
        filter.tags.clear();
        for (const tag of command.tags) filter.tags.add(tag);
        break;
      case "set-tag-mode":
        filter.tagMode = command.mode;
        break;
      case "reset-filters":
        resetDetailFilter(filter);
        break;
      default:
        break;
    }
    if (isFilterCommand(command.type)) {
      publishFilterInput();
      return;
    }
    recomputeRendered();
    notifyRendered();
  }

  return {
    getSnapshot,
    getFilterSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeFilter(listener) {
      filterListeners.add(listener);
      return () => filterListeners.delete(listener);
    },
    subscribeRendered(listener) {
      renderedListeners.add(listener);
      return () => renderedListeners.delete(listener);
    },
    dispatch,
    async handleSave() {},
    consumeMergeFocus() {
      return "";
    },
    dispose() {
      disposed = true;
      deriveScheduler.dispose();
      listeners.clear();
      filterListeners.clear();
      renderedListeners.clear();
    },
    flushRenderedDerive,
  };
}
