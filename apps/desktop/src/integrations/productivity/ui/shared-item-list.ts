import { escAttr, escHtml } from "../../../core/html";
import { createCheckbox, setCheckbox, setCheckboxWithCompletionFeedback } from "../../../ui/checkbox";
import { mountFlatSelectPopover, type FlatSelectPopoverHandle } from "../../../ui/flat-select-popover";
import {
  productivityCreateItem,
  productivityCreateItemAfter,
  productivityDeleteItem,
  productivityMoveItemToListAndPlace,
  productivityReorderItems,
  productivitySetItemStatus,
  productivityUpdateItem,
} from "../client";
import type { ActionSnapshot, CreateItemAfterResponse, CreateItemRequest, CreateItemAfterRequest, ItemOrderSnapshot, ItemSnapshot, RevisionRef, UpdateItemRequest, SetItemStatusRequest, DeleteItemRequest, ReorderItemsRequest, ReorderItemsResponse, MoveItemToListAndPlaceRequest, MoveItemToListAndPlaceResponse, ItemResponse } from "../types";
import { ITEM_ORDER_ROOT_ID } from "../types";
import {
  archivedLists,
  itemsForScope,
  itemsForScopeUnfiltered,
  listIdForNewItem,
  type ScopeVisibility,
  type TaskDataSlice,
  type TaskScope,
} from "./task-selectors";

function invokeErrorText(err: unknown): string {
  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err);
  try { const parsed = JSON.parse(raw) as { message?: string }; if (parsed.message) return parsed.message; } catch { /* plain domain error */ }
  return raw;
}

function isRevisionConflict(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) return (err as { code: string }).code === "REVISION_CONFLICT";
  return invokeErrorText(err).includes("REVISION_CONFLICT");
}

type ContextMenuNode = { value: string; label: string; children?: ContextMenuNode[] };

export type ItemListState = "loading" | "load-error" | "empty" | "filtered-empty" | "content";

export type ItemListBinding = {
  render: () => void;
  isEditing: () => boolean;
  resetContext: () => void;
  moveToList: (itemId: string, targetKey: string) => Promise<void>;
  dispose: () => void;
};

export type MountItemListOpts = {
  host: HTMLElement;
  getScope: () => TaskScope;
  getStore: () => TaskDataSlice;
  getVisibility: () => ScopeVisibility;
  getLoading: () => boolean;
  getLoadError: () => string | null;
  onStoreChange: (store: TaskDataSlice) => void;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
  onSelectArchivedList: (listId: string) => void;
  onSelectList: (listId: string) => void;
  onOpenItem?: (item: ItemSnapshot, returnFocus?: HTMLElement | null) => void;
  onUnarchiveList?: (list: import("../types").ListSnapshot) => Promise<import("../types").ListSnapshot | null>;
  onConfirmDelete?: (returnFocus?: HTMLElement, context?: unknown) => Promise<boolean>;
  onBeforeEdit?: () => Promise<void>;
  onEndEdit?: () => void;
  onSelectItem?: (itemId: string) => void;
  /** Current task-list selection. Context-menu actions use the whole set when the clicked row is inside it. */
  getSelectedItemIds?: () => ReadonlySet<string>;
  onDeleteSelected?: (itemIds: readonly string[], context?: unknown) => Promise<void>;
  getAddLists?: () => readonly { id: string; title: string }[];
  getCategoryMenu?: (keepTypeIds: readonly string[]) => readonly ContextMenuNode[];
  onAddToList?: (itemIds: readonly string[], listId: string | null, context?: unknown) => Promise<void>;
  onSetCategory?: (itemIds: readonly string[], itemTypeId: string | null, context?: unknown) => Promise<void>;
  getDateRange?: () => { start: string; end: string } | null;
  getDateRangeInstants?: () => { start: number; end: number } | null;
  getActions?: () => ActionSnapshot[];
  onRender?: () => void;
  dateFilter?: "insight-action" | "panel-any-source";
  captureWriteContext?: () => unknown;
  validateWriteContext?: (context: unknown) => void;
  /** Panel supplies epoch-bound domain writers; Insight keeps its established adapters. */
  writers?: {
    create: (req: CreateItemRequest, context?: unknown) => Promise<ItemResponse>;
    createAfter: (req: CreateItemAfterRequest, context?: unknown) => Promise<CreateItemAfterResponse>;
    update: (req: UpdateItemRequest, context?: unknown) => Promise<ItemResponse>;
    setStatus: (req: SetItemStatusRequest, context?: unknown) => Promise<ItemResponse>;
    delete: (req: DeleteItemRequest, context?: unknown) => Promise<ItemResponse>;
    reorder: (req: ReorderItemsRequest, context?: unknown) => Promise<ReorderItemsResponse>;
    move: (req: MoveItemToListAndPlaceRequest, context?: unknown) => Promise<MoveItemToListAndPlaceResponse>;
  };
};

const writers = (opts: MountItemListOpts): NonNullable<MountItemListOpts["writers"]> => opts.writers ?? {
  create: productivityCreateItem, createAfter: productivityCreateItemAfter, update: productivityUpdateItem,
  setStatus: productivitySetItemStatus, delete: productivityDeleteItem, reorder: productivityReorderItems,
  move: productivityMoveItemToListAndPlace,
};
const captureWriteContext = (opts: MountItemListOpts) => opts.captureWriteContext?.();
const validateWriteContext = (opts: MountItemListOpts, context: unknown) => opts.validateWriteContext?.(context);

function memberRefs(items: ItemSnapshot[]): RevisionRef[] {
  return items.map((i) => ({ id: i.id, expectedRevision: i.revision }));
}

function isArchivedReadonlyError(err: unknown): boolean {
  const text = invokeErrorText(err);
  return text.includes("ARCHIVED_LIST_READONLY");
}

