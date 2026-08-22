import { getFinancePageScrollEl } from "./ui/page-shell";

/** Finance 视图路由壳：keep-alive 多视图 + 按真实滚动容器记忆 scrollTop */
export type LedgerView = "dashboard" | "stats" | "detail" | "structure";

export type LedgerShellState = {
  activeView: LedgerView;
  scrollByView: Partial<Record<LedgerView, number>>;
};

export type LedgerViewHandle = {
  dispose: () => void;
  getScrollEl?: () => HTMLElement;
  openImport?: (trigger?: HTMLElement) => void;
};

export type LedgerShellHandle = {
  dispose: () => void;
  getRestoreState: () => LedgerShellState;
  restoreState: (state: LedgerShellState) => void;
};

export interface LedgerRouter {
  navigate(view: LedgerView, options?: { onReady?: (handle: LedgerViewHandle) => void }): void;
  back(): void;
}

type ViewEntry = {
  el: HTMLElement;
  mounted: boolean;
  handle?: LedgerViewHandle;
};

export function mountLedgerShell(
  root: HTMLElement,
  onViewMount: (
    view: LedgerView,
    panel: HTMLElement,
    router: LedgerRouter,
  ) => LedgerViewHandle | (() => void) | void,
): LedgerShellHandle {
  let activeView: LedgerView | null = null;
  const views = new Map<LedgerView, ViewEntry>();
  const scrollByView = new Map<LedgerView, number>();

  root.innerHTML = `
    <div class="ledger-app">
      <div class="ledger-view-panel" id="ledger-view-panel"></div>
    </div>`;

  const panel = root.querySelector<HTMLElement>("#ledger-view-panel")!;

  const router: LedgerRouter = {
    navigate(view, options) {
      const entry = switchView(view);
      if (entry.handle) options?.onReady?.(entry.handle);
    },
    back() {
      switchView("dashboard");
    },
  };

  function getOrCreateView(view: LedgerView): ViewEntry {
    let entry = views.get(view);
    if (!entry) {
      const el = document.createElement("div");
      el.className = "ledger-view hidden";
      el.dataset.view = view;
      panel.appendChild(el);
      entry = { el, mounted: false };
      views.set(view, entry);
    }
    return entry;
  }

  function viewScrollEl(entry: ViewEntry): HTMLElement {
    return entry.handle?.getScrollEl?.() ?? getFinancePageScrollEl(entry.el);
  }

  function switchView(view: LedgerView): ViewEntry {
    if (activeView === view) return getOrCreateView(view);
    if (activeView !== null) {
      const prev = views.get(activeView);
      if (prev) {
        scrollByView.set(activeView, viewScrollEl(prev).scrollTop);
      }
    }
    activeView = view;
    for (const [id, entry] of views) {
      entry.el.classList.toggle("hidden", id !== view);
    }
    const entry = getOrCreateView(view);
    entry.el.classList.remove("hidden");
    if (!entry.mounted) {
      entry.mounted = true;
      const result = onViewMount(view, entry.el, router);
      if (typeof result === "function") {
        entry.handle = { dispose: result };
      } else if (result) {
        entry.handle = result;
      }
    }
    // Scroll ownership comes from the mounted view handle; the shell never probes a detail DOM id.
    const scrollEl = viewScrollEl(entry);
    scrollEl.scrollTop = scrollByView.get(view) ?? 0;
    return entry;
  }

  function captureScroll(): void {
    if (activeView === null) return;
    const entry = views.get(activeView);
    if (!entry) return;
    scrollByView.set(activeView, viewScrollEl(entry).scrollTop);
  }

  function getRestoreState(): LedgerShellState {
    captureScroll();
    return {
      activeView: activeView ?? "dashboard",
      scrollByView: Object.fromEntries(scrollByView) as Partial<Record<LedgerView, number>>,
    };
  }

  function restoreState(state: LedgerShellState): void {
    if (state.scrollByView) {
      for (const [view, top] of Object.entries(state.scrollByView)) {
        if (typeof top === "number") scrollByView.set(view as LedgerView, top);
      }
    }
    switchView(state.activeView ?? "dashboard");
  }

  switchView("dashboard");

  if (import.meta.env.DEV) {
    const openDevFinanceDetail = () => {
      if (window.location.hash === "#dev-finance-detail") switchView("detail");
    };
    openDevFinanceDetail();
    window.addEventListener("hashchange", openDevFinanceDetail);
  }

  return {
    dispose() {
      for (const entry of views.values()) {
        entry.handle?.dispose();
      }
    },
    getRestoreState,
    restoreState,
  };
}

export function renderPlaceholder(panel: HTMLElement, text: string): void {
  panel.innerHTML = `<div class="ledger-placeholder"><p>${text}</p></div>`;
}
