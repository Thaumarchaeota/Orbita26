import { isTransactionItem } from "../domain/detail-item";
import type { DetailItem } from "../types";
import { accountMatchesPrefix } from "./account-tree";
import { ALL_FILTERABLE_STRIPE_KINDS } from "../surface/filter-kinds";
import type { FilterableStripeKind } from "../surface/filter-kinds";
import { resolveStripeKind } from "../surface/stripe-kind";

export type TypeFilterMode = "all" | "selected";
export type SetMatchMode = "or" | "and";

export type DetailFilterState = {
  dateFrom: string;
  dateTo: string;
  typeMode: TypeFilterMode;
  types: ReadonlySet<FilterableStripeKind>;
  accounts: ReadonlySet<string>;
  accountMode: SetMatchMode;
  tags: ReadonlySet<string>;
  tagMode: SetMatchMode;
};

export function defaultDetailFilter(): DetailFilterState {
  return {
    dateFrom: "",
    dateTo: "",
    typeMode: "all",
    types: new Set(),
    accounts: new Set(),
    accountMode: "or",
    tags: new Set(),
    tagMode: "or",
  };
}

function postingAccounts(item: DetailItem): string[] {
  if (!isTransactionItem(item)) {
    if (item.kind === "balance" || item.kind === "pad") return [item.account];
    return [];
  }
  return item.postings.map((p) => p.account).filter(Boolean);
}

function itemTags(item: DetailItem): string[] {
  if (!isTransactionItem(item)) return [];
  const raw = (item.tags || "").trim();
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean);
}

function matchesAccountFilter(item: DetailItem, filter: DetailFilterState): boolean {
  if (!filter.accounts.size) return true;
  const targets = postingAccounts(item);
  if (!targets.length) return false;

  const hit = (prefix: string) => targets.some((a) => accountMatchesPrefix(a, prefix));

  if (filter.accountMode === "or") {
    for (const prefix of filter.accounts) {
      if (hit(prefix)) return true;
    }
    return false;
  }

  for (const prefix of filter.accounts) {
    if (!hit(prefix)) return false;
  }
  return true;
}

function matchesTagFilter(item: DetailItem, filter: DetailFilterState): boolean {
  if (!filter.tags.size) return true;
  if (!isTransactionItem(item)) return false;
  const tags = itemTags(item);
  if (!tags.length) return false;
  if (filter.tagMode === "or") {
    for (const t of filter.tags) {
      if (tags.includes(t)) return true;
    }
    return false;
  }
  for (const t of filter.tags) {
    if (!tags.includes(t)) return false;
  }
  return true;
}

function matchesTypeFilter(item: DetailItem, filter: DetailFilterState): boolean {
  if (filter.typeMode === "all") return true;
  if (!filter.types.size) return false;
  const kind = resolveStripeKind(item);
  return filter.types.has(kind);
}

export function applyDetailFilter(items: DetailItem[], filter: DetailFilterState): DetailItem[] {
  let next = items;
  if (filter.dateFrom) next = next.filter((item) => item.date >= filter.dateFrom);
  if (filter.dateTo) next = next.filter((item) => item.date <= filter.dateTo);
  next = next.filter((item) => matchesTypeFilter(item, filter));
  next = next.filter((item) => matchesAccountFilter(item, filter));
  next = next.filter((item) => matchesTagFilter(item, filter));
  return next;
}

export function isFilterActive(filter: DetailFilterState): boolean {
  return (
    !!filter.dateFrom ||
    !!filter.dateTo ||
    filter.typeMode === "selected" ||
    filter.accounts.size > 0 ||
    filter.tags.size > 0
  );
}

export function allTypesSelected(): ReadonlySet<FilterableStripeKind> {
  return new Set(ALL_FILTERABLE_STRIPE_KINDS);
}

export function toggleTypeFilter(
  filter: { typeMode: TypeFilterMode; types: Set<FilterableStripeKind> },
  stripeKind: FilterableStripeKind,
): void {
  if (filter.typeMode === "all") {
    filter.typeMode = "selected";
    filter.types.clear();
    for (const kind of ALL_FILTERABLE_STRIPE_KINDS) {
      if (kind !== stripeKind) filter.types.add(kind);
    }
    return;
  }
  if (filter.types.has(stripeKind)) filter.types.delete(stripeKind);
  else filter.types.add(stripeKind);
}

export function setAllTypesFilter(
  filter: { typeMode: TypeFilterMode; types: Set<FilterableStripeKind> },
): void {
  filter.typeMode = "all";
  filter.types.clear();
}

export function resetDetailFilter(
  filter: DetailFilterState & {
    types: Set<FilterableStripeKind>;
    accounts: Set<string>;
    tags: Set<string>;
  },
): void {
  const defaults = defaultDetailFilter();
  filter.dateFrom = defaults.dateFrom;
  filter.dateTo = defaults.dateTo;
  filter.typeMode = defaults.typeMode;
  filter.types.clear();
  filter.accounts.clear();
  filter.accountMode = defaults.accountMode;
  filter.tags.clear();
  filter.tagMode = defaults.tagMode;
}

export function isSingleDayFilter(filter: DetailFilterState): string | null {
  if (filter.dateFrom && filter.dateTo && filter.dateFrom === filter.dateTo) return filter.dateFrom;
  if (filter.dateFrom && !filter.dateTo) return filter.dateFrom;
  if (!filter.dateFrom && filter.dateTo) return filter.dateTo;
  return null;
}
