import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { mountFlatSelectPopover, type FlatSelectPopoverHandle } from "../../ui/flat-select-popover";
import { acquireInteraction } from "../../ui/interaction-lease";
import { formatDateLabel, formatDateValue, buildCalendarDays, monthLabel, WEEKDAYS } from "../ticktick/calendar";
import { addDays, dateAt, instantForWall } from "../admin/tabs/task/arrangement-model";
import { productivityGetTaskListSnapshot, productivityPanelWriteTask, openInsightItem, getInsightItemNavigationResult } from "./client";
import { mountItemList } from "./ui/shared-item-list";
import { activeLists, liveLists, type ScopeVisibility, type TaskDataSlice, type TaskScope } from "./ui/task-selectors";
import { applyTaskSelectionClasses, createTaskSelectionState, updateTaskSelection } from "./ui/task-selection";
import { getConfirmDialog } from "../shell/dialog";
import type {
  ActionSnapshot, CreateItemAfterRequest, CreateItemRequest, DeleteItemRequest, ItemSnapshot,
  ItemTypeCatalogSnapshot, ListSnapshot, MoveItemToListAndPlaceRequest, MoveItemToListAndPlaceResponse,
  ProductivityPanelWriteOperation, ProductivityPanelWriteResponse, ProductivityTaskListSnapshot,
  ReorderItemsRequest, ReorderItemsResponse, SetItemStatusRequest, UpdateItemRequest,
  BatchMoveItemsToListRequest, BatchDeleteItemsRequest,
} from "./types";
import "./panel-task-host.css";

