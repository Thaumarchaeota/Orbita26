import { prefersReducedLayoutMotion } from "../../../ui/layout-flip";
import type { ContentTabIdentity, ContentTabRecord, PaneId } from "./identity";
import { computeInsertIndex, mountTabReorder, reorderKeys, siblingTranslateX, type TabReorderHandle } from "./reorder";
import "./drag-session.css";

const DRAG_THRESHOLD = 4;
const FLIP_MS = 200;
const EDGE_BAND_RATIO = 0.2;
const EDGE_BAND_MIN = 72;
const EDGE_BAND_MAX = 180;
const ANCHOR_SOURCE_SEL = ".insight-tab-strip-home, .insight-tab-strip-timeline";

export type DragSourceKind = "sidebar" | "tab";

export type DragPhase = "pending" | "dragging";

export type ContentEdgeTarget = {
  kind: "content-edge";
  pane: PaneId;
  side: "left" | "right";
};

export type StripTarget = {
  kind: "strip";
  pane: PaneId;
  insertIndex: number;
};

export type DragTarget = ContentEdgeTarget | StripTarget;

export type DragSession = {
  source: DragSourceKind;
  identity?: ContentTabIdentity;
  tabKey?: string;
  title?: string;
  taskFilter?: string;
  sourcePane?: PaneId;
  pointerId: number;
  origin: { x: number; y: number };
  target?: DragTarget;
  phase: DragPhase;
};

export type SidebarDragPayload = {
  identity: ContentTabIdentity;
  title?: string;
  taskFilter?: string;
};

export type DragSessionHost = {
  paneGroup: HTMLElement;
  getHasRightPane: () => boolean;
  getLeftStripList: () => HTMLElement | null;
  getRightStripList: () => HTMLElement | null;
  getTabKeys: (pane: PaneId) => string[];
  getTabRecord: (key: string) => ContentTabRecord | undefined;
  paneForTabKey: (key: string) => PaneId | undefined;
  openToPane: (
    identity: ContentTabIdentity,
    pane: PaneId,
    opts?: { title?: string; taskFilter?: string; insertIndex?: number },
  ) => boolean;
  moveTab: (key: string, pane: PaneId, index: number) => boolean;
  getLeftViewport?: () => HTMLElement | null;
  getRightViewport?: () => HTMLElement | null;
  getOverlayHost?: () => HTMLElement;
};

export type DragSessionHandle = {
  wireTabReorder: (
    paneId: PaneId,
    listEl: HTMLElement,
    opts: {
      getKeys: () => string[];
      onReorder: (keys: string[]) => void;
      onMoveTab?: (key: string, pane: PaneId, index: number) => void;
    },
  ) => TabReorderHandle;
  attachIdentityDragSource: (
    el: HTMLElement,
    resolve: () => SidebarDragPayload | null,
    signal?: AbortSignal,
  ) => void;
  dispose: () => void;
};

export function computeEdgeBandWidth(contentWidth: number): number {
  const raw = contentWidth * EDGE_BAND_RATIO;
  return Math.max(EDGE_BAND_MIN, Math.min(EDGE_BAND_MAX, raw));
}

export function hitContentEdge(
  clientX: number,
  rect: DOMRect,
  clientY?: number,
): { side: "left" | "right"; pane: PaneId } | null {
  const width = rect.width;
  if (width <= 0) return null;
  if (clientY !== undefined && (clientY < rect.top || clientY >= rect.bottom)) return null;
  let band = computeEdgeBandWidth(width);
  if (band * 2 > width) band = width / 2;
  const left = rect.left;
  if (clientX < left + band) return { side: "left", pane: "left" };
  if (clientX > left + width - band) return { side: "right", pane: "right" };
  return null;
}

function isAnchorIdentity(identity?: ContentTabIdentity): boolean {
  return Boolean(identity && identity.kind === "fixed" && identity.dest === "timeline");
}

function isAnchorSourceEl(el: HTMLElement): boolean {
  return Boolean(el.closest(ANCHOR_SOURCE_SEL));
}

function tabElements(listEl: HTMLElement): HTMLElement[] {
  return [...listEl.querySelectorAll<HTMLElement>(".insight-content-tab[data-tab-key]")];
}

