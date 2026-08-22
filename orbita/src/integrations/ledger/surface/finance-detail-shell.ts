/**

 * Finance Detail entry shell — programmatic DOM only; no page-shell / finance-layout.

 * See docs/plans/v0.0.17-finance-ui-execution.md §3.1 / §6 阶段 A.

 */

import {
  cancelLayoutFlip,
  clearPanelSlideStyles,
  runLayoutFlip,
  runPanelSlide,
} from "../../../ui/layout-flip";

import "../ui/finance-chrome.css";



const RAIL_COLLAPSED_KEY = "ledger-detail-sidebar-collapsed";

const FINANCE_RAIL_DRAWER_MAX_WIDTH = 1180;

const FINANCE_FILTER_INLINE_MIN_WIDTH = 1080;



const TYPE_FILTER_OPTIONS = [

  { stripe: "expense", type: "expense", label: "支出" },

  { stripe: "proxy-expense", type: "proxy-expense", label: "代支出" },

  { stripe: "income", type: "income", label: "收入" },

  { stripe: "transfer", type: "transfer", label: "转账" },

  { stripe: "repayment", type: "repayment", label: "还款" },

  { stripe: "unknown", type: "unknown", label: "未分类" },

] as const;



export type FinanceDetailShellOptions = {

  title: string;

  onBack: () => void;

  onImport?: (e: MouseEvent) => void;

  renderFilter: (el: HTMLElement) => void;

  renderBody: (el: HTMLElement) => void | (() => void);

  renderRail: (el: HTMLElement) => void | (() => void);

};



