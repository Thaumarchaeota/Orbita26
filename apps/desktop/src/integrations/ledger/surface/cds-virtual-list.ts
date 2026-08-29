import { DATE_PIN_HEIGHT, ROW_HEIGHT_ESTIMATE } from "../constants";
import {
  resolveListRenderMode,
  type ListRenderMode,
} from "../domain/list-render-mode";
import {
  computeGroupWindow,
  findIndexAtOffset,
  prefixOffsets,
  shouldLoadOlderOnScroll,
  type ScrollDirection,
} from "../domain/virtual-list";
import { isTransactionItem } from "../domain/detail-item";
import { entryVisualState } from "../domain/entry-visual";
import { getBaseline } from "../state/ledger";
import type { DetailItem } from "../types";
import { collectVisualChangedIds, diffItems } from "./cds-list-patch";
import { createCdsListScheduler } from "./cds-list-scheduler";
import { reconcileChildren } from "./dom-reconcile";
import { formatDatePinLabel, groupItemsByDate, type DateGroup } from "./group-by-date";
import {
  carryCardPaintState,
  itemContentKey,
  itemVisualKey,
  mountConnectedCardVisual,
  patchTransactionCard,
  renderDetailItemCard,
  updateEntryCardVisual,
  type RenderCardContext,
} from "./render-cards";

const GROUP_ITEMS_PAD_Y = 6 + 16;
const GROUP_CARD_GAP = 12;

export type CdsVirtualListDeps = {
  getItems: () => readonly DetailItem[];
  getLoadState: () => "loading" | "partial" | "ready";
  getRenderContext?: () => RenderCardContext;
  loadOlder?: () => Promise<void>;
  onAddEntry?: (date: string, trigger: HTMLElement) => void;
};

export type CdsVirtualListHandle = {
  paint: () => void;
  refresh: () => void;
  scrollToItem: (id: string) => void;
  animateCommitRemovals: (ids: string[]) => Promise<void>;
  setLayoutLocked: (locked: boolean) => void;
  getScheduler: () => ReturnType<typeof createCdsListScheduler>;
  dispose: () => void;
};

type ScrollAnchor = {
  itemId: string | null;
  offsetInViewport: number;
  scrollTop: number;
};

function classifyDataChange(prev: DateGroup[], next: DateGroup[]): "none" | "append" | "mutate" {
  const prevKeys = new Map<string, string>();
  for (const group of prev) {
    for (const item of group.items) prevKeys.set(item.id, itemContentKey(item));
  }
  let hasNew = false;
  let hasMutate = false;
  for (const group of next) {
    for (const item of group.items) {
      const key = itemContentKey(item);
      const old = prevKeys.get(item.id);
      if (old === undefined) hasNew = true;
      else if (old !== key) hasMutate = true;
      prevKeys.delete(item.id);
    }
  }
  if (prevKeys.size > 0 || hasMutate) return "mutate";
  if (hasNew) return "append";
  return "none";
}

function syncCardWrap(
  wrap: HTMLElement,
  item: DetailItem,
  ctx: RenderCardContext,
): HTMLElement {
  const contentKey = itemContentKey(item);
  const visualKey = itemVisualKey(item, ctx);
  if (wrap.dataset.contentKey === contentKey) {
    if (wrap.dataset.visualKey !== visualKey) {
      updateEntryCardVisual(wrap, item, ctx);
      wrap.dataset.visualKey = visualKey;
    }
    return wrap;
  }
  if (isTransactionItem(item) && patchTransactionCard(wrap, item, ctx)) {
    wrap.dataset.contentKey = contentKey;
    wrap.dataset.visualKey = visualKey;
    return wrap;
  }
  const next = renderDetailItemCard(item, ctx);
  carryCardPaintState(wrap, next);
  return next;
}

function mountCardWrap(
  wrap: HTMLElement,
  item: DetailItem,
  ctx: RenderCardContext,
): void {
  wrap.classList.add("is-entering");
  wrap.addEventListener(
    "animationend",
    () => wrap.classList.remove("is-entering"),
    { once: true },
  );
  if (!isTransactionItem(item)) return;
  const visual = item._is_new ? "new" : entryVisualState(item, getBaseline());
  mountConnectedCardVisual(wrap, visual, !!ctx.markedErrorIds?.has(item.id));
}

