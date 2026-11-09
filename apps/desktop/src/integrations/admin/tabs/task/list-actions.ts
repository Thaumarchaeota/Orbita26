import { mountSearchableCascadingMenu, type SearchableCascadingMenuHandle, type SearchableCascadingMenuItem } from "../../../../ui/searchable-cascading-menu";
import {
  productivityBatchDeleteItems,
  productivityBatchMoveItemsToList,
  productivityGetTravel,
} from "../../../productivity/client";
import type { BatchDeleteItem, ItemSnapshot, ListSnapshot, RevisionRef } from "../../../productivity/types";

/** Cascading List picker for moving items; production list moves use the item context menu. */
export type ListMoveTarget = Pick<ListSnapshot, "id" | "title" | "revision">;

export function mountListMoveMenu(options: {
  anchor: HTMLElement;
  lists: readonly ListMoveTarget[];
  includeInbox?: boolean;
  onSelect: (listId: string | null) => void;
}): SearchableCascadingMenuHandle {
  const items: SearchableCascadingMenuItem[] = [];
  if (options.includeInbox !== false) items.push({ value: "__inbox", label: "Inbox" });
  items.push(...options.lists.map((list) => ({ value: list.id, label: list.title })));
  const handle = mountSearchableCascadingMenu({
    anchor: options.anchor,
    items,
    onSelect: (value) => options.onSelect(value === "__inbox" ? null : value),
  });
  return handle;
}

export function itemRefs(items: readonly Pick<ItemSnapshot, "id" | "revision">[]): RevisionRef[] {
  return items.map((item) => ({ id: item.id, expectedRevision: item.revision }));
}

/** One transaction for the whole selection; callers refresh from the returned snapshots. */
export function moveItemsToList(
  items: readonly Pick<ItemSnapshot, "id" | "revision">[],
  list: ListMoveTarget | null,
  expectedDataDir: string,
) {
  return productivityBatchMoveItemsToList({
    expectedDataDir,
    items: itemRefs(items),
    list: list ? { id: list.id, expectedRevision: list.revision } : null,
  });
}

export type DeleteItemsResult =
  { kind: "items"; response: Awaited<ReturnType<typeof productivityBatchDeleteItems>> };

export type PreparedDeleteItems = { expectedDataDir: string; items: BatchDeleteItem[] };

/** Fetches Travel members before the confirmation dialog is shown. */
export async function prepareDeleteItems(
  items: readonly Pick<ItemSnapshot, "id" | "revision" | "travelKind">[],
  expectedDataDir: string,
): Promise<PreparedDeleteItems> {
  const prepared = await Promise.all(items.map(async (item) => {
    const travel = item.travelKind ? await productivityGetTravel({ itemId: item.id, includeDeleted: false }) : null;
    return {
      item: { id: item.id, expectedRevision: item.revision },
      expectedActions: travel?.actions.map((action) => ({ id: action.id, expectedRevision: action.revision })) ?? [],
    } satisfies BatchDeleteItem;
  }));
  return { expectedDataDir, items: prepared };
}

/** One atomic transaction for all selected Items, including Travel aggregates. */
export async function deleteItems(
  items: readonly Pick<ItemSnapshot, "id" | "revision" | "travelKind">[],
  options?: { expectedDataDir?: string; prepared?: PreparedDeleteItems },
): Promise<DeleteItemsResult> {
  const prepared = options?.prepared ?? await prepareDeleteItems(items, options?.expectedDataDir ?? "");
  if (!prepared.expectedDataDir) throw new Error("删除任务缺少数据目录版本");
  const response = await productivityBatchDeleteItems(prepared);
  return { kind: "items", response };
}
