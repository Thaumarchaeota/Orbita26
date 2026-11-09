import type { DragSessionHandle } from "./drag-session";
import type { ActiveSurface, ContentTabRecord, PaneId } from "./identity";
import { mountTabReorder } from "./reorder";
import type { TabStripStyle } from "./session-persist";
import "./tab-strip.css";

export type TabStripOptions = {
  showAnchors?: boolean;
  showNewTab?: boolean;
  paneId?: PaneId;
  dragSession?: DragSessionHandle;
};

export type TabStripCallbacks = {
  getActive: () => ActiveSurface;
  getTabs: () => ContentTabRecord[];
  getStyle: () => TabStripStyle;
  onSelectHome: () => void;
  onSelectTimeline: () => void;
  onNewTab: () => void;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  onReorder: (keys: string[]) => void;
  onMoveTab?: (key: string, pane: PaneId, index: number) => void;
  onFocusPane?: () => void;
};

export type TabStripHandle = {
  refresh: () => void;
  dispose: () => void;
};

const HOME_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V7.5z"/><path d="M6.5 13.5V9h3v4.5"/></svg>`;
const TIMELINE_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 2.5"/></svg>`;
const TAB_CLOSE_MS = 220;
let shapeClipSeq = 0;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function mountTabStrip(
  hostEl: HTMLElement,
  callbacks: TabStripCallbacks,
  options: TabStripOptions = {},
): TabStripHandle {
  const showAnchors = options.showAnchors !== false;
  const showNewTab = options.showNewTab !== false && showAnchors;
  hostEl.classList.add("insight-tab-strip");
  if (!hostEl.classList.contains("insight-pane-tab-slot")) {
    hostEl.classList.add("insight-pane-tab-slot");
  }
  if (options.paneId) hostEl.dataset.pane = options.paneId;
  hostEl.innerHTML = `
    ${showAnchors ? `<button type="button" class="insight-tab-strip-home no-drag" data-tauri-drag-region="false" aria-label="主页" title="主页">${HOME_SVG}</button>
    <button type="button" class="insight-tab-strip-timeline no-drag" data-tauri-drag-region="false" aria-label="时间线" title="时间线">${TIMELINE_SVG}</button>` : ""}
    <div class="insight-tab-strip-scroll no-drag" data-tauri-drag-region="false">
      <div class="insight-tab-strip-list" role="tablist"></div>
    </div>
    ${showNewTab ? `<button type="button" class="insight-tab-strip-new no-drag" data-tauri-drag-region="false" aria-label="新建标签" title="新建标签">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
    </button>` : ""}
    <div class="insight-tab-strip-rest" data-tauri-drag-region></div>
    <div class="insight-tab-strip-shape-layer" aria-hidden="true"></div>`;

  const homeBtn = hostEl.querySelector<HTMLButtonElement>(".insight-tab-strip-home");
  const timelineBtn = hostEl.querySelector<HTMLButtonElement>(".insight-tab-strip-timeline");
  const newBtn = hostEl.querySelector<HTMLButtonElement>(".insight-tab-strip-new");
  const listEl = hostEl.querySelector<HTMLElement>(".insight-tab-strip-list")!;
  const scrollEl = hostEl.querySelector<HTMLElement>(".insight-tab-strip-scroll");
  const shapeLayer = hostEl.querySelector<HTMLElement>(".insight-tab-strip-shape-layer")!;
  const svgNs = "http://www.w3.org/2000/svg";
  const selectedShape = document.createElementNS(svgNs, "svg");
  selectedShape.classList.add("insight-tab-selected-shape");
  selectedShape.setAttribute("aria-hidden", "true");
  selectedShape.setAttribute("focusable", "false");
  selectedShape.setAttribute("hidden", "");
  selectedShape.setAttribute("preserveAspectRatio", "none");
  const clipId = `insight-tab-shape-clip-${++shapeClipSeq}`;
  const clip = document.createElementNS(svgNs, "clipPath");
  clip.id = clipId;
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  const clipRect = document.createElementNS(svgNs, "rect");
  clip.appendChild(clipRect);
  const defs = document.createElementNS(svgNs, "defs");
  defs.appendChild(clip);
  const fillPath = document.createElementNS(svgNs, "path");
  fillPath.classList.add("insight-tab-selected-shape-fill");
  const outlinePath = document.createElementNS(svgNs, "path");
  outlinePath.classList.add("insight-tab-selected-shape-outline");
  selectedShape.append(defs, fillPath, outlinePath);
  shapeLayer.appendChild(selectedShape);
  const ac = new AbortController();
  const { signal } = ac;
  let suppressClick = false;
  const closingKeys = new Set<string>();
  let shapeFrame = 0;
  let shapeStamp = "";
  let seenWidth = Number.NaN;
  let seenHeight = Number.NaN;
  let seenScroll = Number.NaN;
  let previousActiveKey: string | null = null;
  let pendingRevealKey: string | null = null;

  function revealPendingTab(): void {
    if (!scrollEl || !pendingRevealKey) return;
    const active = callbacks.getActive();
    if (active.type !== "content" || active.key !== pendingRevealKey) {
      pendingRevealKey = null;
      return;
    }
    if (listEl.querySelector(".insight-content-tab.is-dragging")) return;
    const tabEl = Array.from(listEl.querySelectorAll<HTMLElement>(".insight-content-tab[data-tab-key]"))
      .find((el) => el.dataset.tabKey === pendingRevealKey);
    if (!tabEl?.isConnected) { pendingRevealKey = null; return; }
    const viewport = scrollEl.getBoundingClientRect();
    const tab = tabEl.getBoundingClientRect();
    if (viewport.width < 1 || tab.width < 1) return;
    const layoutWidth = scrollEl.offsetWidth;
    const scale = layoutWidth > 0 ? viewport.width / layoutWidth : 1;
    const delta = tab.width > viewport.width || tab.left < viewport.left
      ? tab.left - viewport.left
      : tab.right > viewport.right ? tab.right - viewport.right : 0;
    pendingRevealKey = null;
    if (delta && scale > 0) scrollEl.scrollLeft += delta / scale;
  }

  function updateSelectedShape(): void {
    if (!hostEl.isConnected) {
      selectedShape.setAttribute("hidden", "");
      return;
    }
    const active = callbacks.getActive();
    const anchorBtn =
      active.type === "home"
        ? homeBtn ?? null
        : active.type === "fixed" && active.dest === "timeline"
          ? timelineBtn ?? null
          : null;
    const tabEl =
      anchorBtn ??
      (active.type === "content"
        ? listEl.querySelector<HTMLElement>(`[data-tab-key="${active.key}"]`)
        : null);
    if (!tabEl?.isConnected) {
      selectedShape.setAttribute("hidden", "");
      return;
    }

    const chromeRect = hostEl.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();
    if (tabRect.width < 1 || tabRect.height < 1) {
      selectedShape.setAttribute("hidden", "");
      return;
    }

    // Foot uses the tab row's layout box. Visual rects move while content
    // below reflows, and writing those heights back made the shape float.
    const layoutWidth = hostEl.offsetWidth;
    const layoutHeight = hostEl.offsetHeight;
    const useLayout = layoutWidth > 0 && layoutHeight > 0;
    const scaleX = useLayout && chromeRect.width > 0 ? chromeRect.width / layoutWidth : 1;
    const scaleY = useLayout && chromeRect.height > 0 ? chromeRect.height / layoutHeight : 1;
    const sx = scaleX > 0 ? scaleX : 1;
    const sy = scaleY > 0 ? scaleY : 1;
    const hostWidth = useLayout ? layoutWidth : Math.max(1, chromeRect.width);
    const hostHeight = useLayout ? layoutHeight : Math.max(1, chromeRect.height);
    const x1 = (tabRect.left - chromeRect.left) / sx;
    const x2 = (tabRect.right - chromeRect.left) / sx;
    // Tabs sit on the bottom of the fixed chrome row. Visual tops move while
    // the page below reflows; using them lifts the selected shape.
    const tabBox = tabEl.offsetHeight;
    const y1 = tabBox > 0 ? Math.max(0, hostHeight - tabBox) : (tabRect.top - chromeRect.top) / sy;
    const width = x2 - x1;
    const tokenRadius = Number.parseFloat(
      getComputedStyle(hostEl).getPropertyValue("--insight-tab-radius"),
    );
    const radius = Math.max(0, Math.min(tokenRadius || 0, width / 2, hostHeight / 2));
    if (radius < 1 || y1 + radius >= hostHeight) {
      selectedShape.setAttribute("hidden", "");
      return;
    }

    const pad = radius;
    const foot = hostHeight;
    const mask = foot;
    let clipX = -pad;
    let clipWidth = hostWidth + pad * 2;
    if (active.type === "content" && scrollEl) {
      // The shape lives on the host rather than inside its scroll viewport;
      // without this clip an offscreen tab can paint over the frame controls.
      // See docs/plans/insight-tab-overflow.md.
      const scrollRect = scrollEl.getBoundingClientRect();
      const visibleLeft = Math.max(chromeRect.left, scrollRect.left);
      const visibleRight = Math.min(chromeRect.right, scrollRect.right);
      if (visibleRight <= visibleLeft || tabRect.right <= visibleLeft || tabRect.left >= visibleRight) {
        selectedShape.setAttribute("hidden", "");
        shapeStamp = "";
        return;
      }
      clipX = (visibleLeft - chromeRect.left) / sx;
      clipWidth = (visibleRight - visibleLeft) / sx;
    }
    const stamp = [x1, x2, y1, hostWidth, hostHeight, clipX, clipWidth].join(":");
    if (stamp === shapeStamp && !selectedShape.hasAttribute("hidden")) return;
    shapeStamp = stamp;
    // Pixel height tracked the page below and shifted this shape. The layer
    // already fills the tab row; only the horizontal clip follows the scroller.
    selectedShape.setAttribute("viewBox", `${-pad} 0 ${hostWidth + pad * 2} ${mask}`);
    selectedShape.style.left = `${-pad}px`;
    selectedShape.style.width = `${hostWidth + pad * 2}px`;
    selectedShape.style.height = "100%";
    selectedShape.style.clipPath = "";
    clipRect.setAttribute("x", String(clipX));
    clipRect.setAttribute("y", "0");
    clipRect.setAttribute("width", String(clipWidth));
    clipRect.setAttribute("height", String(mask));
    selectedShape.setAttribute("clip-path", `url(#${clipId})`);

    const fillD = [
      `M ${x1 + radius} ${y1}`,
      `L ${x2 - radius} ${y1}`,
      `Q ${x2} ${y1} ${x2} ${y1 + radius}`,
      `L ${x2} ${foot - radius}`,
      `Q ${x2} ${foot} ${x2 + radius} ${foot}`,
      `L ${x1 - radius} ${foot}`,
      `Q ${x1} ${foot} ${x1} ${foot - radius}`,
      `L ${x1} ${y1 + radius}`,
      `Q ${x1} ${y1} ${x1 + radius} ${y1}`,
      "Z",
      `M ${x1} ${foot}`,
      `L ${x2} ${foot}`,
      `L ${x2} ${mask}`,
      `L ${x1} ${mask}`,
      "Z",
    ].join(" ");
    const outlineD = [
      `M ${x1 - radius} ${foot}`,
      `Q ${x1} ${foot} ${x1} ${foot - radius}`,
      `L ${x1} ${y1 + radius}`,
      `Q ${x1} ${y1} ${x1 + radius} ${y1}`,
      `L ${x2 - radius} ${y1}`,
      `Q ${x2} ${y1} ${x2} ${y1 + radius}`,
      `L ${x2} ${foot - radius}`,
      `Q ${x2} ${foot} ${x2 + radius} ${foot}`,
    ].join(" ");
    fillPath.setAttribute("d", fillD);
    outlinePath.setAttribute("d", outlineD);
    selectedShape.removeAttribute("hidden");
  }

  function updateShapeWhileAnimating(): void {
    shapeFrame = 0;
    // DragSession clears its drag state at window pointerup; retry on this
    // frame after that cleanup before positioning the selected background.
    revealPendingTab();
    updateSelectedShape();
    const dragging = Boolean(listEl.querySelector(".insight-content-tab.is-dragging"));
    const animating = listEl.getAnimations().some((animation) => animation.playState === "running");
    if (dragging || animating) {
      shapeFrame = requestAnimationFrame(updateShapeWhileAnimating);
    }
  }

  function scheduleShapeUpdate(): void {
    if (shapeFrame) return;
    shapeFrame = requestAnimationFrame(updateShapeWhileAnimating);
  }

  const reorderOpts = {
    getKeys: () => callbacks.getTabs().map((t) => t.key),
    onReorder: (keys: string[]) => {
      suppressClick = true;
      callbacks.onReorder(keys);
      render();
      requestAnimationFrame(() => {
        suppressClick = false;
      });
    },
    onMoveTab: callbacks.onMoveTab,
  };
  const reorder =
    options.dragSession && options.paneId
      ? options.dragSession.wireTabReorder(options.paneId, listEl, reorderOpts)
      : mountTabReorder(listEl, reorderOpts);

  function createTabEl(tab: ContentTabRecord, selected: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "insight-content-tab no-drag";
    btn.role = "tab";
    btn.dataset.tabKey = tab.key;
    btn.dataset.tauriDragRegion = "false";
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) btn.classList.add("is-selected");

    const title = document.createElement("span");
    title.className = "insight-content-tab-title";
    title.textContent = tab.title;

    const close = document.createElement("span");
    close.className = "insight-content-tab-close no-drag";
    close.setAttribute("role", "button");
    close.tabIndex = -1;
    close.setAttribute("aria-label", "关闭");
    close.dataset.tauriDragRegion = "false";
    close.textContent = "\u00d7";

    btn.append(title, close);

    return btn;
  }

  function playEnterAnimation(btn: HTMLButtonElement): void {
    if (prefersReducedMotion()) return;
    btn.classList.add("is-entering");
    const onEnd = (e: AnimationEvent) => {
      if (e.target !== btn || e.animationName !== "insight-tab-enter") return;
      btn.classList.remove("is-entering");
    };
    btn.addEventListener("animationend", onEnd);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!btn.isConnected) return;
        if (typeof btn.getAnimations === "function" && btn.getAnimations().length === 0) {
          btn.classList.remove("is-entering");
          btn.removeEventListener("animationend", onEnd);
        }
      });
    });
  }

  function patchTabEl(el: HTMLButtonElement, tab: ContentTabRecord, selected: boolean): void {
    if (el.classList.contains("is-exiting")) return;
    el.classList.toggle("is-selected", selected);
    el.setAttribute("aria-selected", selected ? "true" : "false");
    const titleEl = el.querySelector<HTMLElement>(".insight-content-tab-title");
    if (titleEl && titleEl.textContent !== tab.title) {
      titleEl.textContent = tab.title;
    }
  }

  function render(): void {
    const active = callbacks.getActive();
    const tabs = callbacks.getTabs();
    const tabKeys = new Set(tabs.map((t) => t.key));

    if (homeBtn) {
      const homeSelected = active.type === "home";
      homeBtn.setAttribute("aria-current", homeSelected ? "page" : "false");
      homeBtn.classList.toggle("is-selected", homeSelected);
    }

    if (timelineBtn) {
      const timelineSelected = active.type === "fixed" && active.dest === "timeline";
      timelineBtn.setAttribute("aria-current", timelineSelected ? "page" : "false");
      timelineBtn.classList.toggle("is-selected", timelineSelected);
    }

    const existing = new Map<string, HTMLButtonElement>();
    for (const el of listEl.querySelectorAll<HTMLButtonElement>(".insight-content-tab[data-tab-key]")) {
      const key = el.dataset.tabKey;
      if (key) existing.set(key, el);
    }

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const selected = active.type === "content" && active.key === tab.key;
      let el = existing.get(tab.key);
      if (!el) {
        el = createTabEl(tab, selected);
        existing.set(tab.key, el);
        const ref = listEl.children[i] ?? null;
        listEl.insertBefore(el, ref);
        playEnterAnimation(el);
      } else {
        patchTabEl(el, tab, selected);
        const ref = listEl.children[i] ?? null;
        if (el !== ref) {
          listEl.insertBefore(el, ref);
        }
      }
    }

    for (const [key, el] of existing) {
      if (!tabKeys.has(key) && !closingKeys.has(key)) {
        el.remove();
      }
    }

    const activeKey = active.type === "content" ? active.key : null;
    if (activeKey !== previousActiveKey) {
      previousActiveKey = activeKey;
      pendingRevealKey = activeKey;
    }
    revealPendingTab();
    scheduleShapeUpdate();
  }

  function clearCloseInlineStyles(tabEl: HTMLButtonElement): void {
    tabEl.style.width = "";
    tabEl.style.minWidth = "";
    tabEl.style.maxWidth = "";
    tabEl.style.height = "";
    tabEl.style.marginBottom = "";
    tabEl.style.paddingLeft = "";
    tabEl.style.paddingRight = "";
    tabEl.style.opacity = "";
    tabEl.style.flex = "";
    tabEl.style.flexShrink = "";
    tabEl.style.overflow = "";
    tabEl.style.boxSizing = "";
    tabEl.style.transition = "";
  }

  function closeTab(key: string, tabEl: HTMLButtonElement): void {
    if (closingKeys.has(key)) return;
    if (prefersReducedMotion()) {
      callbacks.onCloseTab(key);
      render();
      return;
    }
    closingKeys.add(key);

    const width = tabEl.getBoundingClientRect().width;
    tabEl.style.boxSizing = "border-box";
    tabEl.style.flex = "0 1 auto";
    tabEl.style.width = `${width}px`;
    tabEl.style.maxWidth = `${width}px`;
    tabEl.style.minWidth = "0";
    tabEl.style.flexShrink = "1";
    tabEl.style.overflow = "hidden";
    tabEl.classList.add("is-exiting");
    if (tabEl.classList.contains("is-selected")) {
      selectedShape.setAttribute("hidden", "");
    }

    let done = false;
    let fallbackTimer: ReturnType<typeof setTimeout>;
    const finishClose = () => {
      if (done) return;
      done = true;
      tabEl.removeEventListener("transitionend", onEnd);
      clearTimeout(fallbackTimer);
      closingKeys.delete(key);
      clearCloseInlineStyles(tabEl);
      tabEl.remove();
      callbacks.onCloseTab(key);
      render();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== tabEl || e.propertyName !== "width") return;
      finishClose();
    };
    tabEl.addEventListener("transitionend", onEnd);
    fallbackTimer = setTimeout(finishClose, TAB_CLOSE_MS + 80);

    requestAnimationFrame(() => {
      tabEl.style.transition = `width ${TAB_CLOSE_MS}ms ease, max-width ${TAB_CLOSE_MS}ms ease, padding-left ${TAB_CLOSE_MS}ms ease, padding-right ${TAB_CLOSE_MS}ms ease, opacity 180ms ease`;
      tabEl.style.width = "0";
      tabEl.style.maxWidth = "0";
      tabEl.style.paddingLeft = "0";
      tabEl.style.paddingRight = "0";
      tabEl.style.opacity = "0";
    });
  }

  homeBtn?.addEventListener(
    "click",
    () => {
      if (suppressClick) return;
      callbacks.onSelectHome();
    },
    { signal },
  );

  timelineBtn?.addEventListener(
    "click",
    () => {
      if (suppressClick) return;
      callbacks.onSelectTimeline();
    },
    { signal },
  );

  newBtn?.addEventListener(
    "click",
    () => {
      if (suppressClick) return;
      callbacks.onNewTab();
    },
    { signal },
  );

  hostEl.addEventListener(
    "pointerdown",
    (e) => {
      if ((e.target as Element).closest(".insight-content-tab-close")) return;
      callbacks.onFocusPane?.();
    },
    { signal },
  );

  listEl.addEventListener(
    "click",
    (e) => {
      if (suppressClick) return;
      const closeEl = (e.target as Element).closest<HTMLElement>(".insight-content-tab-close");
      if (closeEl) {
        const tabEl = closeEl.closest<HTMLButtonElement>(".insight-content-tab[data-tab-key]");
        const key = tabEl?.dataset.tabKey;
        if (key && tabEl) {
          e.stopPropagation();
          closeTab(key, tabEl);
        }
        return;
      }
      const tabEl = (e.target as Element).closest<HTMLElement>(".insight-content-tab[data-tab-key]");
      const key = tabEl?.dataset.tabKey;
      if (key) {
        callbacks.onSelectTab(key);
      }
    },
    { signal },
  );

  const onGeometryChange = () => {
    const width = hostEl.clientWidth;
    const height = hostEl.clientHeight;
    const scroll = scrollEl?.scrollLeft ?? 0;
    if (width === seenWidth && height === seenHeight && scroll === seenScroll && pendingRevealKey === null) return;
    seenWidth = width;
    seenHeight = height;
    seenScroll = scroll;
    revealPendingTab();
    scheduleShapeUpdate();
  };
  const onTransition = () => scheduleShapeUpdate();
  window.addEventListener("resize", onGeometryChange, { signal });
  hostEl.addEventListener("pointermove", onTransition, { signal });
  hostEl.addEventListener("pointerup", onGeometryChange, { signal });
  hostEl.addEventListener("pointercancel", onGeometryChange, { signal });
  listEl.addEventListener("transitionrun", onTransition, { signal });
  listEl.addEventListener("transitionend", onGeometryChange, { signal });
  scrollEl?.addEventListener("scroll", () => { pendingRevealKey = null; scheduleShapeUpdate(); }, { signal, passive: true });
  hostEl.addEventListener("wheel", (event) => {
    if (!scrollEl || event.ctrlKey || event.metaKey || scrollEl.scrollWidth <= scrollEl.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollEl.clientWidth : 1;
    const max = scrollEl.scrollWidth - scrollEl.clientWidth;
    const next = Math.max(0, Math.min(max, scrollEl.scrollLeft + delta * unit));
    if (next === scrollEl.scrollLeft) return;
    event.preventDefault();
    pendingRevealKey = null;
    scrollEl.scrollLeft = next;
  }, { signal, passive: false });

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(onGeometryChange)
      : null;
  resizeObserver?.observe(hostEl);
  if (scrollEl) resizeObserver?.observe(scrollEl);
  render();

  return {
    refresh: render,
    dispose() {
      reorder.dispose();
      resizeObserver?.disconnect();
      if (shapeFrame) cancelAnimationFrame(shapeFrame);
      selectedShape.remove();
      ac.abort();
      hostEl.innerHTML = "";
    },
  };
}
