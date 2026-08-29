/**

 * Finance Detail entry shell — programmatic DOM only; no page-shell / finance-layout.

 * See docs/plans/v0.0.17-closeout.md §4.2.

 */

import {
  cancelLayoutFlip,
  clearPanelSlideStyles,
  runLayoutFlip,
  runPanelSlide,
} from "../../../ui/layout-flip";

import "../ui/finance-chrome.css";
import "./finance-search.css";

const RAIL_COLLAPSED_KEY = "ledger-detail-sidebar-collapsed";

const FINANCE_RAIL_DRAWER_MAX_WIDTH = 1180;

export type FinanceDetailShellOptions = {
  title: string;
  onBack: () => void;
  renderBody: (el: HTMLElement) => void | (() => void);
  renderRail: (el: HTMLElement) => void | (() => void);
};

export type FinanceDetailShellHandle = {
  root: HTMLElement;
  bodyEl: HTMLElement;
  discardAllBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  titleBtn: HTMLButtonElement;
  searchHost: HTMLElement;
  mountRailToggle: (toggleBtn: HTMLButtonElement, signal: AbortSignal) => void;
  getScrollEl: () => HTMLElement;
  dispose: () => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  }
  return node;
}

function svgBack(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M15 6l-6 6 6 6");
  svg.appendChild(path);
  return svg;
}

function svgRailPanelToggle(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  frame.setAttribute("x", "4");
  frame.setAttribute("y", "5");
  frame.setAttribute("width", "12");
  frame.setAttribute("height", "10");
  frame.setAttribute("rx", "1.5");
  frame.setAttribute("stroke", "currentColor");
  frame.setAttribute("stroke-width", "1.25");
  const panel = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  panel.setAttribute("x", "11.5");
  panel.setAttribute("y", "6");
  panel.setAttribute("width", "3.5");
  panel.setAttribute("height", "8");
  panel.setAttribute("rx", "0.5");
  panel.setAttribute("fill", "currentColor");
  svg.append(frame, panel);
  return svg;
}

function buildChromeTopbar(
  title: string,
  actions: {
    backBtn: HTMLButtonElement;
    titleBtn: HTMLButtonElement;
    searchHost: HTMLElement;
    discardAllBtn: HTMLButtonElement;
    saveBtn: HTMLButtonElement;
    railToggle: HTMLButtonElement;
  },
): HTMLElement {
  const header = el("header", "finance-chrome-topbar ledger-page-topbar");
  header.setAttribute("data-role", "finance-detail-topbar");

  actions.backBtn.className = "ledger-page-back";
  actions.backBtn.type = "button";
  actions.backBtn.setAttribute("data-role", "finance-detail-back");
  actions.backBtn.setAttribute("aria-label", "返回");
  actions.backBtn.appendChild(svgBack());

  const center = el("div", "finance-topbar-center");
  center.setAttribute("data-role", "finance-detail-topbar-center");

  actions.titleBtn.className = "finance-topbar-title-btn";
  actions.titleBtn.type = "button";
  actions.titleBtn.setAttribute("data-role", "finance-detail-title");
  actions.titleBtn.setAttribute("aria-label", `${title}，打开搜索`);
  actions.titleBtn.setAttribute("aria-expanded", "false");
  actions.titleBtn.textContent = title;

  actions.searchHost.className = "finance-search-host";
  actions.searchHost.setAttribute("data-role", "finance-search-host");

  center.append(actions.titleBtn, actions.searchHost);

  const actionRow = el("div", "ledger-page-topbar-actions");
  actionRow.setAttribute("data-role", "finance-detail-topbar-actions");

  actions.saveBtn.className = "save-btn save-unedited ledger-page-save orbita-action-btn";
  actions.saveBtn.type = "button";
  actions.saveBtn.setAttribute("data-role", "finance-detail-save");
  actions.saveBtn.disabled = true;
  actions.saveBtn.textContent = "保存";

  actions.discardAllBtn.className = "save-btn finance-detail-discard-btn orbita-action-btn";
  actions.discardAllBtn.type = "button";
  actions.discardAllBtn.setAttribute("data-role", "finance-detail-discard-all");
  actions.discardAllBtn.disabled = true;
  actions.discardAllBtn.textContent = "撤销全部";

  actions.railToggle.className = "ledger-page-rail-toggle";
  actions.railToggle.type = "button";
  actions.railToggle.setAttribute("data-role", "finance-detail-rail-toggle");
  actions.railToggle.setAttribute("aria-label", "收起侧边栏");
  actions.railToggle.setAttribute("aria-expanded", "true");
  actions.railToggle.appendChild(svgRailPanelToggle());

  actionRow.append(actions.discardAllBtn, actions.saveBtn, actions.railToggle);
  header.append(actions.backBtn, center, actionRow);
  return header;
}