function stripInsertIndex(listEl: HTMLElement, clientX: number, excludeKey?: string): number {
  const els = tabElements(listEl).filter((el) => el.dataset.tabKey !== excludeKey);
  const centers = els.map((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  return computeInsertIndex(centers, clientX);
}

function pointInRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom;
}

function liveRect(el: HTMLElement | null): DOMRect | null {
  if (!el?.isConnected || el.hidden) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

function overlayBandWidth(rect: DOMRect): number {
  let band = computeEdgeBandWidth(rect.width);
  if (band * 2 > rect.width) band = rect.width / 2;
  return band;
}

export function mountDragSession(host: DragSessionHost): DragSessionHandle {
  const ac = new AbortController();
  const { signal } = ac;
  let session: DragSession | null = null;
  let layerEl: HTMLElement | null = null;
  let previewEl: HTMLElement | null = null;
  let leftOverlay: HTMLElement | null = null;
  let rightOverlay: HTMLElement | null = null;
  let sourceEl: HTMLElement | null = null;
  let overSourceStrip = false;
  let tabDrag: {
    paneId: PaneId;
    key: string;
    fromIndex: number;
    insertIndex: number;
    tabEl: HTMLElement;
    tabWidth: number;
    tabEls: HTMLElement[];
    onReorder: (keys: string[]) => void;
    getKeys: () => string[];
  } | null = null;

  function overlayParent(): HTMLElement {
    return host.getOverlayHost?.() ?? document.body;
  }

  function leftViewportEl(): HTMLElement | null {
    return (
      host.getLeftViewport?.() ??
      host.paneGroup.querySelector<HTMLElement>("#adminLeftViewport") ??
      document.querySelector<HTMLElement>("#adminLeftViewport")
    );
  }

  function rightViewportEl(): HTMLElement | null {
    if (!host.getHasRightPane()) return null;
    return (
      host.getRightViewport?.() ??
      host.paneGroup.querySelector<HTMLElement>("#adminRightViewport") ??
      document.querySelector<HTMLElement>("#adminRightViewport")
    );
  }

  function leftContentRect(): DOMRect | null {
    return liveRect(leftViewportEl()) ?? liveRect(host.paneGroup);
  }

  function rightContentRect(): DOMRect | null {
    return liveRect(rightViewportEl());
  }

  function ensureLayer(): void {
    if (layerEl?.isConnected) return;
    layerEl = document.createElement("div");
    layerEl.className = "insight-drag-overlay-root";
    layerEl.setAttribute("aria-hidden", "true");
    leftOverlay = document.createElement("div");
    leftOverlay.className = "insight-drag-edge-overlay insight-drag-edge-left";
    leftOverlay.textContent = "在左侧打开";
    rightOverlay = document.createElement("div");
    rightOverlay.className = "insight-drag-edge-overlay insight-drag-edge-right";
    rightOverlay.textContent = "在右侧分栏打开";
    previewEl = document.createElement("div");
    previewEl.className = "insight-drag-floating-preview";
    previewEl.hidden = true;
    layerEl.append(leftOverlay, rightOverlay, previewEl);
    overlayParent().appendChild(layerEl);
  }

  function hideOverlays(): void {
    leftOverlay?.classList.remove("is-active");
    rightOverlay?.classList.remove("is-active");
    if (previewEl) {
      previewEl.hidden = true;
      previewEl.textContent = "";
      previewEl.style.transform = "";
    }
  }

  function clearSourcePlaceholder(): void {
    sourceEl?.classList.remove("insight-drag-source-placeholder", "is-dragging");
    if (sourceEl) sourceEl.style.visibility = "";
  }

  function clearSiblingReflow(): void {
    if (!tabDrag) return;
    for (const el of tabDrag.tabEls) {
      if (el === tabDrag.tabEl) continue;
      el.style.transition = "";
      el.style.transform = "";
    }
    overSourceStrip = false;
  }

  function clearPreviewUi(): void {
    hideOverlays();
    clearSourcePlaceholder();
    if (tabDrag) {
      clearSiblingReflow();
      tabDrag.tabEl.style.transform = "";
      tabDrag.tabEl.classList.remove("is-dragging", "insight-drag-source-placeholder");
      tabDrag = null;
    }
    sourceEl = null;
    session = null;
  }

  function layoutEdgeOverlay(el: HTMLElement, rect: DOMRect, side: "left" | "right"): void {
    const band = overlayBandWidth(rect);
    const left = side === "left" ? rect.left : rect.right - band;
    el.style.left = `${left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${band}px`;
    el.style.height = `${rect.height}px`;
  }

  // Hit only content viewports in 2D; chrome/titlebar/outside-window X overlap must not count.
  // 对照页右侧空分区期间暂停拖出左右内容分栏。分栏实现保留，见 checkpoint IC-GCC-2026-10-08。
  function resolveEdgeTarget(clientX: number, clientY: number): ContentEdgeTarget | undefined {
    return undefined;
    const leftRect = leftContentRect();
    const rightRect = rightContentRect();
    if (leftRect && pointInRect(clientX, clientY, leftRect)) {
      const hit = hitContentEdge(clientX, leftRect, clientY);
      if (hit?.side === "left") return { kind: "content-edge", pane: "left", side: "left" };
      if (hit?.side === "right" && !rightRect) return { kind: "content-edge", pane: "right", side: "right" };
      return undefined;
    }
    if (rightRect && pointInRect(clientX, clientY, rightRect)) {
      const hit = hitContentEdge(clientX, rightRect, clientY);
      if (hit?.side === "right") return { kind: "content-edge", pane: "right", side: "right" };
    }
    return undefined;
  }

  function stripListForPane(pane: PaneId): HTMLElement | null {
    return pane === "left" ? host.getLeftStripList() : host.getRightStripList();
  }

  function isOverStrip(stripList: HTMLElement | null, clientX: number, clientY: number): boolean {
    if (!stripList) return false;
    const strip = stripList.closest(".insight-tab-strip") ?? stripList;
    const rect = strip.getBoundingClientRect();
    // The strip host includes the window-control reservation as right padding;
    // it must not accept tab drops (docs/plans/insight-tab-overflow.md).
    const rightPadding = Number.parseFloat(getComputedStyle(strip).paddingRight) || 0;
    const layoutWidth = strip instanceof HTMLElement ? strip.offsetWidth : 0;
    const scale = layoutWidth > 0 ? rect.width / layoutWidth : 1;
    const right = Math.max(rect.left, rect.right - rightPadding * scale);
    return clientX >= rect.left && clientX < right && clientY >= rect.top && clientY < rect.bottom;
  }

  function resolveTarget(clientX: number, clientY: number): DragTarget | undefined {
    if (!session) return undefined;
    const edge = resolveEdgeTarget(clientX, clientY);
    if (edge) return edge;
    if (session.source === "sidebar") return undefined;
    const leftList = host.getLeftStripList();
    const rightList = host.getRightStripList();
    if (isOverStrip(leftList, clientX, clientY) && leftList) {
      return { kind: "strip", pane: "left", insertIndex: stripInsertIndex(leftList, clientX, session.tabKey) };
    }
    if (isOverStrip(rightList, clientX, clientY) && rightList && host.getHasRightPane()) {
      return { kind: "strip", pane: "right", insertIndex: stripInsertIndex(rightList, clientX, session.tabKey) };
    }
    return undefined;
  }

  function applyTargetUi(target: DragTarget | undefined, clientX: number, clientY: number): void {
    ensureLayer();
    const leftRect = leftContentRect();
    const rightRect = rightContentRect();
    if (leftOverlay && leftRect) layoutEdgeOverlay(leftOverlay, leftRect, "left");
    if (rightOverlay) {
      const rightHost = rightRect ?? leftRect;
      if (rightHost) layoutEdgeOverlay(rightOverlay, rightHost, "right");
    }
    leftOverlay?.classList.toggle("is-active", target?.kind === "content-edge" && target.side === "left");
    rightOverlay?.classList.toggle("is-active", target?.kind === "content-edge" && target.side === "right");

    if (!session || !previewEl) return;
    previewEl.hidden = false;
    previewEl.textContent = session.title ?? (session.source === "tab" ? "标签" : "打开");
    previewEl.style.transform = `translate(${clientX + 12}px, ${clientY + 12}px)`;
  }

  function sourceStripList(): HTMLElement | null {
    if (!tabDrag) return null;
    return stripListForPane(tabDrag.paneId);
  }

  function applyTabReflow(clientX: number, clientY: number): void {
    if (!tabDrag || !session) return;
    const list = sourceStripList();
    const over = isOverStrip(list, clientX, clientY);
    if (!over) {
      if (overSourceStrip) clearSiblingReflow();
      return;
    }
    overSourceStrip = true;
    const reduced = prefersReducedLayoutMotion();
    const centers = tabDrag.tabEls
      .map((el, i) => ({ el, i }))
      .filter(({ i }) => i !== tabDrag!.fromIndex)
      .map(({ el }) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      });
    tabDrag.insertIndex = computeInsertIndex(centers, clientX);
    for (let i = 0; i < tabDrag.tabEls.length; i++) {
      const el = tabDrag.tabEls[i];
      if (i === tabDrag.fromIndex) continue;
      const offset = siblingTranslateX(i, tabDrag.fromIndex, tabDrag.insertIndex, tabDrag.tabWidth);
      el.style.transition = reduced ? "none" : `transform ${FLIP_MS}ms ease`;
      el.style.transform = offset ? `translateX(${offset}px)` : "";
    }
  }

  function validateTarget(target: DragTarget): boolean {
    if (!session) return false;
    if (target.kind === "content-edge") {
      if (session.source === "tab") return Boolean(session.tabKey);
      return Boolean(session.identity) && !isAnchorIdentity(session.identity);
    }
    if (target.kind === "strip") {
      if (session.source !== "tab" || !session.tabKey) return false;
      if (target.pane === "right" && !host.getHasRightPane()) return false;
      return Boolean(stripListForPane(target.pane));
    }
    return false;
  }

  function insertIndexForEdge(pane: PaneId): number {
    return host.getTabKeys(pane).length;
  }

  function commitSession(): boolean {
    if (!session || session.phase !== "dragging" || !session.target) return false;
    const target = session.target;
    if (!validateTarget(target)) return false;

    if (target.kind === "content-edge") {
      const insertIndex = insertIndexForEdge(target.pane);
      if (session.source === "tab" && session.tabKey) {
        const sourcePane = host.paneForTabKey(session.tabKey);
        if (sourcePane === target.pane) return true;
        return host.moveTab(session.tabKey, target.pane, insertIndex);
      }
      if (session.identity) {
        return host.openToPane(session.identity, target.pane, {
          title: session.title,
          taskFilter: session.taskFilter,
          insertIndex,
        });
      }
      return false;
    }

    if (target.kind === "strip" && session.source === "tab" && session.tabKey) {
      const insertIndex = target.insertIndex;
      const sourcePane = host.paneForTabKey(session.tabKey);
      if (sourcePane === target.pane) {
        if (!tabDrag) return false;
        const keys = tabDrag.getKeys();
        const fromIndex = keys.indexOf(session.tabKey);
        if (fromIndex < 0) return false;
        const next = reorderKeys(keys, fromIndex, insertIndex);
        if (next.join("\0") === keys.join("\0")) return true;
        tabDrag.onReorder(next);
        return true;
      }
      return host.moveTab(session.tabKey, target.pane, insertIndex);
    }

    return false;
  }

  // try/finally: commit throw or host false must still drop overlay, placeholder, and reflow.
  function endSession(commit: boolean, clientX: number, clientY: number): void {
    if (!session) return;
    try {
      if (commit && session.phase === "dragging") {
        session.target = resolveTarget(clientX, clientY);
        commitSession();
      }
    } finally {
      clearPreviewUi();
    }
  }

  function startDragging(): void {
    if (!session) return;
    session.phase = "dragging";
    ensureLayer();
    sourceEl?.classList.add("insight-drag-source-placeholder", "is-dragging");
    if (tabDrag) {
      tabDrag.tabEl.classList.add("is-dragging", "insight-drag-source-placeholder");
      tabDrag.tabEl.style.transition = "none";
      tabDrag.tabEl.style.transform = "";
    }
  }

  function onWindowMove(e: PointerEvent): void {
    if (!session || e.pointerId !== session.pointerId) return;
    if (sourceEl && !sourceEl.isConnected) {
      endSession(false, e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - session.origin.x;
    const dy = e.clientY - session.origin.y;
    if (session.phase === "pending") {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      startDragging();
    }
    session.target = resolveTarget(e.clientX, e.clientY);
    applyTargetUi(session.target, e.clientX, e.clientY);
    applyTabReflow(e.clientX, e.clientY);
  }

  function onWindowUp(e: PointerEvent): void {
    if (!session || e.pointerId !== session.pointerId) return;
    try {
      sourceEl?.releasePointerCapture(e.pointerId);
    } catch {
      /* released */
    }
    endSession(true, e.clientX, e.clientY);
  }

  function onWindowCancel(e: PointerEvent): void {
    if (!session || e.pointerId !== session.pointerId) return;
    endSession(false, e.clientX, e.clientY);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && session) endSession(false, session.origin.x, session.origin.y);
  }

  function onDocumentLeave(e: PointerEvent): void {
    if (!session || e.pointerId !== session.pointerId) return;
    if (e.relatedTarget) return;
    endSession(false, e.clientX, e.clientY);
  }

  function beginSidebar(e: PointerEvent, payload: SidebarDragPayload, el: HTMLElement): void {
    if (e.button !== 0 || session) return;
    if (isAnchorIdentity(payload.identity) || isAnchorSourceEl(el)) return;
    sourceEl = el;
    session = {
      source: "sidebar",
      identity: payload.identity,
      title: payload.title,
      taskFilter: payload.taskFilter,
      pointerId: e.pointerId,
      origin: { x: e.clientX, y: e.clientY },
      phase: "pending",
    };
    el.setPointerCapture(e.pointerId);
  }

  window.addEventListener("pointermove", onWindowMove, { signal });
  window.addEventListener("pointerup", onWindowUp, { signal });
  window.addEventListener("pointercancel", onWindowCancel, { signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  document.addEventListener("pointerleave", onDocumentLeave, { signal });

  return {
    wireTabReorder(paneId, listEl, opts) {
      return mountTabReorder(listEl, {
        getKeys: opts.getKeys,
        onReorder: opts.onReorder,
        dragThreshold: DRAG_THRESHOLD,
        onTabDragStart: (info) => {
          if (session) return false;
          if (isAnchorSourceEl(info.tabEl)) return false;
          const record = host.getTabRecord(info.key);
          if (isAnchorIdentity(record?.identity)) return false;
          sourceEl = info.tabEl;
          session = {
            source: "tab",
            tabKey: info.key,
            identity: record?.identity,
            title: record?.title,
            sourcePane: paneId,
            pointerId: info.pointerId,
            origin: { x: info.startX, y: info.startY },
            phase: "pending",
          };
          tabDrag = {
            paneId,
            key: info.key,
            fromIndex: info.fromIndex,
            insertIndex: info.fromIndex,
            tabEl: info.tabEl,
            tabWidth: info.tabWidth,
            tabEls: info.tabEls,
            onReorder: opts.onReorder,
            getKeys: opts.getKeys,
          };
          return true;
        },
        onTabDragEnd: (commit, clientX, clientY) => {
          endSession(commit, clientX, clientY);
        },
      });
    },

    attachIdentityDragSource(el, resolve, srcSignal) {
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if (isAnchorSourceEl(el)) return;
        const payload = resolve();
        if (!payload) return;
        beginSidebar(e, payload, el);
      };
      el.addEventListener("pointerdown", onDown, { signal: srcSignal });
      if (srcSignal) {
        srcSignal.addEventListener("abort", () => {
          if (sourceEl === el && session) endSession(false, session.origin.x, session.origin.y);
        });
      }
    },

    dispose() {
      endSession(false, 0, 0);
      layerEl?.remove();
      layerEl = null;
      leftOverlay = null;
      rightOverlay = null;
      previewEl = null;
      ac.abort();
    },
  };
}

let activeHandle: DragSessionHandle | null = null;

export function registerDragSession(handle: DragSessionHandle | null): void {
  activeHandle = handle;
}

export function attachIdentityDragSource(
  el: HTMLElement,
  resolve: () => SidebarDragPayload | null,
  signal?: AbortSignal,
): void {
  activeHandle?.attachIdentityDragSource(el, resolve, signal);
}
