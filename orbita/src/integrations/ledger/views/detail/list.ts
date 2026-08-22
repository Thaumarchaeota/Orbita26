import { formatDateLabelZh } from "../../../../ui/date-picker";
import { DATE_HEADER_HEIGHT, DATE_PIN_HEIGHT, ROW_HEIGHT_ESTIMATE, VIRTUAL_BUFFER } from "../../constants";
import { isBalanceItem, isPadItem, isTransactionItem } from "../../domain/detail-item";
import { computeScrollAnchorDelta, findIndexAtOffset, prefixOffsets, shouldLoadOlderOnScroll } from "../../domain/virtual-list";
import { getLoadState, tryLoadOlder } from "../../state/ledger";
import type { BalanceItem, DetailItem, Entry, PadItem } from "../../types";
import { renderBalanceBlockHtml, renderEntryBlockHtml, renderPadBlockHtml } from "./render";

export type FlatItem =
  | { kind: "date"; date: string; id: string }
  | { kind: "entry"; entry: Entry; id: string }
  | { kind: "pad"; item: PadItem; id: string }
  | { kind: "balance"; item: BalanceItem; id: string };

export function buildFlatList(items: DetailItem[]): FlatItem[] {
  const flat: FlatItem[] = [];
  let lastDate: string | null = null;
  for (const item of items) {
    if (item.date !== lastDate) {
      flat.push({ kind: "date", date: item.date, id: `date:${item.date}` });
      lastDate = item.date;
    }
    if (isPadItem(item)) flat.push({ kind: "pad", item, id: item.id });
    else if (isBalanceItem(item)) flat.push({ kind: "balance", item, id: item.id });
    else if (isTransactionItem(item)) flat.push({ kind: "entry", entry: item, id: item.id });
  }
  return flat;
}

export type DetailVirtualListDeps = {
  getItems: () => DetailItem[];
  expandedCosts?: () => ReadonlySet<string>;
  getLoadState?: typeof getLoadState;
  loadOlder?: typeof tryLoadOlder;
};

export type DetailVirtualListHandle = {
  paint: () => void;
  refresh: () => void;
  scheduleRender: () => void;
  scrollToEntry: (id: string) => void;
  animateCommitRemovals: (ids: string[]) => Promise<void>;
  dispose: () => void;
};

function isRowItem(item: FlatItem): boolean { return item.kind !== "date"; }

