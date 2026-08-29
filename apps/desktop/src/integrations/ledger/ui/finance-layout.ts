/**
 * Finance 页面布局：桌面 CSS Grid 主列 + 右栏，窄宽时仅 composer rail 可成为 drawer。
 */
export const RAIL_COLLAPSED_KEY = "ledger-detail-sidebar-collapsed";
export const FINANCE_RAIL_DRAWER_MAX_WIDTH = 1180;

export type FinanceLayoutOptions = {
  showRail?: boolean;
  mainHtml: string;
  detailLayout?: boolean;
};

export type FinanceLayoutHandle = {
  root: HTMLElement;
  bodyEl: HTMLElement;
  railInner?: HTMLElement;
  mountRailToggle: (toggleBtn: HTMLButtonElement, signal: AbortSignal) => void;
  dispose: () => void;
};

export function mountFinanceLayout(
  container: HTMLElement,
  options: FinanceLayoutOptions,
): FinanceLayoutHandle {
  const showRail = options.showRail ?? false;

  container.innerHTML = showRail
    ? `<div class="ledger-page has-rail">
        <div class="ledger-page-stage ledger-page-grid">
          <div class="ledger-page-main">${options.mainHtml}</div>
          <aside class="ledger-page-rail" id="ledger-page-rail" aria-hidden="false"><div class="ledger-page-rail-inner" id="ledger-page-rail-inner"></div></aside>
        </div>
        <button type="button" class="ledger-page-rail-scrim" aria-label="关闭记一笔抽屉" hidden></button>
      </div>`
    : `<div class="ledger-page"><div class="ledger-page-main">${options.mainHtml}</div></div>`;

  const root = container.querySelector<HTMLElement>(".ledger-page")!;
  if (options.detailLayout) root.classList.add("is-finance-detail");
  const bodyEl = container.querySelector<HTMLElement>("#ledger-page-body")!;
  const railInner = container.querySelector<HTMLElement>("#ledger-page-rail-inner") ?? undefined;
  const lifecycle = new AbortController();
  const scrim = container.querySelector<HTMLButtonElement>(".ledger-page-rail-scrim");
  let toggleBtn: HTMLButtonElement | null = null;
  let lastToggleBtn: HTMLButtonElement | null = null;
  let narrow = false;
  let railOpen = false;

  // Drawer is a secondary surface. Keeping this state here prevents views from
  // competing over width, focus, or Escape handling (finance-rebuild §4).
  function isNarrowViewport(): boolean {
    return window.innerWidth <= FINANCE_RAIL_DRAWER_MAX_WIDTH;
  }

  function syncRailState(options: { restoreFocus?: boolean } = {}): void {
    const railEl = container.querySelector<HTMLElement>("#ledger-page-rail");
    if (!railEl) return;
    root.classList.toggle("is-narrow", narrow);
    root.classList.toggle("is-rail-collapsed", !narrow && !railOpen);
    root.classList.toggle("is-rail-drawer-open", narrow && railOpen);
    railEl.setAttribute("aria-hidden", String(!railOpen));
    if (scrim) scrim.hidden = !(narrow && railOpen);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-label", railOpen ? "关闭记一笔" : "打开记一笔");
      toggleBtn.setAttribute("aria-expanded", String(railOpen));
    }
    if (options.restoreFocus && lastToggleBtn?.isConnected) lastToggleBtn.focus();
  }

  function setRailOpen(open: boolean, options: { restoreFocus?: boolean } = {}): void {
    railOpen = open;
    if (!narrow) sessionStorage.setItem(RAIL_COLLAPSED_KEY, String(!open));
    syncRailState(options);
    if (narrow && open) {
      const focusTarget = railInner?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusTarget?.focus();
    }
  }

  function syncViewport(): void {
    const nextNarrow = isNarrowViewport();
    if (nextNarrow === narrow) return;
    narrow = nextNarrow;
    // A rail that was visible on desktop must not silently cover a newly narrow main column.
    railOpen = narrow ? false : sessionStorage.getItem(RAIL_COLLAPSED_KEY) !== "true";
    syncRailState();
  }

  narrow = isNarrowViewport();
  railOpen = narrow ? false : sessionStorage.getItem(RAIL_COLLAPSED_KEY) !== "true";
  syncRailState();
  window.addEventListener("resize", syncViewport, { signal: lifecycle.signal });
  scrim?.addEventListener("click", () => setRailOpen(false, { restoreFocus: true }), {
    signal: lifecycle.signal,
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && narrow && railOpen) setRailOpen(false, { restoreFocus: true });
    },
    { signal: lifecycle.signal },
  );

  function mountRailToggle(button: HTMLButtonElement, signal: AbortSignal): void {
    if (!showRail) return;
    // The page shell owns the button; the layout owns the rail state and drawer lifecycle.
    // Do not let a cached Finance view retain a listener after its page is disposed.
    toggleBtn = button;
    syncRailState();
    button.addEventListener(
      "click",
      () => {
        lastToggleBtn = button;
        setRailOpen(!railOpen);
      },
      { signal },
    );
  }

  return {
    root,
    bodyEl,
    railInner,
    mountRailToggle,
    dispose: () => lifecycle.abort(),
  };
}
