import {
  createNewTransaction,
  getLoadError,
  getLoadState,
  getSavePhase,
  isLedgerDirty,
  isSemanticMutationBlocked,
  mergeCsvBatch,
  onDetailMutated,
  onSavePhaseChanged,
  softDeleteEntry,
  tryLoadOlder,
  undoDeleteEntry,
  revertDetailToBaseline,
  updateEntryField,
  getDetailItems,
  onAfterCommitFilter,
} from "../state/ledger";
import type { AccountStats, CandidateDiagnostic, DetailItem } from "../types";
import { fetchStats, formatLedgerNetworkError } from "../api/client";
import { collectGlobalValidationMessages } from "../domain/validation-errors";
import { runCardStoreSave } from "./card-store-save";
import {
  defaultDetailFilter,
  resetDetailFilter,
  setAllTypesFilter,
  toggleTypeFilter,
} from "../domain/filter-apply";
import {
  createFilterDeriveScheduler,
  deriveFilteredItems,
  freezeFilterSnapshot,
  isFilterCommand,
  type MutableFilter,
} from "./filter-render-derive";
import type {
  BalanceAuditSnapshot,
  CardDetailCommand,
  CardDetailLoadState,
  CardDetailSnapshot,
  CardDetailStore,
} from "./types";

function createMutableFilter(): MutableFilter {
  const defaults = defaultDetailFilter();
  return {
    dateFrom: defaults.dateFrom,
    dateTo: defaults.dateTo,
    typeMode: defaults.typeMode,
    types: new Set(),
    accounts: new Set(),
    accountMode: defaults.accountMode,
    tags: new Set(),
    tagMode: defaults.tagMode,
  };
}

function resolveCardLoadState(
  rawLoadState: ReturnType<typeof getLoadState>,
  itemCount: number,
  error: string | null,
): CardDetailLoadState {
  if (error && itemCount === 0 && rawLoadState === "loading") return "error";
  if (rawLoadState === "loading" && itemCount === 0) return "loading";
  if (rawLoadState === "partial" || (rawLoadState === "loading" && itemCount > 0)) return "partial";
  return "ready";
}

export type LedgerCardStoreOptions = {
  commitEdit?: () => void;
  onBeforeReload?: (removedIds: string[]) => Promise<void>;
  onCommitSuccess?: (removedIds: string[]) => Promise<void>;
  shake?: () => Promise<void>;
};

