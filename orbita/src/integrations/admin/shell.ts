import { getAdminTab, getAdminTabs } from "./registry";
import { mountAdminSettingsButton } from "./settings";
import type { AdminTabId } from "./types";

let activeTab: AdminTabId | null = null;
let unmountActive: (() => void) | null = null;

function loadingMarkup(): string {
  return '<div class="admin-loading"><span class="admin-spinner"></span></div>';
}

function placeholderPanel(panel: HTMLElement, label: string): void {
  panel.innerHTML = `
    <div class="admin-placeholder">
      <p class="admin-placeholder-label">${label}</p>
      <p class="admin-placeholder-hint">开发中</p>
    </div>`;
}

function activateTab(id: AdminTabId, nav: HTMLElement, panel: HTMLElement): void {
  if (activeTab === id) return;

  unmountActive?.();
  unmountActive = null;
  panel.innerHTML = "";

  const tab = getAdminTab(id);
  if (!tab) return;

  const result = tab.mount(panel);
  if (typeof result === "function") unmountActive = result;

  activeTab = id;
  nav.querySelectorAll<HTMLButtonElement>(".admin-tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === id);
  });
}

export function mountAdminShell(root: HTMLElement): void {
  const tabs = getAdminTabs();
  if (!tabs.length) throw new Error("no admin tabs registered");

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
          <nav class="admin-tabs" id="adminTabs"></nav>
        </aside>
        <main class="admin-content" id="adminContent">${loadingMarkup()}</main>
      </div>
    </div>`;

  const titlebar = root.querySelector<HTMLElement>(".admin-titlebar")!;
  const app = root.querySelector<HTMLElement>(".admin-app")!;
  const toggle = root.querySelector<HTMLButtonElement>("#adminSidebarToggle")!;
  mountAdminSettingsButton(titlebar);
  toggle.addEventListener("click", () => {
    const collapsed = app.classList.toggle("is-sidebar-collapsed");
    toggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
  });

  const nav = root.querySelector<HTMLElement>("#adminTabs")!;
  const panel = root.querySelector<HTMLElement>("#adminContent")!;

  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-tab-btn";
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener("click", () => activateTab(tab.id, nav, panel));
    nav.appendChild(btn);
  }

  activateTab(tabs[0].id, nav, panel);
}

export { placeholderPanel };
