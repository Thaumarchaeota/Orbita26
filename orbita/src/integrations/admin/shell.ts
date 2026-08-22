import { bindDataDirChanged } from "../../core/data/dir-sync";
import {
  queryLayoutFlipTarget,
  runLayoutFlip,
  runSidebarStripMotion,
} from "../../ui/layout-flip";
import { getSettings } from "../../core/settings";
// Insight Host：cached destination 生命周期契约见 docs/plans/v0.0.17-insight-spec.md §4
import {
  DEFAULT_DESTINATION,
  loadPersistedDestination,
  savePersistedDestination,
} from "./destination-persist";
import { setHostDataDirGuard } from "./host-guards";
import { DOMAIN_ICONS } from "./icons";
import { getInsightDestination, getInsightDestinations } from "./registry";
import type {
  InsightDestinationHandle,
  InsightDestinationId,
  InsightHostContext,
} from "./types";

type CachedDestination = {
  root: HTMLElement;
  handle: InsightDestinationHandle;
};

let activeId: InsightDestinationId | null = null;
let hostGeneration = 0;
const liveHostCtx: InsightHostContext = { generation: 0, dataDirKey: "_default" };
const cache = new Map<InsightDestinationId, CachedDestination>();
let tabIndicator: HTMLElement | null = null;
let viewport: HTMLElement | null = null;
let nav: HTMLElement | null = null;
let unbindDataDir: (() => void) | null = null;

function syncHostContext(): void {
  liveHostCtx.generation = hostGeneration;
  liveHostCtx.dataDirKey = getSettings().dataDir || "_default";
}

function hostContext(): InsightHostContext {
  syncHostContext();
  return liveHostCtx;
}

function setRootVisible(root: HTMLElement, visible: boolean): void {
  root.classList.toggle("is-active", visible);
  root.setAttribute("aria-hidden", visible ? "false" : "true");
}

function moveTabIndicator(navEl: HTMLElement, btn: HTMLButtonElement): void {
  if (!tabIndicator) return;
  const navRect = navEl.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  tabIndicator.style.width = `${btnRect.width}px`;
  tabIndicator.style.height = `${btnRect.height}px`;
  tabIndicator.style.transform = `translate(${btnRect.left - navRect.left}px, ${btnRect.top - navRect.top}px)`;
  tabIndicator.style.opacity = "1";
}

function updateSidebarActive(id: InsightDestinationId): void {
  if (!nav) return;
  nav.querySelectorAll<HTMLButtonElement>(".admin-tab-btn").forEach((btn) => {
    const isActive = btn.dataset.tab === id;
    btn.classList.toggle("is-active", isActive);
    if (isActive) moveTabIndicator(nav!, btn);
  });
}

function persistDestination(id: InsightDestinationId): void {
  const entry = cache.get(id);
  savePersistedDestination({
    destinationId: id,
    destinationState: entry?.handle.getRestoreState?.(),
  });
}

function getOrMount(id: InsightDestinationId, panel: HTMLElement): CachedDestination | null {
  const existing = cache.get(id);
  if (existing) return existing;

  const dest = getInsightDestination(id);
  if (!dest) return null;

  const root = document.createElement("div");
  root.className = "insight-dest-root";
  root.dataset.dest = id;
  root.setAttribute("aria-hidden", "true");
  panel.appendChild(root);

  const handle = dest.mount(root, hostContext());
  const entry = { root, handle };
  cache.set(id, entry);

  const persisted = loadPersistedDestination();
  if (
    persisted?.destinationId === id &&
    persisted.destinationState != null &&
    handle.restoreState
  ) {
    handle.restoreState(persisted.destinationState);
  }

  return entry;
}

async function activateDestination(id: InsightDestinationId, panel: HTMLElement): Promise<void> {
  if (activeId === id) return;

  const current = activeId ? cache.get(activeId) : null;
  if (current) {
    persistDestination(activeId!);
    current.handle.deactivate();
    setRootVisible(current.root, false);
  }

  const entry = getOrMount(id, panel);
  if (!entry) return;

  setRootVisible(entry.root, true);
  syncHostContext();
  await entry.handle.activate();

  activeId = id;
  updateSidebarActive(id);
  persistDestination(id);
}

async function disposeAll(reason: "host-dispose" | "data-dir-change"): Promise<void> {
  for (const [, entry] of cache) {
    entry.handle.dispose(reason);
    entry.root.remove();
  }
  cache.clear();
  activeId = null;
  hostGeneration += 1;
}

async function canDisposeAll(reason: "host-dispose" | "data-dir-change"): Promise<boolean> {
  for (const [, entry] of cache) {
    if (entry.handle.canDispose) {
      const ok = await entry.handle.canDispose(reason);
      if (!ok) return false;
    }
  }
  return true;
}