const ALL = "__all__";
const INBOX = "__inbox__";
const SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></svg>`;
type PanelWriteContext = {
  resolvedDataDir: string;
  dataDirEpoch: number;
  store: TaskDataSlice;
  actions: ActionSnapshot[];
  itemTypes: ItemTypeCatalogSnapshot | null;
};

function nextMonth(year: number, month: number, delta: number): [number, number] {
  const date = new Date(year, month + delta, 1);
  return [date.getFullYear(), date.getMonth()];
}

export function mountPanelTaskHost(shellBody: HTMLElement): { dispose(): void } {
  const hostParent = shellBody.querySelector<HTMLElement>(".shell-aside-tasks");
  if (!hostParent) return { dispose() {} };

  const root = document.createElement("section");
  root.className = "productivity-panel-task";
  root.dataset.orbitaHit = "interactive";
  root.innerHTML = `
    <header class="panel-task-heading"><span class="panel-task-icon">${SVG}</span><strong>任务</strong><button type="button" data-action="refresh" aria-label="刷新任务" title="刷新">↻</button></header>
    <div class="panel-task-toolbar"><button type="button" class="panel-task-scope" data-action="scope"></button><label><input type="checkbox" data-visible="completed"> 已完成</label><label><input type="checkbox" data-visible="cancelled"> 已取消</label></div>
    <div class="panel-task-calendar"><div class="panel-task-month"><button type="button" data-action="prev" aria-label="上个月">‹</button><strong data-region="month"></strong><button type="button" data-action="next" aria-label="下个月">›</button><button type="button" data-action="clear-date">清除</button></div><div class="panel-task-weekdays"></div><div class="panel-task-days" data-region="days"></div></div>
    <p class="panel-task-error" data-region="error" hidden></p>
    <div class="panel-task-list" data-region="list"></div>`;
  hostParent.appendChild(root);

  const listHost = root.querySelector<HTMLElement>('[data-region="list"]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-region="error"]')!;
  const monthEl = root.querySelector<HTMLElement>('[data-region="month"]')!;
  const daysEl = root.querySelector<HTMLElement>('[data-region="days"]')!;
  const scopeButton = root.querySelector<HTMLButtonElement>('[data-action="scope"]')!;
  let snapshot: ProductivityTaskListSnapshot | null = null;
  let observedDataDir: string | null = null;
  let observedDataDirEpoch = -1;
  let store: TaskDataSlice = { lists: [], items: [], itemOrder: null };
  let actions: ActionSnapshot[] = [];
  let itemTypes: ItemTypeCatalogSnapshot | null = null;
  let scope: TaskScope = { kind: "all" };
  let date: { start: string; end: string } | null = null;
  let monthAnchor = new Date();
  let visibility: ScopeVisibility = { showCompleted: false, showCancelled: false };
  let loading = true;
  let loadError: string | null = null;
  let disposed = false;
  let generation = 0;
  let pendingReload = false;
  let unlisten: UnlistenFn | null = null;
  let scopeMenu: FlatSelectPopoverHandle | null = null;
  let editLease: ReturnType<typeof acquireInteraction> | null = null;
  let dragLease: ReturnType<typeof acquireInteraction> | null = null;
  let dragStarted = false;
  let navigationGeneration = 0;
  const taskSelection = createTaskSelectionState();

  const setError = (message: string) => {
    errorEl.hidden = !message;
    errorEl.textContent = message;
  };
  const getScopeLabel = (): string => {
    const currentScope = scope;
    switch (currentScope.kind) {
      case "all": return "全部任务";
      case "inbox": return "Inbox";
      case "list": case "archived-list": return liveLists(store.lists).find((list) => list.id === currentScope.listId)?.title ?? "已归档清单";
      default: return "全部任务";
    }
  };
  const captureWriteContext = (): PanelWriteContext => {
    if (!snapshot) throw new Error("任务数据尚未就绪");
    return { resolvedDataDir: snapshot.resolvedDataDir, dataDirEpoch: snapshot.dataDirEpoch, store, actions, itemTypes };
  };
  const validateWriteContext = (value: unknown): PanelWriteContext => {
    const context = value as PanelWriteContext | undefined;
    const observedRootChanged = !!context && observedDataDirEpoch >= 0 && (observedDataDirEpoch > context.dataDirEpoch
      || observedDataDirEpoch === context.dataDirEpoch && !!observedDataDir && observedDataDir !== context.resolvedDataDir);
    if (!context || !snapshot || observedRootChanged || snapshot.resolvedDataDir !== context.resolvedDataDir || snapshot.dataDirEpoch !== context.dataDirEpoch) {
      throw new Error("数据目录已变化，已取消旧操作");
    }
    return context;
  };
  const refreshScopeMenu = () => {
    scopeMenu?.dispose(); scopeMenu = null;
    scopeMenu = mountFlatSelectPopover({ anchor: scopeButton,
      options: [{ value: ALL, label: "全部任务" }, { value: INBOX, label: "Inbox" }, ...activeLists(store.lists).map((list) => ({ value: list.id, label: list.title }))],
      selected: new Set([(() => {
        const currentScope = scope;
        switch (currentScope.kind) {
          case "all": return ALL;
          case "inbox": return INBOX;
          case "list": case "archived-list": return currentScope.listId;
          default: return ALL;
        }
      })()]), multiple: false, search: false,
      onChange: (selected) => {
        const value = [...selected][0];
        scope = value === INBOX ? { kind: "inbox" } : value && value !== ALL ? { kind: "list", listId: value } : { kind: "all" };
        render();
      },
    });
  };

  function calendarRange(): { range: { start: string; end: string }; instants: { start: number; end: number } } | null {
    if (!date || !snapshot) return null;
    try { return { range: date, instants: { start: instantForWall(date.start, 0, snapshot.businessTimeZone), end: instantForWall(addDays(date.end, 1), 0, snapshot.businessTimeZone) } }; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return null; }
  }

  function renderCalendar(): void {
    const year = monthAnchor.getFullYear(); const month = monthAnchor.getMonth();
    monthEl.textContent = monthLabel(year, month);
    const weekdays = root.querySelector<HTMLElement>(".panel-task-weekdays")!;
    weekdays.innerHTML = WEEKDAYS.map((day) => `<span>${day}</span>`).join("");
    daysEl.innerHTML = buildCalendarDays(year, month).map((day) => {
      if (!day) return `<span class="panel-task-day is-blank"></span>`;
      const value = formatDateValue(day);
      const today = snapshot ? dateAt(Date.now(), snapshot.businessTimeZone) : formatDateValue(new Date());
      const selected = !!date && value >= date.start && value <= date.end;
      return `<button type="button" class="panel-task-day${selected ? " is-selected" : ""}${value === today ? " is-today" : ""}" data-date="${value}" aria-pressed="${selected}">${day.getDate()}</button>`;
    }).join("");
  }

  function decorateRows(): void {
    for (const row of listHost.querySelectorAll<HTMLElement>(".task-item-row[data-item-id]")) {
      const item = store.items.find((candidate) => candidate.id === row.dataset.itemId);
      if (!item) continue;
      const titleCol = row.querySelector<HTMLElement>(".task-item-title-col");
      if (titleCol && !titleCol.querySelector(".panel-task-meta")) {
        const meta = document.createElement("span"); meta.className = "panel-task-meta";
        const parts: string[] = [];
        const list = item.listId ? store.lists.find((candidate) => candidate.id === item.listId && !candidate.deletedAtUtc) : null;
        const type = item.itemTypeId ? itemTypes?.itemTypes.find((candidate) => candidate.id === item.itemTypeId) : null;
        if (list?.status !== "已归档" && list) parts.push(list.title);
        if (type) parts.push(type.name);
        meta.textContent = parts.join(" · "); titleCol.appendChild(meta);
      }
      const trail = row.querySelector<HTMLElement>(".task-item-trail-col");
      if (trail && !trail.querySelector(".panel-task-plan")) {
        const action = actions.filter((candidate) => !candidate.deletedAtUtc && candidate.targetKind === "item" && candidate.targetId === item.id && candidate.plannedStartAt)
          .sort((a, b) => Date.parse(a.plannedStartAt!) - Date.parse(b.plannedStartAt!))[0];
        if (action?.plannedStartAt) {
          const plan = document.createElement("span"); plan.className = "panel-task-plan";
          const stamp = Date.parse(action.plannedStartAt);
          const day = dateAt(stamp, snapshot!.businessTimeZone);
          const offset = snapshot!.businessTimeZone.replacements.find((r) => Date.parse(r.startUtc) <= stamp && stamp < Date.parse(r.endUtc))?.offset ?? snapshot!.businessTimeZone.baseOffset;
          const [, sign, hh, mm] = /^([+-])(\d{2}):(\d{2})$/.exec(offset) ?? [];
          const offsetMinutes = (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm));
          const wall = new Date(stamp + offsetMinutes * 60_000);
          const time = `${String(wall.getUTCHours()).padStart(2, "0")}:${String(wall.getUTCMinutes()).padStart(2, "0")}`;
          plan.textContent = `${day} ${time}`; trail.prepend(plan);
        }
      }
    }
    applyTaskSelectionClasses(listHost, taskSelection);
  }

  const itemList = mountItemList({
    host: listHost,
    getScope: () => scope,
    getStore: () => store,
    getVisibility: () => visibility,
    getLoading: () => loading,
    getLoadError: () => loadError,
    onStoreChange: (next) => { store = next; },
    onReload: requestReload,
    onError: setError,
    onSelectArchivedList: () => {},
    onSelectList: (listId) => { scope = { kind: "list", listId }; render(); },
    onOpenItem: (item) => { void navigateToItem(item); },
    getDateRange: () => date,
    getDateRangeInstants: () => calendarRange()?.instants ?? null,
    dateFilter: "panel-any-source",
    getActions: () => actions,
    getSelectedItemIds: () => taskSelection.selected,
    onDeleteSelected: deleteSelectedItems,
    getAddLists: () => activeLists(store.lists).map((list) => ({ id: list.id, title: list.title })),
    getCategoryMenu: (keepTypeIds) => categoryMenu(keepTypeIds),
    onAddToList: (itemIds, listId, context) => moveItemsToList(itemIds, listId, context),
    onSetCategory: (itemIds, itemTypeId, context) => setItemsCategory(itemIds, itemTypeId, context),
    onConfirmDelete: async (returnFocus, context) => {
      const confirmed = await getConfirmDialog()("删除任务", "删除后无法恢复。", returnFocus, { danger: true });
      if (confirmed) validateWriteContext(context);
      return confirmed;
    },
    captureWriteContext,
    validateWriteContext: (context) => { validateWriteContext(context); },
    onBeforeEdit: beginEdit,
    onEndEdit: () => {
      setEditLease(false);
      if (pendingReload && !itemList?.isEditing()) { pendingReload = false; void reload(); }
    },
    onRender: decorateRows,
    writers: {
      create: (request: CreateItemRequest, context?: unknown) => panelWrite({ kind: "createItem", request }, context) as Promise<import("./types").ItemResponse>,
      createAfter: (request: CreateItemAfterRequest, context?: unknown) => panelWrite({ kind: "createItemAfter", request }, context) as Promise<import("./types").CreateItemAfterResponse>,
      update: (request: UpdateItemRequest, context?: unknown) => panelWrite({ kind: "updateItem", request }, context) as Promise<import("./types").ItemResponse>,
      setStatus: (request: SetItemStatusRequest, context?: unknown) => panelWrite({ kind: "setItemStatus", request }, context) as Promise<import("./types").ItemResponse>,
      delete: (request: DeleteItemRequest, context?: unknown) => panelWrite({ kind: "deleteItem", request }, context) as Promise<import("./types").ItemResponse>,
      reorder: (request: ReorderItemsRequest, context?: unknown) => panelWrite({ kind: "reorderItems", request }, context) as Promise<ReorderItemsResponse>,
      move: (request: MoveItemToListAndPlaceRequest, context?: unknown) => panelWrite({ kind: "moveItem", request }, context) as Promise<MoveItemToListAndPlaceResponse>,
    },
  });

  async function panelWrite(operation: ProductivityPanelWriteOperation, value?: unknown): Promise<ProductivityPanelWriteResponse> {
    if (!snapshot) throw new Error("任务数据尚未就绪");
    const captured = validateWriteContext(value ?? captureWriteContext());
    const result = await productivityPanelWriteTask({ expectedDataDir: captured.resolvedDataDir, expectedDataDirEpoch: captured.dataDirEpoch, operation });
    validateWriteContext(captured);
    return result;
  }

  function categoryMenu(keepTypeIds: readonly string[]) {
    type Node = { value: string; label: string; children?: Node[] };
    const keep = new Set(keepTypeIds);
    const types = itemTypes?.itemTypes.filter((entry) => !entry.effectiveInactive || keep.has(entry.id)) ?? [];
    const available = new Set(types.map((entry) => entry.id));
    const children = new Map<string | null, typeof types>();
    for (const entry of types) {
      const parent = entry.parentItemTypeId && available.has(entry.parentItemTypeId) ? entry.parentItemTypeId : null;
      const siblings = children.get(parent) ?? []; siblings.push(entry); children.set(parent, siblings);
    }
    const branch = (parent: string | null): Node[] => (children.get(parent) ?? []).map((entry) => {
      const nested = branch(entry.id); return { value: entry.id, label: entry.name, ...(nested.length ? { children: nested } : {}) };
    });
    return [{ value: "", label: "无分类" }, ...branch(null)];
  }

  async function moveItemsToList(itemIds: readonly string[], listId: string | null, value?: unknown): Promise<void> {
    let captured: PanelWriteContext;
    try { captured = validateWriteContext(value ?? captureWriteContext()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return; }
    const targetList = listId ? captured.store.lists.find((list) => list.id === listId && list.status !== "已归档") : null;
    if (listId && !targetList) { setError("清单已变化，请刷新后重试"); return; }
    const request: BatchMoveItemsToListRequest = { expectedDataDir: captured.resolvedDataDir,
      items: itemIds.map((id) => captured.store.items.find((item) => item.id === id)).filter((item): item is ItemSnapshot => !!item && !item.deletedAtUtc).map((item) => ({ id: item.id, expectedRevision: item.revision })),
      list: targetList ? { id: targetList.id, expectedRevision: targetList.revision } : null };
    if (!request.items.length) return;
    try { await panelWrite({ kind: "batchMoveItemsToList", request }, captured); await reload(); setError(""); }
    catch (error) { await reload(); setError(`移动任务失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  async function deleteSelectedItems(itemIds: readonly string[], value?: unknown): Promise<void> {
    let captured: PanelWriteContext;
    try { captured = validateWriteContext(value ?? captureWriteContext()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return; }
    if (!itemIds.length) return;
    let confirmed: boolean;
    try { confirmed = await getConfirmDialog()("删除任务", `删除所选 ${itemIds.length} 项后无法恢复。`, undefined, { danger: true }); }
    catch (error) { setError(`删除任务失败：${error instanceof Error ? error.message : String(error)}`); return; }
    if (!confirmed) return;
    try { captured = validateWriteContext(captured); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return; }
    const selected = itemIds.map((id) => captured.store.items.find((item) => item.id === id)).filter((item): item is ItemSnapshot => !!item && !item.deletedAtUtc);
    if (!selected.length) return;
    const request: BatchDeleteItemsRequest = { expectedDataDir: captured.resolvedDataDir, items: selected.map((item) => ({
      item: { id: item.id, expectedRevision: item.revision },
      expectedActions: captured.actions.filter((action) => !action.deletedAtUtc && action.targetKind === "item" && action.targetId === item.id).map((action) => ({ id: action.id, expectedRevision: action.revision })),
    })) };
    try { await panelWrite({ kind: "batchDeleteItems", request }, captured); taskSelection.selected.clear(); await reload(); setError(""); }
    catch (error) { await reload(); setError(`删除任务失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  async function setItemsCategory(itemIds: readonly string[], itemTypeId: string | null, value?: unknown): Promise<void> {
    let captured: PanelWriteContext;
    try { captured = validateWriteContext(value ?? captureWriteContext()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return; }
    let completed = 0;
    try {
      for (const id of itemIds) {
        validateWriteContext(captured);
        const item = captured.store.items.find((candidate) => candidate.id === id && !candidate.deletedAtUtc);
        if (!item) continue;
        await productivityPanelWriteTask({ expectedDataDir: captured.resolvedDataDir, expectedDataDirEpoch: captured.dataDirEpoch,
          operation: { kind: "updateItem", request: { item: { id: item.id, expectedRevision: item.revision }, patch: { itemTypeId,
            classificationExpected: itemTypeId && captured.itemTypes ? { itemTypeCatalog: { id: captured.itemTypes.id, expectedRevision: captured.itemTypes.revision } } : undefined } } } });
        validateWriteContext(captured);
        completed++;
      }
      await reload(); setError("");
    } catch (error) {
      await reload(); const detail = error instanceof Error ? error.message : String(error);
      setError(completed ? `已更新 ${completed} 项，后续分类更新失败：${detail}` : `分类更新失败：${detail}`);
    }
  }

  function render(): void {
    if (disposed) return;
    scopeButton.textContent = `${getScopeLabel()} ▾`;
    root.querySelector<HTMLInputElement>('[data-visible="completed"]')!.checked = visibility.showCompleted;
    root.querySelector<HTMLInputElement>('[data-visible="cancelled"]')!.checked = visibility.showCancelled;
    renderCalendar(); itemList.render();
  }

  function requestReload(): void {
    if (disposed) return;
    if (itemList?.isEditing()) { pendingReload = true; return; }
    void reload();
  }

  async function reload(): Promise<void> {
    const current = ++generation;
    // Window focus and productivity-data-invalidated refresh often. Keep the
    // current list on screen after the first snapshot; only the initial load
    // uses the blocking "加载中…" placeholder.
    if (!snapshot) {
      loading = true;
      loadError = null;
      itemList.render();
    }
    try {
      const next = await productivityGetTaskListSnapshot();
      if (disposed || current !== generation) return;
      const rootChanged = !!snapshot && (snapshot.resolvedDataDir !== next.resolvedDataDir || snapshot.dataDirEpoch !== next.dataDirEpoch);
      const firstSnapshot = !snapshot;
      snapshot = next;
      if (next.dataDirEpoch >= observedDataDirEpoch) {
        observedDataDir = next.resolvedDataDir;
        observedDataDirEpoch = next.dataDirEpoch;
      }
      if (rootChanged) {
        scope = { kind: "all" }; date = null; pendingReload = false;
        taskSelection.selected.clear(); taskSelection.anchorId = null;
        scopeMenu?.dispose(); scopeMenu = null;
        itemList.resetContext();
        setEditLease(false); setDragLease(false); dragStarted = false;
        navigationGeneration++;
      }
      if (firstSnapshot || rootChanged) {
        const [businessYear, businessMonth] = dateAt(Date.now(), next.businessTimeZone).split("-").map(Number);
        monthAnchor = new Date(businessYear, businessMonth - 1, 1);
      }
      store = { lists: next.lists.filter((list) => !list.deletedAtUtc), items: next.items, itemOrder: next.itemOrder };
      actions = next.actions; itemTypes = next.itemTypes;
      const currentScope = scope;
      const selectedList = currentScope.kind === "list" ? activeLists(store.lists).find((list) => list.id === currentScope.listId) : true;
      if (!selectedList) scope = { kind: "all" };
      loading = false; loadError = null; setError("");
      refreshScopeMenu(); render();
    } catch (error) {
      if (disposed || current !== generation) return;
      loading = false;
      const message = error instanceof Error ? error.message : String(error);
      if (!snapshot) loadError = message;
      setError(`任务加载失败：${message}`);
      itemList.render();
    }
  }

  async function navigateToItem(item: ItemSnapshot): Promise<void> {
    if (!snapshot) return;
    const current = ++navigationGeneration;
    try {
      const accepted = await openInsightItem({ expectedDataDir: snapshot.resolvedDataDir, expectedDataDirEpoch: snapshot.dataDirEpoch, itemId: item.id });
      if (accepted.status !== "accepted") throw new Error(accepted.message ?? "Insight 未接受此任务导航");
      const requestId = accepted.requestId;
      const deadline = Date.now() + 45_000;
      while (!disposed && current === navigationGeneration && Date.now() < deadline) {
        const result = await getInsightItemNavigationResult({ requestId });
        if (result.status === "opened") return;
        if (result.status === "cancelled" || result.status === "failed") throw new Error(result.message ?? "Insight 未能打开此任务");
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (!disposed && current === navigationGeneration) throw new Error("Insight 仍在处理任务导航，请查看 Insight 窗口");
    } catch (error) { if (!disposed && current === navigationGeneration) setError(error instanceof Error ? error.message : String(error)); }
  }

  function setEditLease(active: boolean): void {
    if (active && !editLease) editLease = acquireInteraction("edit");
    else if (!active && editLease) { editLease.release(); editLease = null; }
  }
  async function beginEdit(): Promise<void> {
    if (!editLease) editLease = acquireInteraction("edit");
    const lease = editLease;
    try { await lease.ready; }
    catch (error) {
      if (editLease === lease) { editLease.release(); editLease = null; }
      throw error;
    }
  }
  function setDragLease(active: boolean): void {
    if (active && !dragLease) dragLease = acquireInteraction("drag");
    else if (!active && dragLease) { dragLease.release(); dragLease = null; }
  }
  const onFocusIn = (event: FocusEvent) => setEditLease((event.target as HTMLElement).matches("input"));
  const onFocusOut = () => {
    queueMicrotask(() => { if (!itemList?.isEditing()) setEditLease(false); });
  };
  const onDragStart = () => { dragStarted = true; setDragLease(true); };
  const onDragEnd = () => { dragStarted = false; setDragLease(false); };
  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target as HTMLElement).closest('.task-item-row[draggable="true"]')) return;
    setDragLease(true);
  };
  const onPointerUp = () => { if (!dragStarted) setDragLease(false); };
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "scope") { void scopeMenu?.open(); return; }
    if (action === "refresh") { void reload(); return; }
    if (action === "clear-date") { date = null; render(); return; }
    if (action === "prev" || action === "next") {
      const [year, month] = nextMonth(monthAnchor.getFullYear(), monthAnchor.getMonth(), action === "prev" ? -1 : 1);
      monthAnchor = new Date(year, month, 1); renderCalendar(); return;
    }
    const day = target.closest<HTMLButtonElement>("[data-date]");
    if (day?.dataset.date) {
      const value = day.dataset.date;
      date = date?.start === value && date.end === value ? null : { start: value, end: value };
      render();
    }
  };
  const onChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.visible === "completed") visibility = { ...visibility, showCompleted: input.checked };
    if (input.dataset.visible === "cancelled") visibility = { ...visibility, showCancelled: input.checked };
    render();
  };
  const onSelectionClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>(".task-item-row[data-item-id]");
    if (!row?.dataset.itemId || target.closest(".task-item-check, .task-item-detail-btn, input, button")) return;
    const ids = [...listHost.querySelectorAll<HTMLElement>(".task-item-row[data-item-id]")].map((entry) => entry.dataset.itemId!).filter(Boolean);
    updateTaskSelection(taskSelection, ids, row.dataset.itemId, event);
    applyTaskSelectionClasses(listHost, taskSelection);
  };
  const onInvalidated = (event: { payload?: { dataDir?: string; dataDirEpoch?: number } }) => {
    const stamp = event.payload;
    if (stamp?.dataDir && typeof stamp.dataDirEpoch === "number" && stamp.dataDirEpoch >= observedDataDirEpoch) {
      observedDataDir = stamp.dataDir;
      observedDataDirEpoch = stamp.dataDirEpoch;
    }
    requestReload();
  };
  const onWindowFocus = () => { if (!document.hidden) requestReload(); };

  root.addEventListener("click", onClick);
  root.addEventListener("click", onSelectionClick);
  root.addEventListener("change", onChange);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("task-item-drag-start", onDragStart);
  window.addEventListener("task-item-drag-end", onDragEnd);
  window.addEventListener("focus", onWindowFocus);
  document.addEventListener("visibilitychange", onWindowFocus);
  root.querySelector<HTMLElement>(".panel-task-month")!.setAttribute("aria-label", `日历，${formatDateLabel(formatDateValue(new Date()))}`);

  void (async () => {
    try { unlisten = await listen("productivity-data-invalidated", onInvalidated); }
    catch { /* Focus refresh remains the recovery path when event registration is unavailable. */ }
    if (!disposed) await reload();
    else unlisten?.();
  })();

  return {
    dispose() {
      if (disposed) return;
      disposed = true; generation++; navigationGeneration++;
      unlisten?.(); unlisten = null;
      scopeMenu?.dispose(); scopeMenu = null;
      editLease?.release(); editLease = null; dragLease?.release(); dragLease = null;
      root.removeEventListener("click", onClick); root.removeEventListener("change", onChange);
      root.removeEventListener("click", onSelectionClick);
      root.removeEventListener("focusin", onFocusIn); root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("task-item-drag-start", onDragStart); window.removeEventListener("task-item-drag-end", onDragEnd);
      window.removeEventListener("focus", onWindowFocus); document.removeEventListener("visibilitychange", onWindowFocus);
      itemList.dispose(); root.remove();
    },
  };
}
