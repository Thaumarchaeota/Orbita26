import type { CsvImportOrder } from "../domain/csv-import";
import { isTransactionItem } from "../domain/detail-item";
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
  updateEntryField,
  getDetailItems,
  onAfterCommitFilter,
} from "../state/ledger";
import type { AccountStats, CandidateDiagnostic, DetailItem } from "../types";
import { fetchStats, formatLedgerNetworkError } from "../api/client";
import { collectGlobalValidationMessages } from "../domain/validation-errors";
import { runCardStoreSave } from "./card-store-save";
import { ALL_FILTERABLE_STRIPE_KINDS } from "./filter-kinds";
import type { FilterableStripeKind } from "./filter-kinds";
import { resolveStripeKind } from "./stripe-kind";
import { cloneFrozenDetailItems } from "./snapshot-freeze";
import type {
  BalanceAuditSnapshot,
  CardDetailCommand,
  CardDetailLoadState,
  CardDetailSnapshot,
  CardDetailStore,
} from "./types";

type MutableFilter = {
  dateFrom: string;
  dateTo: string;
  types: Set<FilterableStripeKind>;
};

function freezeFilter(filter: MutableFilter) {
  return Object.freeze({
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    types: new Set(filter.types) as ReadonlySet<FilterableStripeKind>,
  });
}

function applyStripeTypeFilter(items: DetailItem[], types: Set<FilterableStripeKind>): DetailItem[] {
  if (!types.size || types.size >= ALL_FILTERABLE_STRIPE_KINDS.length) return items;
  return items.filter((item) => {
    if (!isTransactionItem(item)) return true;
    const kind = resolveStripeKind(item);
    return types.has(kind as FilterableStripeKind);
  });
}

function applyFilter(items: DetailItem[], filter: MutableFilter): DetailItem[] {
  let next = items;
  if (filter.dateFrom) next = next.filter((item) => item.date >= filter.dateFrom);
  if (filter.dateTo) next = next.filter((item) => item.date <= filter.dateTo);
  next = applyStripeTypeFilter(next, filter.types);
  return next;
}

function toggleStripeKind(types: Set<FilterableStripeKind>, stripeKind: FilterableStripeKind): void {
  if (!types.size) {
    for (const kind of ALL_FILTERABLE_STRIPE_KINDS) {
      if (kind !== stripeKind) types.add(kind);
    }
    return;
  }
  if (types.has(stripeKind)) types.delete(stripeKind);
  else types.add(stripeKind);
  if (types.size >= ALL_FILTERABLE_STRIPE_KINDS.length) types.clear();
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
  const filter: MutableFilter = { dateFrom: "", dateTo: "", types: new Set() };
  const listeners = new Set<() => void>();
  let disposed = false;
  let validationErrors: CandidateDiagnostic[] = [];
  let globalValidationErrors: string[] = [];
  let globalValidationError: string | null = null;
  let focusRequest: string | null = null;
  let mergeFocusId = "";
  let commitEditRef = options.commitEdit;
  let balanceAccounts: AccountStats[] = [];
  let balanceLoadState: BalanceAuditSnapshot["loadState"] = "idle";
  let balanceError: string | null = null;
  let balanceLoadGen = 0;

  function notify(): void {
    if (disposed) return;
    for (const listener of listeners) listener();
  }

  const unsubLedger = onDetailMutated(notify);
  const unsubSave = onSavePhaseChanged(notify);

  async function reloadBalanceAudit(): Promise<void> {
    const gen = ++balanceLoadGen;
    balanceLoadState = "loading";
    balanceError = null;
    notify();
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
    notify();
  }

  void reloadBalanceAudit();

  function getSnapshot(): CardDetailSnapshot {
    const rawLoadState = getLoadState();
    const error = getLoadError();
    const filtered = applyFilter(getDetailItems(), filter);
    const items = cloneFrozenDetailItems(filtered);
    return Object.freeze({
      items,
      loadState: resolveCardLoadState(rawLoadState, items.length, error),
      error,
      filter: freezeFilter(filter),
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

  function setValidationErrors(errors: CandidateDiagnostic[]): void {
    validationErrors = errors;
    globalValidationErrors = collectGlobalValidationMessages(errors);
    globalValidationError = globalValidationErrors[0] ?? null;
    const focusId = errors.find((e) => e.item_ids?.[0])?.item_ids?.[0];
    if (focusId) focusRequest = focusId;
    notify();
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
      case "toggle-type":
        toggleStripeKind(filter.types, command.stripeKind);
        break;
      case "reset-filters":
        filter.dateFrom = "";
        filter.dateTo = "";
        filter.types.clear();
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
        filter.dateFrom = "";
        filter.dateTo = "";
        filter.types.clear();
        mergeFocusId = mergeCsvBatch(command.drafts, command.orderMode);
        if (!mergeFocusId) break;
        validationErrors = [];
        globalValidationErrors = [];
        globalValidationError = null;
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
    notify();
  }

  async function handleSave(): Promise<void> {
    await runCardStoreSave(
      {
        onValidationErrors: setValidationErrors,
        onSavePhaseChange: notify,
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

  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    handleSave,
    consumeMergeFocus() {
      const id = mergeFocusId;
      mergeFocusId = "";
      return id;
    },
    dispose() {
      disposed = true;
      balanceLoadGen++;
      unsubLedger();
      unsubSave();
      listeners.clear();
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
  };
}
