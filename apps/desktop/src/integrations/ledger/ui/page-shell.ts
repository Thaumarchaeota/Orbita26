/**
 * Finance 统一页面壳：顶栏 + 可选筛选 + 主体；布局委托 finance-layout（真 Grid）。
 */
import { mountFinanceLayout } from "./finance-layout";
import "./finance-chrome.css";

export const FILTER_OPEN_KEY = "ledger-detail-filter-open";

export type FinancePageOptions = {
  title: string;
  showBack?: boolean;
  showFilter?: boolean;
  showImport?: boolean;
  showGlobalSave?: boolean;
  showManage?: boolean;
  showRail?: boolean;
  /** Detail 视图：贴顶 chrome、主列独立滚动、筛选单层动画 */
  detailChrome?: boolean;
  onBack?: () => void;
  onManage?: () => void;
  onImport?: (e: MouseEvent) => void;
  renderFilter?: (el: HTMLElement) => void;
  renderBody: (el: HTMLElement) => void | (() => void);
  renderRail?: (el: HTMLElement) => void | (() => void);
};

export type FinancePageHandle = {
  root: HTMLElement;
  bodyEl: HTMLElement;
  saveBtn?: HTMLButtonElement;
  getScrollEl: () => HTMLElement;
  unmount: () => void;
};

/** Generic page scroll fallback for cached views that do not expose a handle. */
export function getFinancePageScrollEl(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".ledger-page-body") ?? container;
}

/** 明细筛选 DOM；挂载点与 filters.ts 约定一致 */
const FILTER_PANEL_HTML = `
    <div data-detail-filter-from-mount class="detail-filter-date-mount" aria-label="起始日期"></div>
    <span class="detail-filter-sep">—</span>
    <div data-detail-filter-to-mount class="detail-filter-date-mount" aria-label="截止日期"></div>
    <div class="type-filters finance-type-filter" data-role="detail-type-filter">
      <button type="button" class="finance-type-filter-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="finance-type-filter-label">类型 · 全部</span>
        <span class="finance-type-filter-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
      </button>
      <div class="finance-type-filter-panel scroll-slim motion-popover" role="group" aria-label="交易类型筛选">
          <button type="button" class="finance-type-filter-option is-selected" data-stripe="expense" data-detail-type="expense" aria-pressed="true"><span class="finance-type-filter-stripe" aria-hidden="true"></span><span class="finance-type-filter-text">支出</span></button>
          <button type="button" class="finance-type-filter-option is-selected" data-stripe="proxy-expense" data-detail-type="proxy-expense" aria-pressed="true"><span class="finance-type-filter-stripe" aria-hidden="true"></span><span class="finance-type-filter-text">代支出</span></button>
          <button type="button" class="finance-type-filter-option is-selected" data-stripe="income" data-detail-type="income" aria-pressed="true"><span class="finance-type-filter-stripe" aria-hidden="true"></span><span class="finance-type-filter-text">收入</span></button>
          <button type="button" class="finance-type-filter-option is-selected" data-stripe="transfer" data-detail-type="transfer" aria-pressed="true"><span class="finance-type-filter-stripe" aria-hidden="true"></span><span class="finance-type-filter-text">转账</span></button>
          <button type="button" class="finance-type-filter-option is-selected" data-stripe="repayment" data-detail-type="repayment" aria-pressed="true"><span class="finance-type-filter-stripe" aria-hidden="true"></span><span class="finance-type-filter-text">还款</span></button>
          <button type="button" class="finance-type-filter-option is-selected" data-stripe="unknown" data-detail-type="unknown" aria-pressed="true"><span class="finance-type-filter-stripe" aria-hidden="true"></span><span class="finance-type-filter-text">未分类</span></button>
      </div>
    </div>`;

const LEGACY_FILTER_PANEL_HTML = `<div class="ledger-page-filter-inner">${FILTER_PANEL_HTML}</div>`;