async function onDataDirChanged(panel: HTMLElement): Promise<void> {
  if (!(await canDisposeAll("data-dir-change"))) return;
  const prev = activeId ?? DEFAULT_DESTINATION;
  await disposeAll("data-dir-change");
  panel.innerHTML = "";
  await activateDestination(prev, panel);
}

function resolveInitialDestination(): InsightDestinationId {
  const dests = getInsightDestinations();
  const persisted = loadPersistedDestination();
  if (persisted && dests.some((d) => d.id === persisted.destinationId)) {
    return persisted.destinationId;
  }
  return dests.some((d) => d.id === DEFAULT_DESTINATION) ? DEFAULT_DESTINATION : dests[0]?.id ?? DEFAULT_DESTINATION;
}

export function mountAdminShell(root: HTMLElement): void {
  const dests = getInsightDestinations();
  if (!dests.length) throw new Error("no insight destinations registered");

  root.innerHTML = `
    <div class="admin-app">
      <header class="admin-titlebar">
        <div class="admin-titlebar-drag" data-tauri-drag-region>
          <div class="admin-titlebar-start">
            <span class="admin-titlebar-title">Orbita</span>
            <button type="button" class="admin-sidebar-toggle" id="adminSidebarToggle" aria-label="收起侧边栏" data-tauri-drag-region="false">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
            </button>
          </div>
        </div>
        <div class="admin-titlebar-spacer" aria-hidden="true"></div>
      </header>
      <div class="admin-shell">
        <aside class="admin-sidebar" id="adminSidebar">
          <nav class="admin-tabs" id="adminTabs">
            <div class="admin-tab-indicator" aria-hidden="true"></div>
          </nav>
        </aside>
        <main class="admin-content" id="adminContent" role="main"></main>
      </div>
    </div>`;

  const titlebar = root.querySelector<HTMLElement>(".admin-titlebar")!;
  const app = root.querySelector<HTMLElement>(".admin-app")!;
  const toggle = root.querySelector<HTMLButtonElement>("#adminSidebarToggle")!;

  import("./settings").then(({ mountAdminSettingsButton }) => {
    mountAdminSettingsButton(titlebar);
  });

  toggle.addEventListener("click", () => {
    const content = root.querySelector<HTMLElement>("#adminContent");
    const flipTarget = content ? queryLayoutFlipTarget(content) : null;
    const tabs = root.querySelector<HTMLElement>("#adminTabs");
    const mutate = () => {
      const collapsed = app.classList.toggle("is-sidebar-collapsed");
      toggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
    };
    const finish = () => {
      const navEl = root.querySelector<HTMLElement>("#adminTabs")!;
      const active = navEl.querySelector<HTMLButtonElement>(".admin-tab-btn.is-active");
      if (active) requestAnimationFrame(() => moveTabIndicator(navEl, active));
    };

    if (!flipTarget) {
      mutate();
      void (tabs ? runSidebarStripMotion(tabs) : Promise.resolve()).finally(finish);
      return;
    }

    void (async () => {
      const motion = tabs ? runSidebarStripMotion(tabs) : Promise.resolve();
      await runLayoutFlip(flipTarget, mutate);
      await motion;
      finish();
    })();
  });

  nav = root.querySelector<HTMLElement>("#adminTabs")!;
  tabIndicator = nav.querySelector<HTMLElement>(".admin-tab-indicator");
  viewport = root.querySelector<HTMLElement>("#adminContent")!;

  for (const dest of dests) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-tab-btn";
    btn.dataset.tab = dest.id;
    btn.title = dest.label;
    btn.setAttribute("aria-label", dest.label);
    const icon = DOMAIN_ICONS[dest.icon] ?? DOMAIN_ICONS[dest.id] ?? "";
    btn.innerHTML = `<span class="admin-tab-icon">${icon}</span><span class="admin-tab-label">${dest.label}</span>`;
    btn.addEventListener("click", () => {
      void activateDestination(dest.id, viewport!);
    });
    nav.appendChild(btn);
  }

  window.addEventListener("resize", () => {
    const active = nav!.querySelector<HTMLButtonElement>(".admin-tab-btn.is-active");
    if (active) moveTabIndicator(nav!, active);
  });

  setHostDataDirGuard((reason) => canDisposeAll(reason));

  unbindDataDir?.();
  unbindDataDir = bindDataDirChanged(() => {
    void onDataDirChanged(viewport!);
  });

  window.addEventListener("beforeunload", () => {
    if (activeId) persistDestination(activeId);
  });

  void activateDestination(resolveInitialDestination(), viewport);
}

export async function requestInsightDataDirChange(): Promise<boolean> {
  return canDisposeAll("data-dir-change");
}
