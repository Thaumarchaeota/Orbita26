import {
  DATE_HEADER_HEIGHT,
  DATE_PIN_HEIGHT,
  ROW_HEIGHT_ESTIMATE,
  VIRTUAL_BUFFER,
} from "../../constants";
import type { Entry } from "../../types";
import { getLoadState, tryLoadOlder } from "../../state/ledger";
import { getFilteredEntries } from "./filters";
import { renderEntryBlockHtml } from "./render";

export type FlatItem =
  | { kind: "date"; date: string; id: string }
  | { kind: "entry"; entry: Entry; id: string };

export function buildFlatList(entries: Entry[]): FlatItem[] {
  const items: FlatItem[] = [];
  let lastDate: string | null = null;
  for (const e of entries) {
    if (e.date !== lastDate) {
      items.push({ kind: "date", date: e.date, id: `date:${e.date}` });
      lastDate = e.date;
    }
    items.push({ kind: "entry", entry: e, id: e.id });
  }
  return items;
}

let detailRenderToken = 0;
let flatItems: FlatItem[] = [];
const rowHeights = new Map<string, number>();
let scrollContainer: HTMLElement | null = null;
let datePinEl: HTMLElement | null = null;
let spacerEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;
let loadingOlder = false;

const DEFAULT_ENTRY_HEIGHT = ROW_HEIGHT_ESTIMATE;

function itemHeight(item: FlatItem): number {
  if (item.kind === "date") return DATE_HEADER_HEIGHT;
  return rowHeights.get(item.id) || DEFAULT_ENTRY_HEIGHT;
}

function prefixOffsets(items: FlatItem[]): number[] {
  const offsets = [0];
  let sum = 0;
  for (const it of items) {
    sum += itemHeight(it);
    offsets.push(sum);
  }
  return offsets;
}

function findIndexAtOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function resolveRenderStart(startIdx: number): number {
  if (startIdx > 0 && flatItems[startIdx]?.kind === "entry") {
    const prev = startIdx - 1;
    if (flatItems[prev]?.kind === "date") return prev;
  }
  return startIdx;
}

function currentDateAtScroll(offsets: number[], scrollTop: number): string | null {
  const idx = findIndexAtOffset(offsets, scrollTop);
  for (let i = idx; i >= 0; i -= 1) {
    const item = flatItems[i];
    if (item.kind === "date") return item.date;
  }
  return null;
}

function shouldSkipDateHeader(
  item: FlatItem & { kind: "date" },
  globalIdx: number,
  offsets: number[],
  scrollTop: number,
  pinDate: string | null,
): boolean {
  if (!pinDate || item.date !== pinDate) return false;
  const relTop = offsets[globalIdx] - scrollTop;
  return relTop < DATE_PIN_HEIGHT;
}

function mountItem(item: FlatItem): string {
  if (item.kind === "date") {
    return `<div class="detail-date-header" data-date="${item.date}">${item.date}</div>`;
  }
  return renderEntryBlockHtml(item.entry);
}

function measureVisible(): void {
  if (!contentEl) return;
  contentEl.querySelectorAll<HTMLElement>(".entry-block-wrap").forEach((wrap) => {
    const id = wrap.dataset.entryId;
    if (id) rowHeights.set(id, wrap.offsetHeight + 12);
  });
}

function ensureDatePin(): HTMLElement | null {
  if (!scrollContainer) return null;
  if (datePinEl && datePinEl.isConnected) return datePinEl;
  datePinEl = document.createElement("div");
  datePinEl.className = "detail-date-pin";
  return datePinEl;
}

function updateDatePin(pinDate: string | null): void {
  const pin = ensureDatePin();
  if (!pin) return;
  pin.textContent = pinDate || "";
  pin.hidden = !pinDate;
}

function ensureVirtualDom(): void {
  if (!scrollContainer) return;
  if (spacerEl && contentEl && spacerEl.parentElement) return;
  const pin = ensureDatePin();
  scrollContainer.innerHTML = "";
  if (pin) scrollContainer.appendChild(pin);
  const viewport = document.createElement("div");
  viewport.className = "detail-virtual-viewport";
  spacerEl = document.createElement("div");
  spacerEl.className = "detail-virtual-spacer";
  contentEl = document.createElement("div");
  contentEl.className = "detail-virtual-content";
  viewport.appendChild(spacerEl);
  viewport.appendChild(contentEl);
  scrollContainer.appendChild(viewport);
  if (!scrollContainer.dataset.scrollBound) {
    scrollContainer.dataset.scrollBound = "1";
    scrollContainer.addEventListener("scroll", () => requestAnimationFrame(paintDetailList), {
      passive: true,
    });
  }
}

