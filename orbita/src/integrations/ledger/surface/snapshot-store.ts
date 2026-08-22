import { isTransactionItem } from "../domain/detail-item";
import type { DetailItem } from "../types";
import { ALL_FILTERABLE_STRIPE_KINDS } from "./filter-kinds";
import type { FilterableStripeKind } from "./filter-kinds";
import { resolveStripeKind } from "./stripe-kind";
import { CARD_DETAIL_FIXTURES } from "./fixtures";
import { cloneFrozenDetailItems } from "./snapshot-freeze";
import type {
  CardDetailCommand,
  CardDetailSnapshot,
  CardDetailStore,
} from "./types";

type MutableFilter = {
  dateFrom: string;
  dateTo: string;
  types: Set<FilterableStripeKind>;
};

function applyFilter(items: DetailItem[], filter: MutableFilter): DetailItem[] {
  let next = items;
  if (filter.dateFrom) next = next.filter((item) => item.date >= filter.dateFrom);
  if (filter.dateTo) next = next.filter((item) => item.date <= filter.dateTo);
  if (filter.types.size && filter.types.size < ALL_FILTERABLE_STRIPE_KINDS.length) {
    next = next.filter((item) => {
      if (!isTransactionItem(item)) return true;
      const kind = resolveStripeKind(item);
      return filter.types.has(kind as FilterableStripeKind);
    });
  }
  return next;
}

function freezeFilter(filter: MutableFilter) {
  return Object.freeze({
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    types: new Set(filter.types) as ReadonlySet<FilterableStripeKind>,
  });
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

/** Phase A fixture store; tests and static previews. */
export function createCardDetailSnapshotStore(): CardDetailStore {
  const filter: MutableFilter = { dateFrom: "", dateTo: "", types: new Set() };
  const listeners = new Set<() => void>();
  let disposed = false;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function getSnapshot(): CardDetailSnapshot {
    const items = cloneFrozenDetailItems(applyFilter(CARD_DETAIL_FIXTURES, filter));
    return Object.freeze({
      items,
      loadState: "ready" as const,
      error: null,
      filter: freezeFilter(filter),
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
      default:
        break;
    }
    notify();
  }

  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    async handleSave() {},
    consumeMergeFocus() {
      return "";
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