export function mountFinanceDetailShell(
  container: HTMLElement,
  options: FinanceDetailShellOptions,
): FinanceDetailShellHandle {
  const ac = new AbortController();
  const { signal } = ac;
  const cleanups: Array<() => void> = [];

  const backBtn = document.createElement("button");
  const titleBtn = document.createElement("button");
  const searchHost = document.createElement("div");
  const discardAllBtn = document.createElement("button");
  const saveBtn = document.createElement("button");
  const railToggle = document.createElement("button");

  const topbar = buildChromeTopbar(options.title, {
    backBtn,
    titleBtn,
    searchHost,
    discardAllBtn,
    saveBtn,
    railToggle,
  });

  const flipFrame = el("div", "finance-detail-flip-frame");
  flipFrame.setAttribute("data-layout-flip", "");

  const bodyEl = el("div", "finance-chrome-body");
  bodyEl.setAttribute("data-role", "finance-detail-body");
  flipFrame.appendChild(bodyEl);

  const chromeMain = el("div", "finance-chrome-main");
  chromeMain.setAttribute("data-role", "finance-detail-main");
  chromeMain.appendChild(flipFrame);

  const pageMain = el("div", "ledger-page-main");
  pageMain.setAttribute("data-role", "finance-detail-page-main");
  pageMain.appendChild(chromeMain);

  const railEl = el("aside", "ledger-page-rail");
  railEl.setAttribute("data-role", "finance-detail-rail");
  railEl.setAttribute("aria-hidden", "false");

  const railMount = el("div", "ledger-page-rail-inner");
  railMount.setAttribute("data-role", "finance-detail-rail-mount");
  railEl.appendChild(railMount);

  const stage = el("div", "ledger-page-stage ledger-page-grid");
  stage.setAttribute("data-role", "finance-detail-stage");
  stage.append(pageMain, railEl);

  const scrim = el("button", "ledger-page-rail-scrim");
  scrim.type = "button";
  scrim.setAttribute("data-role", "finance-detail-rail-scrim");
  scrim.setAttribute("aria-label", "关闭记一笔抽屉");
  scrim.hidden = true;

  const root = el("div", "ledger-page has-rail is-finance-detail");
  root.setAttribute("data-role", "finance-detail-root");
  root.append(topbar, stage, scrim);

  container.replaceChildren(root);

  let narrow = false;
  let railOpen = false;
  let lastToggleBtn: HTMLButtonElement | null = null;
  let layoutLockDepth = 0;

  function isNarrowViewport(): boolean {
    return window.innerWidth <= FINANCE_RAIL_DRAWER_MAX_WIDTH;
  }

  function setLayoutLocked(locked: boolean): void {
    layoutLockDepth += locked ? 1 : -1;
    if (layoutLockDepth < 0) layoutLockDepth = 0;
    window.dispatchEvent(
      new CustomEvent("orbita-finance-layout-lock", {
        detail: { locked: layoutLockDepth > 0 },
      }),
    );
  }

  function syncRailState(opts: { restoreFocus?: boolean } = {}): void {
    root.classList.toggle("is-narrow", narrow);
    root.classList.toggle("is-rail-collapsed", !narrow && !railOpen);
    root.classList.toggle("is-rail-drawer-open", narrow && railOpen);
    railEl.setAttribute("aria-hidden", String(!railOpen));
    scrim.hidden = !(narrow && railOpen);
    railToggle.setAttribute("aria-label", railOpen ? "关闭记一笔" : "打开记一笔");
    railToggle.setAttribute("aria-expanded", String(railOpen));
    if (opts.restoreFocus && lastToggleBtn?.isConnected) lastToggleBtn.focus();
  }

  function focusRail(): void {
    const focusTarget = railMount.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusTarget?.focus();
  }

  function setRailOpen(open: boolean, opts: { restoreFocus?: boolean } = {}): void {
    if (narrow) {
      railOpen = open;
      syncRailState(opts);
      if (open) focusRail();
      return;
    }

    const railInner = railEl.querySelector<HTMLElement>(".ledger-page-rail-inner");
    if (!railInner) {
      railOpen = open;
      sessionStorage.setItem(RAIL_COLLAPSED_KEY, String(!open));
      syncRailState(opts);
      if (open) focusRail();
      return;
    }

    setLayoutLocked(true);
    void (async () => {
      try {
        if (!open && railOpen) {
          await runPanelSlide(railInner, false, { offset: 24 });
        }
        await runLayoutFlip(flipFrame, () => {
          railOpen = open;
          sessionStorage.setItem(RAIL_COLLAPSED_KEY, String(!open));
          syncRailState(opts);
        });
        if (open) {
          await runPanelSlide(railInner, true, { offset: 24 });
          focusRail();
        } else {
          clearPanelSlideStyles(railInner);
        }
      } finally {
        setLayoutLocked(false);
      }
    })();
  }

  function syncViewport(): void {
    const nextNarrow = isNarrowViewport();
    if (nextNarrow === narrow) return;
    narrow = nextNarrow;
    railOpen = narrow ? false : sessionStorage.getItem(RAIL_COLLAPSED_KEY) !== "true";
    syncRailState();
  }

  narrow = isNarrowViewport();
  railOpen = narrow ? false : sessionStorage.getItem(RAIL_COLLAPSED_KEY) !== "true";
  syncRailState();

  window.addEventListener("resize", syncViewport, { signal });
  scrim.addEventListener("click", () => setRailOpen(false, { restoreFocus: true }), { signal });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && narrow && railOpen) setRailOpen(false, { restoreFocus: true });
    },
    { signal },
  );

  backBtn.addEventListener("click", options.onBack, { signal });

  const bodyCleanup = options.renderBody(bodyEl);
  if (typeof bodyCleanup === "function") cleanups.push(bodyCleanup);

  const railCleanup = options.renderRail(railMount);
  if (typeof railCleanup === "function") cleanups.push(railCleanup);

  function mountRailToggle(toggleBtn: HTMLButtonElement, toggleSignal: AbortSignal): void {
    syncRailState();
    toggleBtn.addEventListener(
      "click",
      () => {
        lastToggleBtn = toggleBtn;
        setRailOpen(!railOpen);
      },
      { signal: toggleSignal },
    );
  }

  mountRailToggle(railToggle, signal);

  return {
    root,
    bodyEl,
    discardAllBtn,
    saveBtn,
    titleBtn,
    searchHost,
    mountRailToggle,
    getScrollEl: () => bodyEl,
    dispose: () => {
      cancelLayoutFlip(flipFrame);
      cleanups.forEach((fn) => fn());
      ac.abort();
      container.replaceChildren();
    },
  };
}