export function paintDetailList(): void {
  if (!scrollContainer) scrollContainer = document.getElementById("detail-list");
  if (!scrollContainer) return;

  const entries = getFilteredEntries();
  flatItems = buildFlatList(entries);
  if (!flatItems.length) {
    scrollContainer.innerHTML = '<div class="detail-empty">暂无记录</div>';
    datePinEl = null;
    spacerEl = null;
    contentEl = null;
    return;
  }
  ensureVirtualDom();

  const offsets = prefixOffsets(flatItems);
  const totalHeight = offsets[offsets.length - 1];
  const scrollTop = scrollContainer.scrollTop;
  const viewH = scrollContainer.clientHeight;
  const rawStart = Math.max(0, findIndexAtOffset(offsets, scrollTop) - VIRTUAL_BUFFER);
  const renderStart = resolveRenderStart(rawStart);
  const endY = scrollTop + viewH;
  let endIdx = renderStart;
  while (endIdx < flatItems.length && offsets[endIdx] < endY + VIRTUAL_BUFFER * DEFAULT_ENTRY_HEIGHT) {
    endIdx += 1;
  }
  endIdx = Math.min(flatItems.length, endIdx + VIRTUAL_BUFFER);

  const pinDate = currentDateAtScroll(offsets, scrollTop);
  const slice = flatItems.slice(renderStart, endIdx);
  const top = offsets[renderStart];
  const heightsBefore = new Map(rowHeights);
  spacerEl!.style.height = `${totalHeight}px`;
  contentEl!.style.transform = `translateY(${top}px)`;
  contentEl!.innerHTML = slice
    .map((item, i) => {
      const globalIdx = renderStart + i;
      if (item.kind === "date" && shouldSkipDateHeader(item, globalIdx, offsets, scrollTop, pinDate)) {
        return "";
      }
      return mountItem(item);
    })
    .join("");
  measureVisible();
  updateDatePin(pinDate);

  let heightsChanged = false;
  for (const [id, h] of rowHeights) {
    if (heightsBefore.get(id) !== h) {
      heightsChanged = true;
      break;
    }
  }
  if (heightsChanged) {
    const anchor = slice.find((i) => i.kind === "entry");
    if (anchor && anchor.kind === "entry") {
      const anchorIdx = flatItems.findIndex((i) => i.id === anchor.id);
      const anchorTop = offsets[anchorIdx];
      const newOffsets = prefixOffsets(flatItems);
      scrollContainer.scrollTop += newOffsets[anchorIdx] - anchorTop;
    }
  }

  if (scrollTop < 80 && getLoadState() !== "ready" && !loadingOlder) {
    void loadOlderOnScroll();
  }
}

async function loadOlderOnScroll(): Promise<void> {
  if (loadingOlder || !flatItems.length) return;
  loadingOlder = true;
  try {
    await tryLoadOlder();
    paintDetailList();
  } finally {
    loadingOlder = false;
  }
}

export function scheduleDetailRender(): void {
  const token = ++detailRenderToken;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== detailRenderToken) return;
      paintDetailList();
    });
  });
}

export function initDetailList(): void {
  scrollContainer = document.getElementById("detail-list");
  paintDetailList();
}

export function collapseEntryWrap(wrap: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      wrap.remove();
      paintDetailList();
      resolve();
    };
    const h = wrap.offsetHeight;
    wrap.style.maxHeight = `${h}px`;
    wrap.addEventListener(
      "transitionend",
      (e) => {
        if (e.propertyName === "max-height") finish();
      },
      { once: true },
    );
    requestAnimationFrame(() => {
      wrap.classList.add("is-collapsing");
      wrap.style.maxHeight = "0";
    });
    setTimeout(finish, 500);
  });
}

export async function animateCommitRemovals(ids: string[]): Promise<void> {
  const wraps = ids
    .map((id) => document.querySelector<HTMLElement>(`.entry-block-wrap[data-entry-id="${id}"]`))
    .filter((w): w is HTMLElement => !!w);
  if (!wraps.length) return;
  await Promise.all(wraps.map((w) => collapseEntryWrap(w)));
}
