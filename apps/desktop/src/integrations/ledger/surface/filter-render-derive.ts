import {
  applyDetailFilter,
  type DetailFilterState,
} from "../domain/filter-apply";
import type { FilterableStripeKind } from "./filter-kinds";
import { cloneFrozenDetailItems } from "./snapshot-freeze";
import type { DetailItem } from "../types";
import type { CardDetailFilterSnapshot } from "./types";

export type MutableFilter = DetailFilterState & {
  types: Set<FilterableStripeKind>;
  accounts: Set<string>;
  tags: Set<string>;
};

export function freezeFilterSnapshot(filter: MutableFilter): CardDetailFilterSnapshot {
  return Object.freeze({
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    typeMode: filter.typeMode,
    types: new Set(filter.types) as ReadonlySet<FilterableStripeKind>,
    accounts: new Set(filter.accounts),
    accountMode: filter.accountMode,
    tags: new Set(filter.tags),
    tagMode: filter.tagMode,
  });
}

export function deriveFilteredItems(
  source: readonly DetailItem[],
  filter: MutableFilter,
): readonly DetailItem[] {
  return cloneFrozenDetailItems(applyDetailFilter(source, filter));
}

export type FilterDeriveScheduler = {
  schedule: (run: () => void) => void;
  flush: () => void;
  dispose: () => void;
};

export function createFilterDeriveScheduler(): FilterDeriveScheduler {
  let rafId: number | null = null;
  let pending: (() => void) | null = null;

  const flush = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const run = pending;
    pending = null;
    run?.();
  };

  return {
    schedule(run) {
      pending = run;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        flush();
      });
    },
    flush,
    dispose() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      pending = null;
    },
  };
}

export function isFilterCommand(type: string): boolean {
  switch (type) {
    case "set-date-from":
    case "set-date-to":
    case "set-date-range":
    case "set-type-mode":
    case "toggle-type":
    case "set-all-types":
    case "set-accounts":
    case "set-account-mode":
    case "set-tags":
    case "set-tag-mode":
    case "reset-filters":
      return true;
    default:
      return false;
  }
}