export type FinanceDetailShellHandle = {

  root: HTMLElement;

  bodyEl: HTMLElement;

  saveBtn: HTMLButtonElement;

  filterInner: HTMLElement;

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



function svgRailChevron(): SVGSVGElement {

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  svg.setAttribute("viewBox", "0 0 24 24");

  svg.setAttribute("width", "16");

  svg.setAttribute("height", "16");

  svg.setAttribute("fill", "none");

  svg.setAttribute("stroke", "currentColor");

  svg.setAttribute("stroke-width", "2");

  svg.setAttribute("stroke-linecap", "round");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  path.setAttribute("d", "M9 6l6 6-6 6");

  svg.appendChild(path);

  return svg;

}



function svgTypeChevron(): SVGSVGElement {

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  svg.setAttribute("viewBox", "0 0 24 24");

  svg.setAttribute("fill", "none");

  svg.setAttribute("stroke", "currentColor");

  svg.setAttribute("stroke-width", "2.2");

  svg.setAttribute("stroke-linecap", "round");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");

  polyline.setAttribute("points", "6 9 12 15 18 9");

  svg.appendChild(polyline);

  return svg;

}



function buildFilterInner(): HTMLElement {

  const inner = el("div", "finance-chrome-filter-inner");

  inner.setAttribute("data-role", "finance-detail-filter-inner");



  const fromMount = el("div", "detail-filter-date-mount");

  fromMount.setAttribute("data-detail-filter-from-mount", "");

  fromMount.setAttribute("aria-label", "起始日期");



  const sep = el("span", "detail-filter-sep");

  sep.textContent = "—";



  const toMount = el("div", "detail-filter-date-mount");

  toMount.setAttribute("data-detail-filter-to-mount", "");

  toMount.setAttribute("aria-label", "截止日期");



  const typeRoot = el("div", "type-filters finance-type-filter");

  typeRoot.setAttribute("data-role", "detail-type-filter");



  const trigger = el("button", "finance-type-filter-trigger");

  trigger.type = "button";

  trigger.setAttribute("aria-haspopup", "listbox");

  trigger.setAttribute("aria-expanded", "false");



  const label = el("span", "finance-type-filter-label");

  label.textContent = "类型 · 全部";



  const chevronWrap = el("span", "finance-type-filter-chevron");

  chevronWrap.setAttribute("aria-hidden", "true");

  chevronWrap.appendChild(svgTypeChevron());

  trigger.append(label, chevronWrap);



  const panel = el("div", "finance-type-filter-panel scroll-slim motion-popover");

  panel.setAttribute("role", "listbox");

  panel.setAttribute("aria-label", "交易类型筛选");



  for (const opt of TYPE_FILTER_OPTIONS) {

    const option = el("button", "finance-type-filter-option is-selected");

    option.type = "button";

    option.dataset.stripe = opt.stripe;

    option.dataset.detailType = opt.type;

    option.setAttribute("aria-pressed", "true");

    option.setAttribute("role", "option");

    const stripe = el("span", "finance-type-filter-stripe");

    stripe.setAttribute("aria-hidden", "true");

    const text = el("span", "finance-type-filter-text");

    text.textContent = opt.label;

    option.append(stripe, text);

    panel.appendChild(option);

  }



  typeRoot.append(trigger, panel);



  const clearBtn = el("button", "finance-filter-clear-btn");

  clearBtn.type = "button";

  clearBtn.setAttribute("data-role", "detail-filter-clear");

  clearBtn.setAttribute("aria-label", "清除筛选");

  clearBtn.hidden = true;

  clearBtn.textContent = "清除";



  inner.append(fromMount, sep, toMount, typeRoot, clearBtn);

  return inner;

}



function buildChromeTopbar(

  title: string,

  filterInner: HTMLElement,

  actions: {

    backBtn: HTMLButtonElement;

    filterBtn: HTMLButtonElement;

    importBtn: HTMLButtonElement;

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



  const heading = el("h1", "ledger-page-title");

  heading.setAttribute("data-role", "finance-detail-title");

  heading.textContent = title;



  const filterCenter = el("div", "finance-topbar-filters");

  filterCenter.setAttribute("data-role", "finance-detail-topbar-filters");

  filterCenter.appendChild(filterInner);



  const filterNarrowWrap = el("div", "finance-chrome-filter-narrow");

  filterNarrowWrap.setAttribute("data-role", "finance-detail-filter-narrow");

  const filterNarrowPanel = el("div", "finance-chrome-filter-narrow-panel");

  filterNarrowWrap.appendChild(filterNarrowPanel);



  const actionRow = el("div", "ledger-page-topbar-actions");

  actionRow.setAttribute("data-role", "finance-detail-topbar-actions");



  actions.filterBtn.className = "ledger-page-filter-btn finance-topbar-filter-toggle";

  actions.filterBtn.type = "button";

  actions.filterBtn.setAttribute("data-role", "finance-detail-filter-toggle");

  actions.filterBtn.setAttribute("aria-label", "筛选");

  actions.filterBtn.setAttribute("aria-expanded", "false");

  actions.filterBtn.hidden = true;

  actions.filterBtn.textContent = "筛选";



  actions.importBtn.className = "ledger-page-import-btn";

  actions.importBtn.type = "button";

  actions.importBtn.setAttribute("data-role", "finance-detail-import");

  actions.importBtn.textContent = "导入";



  actions.saveBtn.className = "save-btn save-unedited ledger-page-save orbita-action-btn";

  actions.saveBtn.type = "button";

  actions.saveBtn.setAttribute("data-role", "finance-detail-save");

  actions.saveBtn.disabled = true;

  actions.saveBtn.textContent = "保存";



  actions.railToggle.className = "ledger-page-rail-toggle";

  actions.railToggle.type = "button";

  actions.railToggle.setAttribute("data-role", "finance-detail-rail-toggle");

  actions.railToggle.setAttribute("aria-label", "收起侧边栏");

  actions.railToggle.setAttribute("aria-expanded", "true");

  actions.railToggle.appendChild(svgRailChevron());



  actionRow.append(actions.filterBtn, actions.importBtn, actions.saveBtn, actions.railToggle);

  header.append(actions.backBtn, heading, filterCenter, actionRow, filterNarrowWrap);

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

  const filterBtn = document.createElement("button");

  const importBtn = document.createElement("button");

  const saveBtn = document.createElement("button");

  const railToggle = document.createElement("button");



  const filterInner = buildFilterInner();

  const topbar = buildChromeTopbar(options.title, filterInner, {

    backBtn,

    filterBtn,

    importBtn,

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

  let filterNarrow = false;

  let railOpen = false;

  let filterPanelOpen = false;

  let lastToggleBtn: HTMLButtonElement | null = null;

  let layoutLockDepth = 0;



  const filterNarrowWrap = topbar.querySelector<HTMLElement>("[data-role='finance-detail-filter-narrow']")!;

  const filterNarrowPanel = filterNarrowWrap.querySelector<HTMLElement>(".finance-chrome-filter-narrow-panel")!;



  function isNarrowViewport(): boolean {

    return window.innerWidth <= FINANCE_RAIL_DRAWER_MAX_WIDTH;

  }



  function isFilterNarrowViewport(): boolean {

    return window.innerWidth < FINANCE_FILTER_INLINE_MIN_WIDTH;

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



  function syncFilterLayout(): void {

    const nextFilterNarrow = isFilterNarrowViewport();

    if (nextFilterNarrow !== filterNarrow) {

      filterNarrow = nextFilterNarrow;

      if (!filterNarrow) {

        filterPanelOpen = false;

        filterNarrowPanel.replaceChildren();

        filterNarrowPanel.appendChild(filterInner);

      } else if (!filterNarrowPanel.contains(filterInner)) {

        filterNarrowPanel.appendChild(filterInner);

      }

    }

    root.classList.toggle("is-filter-narrow", filterNarrow);

    filterBtn.hidden = !filterNarrow;

    const filterCenter = topbar.querySelector<HTMLElement>("[data-role='finance-detail-topbar-filters']")!;

    if (filterNarrow) {

      if (filterInner.parentElement !== filterNarrowPanel) {

        filterNarrowPanel.appendChild(filterInner);

      }

    } else if (filterInner.parentElement !== filterCenter) {

      filterCenter.appendChild(filterInner);

    }

    filterBtn.setAttribute("aria-expanded", String(filterPanelOpen));

    filterNarrowWrap.classList.toggle("is-open", filterNarrow && filterPanelOpen);

    filterNarrowWrap.hidden = !filterNarrow;

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

    syncFilterLayout();

    if (nextNarrow === narrow) return;

    narrow = nextNarrow;

    railOpen = narrow ? false : sessionStorage.getItem(RAIL_COLLAPSED_KEY) !== "true";

    syncRailState();

  }



  narrow = isNarrowViewport();

  filterNarrow = isFilterNarrowViewport();

  railOpen = narrow ? false : sessionStorage.getItem(RAIL_COLLAPSED_KEY) !== "true";

  syncFilterLayout();

  syncRailState();



  window.addEventListener("resize", syncViewport, { signal });

  scrim.addEventListener("click", () => setRailOpen(false, { restoreFocus: true }), { signal });

  document.addEventListener(

    "keydown",

    (event) => {

      if (event.key === "Escape" && narrow && railOpen) setRailOpen(false, { restoreFocus: true });

      if (event.key === "Escape" && filterNarrow && filterPanelOpen) {

        filterPanelOpen = false;

        syncFilterLayout();

      }

    },

    { signal },

  );



  backBtn.addEventListener("click", options.onBack, { signal });



  if (options.onImport) {

    const onImport = options.onImport;

    importBtn.addEventListener("click", (e) => onImport(e as MouseEvent), { signal });

  }



  filterBtn.addEventListener(

    "click",

    () => {

      filterPanelOpen = !filterPanelOpen;

      syncFilterLayout();

    },

    { signal },

  );



  options.renderFilter(filterInner);



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

    saveBtn,

    filterInner,

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