/** The Surface owns every mutable virtual-list measurement and scroll listener. */
export function createDetailVirtualList(
  scrollContainer: HTMLElement,
  deps: DetailVirtualListDeps = {},
): DetailVirtualListHandle {
  const getItems = deps.getItems;
  const getCurrentLoadState = deps.getLoadState ?? getLoadState;
  const loadOlder = deps.loadOlder ?? tryLoadOlder;
  const lifecycle = new AbortController();
  const rowHeights = new Map<string, number>();
  let flatItems: FlatItem[] = [];
  let datePinEl: HTMLElement | null = null;
  let spacerEl: HTMLElement | null = null;
  let contentEl: HTMLElement | null = null;
  let loadingOlder = false;
  let renderToken = 0;
  let disposed = false;
  const itemHeight = (item: FlatItem) => item.kind === "date" ? DATE_HEADER_HEIGHT : rowHeights.get(item.id) || ROW_HEIGHT_ESTIMATE;
  const offsetsFor = (items: FlatItem[]) => prefixOffsets(items.map(itemHeight));
  const renderStartFor = (start: number) => start > 0 && isRowItem(flatItems[start]!) && flatItems[start - 1]?.kind === "date" ? start - 1 : start;
  const dateAtScroll = (offsets: number[], top: number) => {
    for (let index = findIndexAtOffset(offsets, top); index >= 0; index -= 1) {
      const item = flatItems[index];
      if (item?.kind === "date") return item.date;
    }
    return null;
  };
  const itemHtml = (item: FlatItem) => {
    if (item.kind === "date") return `<div class="detail-date-header" data-date="${item.date}">${item.date}</div>`;
    if (item.kind === "pad") return renderPadBlockHtml(item.item);
    if (item.kind === "balance") return renderBalanceBlockHtml(item.item);
    return renderEntryBlockHtml(item.entry, deps.expandedCosts?.() ?? new Set());
  };
  const ensureDom = () => {
    if (spacerEl && contentEl?.parentElement) return;
    datePinEl = document.createElement("div");
    datePinEl.className = "detail-date-pin";
    const viewport = document.createElement("div");
    viewport.className = "detail-virtual-viewport";
    spacerEl = document.createElement("div");
    spacerEl.className = "detail-virtual-spacer";
    contentEl = document.createElement("div");
    contentEl.className = "detail-virtual-content";
    viewport.append(spacerEl, contentEl);
    scrollContainer.replaceChildren(datePinEl, viewport);
  };
  const measureVisible = () => contentEl?.querySelectorAll<HTMLElement>(".detail-card-wrap").forEach((wrap) => {
    if (wrap.dataset.entryId) rowHeights.set(wrap.dataset.entryId, wrap.offsetHeight + 12);
  });
  const loadOlderOnScroll = async () => {
    if (loadingOlder || !flatItems.length) return;
    loadingOlder = true;
    try { await loadOlder(); paint(); } finally { loadingOlder = false; }
  };
  const paint = () => {
    if (disposed || !scrollContainer.isConnected) return;
    flatItems = buildFlatList(getItems());
    if (!flatItems.length) {
      scrollContainer.innerHTML = '<div class="detail-empty">暂无记录</div>';
      datePinEl = spacerEl = contentEl = null;
      return;
    }
    ensureDom();
    const offsets = offsetsFor(flatItems);
    const scrollTop = scrollContainer.scrollTop;
    const rawStart = Math.max(0, findIndexAtOffset(offsets, scrollTop) - VIRTUAL_BUFFER);
    const start = renderStartFor(rawStart);
    let end = start;
    while (end < flatItems.length && offsets[end] < scrollTop + scrollContainer.clientHeight + VIRTUAL_BUFFER * ROW_HEIGHT_ESTIMATE) end += 1;
    end = Math.min(flatItems.length, end + VIRTUAL_BUFFER);
    const pinDate = dateAtScroll(offsets, scrollTop);
    const slice = flatItems.slice(start, end);
    const heightsBefore = new Map(rowHeights);
    spacerEl!.style.height = `${offsets[offsets.length - 1]}px`;
    contentEl!.style.transform = `translateY(${offsets[start]}px)`;
    contentEl!.innerHTML = slice.map((item, index) => {
      const globalIndex = start + index;
      return item.kind === "date" && pinDate === item.date && offsets[globalIndex] - scrollTop < DATE_PIN_HEIGHT ? "" : itemHtml(item);
    }).join("");
    measureVisible();
    datePinEl!.textContent = pinDate ? formatDateLabelZh(pinDate) : "";
    datePinEl!.hidden = !pinDate;
    if ([...rowHeights].some(([id, height]) => heightsBefore.get(id) !== height)) {
      const anchor = slice.find(isRowItem);
      if (anchor) scrollContainer.scrollTop += computeScrollAnchorDelta(offsets, offsetsFor(flatItems), flatItems.findIndex((item) => item.id === anchor.id));
    }
    if (shouldLoadOlderOnScroll(scrollTop, getCurrentLoadState(), loadingOlder)) void loadOlderOnScroll();
  };
  const scheduleRender = () => {
    const token = ++renderToken;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (token === renderToken) paint(); }));
  };
  const refresh = () => scheduleRender();
  const scrollToEntry = (id: string) => {
    refresh();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = scrollContainer.querySelector<HTMLElement>(`.detail-card-wrap[data-entry-id="${id}"]`);
      if (element) scrollContainer.scrollTop = Math.max(0, element.offsetTop - scrollContainer.clientHeight * 0.2);
    }));
  };
  const collapse = (wrap: HTMLElement) => new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; wrap.remove(); paint(); resolve(); } };
    wrap.style.maxHeight = `${wrap.offsetHeight}px`;
    wrap.addEventListener("transitionend", (event) => { if (event.propertyName === "max-height") finish(); }, { once: true });
    requestAnimationFrame(() => { wrap.classList.add("is-collapsing"); wrap.style.maxHeight = "0"; });
    setTimeout(finish, 500);
  });
  const animateCommitRemovals = async (ids: string[]) => {
    const wraps = ids.map((id) => scrollContainer.querySelector<HTMLElement>(`.detail-card-wrap[data-entry-id="${id}"]`)).filter((wrap): wrap is HTMLElement => !!wrap);
    await Promise.all(wraps.map(collapse));
  };
  scrollContainer.addEventListener("scroll", () => requestAnimationFrame(paint), { passive: true, signal: lifecycle.signal });
  return { paint, refresh, scheduleRender, scrollToEntry, animateCommitRemovals, dispose: () => { disposed = true; lifecycle.abort(); } };
}