/** 挂载统一页面壳；各 Finance 子视图通过 options 开关顶栏能力 */
export function mountFinancePage(
  container: HTMLElement,
  options: FinancePageOptions,
): FinancePageHandle {
  const ac = new AbortController();
  const { signal } = ac;
  const showBack = options.showBack !== false;
  const cleanups: Array<() => void> = [];

  const detailChrome = options.detailChrome === true;
  const topbarClass = detailChrome ? "finance-chrome-topbar ledger-page-topbar" : "ledger-page-topbar";
  const bodyClass = detailChrome ? "finance-chrome-body" : "ledger-page-body";
  const bodyId = "ledger-page-body";

  const mainHtml = detailChrome
    ? `<div class="finance-chrome-main">
        <div class="finance-chrome-shell">
        <header class="${topbarClass}">
          ${showBack ? `<button type="button" class="ledger-page-back" id="ledger-page-back" aria-label="返回">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>` : ""}
          <h1 class="ledger-page-title">${options.title}</h1>
          <div class="ledger-page-topbar-actions">
            ${options.showManage ? `<button type="button" class="ledger-page-manage-btn" id="ledger-page-manage-btn" aria-label="账户与分类管理">管理</button>` : ""}
            ${options.showFilter ? `<button type="button" class="ledger-page-filter-btn" id="ledger-page-filter-btn" aria-label="筛选" aria-expanded="false">筛选</button>` : ""}
            ${options.showImport ? `<button type="button" class="ledger-page-import-btn" id="ledger-page-import-btn">导入</button>` : ""}
            ${options.showGlobalSave ? `<button type="button" id="save-btn" class="save-btn save-unedited ledger-page-save orbita-action-btn" disabled>保存</button>` : ""}
            ${options.showRail ? `<button type="button" class="ledger-page-rail-toggle" id="ledger-page-rail-toggle" aria-label="收起侧边栏" aria-expanded="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="19" height="18" rx="1.5"/><path d="M15.5 3v18"/></svg>
            </button>` : ""}
          </div>
        </header>
        ${options.showFilter ? `<div class="finance-chrome-filter" id="ledger-page-filter"><div class="finance-chrome-filter-panel"><div class="finance-chrome-filter-inner">${FILTER_PANEL_HTML}</div></div></div>` : ""}
        </div>
        <div class="${bodyClass}" id="${bodyId}"></div>
      </div>`
    : `
        <header class="${topbarClass}">
          ${showBack ? `<button type="button" class="ledger-page-back" id="ledger-page-back" aria-label="返回">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>` : ""}
          <h1 class="ledger-page-title">${options.title}</h1>
          <div class="ledger-page-topbar-actions">
            ${options.showManage ? `<button type="button" class="ledger-page-manage-btn" id="ledger-page-manage-btn" aria-label="账户与分类管理">管理</button>` : ""}
            ${options.showFilter ? `<button type="button" class="ledger-page-filter-btn" id="ledger-page-filter-btn" aria-label="筛选" aria-expanded="false">筛选</button>` : ""}
            ${options.showImport ? `<button type="button" class="ledger-page-import-btn" id="ledger-page-import-btn">导入</button>` : ""}
            ${options.showGlobalSave ? `<button type="button" id="save-btn" class="save-btn save-unedited ledger-page-save orbita-action-btn" disabled>保存</button>` : ""}
            ${options.showRail ? `<button type="button" class="ledger-page-rail-toggle" id="ledger-page-rail-toggle" aria-label="收起侧边栏" aria-expanded="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="19" height="18" rx="1.5"/><path d="M15.5 3v18"/></svg>
            </button>` : ""}
          </div>
        </header>
        ${options.showFilter ? `<div class="ledger-page-filter" id="ledger-page-filter"><div class="ledger-page-filter-grid"><div class="ledger-page-filter-content">${LEGACY_FILTER_PANEL_HTML}</div></div></div>` : ""}
        <div class="${bodyClass}" id="${bodyId}"></div>`;

  const layout = mountFinanceLayout(container, {
    showRail: options.showRail,
    mainHtml,
    detailLayout: detailChrome,
  });

  const saveBtn = options.showGlobalSave
    ? container.querySelector<HTMLButtonElement>("#save-btn") ?? undefined
    : undefined;
  const filterWrap = container.querySelector<HTMLElement>("#ledger-page-filter");
  const filterBtn = container.querySelector<HTMLButtonElement>("#ledger-page-filter-btn");
  const railToggle = container.querySelector<HTMLButtonElement>("#ledger-page-rail-toggle");

  if (showBack && options.onBack) {
    container.querySelector("#ledger-page-back")!.addEventListener("click", options.onBack, { signal });
  }

  if (options.showManage && options.onManage) {
    container.querySelector("#ledger-page-manage-btn")!.addEventListener("click", options.onManage, { signal });
  }

  if (options.showImport && options.onImport) {
    const onImport = options.onImport;
    container.querySelector("#ledger-page-import-btn")!.addEventListener(
      "click",
      (e) => onImport(e as MouseEvent),
      { signal },
    );
  }

  if (options.showFilter && filterWrap && filterBtn) {
    const filterOpen = sessionStorage.getItem(FILTER_OPEN_KEY) === "true";
    if (filterOpen) {
      filterWrap.classList.add("is-open");
      filterBtn.setAttribute("aria-expanded", "true");
    }
    filterBtn.addEventListener(
      "click",
      () => {
        const open = filterWrap.classList.toggle("is-open");
        filterBtn.setAttribute("aria-expanded", String(open));
        sessionStorage.setItem(FILTER_OPEN_KEY, String(open));
      },
      { signal },
    );
    const filterInner = filterWrap.querySelector<HTMLElement>(
      detailChrome ? ".finance-chrome-filter-inner" : ".ledger-page-filter-content",
    );
    if (filterInner && options.renderFilter) options.renderFilter(filterInner);
  }

  if (options.showRail && railToggle) {
    layout.mountRailToggle(railToggle, signal);
  }

  const bodyCleanup = options.renderBody(layout.bodyEl);
  if (typeof bodyCleanup === "function") cleanups.push(bodyCleanup);

  if (layout.railInner && options.renderRail) {
    const railCleanup = options.renderRail(layout.railInner);
    if (typeof railCleanup === "function") cleanups.push(railCleanup);
  }

  return {
    root: layout.root,
    bodyEl: layout.bodyEl,
    saveBtn,
    // Detail returns its Surface handle; ordinary pages use their own page body.
    getScrollEl: () => layout.bodyEl,
    unmount: () => {
      cleanups.forEach((fn) => fn());
      ac.abort();
      layout.dispose();
    },
  };
}
