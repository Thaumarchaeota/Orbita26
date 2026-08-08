export type LedgerView = "dashboard" | "stats" | "detail" | "import";

const SECONDARY_TITLES: Record<Exclude<LedgerView, "dashboard">, string> = {
  stats: "统计",
  detail: "整理",
  import: "导入",
};

export interface LedgerRouter {
  navigate(view: LedgerView): void;
  back(): void;
}

type ViewEntry = {
  el: HTMLElement;
  mounted: boolean;
  unmount?: () => void;
};

export function mountLedgerShell(
  root: HTMLElement,
  onViewMount: (view: LedgerView, panel: HTMLElement, router: LedgerRouter) => (() => void) | void,
): () => void {
  const ac = new AbortController();
  const { signal } = ac;
  let activeView: LedgerView | null = null;
  const views = new Map<LedgerView, ViewEntry>();
  const scrollByView = new Map<LedgerView, number>();

  root.innerHTML = `
    <div class="ledger-app">
      <header class="ledger-chrome hidden" id="ledger-chrome">
        <button type="button" class="ledger-chrome-back" id="ledger-chrome-back" aria-label="返回">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <h1 class="ledger-chrome-title" id="ledger-chrome-title"></h1>
      </header>
      <div class="ledger-view-panel" id="ledger-view-panel"></div>
    </div>`;

  const chrome = root.querySelector<HTMLElement>("#ledger-chrome")!;
  const chromeTitle = root.querySelector<HTMLElement>("#ledger-chrome-title")!;
  const panel = root.querySelector<HTMLElement>("#ledger-view-panel")!;

  const router: LedgerRouter = {
    navigate(view) {
      switchView(view);
    },
    back() {
      switchView("dashboard");
    },
  };

  root.querySelector("#ledger-chrome-back")!.addEventListener(
    "click",
    () => router.back(),
    { signal },
  );

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

  function updateChrome(view: LedgerView): void {
    if (view === "dashboard") {
      chrome.classList.add("hidden");
      return;
    }
    if (view === "detail") {
      chrome.classList.add("hidden");
      return;
    }
    chrome.classList.remove("hidden");
    chromeTitle.textContent = SECONDARY_TITLES[view];
  }

  function switchView(view: LedgerView): void {
    if (activeView === view) return;
    if (activeView !== null) {
      const prev = views.get(activeView);
      if (prev) scrollByView.set(activeView, prev.el.scrollTop);
    }
    activeView = view;
    updateChrome(view);
    for (const [id, entry] of views) {
      entry.el.classList.toggle("hidden", id !== view);
    }
    const entry = getOrCreateView(view);
    entry.el.classList.remove("hidden");
    if (!entry.mounted) {
      entry.mounted = true;
      const result = onViewMount(view, entry.el, router);
      if (typeof result === "function") entry.unmount = result;
    }
    entry.el.scrollTop = scrollByView.get(view) ?? 0;
  }

  switchView("dashboard");

  return () => {
    for (const entry of views.values()) {
      entry.unmount?.();
    }
    ac.abort();
  };
}

export function renderPlaceholder(panel: HTMLElement, text: string): void {
  panel.innerHTML = `<div class="ledger-placeholder"><p>${text}</p></div>`;
}