function collapseCardWrap(wrap: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      wrap.remove();
      resolve();
    };
    const height = wrap.offsetHeight;
    if (height <= 0) {
      finish();
      return;
    }
    wrap.style.maxHeight = `${height}px`;
    const onEnd = (event: TransitionEvent) => {
      if (event.target === wrap && event.propertyName === "max-height") finish();
    };
    wrap.addEventListener("transitionend", onEnd);
    requestAnimationFrame(() => {
      wrap.classList.add("is-collapsing");
      wrap.style.maxHeight = "0";
    });
    window.setTimeout(finish, 520);
  });
}

export function createCdsVirtualList(
  scrollContainer: HTMLElement,
  deps: CdsVirtualListDeps,
): CdsVirtualListHandle {
  const lifecycle = new AbortController();
  const scheduler = createCdsListScheduler();
  const cardHeights = new Map<string, number>();
  const groupHeights = new Map<string, number>();
  const groupElements = new Map<string, HTMLElement>();
  const groupResizeObservers = new Map<string, ResizeObserver>();
  const dirtyMeasureDates = new Set<string>();
  let topSpacer: HTMLElement | null = null;
  let groupsHost: HTMLElement | null = null;
  let bottomSpacer: HTMLElement | null = null;
  let groups: DateGroup[] = [];
  let snapshotItems: DetailItem[] = [];
  const itemVisualCache = new Map<string, string>();
  let cachedOffsets: number[] = [0];
  let offsetsDirty = true;
  let visibleStart = -1;
  let visibleEnd = -1;
  let loadingOlder = false;
  let instanceGeneration = 0;
  let anchorGuard = false;
  let pendingAnchor: { scrollTop: number; prefixOffset: number } | null = null;
  let disposed = false;
  let snapshotGroups: DateGroup[] = [];
  let lastScrollTop = 0;
  let scrollDirection: ScrollDirection = "none";
  let scrollRafPending = false;
  let pendingScrollTop = 0;
  let pendingAnchorPass = false;
  let renderMode: ListRenderMode | null = null;

  function isStale(generation: number): boolean {
    return disposed || generation !== instanceGeneration;
  }

  function captureScrollAnchor(): ScrollAnchor {
    const rootTop = scrollContainer.getBoundingClientRect().top;
    for (const wrap of scrollContainer.querySelectorAll<HTMLElement>(".cds-card-wrap")) {
      const rect = wrap.getBoundingClientRect();
      if (rect.bottom <= rootTop) continue;
      return {
        itemId: wrap.dataset.itemId ?? null,
        offsetInViewport: rect.top - rootTop,
        scrollTop: scrollContainer.scrollTop,
      };
    }
    return { itemId: null, offsetInViewport: 0, scrollTop: scrollContainer.scrollTop };
  }

  function restoreScrollAnchor(anchor: ScrollAnchor): void {
    if (anchor.itemId) {
      const wrap = scrollContainer.querySelector<HTMLElement>(
        `[data-item-id="${anchor.itemId}"]`,
      );
      if (wrap) {
        const rootTop = scrollContainer.getBoundingClientRect().top;
        const rect = wrap.getBoundingClientRect();
        if (rect.height > 0 || rect.bottom > rootTop) {
          anchorGuard = true;
          const delta = rect.top - rootTop - anchor.offsetInViewport;
          scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + delta);
          anchorGuard = false;
          return;
        }
      }
    }
    anchorGuard = true;
    scrollContainer.scrollTop = Math.max(0, anchor.scrollTop);
    anchorGuard = false;
  }

  function clearGroupResizeObserver(date: string): void {
    const observer = groupResizeObservers.get(date);
    if (observer) observer.disconnect();
    groupResizeObservers.delete(date);
  }

  function clearAllGroupResizeObservers(): void {
    for (const observer of groupResizeObservers.values()) observer.disconnect();
    groupResizeObservers.clear();
  }

  function cardHeight(item: DetailItem): number {
    return cardHeights.get(item.id) || ROW_HEIGHT_ESTIMATE;
  }

  function estimateGroupHeight(group: DateGroup): number {
    let height = DATE_PIN_HEIGHT + GROUP_ITEMS_PAD_Y;
    for (let i = 0; i < group.items.length; i++) {
      height += cardHeight(group.items[i]!);
      if (i > 0) height += GROUP_CARD_GAP;
    }
    return height;
  }

  function groupHeight(group: DateGroup): number {
    return groupHeights.get(group.date) ?? estimateGroupHeight(group);
  }

  function rebuildOffsets(): number[] {
    cachedOffsets = prefixOffsets(groups.map((group) => groupHeight(group)));
    offsetsDirty = false;
    return cachedOffsets;
  }

  function getOffsets(): number[] {
    if (offsetsDirty) return rebuildOffsets();
    return cachedOffsets;
  }

  function markOffsetsDirty(): void {
    offsetsDirty = true;
  }

  function beginAnchorCycle(offsets: number[], scrollTop: number): void {
    const idx = findIndexAtOffset(offsets, scrollTop);
    pendingAnchor = { scrollTop, prefixOffset: offsets[idx] ?? 0 };
  }

  function applyAnchorCompensation(offsetsBefore: number[], offsetsAfter: number[]): void {
    if (!pendingAnchor || anchorGuard) return;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    const idx = findIndexAtOffset(offsetsBefore, anchor.scrollTop);
    const prefixDelta = offsetsAfter[idx]! - offsetsBefore[idx]!;
    if (prefixDelta === 0) return;
    anchorGuard = true;
    scrollContainer.scrollTop = anchor.scrollTop + prefixDelta;
    anchorGuard = false;
  }

  function ensureVirtualDom(): void {
    if (groupsHost && topSpacer && bottomSpacer) return;
    topSpacer = document.createElement("div");
    topSpacer.className = "cds-virtual-spacer";
    groupsHost = document.createElement("div");
    groupsHost.className = "cds-virtual-groups";
    bottomSpacer = document.createElement("div");
    bottomSpacer.className = "cds-virtual-spacer";
    scrollContainer.replaceChildren(topSpacer, groupsHost, bottomSpacer);
  }

  function ensureFullDom(): void {
    if (groupsHost && !topSpacer && !bottomSpacer) return;
    groupsHost = document.createElement("div");
    groupsHost.className = "cds-virtual-groups";
    scrollContainer.replaceChildren(groupsHost);
    topSpacer = bottomSpacer = null;
  }

  function syncGroupItems(groupEl: HTMLElement, group: DateGroup, trackMeasure: boolean): void {
    const itemsEl = groupEl.querySelector<HTMLElement>("[data-role='date-group-items']");
    if (!itemsEl) return;
    const ctx = deps.getRenderContext?.() ?? {};
    const groupContentKey = group.items.map((item) => `${item.id}:${itemContentKey(item)}`).join("\0");
    const groupVisualKey = group.items.map((item) => `${item.id}:${itemVisualKey(item, ctx)}`).join("\0");
    if (
      itemsEl.dataset.contentKey === groupContentKey &&
      itemsEl.dataset.visualKey === groupVisualKey
    ) {
      return;
    }

    const existing = new Map<string, HTMLElement>();
    for (const wrap of itemsEl.querySelectorAll<HTMLElement>(".cds-card-wrap")) {
      const id = wrap.dataset.itemId;
      if (id) existing.set(id, wrap);
    }

    const next: HTMLElement[] = [];
    const fresh: Array<{ wrap: HTMLElement; item: DetailItem }> = [];
    for (const item of group.items) {
      const prev = existing.get(item.id);
      if (prev) {
        next.push(syncCardWrap(prev, item, ctx));
      } else {
        const node = renderDetailItemCard(item, ctx);
        fresh.push({ wrap: node, item });
        next.push(node);
      }
      existing.delete(item.id);
    }
    for (const orphan of existing.values()) orphan.remove();
    reconcileChildren(itemsEl, next);
    for (const { wrap, item } of fresh) {
      mountCardWrap(wrap, item, ctx);
    }
    itemsEl.dataset.contentKey = groupContentKey;
    itemsEl.dataset.visualKey = groupVisualKey;
    if (trackMeasure) dirtyMeasureDates.add(group.date);
  }

  function observeGroupHeight(groupEl: HTMLElement, date: string): void {
    if (groupResizeObservers.has(date)) return;
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      dirtyMeasureDates.add(date);
      if (scheduler.shouldDeferHeavyWork()) return;
      scheduleScrollReconcile();
    });
    observer.observe(groupEl);
    groupResizeObservers.set(date, observer);
  }

  function measureGroupElement(groupEl: HTMLElement, date: string): boolean {
    const prev = groupHeights.get(date);
    const next = groupEl.offsetHeight;
    let changed = prev !== next;
    if (changed) groupHeights.set(date, next);
    groupEl.querySelectorAll<HTMLElement>(".cds-card-wrap").forEach((wrap) => {
      const id = wrap.dataset.itemId;
      if (!id) return;
      const cardPrev = cardHeights.get(id);
      const cardNext = wrap.offsetHeight;
      if (cardPrev !== cardNext) {
        cardHeights.set(id, cardNext);
        changed = true;
      }
    });
    return changed;
  }

  function buildDateGroupShell(group: DateGroup): HTMLElement {
    const groupEl = document.createElement("section");
    groupEl.className = "cds-date-group";
    groupEl.setAttribute("data-role", "date-group");
    groupEl.dataset.date = group.date;

    const pinRow = document.createElement("div");
    pinRow.className = "cds-date-pin-row";
    pinRow.setAttribute("data-role", "date-pin-row");

    const pin = document.createElement("div");
    pin.className = "cds-date-pin";
    pin.setAttribute("data-role", "date-pin");
    pin.textContent = formatDatePinLabel(group.date);

    pinRow.appendChild(pin);
    if (deps.onAddEntry) {
      const addBtn = document.createElement("button");
      addBtn.className = "cds-date-add";
      addBtn.type = "button";
      addBtn.setAttribute("aria-label", `在 ${group.date} 记一笔`);
      addBtn.textContent = "+";
      addBtn.addEventListener("click", () => deps.onAddEntry!(group.date, addBtn));
      pinRow.appendChild(addBtn);
    }

    const itemsEl = document.createElement("div");
    itemsEl.className = "cds-date-items";
    itemsEl.setAttribute("data-role", "date-group-items");
    groupEl.append(pinRow, itemsEl);
    return groupEl;
  }

  function populateGroupItems(groupEl: HTMLElement, group: DateGroup, trackMeasure: boolean): void {
    syncGroupItems(groupEl, group, trackMeasure);
  }

  function renderVirtualDateGroup(group: DateGroup): HTMLElement {
    const groupEl = buildDateGroupShell(group);
    populateGroupItems(groupEl, group, true);
    observeGroupHeight(groupEl, group.date);
    return groupEl;
  }

  function renderFullDateGroup(group: DateGroup): HTMLElement {
    const groupEl = buildDateGroupShell(group);
    populateGroupItems(groupEl, group, false);
    return groupEl;
  }

  function removeGroup(date: string): void {
    clearGroupResizeObserver(date);
    dirtyMeasureDates.delete(date);
    const el = groupElements.get(date);
    if (el) el.remove();
    groupElements.delete(date);
  }

  function clearListDom(): void {
    clearAllGroupResizeObservers();
    groupElements.clear();
    dirtyMeasureDates.clear();
    topSpacer = groupsHost = bottomSpacer = null;
    visibleStart = visibleEnd = -1;
    pendingAnchor = null;
  }

  function setRenderMode(nextMode: ListRenderMode): void {
    renderMode = nextMode;
    scrollContainer.dataset.cdsListMode = nextMode;
  }

  function switchRenderMode(nextMode: ListRenderMode): ScrollAnchor {
    const anchor = captureScrollAnchor();
    clearListDom();
    setRenderMode(nextMode);
    if (nextMode === "full") ensureFullDom();
    else ensureVirtualDom();
    return anchor;
  }

  function updateSpacers(start: number, end: number, offsets: number[]): void {
    const total = offsets[offsets.length - 1]!;
    topSpacer!.style.height = `${offsets[start]!}px`;
    bottomSpacer!.style.height = `${Math.max(0, total - offsets[end]!)}px`;
  }

  function renderVirtualVisibleRange(start: number, end: number): void {
    const visibleSlice = groups.slice(start, end);
    const visibleDates = new Set(visibleSlice.map((g) => g.date));
    for (const date of groupElements.keys()) {
      if (!visibleDates.has(date)) removeGroup(date);
    }
    for (const group of visibleSlice) {
      let el = groupElements.get(group.date);
      if (!el) {
        el = renderVirtualDateGroup(group);
        groupElements.set(group.date, el);
      } else {
        syncGroupItems(el, group, true);
        observeGroupHeight(el, group.date);
      }
      groupsHost!.appendChild(el);
    }
  }

  function renderFullList(): void {
    ensureFullDom();
    const nextEls: HTMLElement[] = [];
    const groupDates = new Set(groups.map((g) => g.date));
    for (const date of groupElements.keys()) {
      if (!groupDates.has(date)) removeGroup(date);
    }
    for (const group of groups) {
      let el = groupElements.get(group.date);
      if (!el) {
        el = renderFullDateGroup(group);
        groupElements.set(group.date, el);
      } else {
        syncGroupItems(el, group, false);
      }
      nextEls.push(el);
    }
    reconcileChildren(groupsHost!, nextEls);
  }

  function findItemById(id: string): DetailItem | undefined {
    return snapshotItems.find((item) => item.id === id);
  }

  function applyItemUpdates(items: readonly DetailItem[], ids: Set<string>): void {
    const map = new Map(items.map((item) => [item.id, item]));
    for (const group of groups) {
      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i]!;
        if (ids.has(item.id)) group.items[i] = map.get(item.id)!;
      }
    }
  }

  function patchItemIds(ids: Set<string>, ctx: RenderCardContext): void {
    if (!ids.size) return;
    const touchedItemsEls = new Set<HTMLElement>();
    for (const id of ids) {
      const item = findItemById(id);
      if (!item) continue;
      const wrap = scrollContainer.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
      if (!wrap) continue;
      const synced = syncCardWrap(wrap, item, ctx);
      if (synced !== wrap) wrap.replaceWith(synced);
      const itemsEl = synced
        .closest<HTMLElement>(".cds-date-group")
        ?.querySelector<HTMLElement>("[data-role='date-group-items']");
      if (itemsEl) touchedItemsEls.add(itemsEl);
    }
    for (const itemsEl of touchedItemsEls) {
      delete itemsEl.dataset.contentKey;
      delete itemsEl.dataset.visualKey;
    }
  }

  function compensateScrollDrift(
    scrollTop: number,
    offsetsBefore: number[],
    offsetsAfter: number[],
  ): void {
    const idx = findIndexAtOffset(offsetsBefore, scrollTop);
    const delta = offsetsAfter[idx]! - offsetsBefore[idx]!;
    if (Math.abs(delta) <= 1) return;
    anchorGuard = true;
    scrollContainer.scrollTop = scrollTop + delta;
    anchorGuard = false;
  }

  function runMeasurePass(
    allowAnchor: boolean,
    scrollTop: number,
    generation: number,
  ): void {
    if (isStale(generation) || renderMode !== "virtual" || !dirtyMeasureDates.size) return;
    const offsetsBefore = getOffsets();
    let heightsChanged = false;
    for (const date of [...dirtyMeasureDates]) {
      const el = groupElements.get(date);
      if (!el) {
        dirtyMeasureDates.delete(date);
        continue;
      }
      if (measureGroupElement(el, date)) heightsChanged = true;
      dirtyMeasureDates.delete(date);
    }
    if (!heightsChanged) return;

    markOffsetsDirty();
    const offsetsAfter = getOffsets();
    updateSpacers(visibleStart, visibleEnd, offsetsAfter);

    if (allowAnchor) {
      applyAnchorCompensation(offsetsBefore, offsetsAfter);
    } else {
      compensateScrollDrift(scrollTop, offsetsBefore, offsetsAfter);
    }
  }

  const loadOlderOnScroll = async (): Promise<void> => {
    if (loadingOlder || !groups.length || !deps.loadOlder) return;
    const generation = instanceGeneration;
    loadingOlder = true;
    try {
      await deps.loadOlder();
      if (isStale(generation)) return;
      refresh(true);
    } finally {
      loadingOlder = false;
    }
  };

  function computeWindow(scrollTop: number): { start: number; end: number } {
    const offsets = getOffsets();
    return computeGroupWindow(
      groups,
      offsets,
      scrollTop,
      scrollContainer.clientHeight,
      scrollDirection,
    );
  }

  function applyVirtualWindow(start: number, end: number, scrollTop: number, allowAnchor: boolean): void {
    if (!groups.length) {
      clearListDom();
      scrollContainer.replaceChildren();
      return;
    }

    ensureVirtualDom();
    const offsets = getOffsets();

    if (allowAnchor) {
      beginAnchorCycle(offsets, scrollTop);
      pendingAnchorPass = true;
    }

    visibleStart = start;
    visibleEnd = end;
    renderVirtualVisibleRange(start, end);
    updateSpacers(start, end, offsets);

    if (
      shouldLoadOlderOnScroll(scrollTop, deps.getLoadState(), loadingOlder) &&
      deps.loadOlder
    ) {
      void loadOlderOnScroll();
    }
  }

  function syncViewportImmediate(scrollTop: number): void {
    if (disposed || !scrollContainer.isConnected || renderMode !== "virtual") return;
    if (!groups.length) {
      applyVirtualWindow(0, 0, scrollTop, false);
      return;
    }

    const { start, end } = computeWindow(scrollTop);
    if (start === visibleStart && end === visibleEnd) return;
    applyVirtualWindow(start, end, scrollTop, false);
  }

  function reconcileScrollFrame(): void {
    if (disposed || !scrollContainer.isConnected || renderMode !== "virtual" || !groups.length) {
      return;
    }
    const scrollTop = pendingScrollTop;
    const allowAnchor = pendingAnchorPass;
    pendingAnchorPass = false;
    const { start, end } = computeWindow(scrollTop);
    if (start !== visibleStart || end !== visibleEnd) {
      applyVirtualWindow(start, end, scrollTop, false);
    }
    runMeasurePass(allowAnchor, scrollTop, instanceGeneration);
  }

  function scheduleScrollReconcile(): void {
    if (scrollRafPending || renderMode !== "virtual" || scheduler.shouldDeferHeavyWork()) return;
    scrollRafPending = true;
    const generation = instanceGeneration;
    requestAnimationFrame(() => {
      scrollRafPending = false;
      if (isStale(generation)) return;
      reconcileScrollFrame();
    });
  }

  function paintCurrentMode(
    forceAnchor: boolean,
    changeKind: "none" | "append" | "mutate",
    dataChanged: boolean,
    visualChanged: boolean,
  ): void {
    const scrollTop = scrollContainer.scrollTop;
    if (renderMode === "full") {
      if (!groups.length) {
        clearListDom();
        scrollContainer.replaceChildren();
        return;
      }
      renderFullList();
      if (
        shouldLoadOlderOnScroll(scrollTop, deps.getLoadState(), loadingOlder) &&
        deps.loadOlder
      ) {
        void loadOlderOnScroll();
      }
      return;
    }

    const { start, end } = computeWindow(scrollTop);
    applyVirtualWindow(
      start,
      end,
      scrollTop,
      forceAnchor || changeKind === "append" || dataChanged || visualChanged,
    );
    if (dirtyMeasureDates.size || forceAnchor) {
      pendingAnchorPass = pendingAnchorPass || forceAnchor || changeKind === "append";
      scheduleScrollReconcile();
    }
  }

  function refresh(forceAnchor = false): void {
    const items = deps.getItems();
    const ctx = deps.getRenderContext?.() ?? {};
    const nextMode = resolveListRenderMode(items.length, renderMode);
    const changes = diffItems(snapshotItems, items);
    const visualChangedIds = collectVisualChangedIds(items, ctx, itemVisualCache);
    const patchIds = new Set<string>([...visualChangedIds, ...changes.contentChanged]);
    const needsModeSwitch = nextMode !== renderMode;
    const needsStructural =
      needsModeSwitch || changes.structural || snapshotItems.length === 0 || renderMode === null;

    if (!needsStructural && patchIds.size === 0 && !forceAnchor) return;

    if (!needsStructural) {
      scheduler.notePatch();
      applyItemUpdates(items, patchIds);
      snapshotItems = [...items];
      patchItemIds(patchIds, ctx);
      return;
    }

    let anchor: ScrollAnchor | null = null;
    if (needsModeSwitch) {
      anchor = switchRenderMode(nextMode);
      visibleStart = visibleEnd = -1;
    }

    const prevGroups = snapshotGroups;
    groups = groupItemsByDate(items);
    snapshotGroups = groups;
    snapshotItems = [...items];
    itemVisualCache.clear();
    collectVisualChangedIds(items, ctx, itemVisualCache);
    markOffsetsDirty();
    scheduler.noteFullReconcile();

    const changeKind = classifyDataChange(prevGroups, groups);
    if (changeKind === "mutate") visibleStart = visibleEnd = -1;

    paintCurrentMode(forceAnchor, changeKind, true, true);
    if (anchor) restoreScrollAnchor(anchor);
  }

  scheduler.onLayoutSettled(() => {
    if (disposed || renderMode !== "virtual") return;
    const scrollTop = scrollContainer.scrollTop;
    if (dirtyMeasureDates.size) {
      runMeasurePass(false, scrollTop, instanceGeneration);
    }
  });

  const scrollToItem = (id: string): void => {
    const generation = instanceGeneration;
    refresh(false);
    requestAnimationFrame(() => {
      if (isStale(generation)) return;
      const target = scrollContainer.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      if (renderMode !== "virtual") return;
      const groupIndex = groups.findIndex((group) =>
        group.items.some((item) => item.id === id),
      );
      if (groupIndex < 0) return;
      const offsets = getOffsets();
      anchorGuard = true;
      scrollContainer.scrollTop = Math.max(
        0,
        offsets[groupIndex]! - scrollContainer.clientHeight * 0.2,
      );
      anchorGuard = false;
      refresh(false);
    });
  };

  scrollContainer.addEventListener(
    "scroll",
    () => {
      if (anchorGuard) return;
      const scrollTop = scrollContainer.scrollTop;
      const prevTop = lastScrollTop;
      lastScrollTop = scrollTop;
      if (renderMode === "virtual") {
        pendingScrollTop = scrollTop;
        scrollDirection =
          scrollTop > prevTop ? "down" : scrollTop < prevTop ? "up" : "none";
        syncViewportImmediate(scrollTop);
        scheduleScrollReconcile();
      } else if (
        shouldLoadOlderOnScroll(scrollTop, deps.getLoadState(), loadingOlder) &&
        deps.loadOlder
      ) {
        void loadOlderOnScroll();
      }
    },
    { passive: true, signal: lifecycle.signal },
  );

  const animateCommitRemovals = async (ids: string[]): Promise<void> => {
    if (!ids.length) return;
    const wraps = ids
      .map((id) => scrollContainer.querySelector<HTMLElement>(`[data-item-id="${id}"]`))
      .filter((wrap): wrap is HTMLElement => !!wrap);
    await Promise.all(wraps.map(collapseCardWrap));
  };

  return {
    paint: () => refresh(false),
    refresh: () => refresh(false),
    scrollToItem,
    animateCommitRemovals,
    setLayoutLocked: (locked: boolean) => scheduler.setLayoutLocked(locked),
    getScheduler: () => scheduler,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      instanceGeneration += 1;
      scrollRafPending = false;
      pendingAnchorPass = false;
      clearListDom();
      renderMode = null;
      delete scrollContainer.dataset.cdsListMode;
      lifecycle.abort();
    },
  };
}