function resolveCreateListId(scope: TaskScope, anchor: ItemSnapshot | undefined): string | null {
  if (scope.kind === "list") return scope.listId;
  if (anchor) return anchor.listId ?? null;
  return listIdForNewItem(scope);
}

function createListIdMismatch(scope: TaskScope, anchor: ItemSnapshot | undefined, _listId: string | null): boolean {
  if (!anchor) return false;
  const anchorListId = anchor.listId ?? null;
  if (scope.kind === "list") return anchorListId !== scope.listId;
  if (scope.kind === "inbox") return anchorListId !== null;
  return false;
}

const POINTER_DRAG_THRESHOLD = 4;

export function mountItemList(opts: MountItemListOpts): ItemListBinding {
  const { host } = opts;
  function visibleItems(scope = opts.getScope()): ItemSnapshot[] {
    const items = itemsForScope(scope, opts.getStore(), opts.getVisibility());
    const range = opts.getDateRange?.();
    if (!range) return items;
    const instants = opts.getDateRangeInstants?.();
    const start = instants?.start ?? Date.parse(`${range.start}T00:00:00Z`);
    const end = instants?.end ?? Date.parse(`${range.end}T00:00:00Z`) + 86_400_000;
    const matching = new Set((opts.getActions?.() ?? []).filter((action) => action.targetKind === "item" && action.plannedStartAt && action.plannedEndAt
      && (opts.dateFilter !== "panel-any-source" || !action.deletedAtUtc && Date.parse(action.plannedEndAt) > Date.parse(action.plannedStartAt))
      && Date.parse(action.plannedStartAt) < end && Date.parse(action.plannedEndAt) > start).map((action) => action.targetId));
    if (opts.dateFilter === "panel-any-source") {
      return items.filter((item) => {
        if (matching.has(item.id)) return true;
        return [item.plannedPoint, item.duePoint].some((point) => {
          if (!point) return false;
          if (point.precision === "date") return point.date >= range.start && point.date <= range.end;
          const instant = Date.parse(point.atUtc);
          return Number.isFinite(instant) && instant >= start && instant < end;
        });
      });
    }
    return items.filter((item) => matching.has(item.id));
  }
  let editingId: string | null = null;
  let editWriteContext: unknown;
  let inlineDraft: { afterId?: string; title: string } | null = null;
  let dragItemId: string | null = null;
  let dragWriteContext: unknown;
  let dropBeforeId: string | null = null;
  let pointerDrag = false;
  let pointerEditStart: { x: number; y: number } | null = null;
  let suppressTitleEditClick = false;
  let disposed = false;
  let submitting = false;
  let ignoreFocusOut = false;
  const statusPending = new Set<string>();
  const titleSaves = new Map<string, { title: string; promise: Promise<boolean> }>();
  let ctxMenu: FlatSelectPopoverHandle | null = null;
  let ctxMenuAnchor: HTMLElement | null = null;
  let ctxMenuTrigger: HTMLElement | null = null;
  let openItemClickTimer = 0;

  function dispatchDragStart(itemId: string): void {
    window.dispatchEvent(new CustomEvent("task-item-drag-start", { detail: { itemId } }));
  }

  function dispatchDragEnd(): void {
    window.dispatchEvent(new Event("task-item-drag-end"));
  }

  function resolveState(): ItemListState {
    if (opts.getLoading()) return "loading";
    if (opts.getLoadError()) return "load-error";
    const scope = opts.getScope();
    if (scope.kind === "archived-index") return "content";
    const unfiltered = itemsForScopeUnfiltered(scope, opts.getStore());
    if (!unfiltered.length && !inlineDraft) return "empty";
    const visible = visibleItems(scope);
    if (!visible.length && !inlineDraft) return "filtered-empty";
    return "content";
  }

  function applyOrderResponse(itemOrder: ItemOrderSnapshot, items: ItemSnapshot[]): void {
    opts.onStoreChange({ ...opts.getStore(), itemOrder, items });
  }

  function rowSelector(itemId: string): string {
    return `.task-item-row[data-item-id="${CSS.escape(itemId)}"]`;
  }

  function setRowPending(itemId: string, pending: boolean): void {
    const row = host.querySelector<HTMLElement>(rowSelector(itemId));
    if (!row) {
      render();
      return;
    }
    row.classList.toggle("is-pending", pending);
    const check = row.querySelector<HTMLButtonElement>(".task-item-check");
    if (check) {
      check.setAttribute("aria-busy", String(pending));
      if (pending) check.setAttribute("aria-disabled", "true");
      else check.removeAttribute("aria-disabled");
    }
  }

  const completeHolds = new Map<string, number>();

  function clearCompleteHold(itemId: string): void {
    const timer = completeHolds.get(itemId);
    if (timer !== undefined) window.clearTimeout(timer);
    completeHolds.delete(itemId);
    const row = host.querySelector<HTMLElement>(rowSelector(itemId));
    row?.classList.remove("is-complete-hold", "is-settling", "is-leaving");
  }

  function syncRowDoneVisual(itemId: string, done: boolean): void {
    const row = host.querySelector<HTMLElement>(rowSelector(itemId));
    if (!row) return;
    row.classList.remove("is-pending");
    const holding = completeHolds.has(itemId);
    row.classList.toggle("is-done", done && !holding);
    const check = row.querySelector<HTMLButtonElement>(".task-item-check");
    if (check) {
      check.disabled = false;
      check.removeAttribute("aria-disabled");
      check.removeAttribute("aria-busy");
      setCheckbox(check, done);
    }
    row.querySelectorAll<HTMLElement>(".task-item-title, .task-item-title-input, .task-item-detail-btn").forEach((el) => {
      el.classList.toggle("is-done", done && !holding);
    });
  }

  function beginCompleteHold(itemId: string): void {
    clearCompleteHold(itemId);
    const row = host.querySelector<HTMLElement>(rowSelector(itemId));
    if (!row) return;
    row.classList.remove("is-pending", "is-done", "is-settling", "is-leaving");
    row.classList.add("is-complete-hold");
    const check = row.querySelector<HTMLButtonElement>(".task-item-check");
    if (check) {
      check.disabled = false;
      check.removeAttribute("aria-disabled");
      check.removeAttribute("aria-busy");
      setCheckbox(check, true);
    }
    row.querySelectorAll<HTMLElement>(".task-item-title, .task-item-title-input, .task-item-detail-btn").forEach((el) => {
      el.classList.remove("is-done");
    });
    const timer = window.setTimeout(() => settleComplete(itemId), 5000);
    completeHolds.set(itemId, timer);
  }

  function settleComplete(itemId: string): void {
    completeHolds.delete(itemId);
    const row = host.querySelector<HTMLElement>(rowSelector(itemId));
    if (!row || !row.classList.contains("is-complete-hold")) return;
    row.classList.add("is-settling", "is-done");
    row.classList.remove("is-complete-hold");
    row.querySelectorAll<HTMLElement>(".task-item-title, .task-item-title-input, .task-item-detail-btn").forEach((el) => {
      el.classList.add("is-done");
    });
    const stillVisible = visibleItems().some((i) => i.id === itemId);
    if (stillVisible) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      if (!row.isConnected) return;
      row.classList.add("is-leaving");
      const remove = () => {
        if (row.isConnected) row.remove();
      };
      if (reduced) {
        remove();
        return;
      }
      const onEnd = (e: TransitionEvent) => {
        if (e.target !== row || e.propertyName !== "max-height") return;
        row.removeEventListener("transitionend", onEnd);
        remove();
      };
      row.addEventListener("transitionend", onEnd);
      window.setTimeout(remove, 320);
    }, reduced ? 0 : 280);
  }

  function patchItem(item: ItemSnapshot): void {
    const store = opts.getStore();
    opts.onStoreChange({
      ...store,
      items: store.items.map((i) => (i.id === item.id ? item : i)),
    });
  }

  function resolveInsertAfterId(): string | undefined {
    if (!inlineDraft) return undefined;
    if (inlineDraft.afterId) return inlineDraft.afterId;
    const visible = visibleItems();
    if (!visible.length) return undefined;
    return visible[visible.length - 1]?.id;
  }

  async function saveTitle(itemId: string, title: string): Promise<boolean> {
    const nextTitle = title.trim();
    const ongoing = titleSaves.get(itemId);
    if (ongoing) {
      if (ongoing.title === nextTitle) return ongoing.promise;
      return ongoing.promise.then(() => saveTitle(itemId, nextTitle));
    }
    const item = opts.getStore().items.find((i) => i.id === itemId);
    if (!item) return false;
    if (item.title === nextTitle) return true;

    const save = (async (): Promise<boolean> => {
      try {
        const res = await writers(opts).update({
          item: { id: item.id, expectedRevision: item.revision },
          patch: { title: nextTitle },
        }, editWriteContext);
        patchItem(res.item);
        opts.onError("");
        return true;
      } catch (err) {
        if (isRevisionConflict(err)) {
          opts.onError("任务内容已变化");
          await opts.onReload();
        } else if (isArchivedReadonlyError(err)) {
          opts.onError("归档清单中的任务不可修改");
        } else {
          opts.onError(invokeErrorText(err));
        }
        return false;
      }
    })();
    let tracked: Promise<boolean>;
    tracked = save.finally(() => {
      if (titleSaves.get(itemId)?.promise === tracked) titleSaves.delete(itemId);
    });
    titleSaves.set(itemId, { title: nextTitle, promise: tracked });
    return tracked;
  }

  async function submitDraft(): Promise<void> {
    if (!inlineDraft || submitting) return;
    const title = inlineDraft.title.trim();
    if (!title) return;
    const scope = opts.getScope();
    const store = opts.getStore();
    const insertAfterItemId = resolveInsertAfterId();
    const anchor = insertAfterItemId
      ? store.items.find((i) => i.id === insertAfterItemId)
      : undefined;
    const listId = resolveCreateListId(scope, anchor);
    if (createListIdMismatch(scope, anchor, listId)) {
      opts.onError("任务归属与当前范围不一致，无法在此创建");
      return;
    }
    const draftSnapshot = { ...inlineDraft, title };
    submitting = true;
    try {
      if (insertAfterItemId && store.itemOrder) {
        const res = await writers(opts).createAfter({
          title,
          status: "进行中",
          listId,
          priority: "none",
          insertAfterItemId,
          itemOrder: { id: ITEM_ORDER_ROOT_ID, expectedRevision: store.itemOrder.revision },
          expectedMembers: memberRefs(store.items.filter((i) => !i.deletedAtUtc)),
        }, editWriteContext);
        applyOrderResponse(res.itemOrder, res.items);
        opts.onError("");
        await openDraftAfter(res.item.id);
      } else if (!insertAfterItemId) {
        const res = await writers(opts).create({
          title,
          status: "进行中",
          listId,
          priority: "none",
        }, editWriteContext);
        inlineDraft = null;
        opts.onEndEdit?.();
        const nextItems = [...store.items.filter((i) => i.id !== res.item.id), res.item];
        opts.onStoreChange({ ...store, items: nextItems });
        await opts.onReload();
      }
    } catch (err) {
      try { validateWriteContext(opts, editWriteContext); }
      catch { inlineDraft = null; return; }
      inlineDraft = draftSnapshot;
      if (isRevisionConflict(err)) {
        opts.onError("任务内容已变化");
        await opts.onReload();
      } else if (isArchivedReadonlyError(err)) {
        opts.onError("归档清单中的任务不可创建");
      } else {
        opts.onError(invokeErrorText(err));
      }
      render();
      host.querySelector<HTMLInputElement>(".task-create-input, .task-item-draft-input")?.focus();
    } finally {
      submitting = false;
      opts.onEndEdit?.();
    }
  }

  async function prepareEdit(): Promise<boolean> {
    const context = captureWriteContext(opts);
    try {
      await opts.onBeforeEdit?.();
      validateWriteContext(opts, context);
      editWriteContext = context;
      return true;
    }
    catch (error) { opts.onError(invokeErrorText(error)); return false; }
  }

  async function openDraftAfter(itemId: string): Promise<void> {
    if (!(await prepareEdit())) return;
    if (disposed) return;
    inlineDraft = { afterId: itemId, title: "" };
    render();
    host.querySelector<HTMLInputElement>(".task-create-input, .task-item-draft-input")?.focus();
  }

  async function openCreateDraft(): Promise<void> {
    if (!(await prepareEdit())) return;
    if (disposed) return;
    inlineDraft = { title: "" };
    render();
    host.querySelector<HTMLInputElement>(".task-create-input")?.focus();
  }

  function openDetail(item: ItemSnapshot, returnFocus?: HTMLElement | null): void {
    if (!opts.onOpenItem) return;
    opts.onOpenItem(item, returnFocus);
  }

  async function deleteItem(item: ItemSnapshot, context?: unknown): Promise<void> {
    try {
      validateWriteContext(opts, context);
      await writers(opts).delete({
        item: { id: item.id, expectedRevision: item.revision },
      }, context);
      opts.onError("");
      await opts.onReload();
      render();
    } catch (err) {
      if (isRevisionConflict(err)) {
        opts.onError("任务内容已变化");
        await opts.onReload();
      } else if (isArchivedReadonlyError(err)) {
        opts.onError("归档清单中的任务不可删除");
      } else {
        opts.onError(invokeErrorText(err));
      }
      render();
    }
  }

  function contextTargets(item: ItemSnapshot): ItemSnapshot[] {
    const selected = opts.getSelectedItemIds?.();
    if (!selected || selected.size < 2 || !selected.has(item.id)) return [item];
    const store = opts.getStore();
    return [...selected]
      .map((id) => store.items.find((candidate) => candidate.id === id && !candidate.deletedAtUtc))
      .filter((candidate): candidate is ItemSnapshot => Boolean(candidate));
  }

  function menuNodes(nodes: readonly ContextMenuNode[]): ContextMenuNode[] {
    return nodes.map((node) => {
      const children = node.children?.length ? menuNodes(node.children) : undefined;
      return { value: node.value || "__no_category", label: node.label, ...(children ? { children } : {}) };
    });
  }

  function showItemContextMenu(item: ItemSnapshot, x: number, y: number, trigger: HTMLElement): void {
    ctxMenu?.dispose();
    ctxMenuAnchor?.remove();
    const anchor = document.createElement("span");
    anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px;opacity:0;pointer-events:none`;
    document.body.appendChild(anchor);
    ctxMenuAnchor = anchor;
    ctxMenuTrigger = trigger;
    const targets = contextTargets(item);
    const writeContext = captureWriteContext(opts);
    const multi = targets.length > 1;
    const targetIds = targets.map((candidate) => candidate.id);
    const lists = opts.getAddLists?.() ?? [];
    const keepTypeIds = targets.map((candidate) => candidate.itemTypeId).filter((id): id is string => Boolean(id));
    const categories = menuNodes(opts.getCategoryMenu?.(keepTypeIds) ?? []);
    const categoryTargets = targets.filter((candidate) => !candidate.travelKind);
    ctxMenu = mountFlatSelectPopover({
      anchor,
      options: [
        ...(multi ? [] : [{ value: "edit", label: "编辑" }]),
        { value: "add", label: "添加到", children: [
          { value: "__inbox", label: "Inbox" },
          ...lists.map((list) => ({ value: `list:${list.id}`, label: list.title })),
        ] },
        ...(categoryTargets.length ? [{
          value: "category",
          label: "分类",
          children: categories.length ? categories : [{ value: "__empty_category", label: "暂无分类", disabled: true }],
        }] : []),
        { value: "delete", label: "删除", danger: true },
      ],
      selected: new Set(),
      multiple: false,
      search: false,
      menu: true,
      submenuSearch: true,
      onOpenChange: (open) => {
        if (!open) {
          ctxMenuTrigger?.focus();
          ctxMenuTrigger = null;
          ctxMenuAnchor?.remove();
          ctxMenuAnchor = null;
          ctxMenu = null;
        }
      },
      onChange: (values) => {
        const action = [...values][0];
        const returnFocus = ctxMenuTrigger;
        ctxMenuTrigger = null;
        if (!action) return;
        try { validateWriteContext(opts, writeContext); }
        catch (error) { opts.onError(invokeErrorText(error)); return; }
        if (action === "edit") {
          openDetail(item, returnFocus);
          return;
        }
        if (action === "delete") {
          if (multi && opts.onDeleteSelected) {
            void opts.onDeleteSelected(targetIds, writeContext);
            return;
          }
          void (async () => {
            try {
              const ok = await opts.onConfirmDelete?.(returnFocus ?? undefined, writeContext) ?? false;
              if (!ok) { returnFocus?.focus(); return; }
              await deleteItem(item, writeContext);
              returnFocus?.focus();
            } catch (error) {
              opts.onError(invokeErrorText(error));
              returnFocus?.focus();
            }
          })();
          return;
        }
        if (action === "__inbox" || action.startsWith("list:")) {
          void opts.onAddToList?.(targetIds, action === "__inbox" ? null : action.slice(5), writeContext);
          return;
        }
        if (action === "__no_category") {
          void opts.onSetCategory?.(categoryTargets.map((candidate) => candidate.id), null, writeContext);
          return;
        }
        if (action !== "category" && action !== "add" && action !== "__empty_category") {
          void opts.onSetCategory?.(categoryTargets.map((candidate) => candidate.id), action, writeContext);
        }
      },
    });
    void ctxMenu.open();
  }

  async function toggleItemStatus(itemId: string, nextStatus: string): Promise<void> {
    if (statusPending.has(itemId)) return;
    const item = opts.getStore().items.find((i) => i.id === itemId);
    if (!item || item.status === "取消") return;
    const priorDone = item.status === "完成";
    const writeContext = captureWriteContext(opts);
    if (nextStatus === "完成" && !priorDone) {
      const check = host.querySelector<HTMLButtonElement>(`${rowSelector(itemId)} .task-item-check`);
      if (check) setCheckboxWithCompletionFeedback(check, true);
    }
    statusPending.add(itemId);
    setRowPending(itemId, true);
    try {
      const res = await writers(opts).setStatus({
        item: { id: item.id, expectedRevision: item.revision },
        status: nextStatus,
      }, writeContext);
      patchItem(res.item);
      opts.onError("");
      if (res.item.status === "完成" && !priorDone) beginCompleteHold(itemId);
      else {
        if (res.item.status !== "完成") clearCompleteHold(itemId);
        syncRowDoneVisual(itemId, res.item.status === "完成");
      }
    } catch (err) {
      syncRowDoneVisual(itemId, priorDone);
      try { validateWriteContext(opts, writeContext); }
      catch { opts.onError(invokeErrorText(err)); return; }
      if (isRevisionConflict(err)) {
        opts.onError("任务内容已变化");
        await opts.onReload();
        render();
      } else if (isArchivedReadonlyError(err)) {
        opts.onError("归档清单中的任务不可修改");
      } else {
        opts.onError(invokeErrorText(err));
      }
    } finally {
      statusPending.delete(itemId);
    }
  }

  async function reorderVisible(orderedVisibleIds: string[], writeContext?: unknown): Promise<void> {
    const store = opts.getStore();
    if (!store.itemOrder) return;
    const global = [...store.itemOrder.orderedItemIds];
    const visibleSet = new Set(orderedVisibleIds);
    const visibleGlobal = global.filter((id) => visibleSet.has(id));
    if (visibleGlobal.join() === orderedVisibleIds.join()) return;
    let vi = 0;
    const next = global.map((id) => (visibleSet.has(id) ? orderedVisibleIds[vi++] : id));
    try {
      const res = await writers(opts).reorder({
        itemOrder: { id: ITEM_ORDER_ROOT_ID, expectedRevision: store.itemOrder.revision },
        expectedMembers: memberRefs(store.items.filter((i) => !i.deletedAtUtc)),
        orderedItemIds: next,
      }, writeContext);
      applyOrderResponse(res.itemOrder, res.items);
      opts.onError("");
      render();
    } catch (err) {
      if (isRevisionConflict(err)) {
        opts.onError("任务内容已变化");
        await opts.onReload();
      } else if (isArchivedReadonlyError(err)) {
        opts.onError("归档清单中的任务不可重排");
      } else {
        opts.onError(invokeErrorText(err));
      }
      render();
    }
  }

  async function moveToList(itemId: string, targetKey: string): Promise<void> {
    const writeContext = captureWriteContext(opts);
    const store = opts.getStore();
    if (!store.itemOrder) return;
    const item = store.items.find((i) => i.id === itemId);
    if (!item) return;
    const list =
      targetKey === "inbox"
        ? null
        : store.lists.find((l) => l.id === targetKey && !l.deletedAtUtc) ?? null;
    if (targetKey !== "inbox" && !list) return;
    try {
      const res = await writers(opts).move({
        item: { id: item.id, expectedRevision: item.revision },
        list: list ? { id: list.id, expectedRevision: list.revision } : null,
        itemOrder: { id: ITEM_ORDER_ROOT_ID, expectedRevision: store.itemOrder.revision },
      }, writeContext);
      opts.onStoreChange({
        ...store,
        itemOrder: res.itemOrder,
        items: store.items.map((i) => (i.id === res.item.id ? res.item : i)),
      });
      opts.onError("");
      render();
    } catch (err) {
      if (isRevisionConflict(err)) {
        opts.onError("任务内容已变化");
        await opts.onReload();
      } else if (isArchivedReadonlyError(err)) {
        opts.onError("无法将任务移入或移出归档清单");
      } else {
        opts.onError(invokeErrorText(err));
      }
      render();
    }
  }

  function renderStatusControl(item: ItemSnapshot, readonly: boolean): string {
    const done = item.status === "完成";
    const cancelled = item.status === "取消";
    const pending = statusPending.has(item.id);
    if (readonly) {
      const mark = done ? "✓" : cancelled ? "—" : "○";
      const label = escHtml(item.status);
      return `<span class="task-item-status-mark" aria-label="${label}">${mark}</span>`;
    }
    const label = cancelled ? "已取消" : done ? "标记为进行中" : "标记为完成";
    const disabled = cancelled || pending;
    return `<span class="task-item-check-slot" data-checked="${done && !cancelled ? "1" : "0"}" data-disabled="${disabled ? "1" : "0"}" data-label="${escAttr(label)}"></span>`;
  }

  function renderInlineDraftRow(): string {
    return `<div class="task-item-row task-create-slot is-editing task-item-row-draft">
      <span class="task-item-check-spacer" aria-hidden="true"></span>
      <input type="text" class="task-create-input task-item-draft-input" value="${escAttr(inlineDraft!.title)}" aria-label="新建任务">
      <span class="task-create-trail" aria-hidden="true"></span>
    </div>`;
  }

  function renderCreateSlot(): string {
    const editing = Boolean(inlineDraft && !inlineDraft.afterId);
    if (!editing) {
      return `<div class="task-create-slot" role="presentation"><button type="button" class="task-create-label" data-action="create">新建任务</button></div>`;
    }
    return `<div class="task-item-row task-create-slot${editing ? " is-editing" : ""}">
      <span class="task-item-check-spacer" aria-hidden="true"></span>
      <div class="task-create-title-col">
        <button type="button" class="task-create-label" data-action="create">新建任务</button>
        <input type="text" class="task-create-input task-item-draft-input" value="${escAttr(editing ? inlineDraft!.title : "")}" aria-label="新建任务">
      </div>
      <span class="task-create-trail" aria-hidden="true"></span>
    </div>`;
  }

  function renderItemRow(item: ItemSnapshot, readonly: boolean): string {
    const isEditing = editingId === item.id;
    const done = item.status === "完成";
    const holding = completeHolds.has(item.id);
    const cancelled = item.status === "取消";
    const pending = statusPending.has(item.id);
    const dropCls = dropBeforeId === item.id ? " is-drop-before" : "";
    const doneCls = done && !holding ? " is-done" : "";
    const holdCls = holding ? " is-complete-hold" : "";
    const pendingCls = pending ? " is-pending" : "";
    if (readonly) {
      return `<div class="task-item-row task-item-row-readonly${doneCls}${dropCls}" data-item-id="${escAttr(item.id)}" tabindex="-1">
        ${renderStatusControl(item, true)}
        <div class="task-item-title-col"><span class="task-item-title${doneCls}">${escHtml(item.title)}</span></div>
        <span class="task-create-trail" aria-hidden="true"></span>
      </div>`;
    }
    const titlePart = isEditing
      ? `<input type="text" class="task-item-title-input${doneCls}" value="${escAttr(item.title)}" data-item-id="${escAttr(item.id)}">`
      : `<span class="task-item-title${doneCls}" data-edit-id="${escAttr(item.id)}">${escHtml(item.title)}</span>`;
    const cancelledLabel = cancelled ? `<span class="task-item-status-label">已取消</span>` : "";
    return `<div class="task-item-row${doneCls}${holdCls}${pendingCls}${dropCls}" draggable="true" data-item-id="${escAttr(item.id)}" tabindex="-1">
      ${renderStatusControl(item, false)}
      <div class="task-item-title-col">${titlePart}${cancelledLabel}</div>
      <div class="task-item-trail-col"><button type="button" class="task-item-detail-btn${doneCls}" data-detail-id="${escAttr(item.id)}" aria-label="打开详情" title="打开详情">⋯</button></div>
    </div>`;
  }

  function renderItemListBody(readonly: boolean): string {
    const items = visibleItems();
    const parts: string[] = [];
    for (const item of items) {
      parts.push(renderItemRow(item, readonly));
      if (inlineDraft?.afterId === item.id) parts.push(renderInlineDraftRow());
    }
    if (!readonly) parts.push(renderCreateSlot());
    return `<div class="task-item-list">${parts.join("")}</div>`;
  }

  function paint(html: string): void {
    host.innerHTML = html;
    host.querySelectorAll<HTMLElement>(".task-item-check-slot").forEach((slot) => {
      const box = createCheckbox(slot.dataset.checked === "1");
      box.classList.add("task-item-check");
      box.disabled = slot.dataset.disabled === "1";
      const label = slot.dataset.label;
      if (label) box.setAttribute("aria-label", label);
      slot.replaceWith(box);
    });
  }

  function renderArchivedIndex(): void {
    const lists = archivedLists(opts.getStore().lists);
    if (!lists.length) {
      host.innerHTML = `<p class="task-empty-hint">暂无已归档清单</p>`;
      return;
    }
    host.innerHTML = `
      <ul class="task-archived-index">
        ${lists
          .map(
            (l) => `
          <li class="task-archived-index-row">
            <button type="button" class="task-archived-index-open" data-list-id="${escAttr(l.id)}">${escHtml(l.title)}</button>
            <button type="button" class="task-archived-index-unarchive" data-unarchive="${escAttr(l.id)}">取消归档</button>
          </li>`,
          )
          .join("")}
      </ul>`;
  }

  function renderInternal(): void {
    if (disposed) return;
    const state = resolveState();
    const scope = opts.getScope();

    if (state === "loading") {
      host.innerHTML = `<p class="task-empty-hint">加载中…</p>`;
      return;
    }
    if (state === "load-error") {
      host.innerHTML = `<p class="task-empty-hint task-empty-error">${escHtml(opts.getLoadError() ?? "加载失败")}</p>`;
      return;
    }
    if (scope.kind === "archived-index") {
      renderArchivedIndex();
      return;
    }
    if (state === "empty") {
      const readonly = scope.kind === "archived-list";
      if (readonly) {
        host.innerHTML = `<p class="task-empty-hint">暂无任务</p>`;
        return;
      }
      paint(renderItemListBody(false));
      return;
    }
    if (state === "filtered-empty") {
      const readonly = scope.kind === "archived-list";
      if (readonly) {
        host.innerHTML = `<p class="task-empty-hint">任务已被筛选隐藏，可开启「显示完成」或「显示取消」</p>`;
        return;
      }
      paint(`<p class="task-empty-hint">任务已被筛选隐藏，可开启「显示完成」或「显示取消」</p>${renderItemListBody(false)}`);
      return;
    }
    const readonly = scope.kind === "archived-list";
    paint(renderItemListBody(readonly));
  }

  // Keep page-owned row decoration attached to every internal render, including inline edit.
  function render(): void {
    renderInternal();
    if (!disposed) opts.onRender?.();
  }

  function onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const createBtn = target.closest<HTMLButtonElement>('[data-action="create"]');
    if (createBtn) {
      void openCreateDraft();
      return;
    }
    const createSlot = target.closest<HTMLElement>(".task-create-slot:not(.is-editing)");
    if (createSlot && !target.closest(".task-create-label")) {
      void openCreateDraft();
      return;
    }
    const check = target.closest<HTMLButtonElement>(".task-item-check");
    if (check && !check.disabled) {
      e.preventDefault();
      const row = check.closest<HTMLElement>(".task-item-row");
      const itemId = row?.dataset.itemId;
      if (!itemId) return;
      const item = opts.getStore().items.find((i) => i.id === itemId);
      if (!item || item.status === "取消") return;
      const nextStatus = item.status === "完成" ? "进行中" : "完成";
      void toggleItemStatus(itemId, nextStatus);
      return;
    }
    const detailBtn = target.closest<HTMLButtonElement>("[data-detail-id]");
    if (detailBtn?.dataset.detailId) {
      const context = captureWriteContext(opts);
      try { validateWriteContext(opts, context); }
      catch (error) { opts.onError(invokeErrorText(error)); return; }
      const item = opts.getStore().items.find((i) => i.id === detailBtn.dataset.detailId);
      if (item) opts.onSelectItem ? opts.onSelectItem(item.id) : openDetail(item, detailBtn);
      return;
    }
    const openBtn = target.closest<HTMLButtonElement>(".task-archived-index-open");
    if (openBtn?.dataset.listId) {
      opts.onSelectArchivedList(openBtn.dataset.listId);
      return;
    }
    const unarchiveBtn = target.closest<HTMLButtonElement>("[data-unarchive]");
    if (unarchiveBtn?.dataset.unarchive) {
      const list = opts.getStore().lists.find((l) => l.id === unarchiveBtn.dataset.unarchive);
      if (!list) return;
      void (async () => {
        const restored = await opts.onUnarchiveList?.(list) ?? null;
        if (!restored) return;
        await opts.onReload();
        opts.onSelectList(restored.id);
      })();
      return;
    }
    const editSpan = target.closest<HTMLElement>("[data-edit-id]");
    if (editSpan?.dataset.editId && !suppressTitleEditClick) {
      if (opts.onOpenItem) {
        window.clearTimeout(openItemClickTimer);
        const item = opts.getStore().items.find((candidate) => candidate.id === editSpan.dataset.editId);
        const context = captureWriteContext(opts);
        if (!item) return;
        openItemClickTimer = window.setTimeout(() => {
          try { validateWriteContext(opts, context); }
          catch (error) { opts.onError(invokeErrorText(error)); return; }
          opts.onOpenItem?.(item, editSpan);
        }, 230);
        return;
      }
      if (opts.onSelectItem) { opts.onSelectItem(editSpan.dataset.editId); return; }
      editingId = editSpan.dataset.editId;
      render();
      const input = host.querySelector<HTMLInputElement>(`.task-item-title-input[data-item-id="${editingId}"]`);
      input?.focus();
      input?.select();
    }
  }

  function onPointerDown(e: PointerEvent): void {
    const editSpan = (e.target as HTMLElement).closest<HTMLElement>("[data-edit-id]");
    if (editSpan) {
      pointerEditStart = { x: e.clientX, y: e.clientY };
      suppressTitleEditClick = false;
      return;
    }
    pointerEditStart = null;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointerEditStart) return;
    const dx = e.clientX - pointerEditStart.x;
    const dy = e.clientY - pointerEditStart.y;
    if (Math.hypot(dx, dy) >= POINTER_DRAG_THRESHOLD) suppressTitleEditClick = true;
  }

  function onPointerUp(): void {
    pointerEditStart = null;
  }

  function onDblClick(e: Event): void {
    e.preventDefault();
    const scope = opts.getScope();
    if (scope.kind === "archived-list" || scope.kind === "archived-index") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".task-item-row");
    if (!row?.dataset.itemId || row.classList.contains("task-item-row-readonly")) return;
    if ((e.target as HTMLElement).closest(".task-item-check, .task-item-detail-btn")) return;
    const item = opts.getStore().items.find((i) => i.id === row.dataset.itemId);
    if (!item) return;
    window.clearTimeout(openItemClickTimer);
    openItemClickTimer = 0;
    if (editingId === item.id) {
      editingId = null;
      render();
    }
    if (opts.onSelectItem || opts.onOpenItem) {
      void (async () => {
        if (!(await prepareEdit())) return;
        if (disposed) return;
        editingId = item.id;
        render();
        const input = host.querySelector<HTMLInputElement>(`.task-item-title-input[data-item-id="${editingId}"]`);
        input?.focus(); input?.select();
      })();
    } else openDetail(item, row);
  }

  function onKeyDown(e: KeyboardEvent): void {
    const input = e.target as HTMLInputElement;
    if ((input.classList.contains("task-item-draft-input") || input.classList.contains("task-create-input")) && inlineDraft) {
      if (e.key === "Enter") {
        e.preventDefault();
        ignoreFocusOut = true;
        inlineDraft = { ...inlineDraft!, title: input.value };
        void submitDraft().finally(() => {
          ignoreFocusOut = false;
        });
      }
      if (e.key === "Escape") {
        inlineDraft = null;
        opts.onEndEdit?.();
        render();
      }
      return;
    }
    if (input.classList.contains("task-item-title-input") && input.dataset.itemId) {
      if (e.key === "Enter") {
        e.preventDefault();
        const itemId = input.dataset.itemId;
        ignoreFocusOut = true;
        void saveTitle(itemId, input.value)
          .then(async (saved) => {
            if (saved) {
              editingId = null;
              render();
              await openDraftAfter(itemId);
            }
          })
          .finally(() => {
            ignoreFocusOut = false;
          });
      }
      if (e.key === "Escape") {
        editingId = null;
        opts.onEndEdit?.();
        render();
      }
      return;
    }

    const detailBtn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-detail-id]");
    if (detailBtn?.dataset.detailId && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      const item = opts.getStore().items.find((i) => i.id === detailBtn.dataset.detailId);
      if (item) openDetail(item, detailBtn);
      return;
    }

    const check = (e.target as HTMLElement).closest<HTMLButtonElement>(".task-item-check");
    if (check && !check.disabled && e.key === " ") {
      e.preventDefault();
      const row = check.closest<HTMLElement>(".task-item-row");
      const itemId = row?.dataset.itemId;
      if (!itemId) return;
      const item = opts.getStore().items.find((i) => i.id === itemId);
      if (!item || item.status === "取消") return;
      const nextStatus = item.status === "完成" ? "进行中" : "完成";
      void toggleItemStatus(itemId, nextStatus);
      return;
    }

    const row = (e.target as HTMLElement).closest<HTMLElement>(".task-item-row[data-item-id]");
    if (row?.dataset.itemId && e.shiftKey && e.key === "F10") {
      e.preventDefault();
      const scope = opts.getScope();
      if (scope.kind === "archived-list") return;
      const item = opts.getStore().items.find((i) => i.id === row.dataset.itemId);
      if (!item) return;
      const rect = row.getBoundingClientRect();
      showItemContextMenu(item, rect.left + 8, rect.top + 8, row);
    }
  }

  function onFocusOut(e: FocusEvent): void {
    if (ignoreFocusOut || submitting) return;
    const input = e.target as HTMLInputElement;
    if (!input.isConnected) return;
    if (input.classList.contains("task-item-title-input") && input.dataset.itemId) {
      void saveTitle(input.dataset.itemId, input.value).then((saved) => {
        if (saved) {
          editingId = null;
          render();
          opts.onEndEdit?.();
        }
      });
    }
    if ((input.classList.contains("task-item-draft-input") || input.classList.contains("task-create-input")) && inlineDraft) {
      inlineDraft = { ...inlineDraft, title: input.value };
      if (input.value.trim()) void submitDraft();
      else {
        inlineDraft = null;
        render();
        opts.onEndEdit?.();
      }
    }
  }

  function onInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    if ((input.classList.contains("task-item-draft-input") || input.classList.contains("task-create-input")) && inlineDraft) {
      inlineDraft = { ...inlineDraft, title: input.value };
    }
  }

  function onContextMenu(e: Event): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".task-item-row[data-item-id]");
    if (!row?.dataset.itemId || row.classList.contains("task-item-row-readonly")) return;
    const scope = opts.getScope();
    if (scope.kind === "archived-list") return;
    const item = opts.getStore().items.find((i) => i.id === row.dataset.itemId);
    if (!item) return;
    e.preventDefault();
    showItemContextMenu(item, (e as MouseEvent).clientX, (e as MouseEvent).clientY, row);
  }

  function onDragStart(e: DragEvent): void {
    pointerDrag = true;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".task-item-row");
    if (!row?.dataset.itemId || row.classList.contains("task-item-row-readonly")) return;
    if ((e.target as HTMLElement).closest(".task-item-check, .task-item-detail-btn, input")) {
      e.preventDefault();
      return;
    }
    dragItemId = row.dataset.itemId;
    dragWriteContext = captureWriteContext(opts);
    row.classList.add("is-dragging");
    e.dataTransfer?.setData("text/plain", dragItemId);
    dispatchDragStart(dragItemId);
  }

  function onDragEnd(): void {
    dragItemId = null;
    dropBeforeId = null;
    pointerDrag = false;
    host.querySelectorAll(".is-dragging, .is-drop-before").forEach((el) => {
      el.classList.remove("is-dragging", "is-drop-before");
    });
    dispatchDragEnd();
  }

  function onDragOver(e: DragEvent): void {
    if (!dragItemId) return;
    e.preventDefault();
    const row = (e.target as HTMLElement).closest<HTMLElement>(".task-item-row");
    dropBeforeId = row?.dataset.itemId ?? null;
    host.querySelectorAll(".is-drop-before").forEach((el) => el.classList.remove("is-drop-before"));
    row?.classList.add("is-drop-before");
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    if (!dragItemId || !dropBeforeId || dragItemId === dropBeforeId) return;
    const scope = opts.getScope();
    const visible = visibleItems(scope).map((i) => i.id);
    const from = visible.indexOf(dragItemId);
    const to = visible.indexOf(dropBeforeId);
    if (from < 0 || to < 0) return;
    visible.splice(from, 1);
    visible.splice(to, 0, dragItemId);
    void reorderVisible(visible, dragWriteContext);
    dragItemId = null;
    dropBeforeId = null;
    dragWriteContext = null;
  }

  host.addEventListener("click", onClick);
  host.addEventListener("dblclick", onDblClick);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("focusout", onFocusOut);
  host.addEventListener("input", onInput);
  host.addEventListener("contextmenu", onContextMenu);
  host.addEventListener("dragstart", onDragStart);
  host.addEventListener("dragend", onDragEnd);
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);

  return {
    render,
    isEditing: () => Boolean(editingId || inlineDraft || submitting || titleSaves.size),
    resetContext: () => {
      editingId = null; inlineDraft = null; editWriteContext = undefined;
      dragItemId = null; dropBeforeId = null; dragWriteContext = undefined;
      ctxMenu?.dispose(); ctxMenu = null; ctxMenuAnchor?.remove(); ctxMenuAnchor = null;
      ctxMenuTrigger = null;
      render();
    },
    moveToList,
    dispose() {
      disposed = true;
      opts.onEndEdit?.();
      ctxMenu?.dispose();
      ctxMenuAnchor?.remove();
      host.removeEventListener("click", onClick);
      host.removeEventListener("dblclick", onDblClick);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("input", onInput);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("dragstart", onDragStart);
      host.removeEventListener("dragend", onDragEnd);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      window.clearTimeout(openItemClickTimer);
      host.innerHTML = "";
    },
  };
}