/** Phase C: facade over ledger-store; views dispatch commands only. */
export function createLedgerCardStore(options: LedgerCardStoreOptions = {}): CardDetailStore {
  const filter = createMutableFilter();
  const listeners = new Set<() => void>();
  const filterListeners = new Set<() => void>();
  const renderedListeners = new Set<() => void>();
  const deriveScheduler = createFilterDeriveScheduler();
  let disposed = false;
  let validationErrors: CandidateDiagnostic[] = [];
  let globalValidationErrors: string[] = [];
  let globalValidationError: string | null = null;
  let focusRequest: string | null = null;
  let mergeFocusId = "";
  let commitEditRef = options.commitEdit;
  let dismissEditRef: (() => void) | undefined;
  let balanceAccounts: AccountStats[] = [];
  let balanceLoadState: BalanceAuditSnapshot["loadState"] = "idle";
  let balanceError: string | null = null;
  let balanceLoadGen = 0;
  let cachedFilterSnapshot = freezeFilterSnapshot(filter);
  let cachedRenderedSnapshot: CardDetailSnapshot | null = null;
  let deriveCount = 0;

  function notifyRendered(): void {
    if (disposed) return;
    for (const listener of renderedListeners) listener();
    for (const listener of listeners) listener();
  }

  function notifyFilter(): void {
    if (disposed) return;
    for (const listener of filterListeners) listener();
  }

  function notifyMeta(): void {
    if (disposed) return;
    notifyRendered();
  }

  function buildSnapshot(items: readonly DetailItem[]): CardDetailSnapshot {
    const rawLoadState = getLoadState();
    const error = getLoadError();
    return Object.freeze({
      items,
      loadState: resolveCardLoadState(rawLoadState, items.length, error),
      error,
      filter: cachedFilterSnapshot,
      savePhase: getSavePhase(),
      isDirty: isLedgerDirty(),
      validationErrors: Object.freeze([...validationErrors]),
      globalValidationErrors: Object.freeze([...globalValidationErrors]),
      globalValidationError,
      focusRequest,
      balanceAudit: Object.freeze({
        loadState: balanceLoadState,
        error: balanceError,
        accounts: Object.freeze([...balanceAccounts]),
      }),
    });
  }

  function recomputeRendered(): void {
    deriveCount += 1;
    const items = deriveFilteredItems(getDetailItems(), filter);
    cachedRenderedSnapshot = buildSnapshot(items);
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

  const unsubLedger = onDetailMutated(() => {
    recomputeRendered();
    notifyRendered();
  });
  const unsubSave = onSavePhaseChanged(() => {
    if (cachedRenderedSnapshot) {
      cachedRenderedSnapshot = buildSnapshot(cachedRenderedSnapshot.items);
    }
    notifyMeta();
  });

  async function reloadBalanceAudit(): Promise<void> {
    const gen = ++balanceLoadGen;
    balanceLoadState = "loading";
    balanceError = null;
    notifyMeta();
    try {
      const data = await fetchStats();
      if (disposed || gen !== balanceLoadGen) return;
      balanceAccounts = data.accounts ?? [];
      balanceLoadState = "ready";
      balanceError = null;
    } catch (err) {
      if (disposed || gen !== balanceLoadGen) return;
      balanceLoadState = "error";
      balanceError = formatLedgerNetworkError(err, "/api/stats");
      balanceAccounts = [];
    }
    if (cachedRenderedSnapshot) {
      cachedRenderedSnapshot = buildSnapshot(cachedRenderedSnapshot.items);
    }
    notifyMeta();
  }

  void reloadBalanceAudit();

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

  function setValidationErrors(errors: CandidateDiagnostic[]): void {
    validationErrors = errors;
    globalValidationErrors = collectGlobalValidationMessages(errors);
    globalValidationError = globalValidationErrors[0] ?? null;
    const focusId = errors.find((e) => e.item_ids?.[0])?.item_ids?.[0];
    if (focusId) focusRequest = focusId;
    if (cachedRenderedSnapshot) {
      cachedRenderedSnapshot = buildSnapshot(cachedRenderedSnapshot.items);
    }
    notifyMeta();
  }

  function dispatch(command: CardDetailCommand): void {
    if (disposed) return;
    let filterOnly = isFilterCommand(command.type);
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
      case "update-entry": {
        if (isSemanticMutationBlocked()) break;
        if (updateEntryField(command.id, command.patch).ok) {
          validationErrors = [];
          globalValidationErrors = [];
          globalValidationError = null;
        }
        break;
      }
      case "soft-delete": {
        if (isSemanticMutationBlocked()) break;
        if (softDeleteEntry(command.id).ok) {
          validationErrors = [];
          globalValidationErrors = [];
          globalValidationError = null;
        }
        break;
      }
      case "undo-delete": {
        if (isSemanticMutationBlocked()) break;
        if (undoDeleteEntry(command.id).ok) {
          validationErrors = [];
          globalValidationErrors = [];
          globalValidationError = null;
        }
        break;
      }
      case "create-transaction": {
        if (isSemanticMutationBlocked()) break;
        const id = createNewTransaction(command.draft);
        if (!id) break;
        validationErrors = [];
        globalValidationErrors = [];
        globalValidationError = null;
        focusRequest = id;
        break;
      }
      case "merge-csv": {
        if (isSemanticMutationBlocked()) break;
        resetDetailFilter(filter);
        mergeFocusId = mergeCsvBatch(command.drafts, command.orderMode);
        if (!mergeFocusId) break;
        validationErrors = [];
        globalValidationErrors = [];
        globalValidationError = null;
        filterOnly = false;
        break;
      }
      case "clear-validation-errors":
        validationErrors = [];
        globalValidationErrors = [];
        globalValidationError = null;
        break;
      case "consume-focus":
        focusRequest = null;
        break;
    }
    if (filterOnly) {
      publishFilterInput();
      return;
    }
    cachedFilterSnapshot = freezeFilterSnapshot(filter);
    recomputeRendered();
    notifyRendered();
    if (command.type === "reset-filters" || command.type === "merge-csv") {
      notifyFilter();
    }
  }

  async function handleSave(): Promise<void> {
    await runCardStoreSave(
      {
        onValidationErrors: setValidationErrors,
        onSavePhaseChange: notifyMeta,
        onBeforeReload: options.onBeforeReload,
        onCommitSuccess: async (removedIds) => {
          await options.onCommitSuccess?.(removedIds);
          void reloadBalanceAudit();
        },
        shake: options.shake ?? (async () => {}),
      },
      commitEditRef,
    );
  }

  function revertAllEdits(): boolean {
    dismissEditRef?.();
    const result = revertDetailToBaseline();
    if (!result.ok) return false;
    validationErrors = [];
    globalValidationErrors = [];
    globalValidationError = null;
    focusRequest = null;
    recomputeRendered();
    notifyRendered();
    return true;
  }

  const store: CardDetailStore & { __testDeriveCount?: () => number } = {
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
    handleSave,
    revertAllEdits,
    consumeMergeFocus() {
      const id = mergeFocusId;
      mergeFocusId = "";
      return id;
    },
    dispose() {
      disposed = true;
      balanceLoadGen++;
      deriveScheduler.dispose();
      unsubLedger();
      unsubSave();
      listeners.clear();
      filterListeners.clear();
      renderedListeners.clear();
    },
    tryLoadOlder: () => tryLoadOlder(),
    onAfterCommit: (fn) => {
      const unsub = onAfterCommitFilter(() => {
        fn();
        void reloadBalanceAudit();
      });
      return unsub;
    },
    setCommitEdit(fn: () => void) {
      commitEditRef = fn;
    },
    setDismissEdit(fn: () => void) {
      dismissEditRef = fn;
    },
    __testDeriveCount: () => deriveCount,
    flushRenderedDerive,
  };

  return store;
}

export function __testFlushFilterDerive(store: CardDetailStore): void {
  const flush = (store as CardDetailStore & { flushRenderedDerive?: () => void }).flushRenderedDerive;
  flush?.();
}
