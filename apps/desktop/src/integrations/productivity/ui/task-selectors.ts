import type { ItemOrderSnapshot, ItemSnapshot, ListSnapshot } from "../types";

export type TaskScope =
  | { kind: "all" }
  | { kind: "inbox" }
  | { kind: "list"; listId: string }
  | { kind: "archived-index" }
  | { kind: "archived-list"; listId: string };

export type ScopeVisibility = {
  showCompleted: boolean;
  showCancelled: boolean;
};

export type TaskDataSlice = {
  lists: ListSnapshot[];
  items: ItemSnapshot[];
  itemOrder: ItemOrderSnapshot | null;
};

export function liveLists(lists: ListSnapshot[]): ListSnapshot[] {
  return lists.filter((l) => !l.deletedAtUtc);
}

export function activeLists(lists: ListSnapshot[]): ListSnapshot[] {
  return liveLists(lists).filter((l) => l.status !== "已归档");
}

export function archivedLists(lists: ListSnapshot[]): ListSnapshot[] {
  return liveLists(lists).filter((l) => l.status === "已归档");
}

export function liveItems(items: ItemSnapshot[]): ItemSnapshot[] {
  return items.filter((i) => !i.deletedAtUtc);
}

export function orderedLiveItems(order: ItemOrderSnapshot, items: ItemSnapshot[]): ItemSnapshot[] {
  const map = new Map(liveItems(items).map((i) => [i.id, i]));
  const out: ItemSnapshot[] = [];
  for (const id of order.orderedItemIds) {
    const hit = map.get(id);
    if (hit) {
      out.push(hit);
      map.delete(id);
    }
  }
  for (const item of map.values()) out.push(item);
  return out;
}

function archivedListIds(lists: ListSnapshot[]): Set<string> {
  return new Set(archivedLists(lists).map((l) => l.id));
}

function itemMatchesScope(item: ItemSnapshot, scope: TaskScope, archived: Set<string>): boolean {
  switch (scope.kind) {
    case "all":
      if (!item.listId) return true;
      return !archived.has(item.listId);
    case "inbox":
      return item.listId == null;
    case "list":
      return item.listId === scope.listId;
    case "archived-list":
      return item.listId === scope.listId;
    case "archived-index":
      return false;
  }
}

export function applyVisibility(items: ItemSnapshot[], visibility: ScopeVisibility): ItemSnapshot[] {
  return items.filter((item) => {
    if (!visibility.showCompleted && item.status === "完成") return false;
    if (!visibility.showCancelled && item.status === "取消") return false;
    return true;
  });
}

export function itemsForScopeUnfiltered(scope: TaskScope, store: TaskDataSlice): ItemSnapshot[] {
  const archived = archivedListIds(store.lists);
  const ordered = store.itemOrder
    ? orderedLiveItems(store.itemOrder, store.items)
    : liveItems(store.items);
  return ordered.filter((item) => !item.deletedAtUtc && itemMatchesScope(item, scope, archived));
}

export function itemsForScope(
  scope: TaskScope,
  store: TaskDataSlice,
  visibility: ScopeVisibility,
): ItemSnapshot[] {
  return applyVisibility(itemsForScopeUnfiltered(scope, store), visibility);
}

export function scopeKey(scope: TaskScope): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "inbox":
      return "inbox";
    case "list":
      return scope.listId;
    case "archived-index":
      return "archived";
    case "archived-list":
      return `archived:${scope.listId}`;
  }
}

export function scopeToRestoreFilter(scope: TaskScope): string | undefined {
  switch (scope.kind) {
    case "all":
      return undefined;
    case "inbox":
      return "inbox";
    case "list":
      return scope.listId;
    case "archived-index":
      return "archived";
    case "archived-list":
      return `archived:${scope.listId}`;
  }
}

export function filterToScope(filter?: string): TaskScope {
  if (!filter) return { kind: "all" };
  if (filter === "inbox") return { kind: "inbox" };
  if (filter === "archived") return { kind: "archived-index" };
  if (filter.startsWith("archived:")) return { kind: "archived-list", listId: filter.slice("archived:".length) };
  return { kind: "list", listId: filter };
}

export function listIdForNewItem(scope: TaskScope): string | null {
  if (scope.kind === "list") return scope.listId;
  return null;
}

export function isScopeReadOnly(scope: TaskScope): boolean {
  return scope.kind === "archived-list";
}
