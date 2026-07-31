import { ENGINES } from "./engines";
import { getCurrentEngine, setEngine, shellStore } from "./store";
import { launchV2ray, openUrl } from "./adapter";
import {
  loadBookmarks,
  saveBookmarks,
  updateBookmark,
  updateBookmarkInFolder,
} from "./bookmarks";
import {
  loadApps,
  saveApps,
  updateApp,
  updateAppInFolder,
} from "./apps";
import { dockLeftGridCapacity, topGridCapacity } from "./grid-slots";
import { mountAppDialog, mountBookmarkDialog, mountConfirmDialog } from "./dialog";
import { mountLocalPanel } from "./local-panel";
import { mountSettingsButton } from "../settings";
import { mountFolderOverlay } from "./folder-overlay";
import { mountAppLauncherGrid, mountBookmarkLauncherGrid } from "./launcher-grid";
import { mountStatsBar } from "./stats-bar";

const BOOKMARK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const APP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;

const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
const V2RAY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

const LBL_BOOKMARKS = "\u4e66\u7b7e";
const LBL_APPS = "\u5e94\u7528";
const LBL_ADD = "\u6dfb\u52a0";
const LBL_SEARCH_IN = (name: string) => `\u5728 ${name} \u4e2d\u641c\u7d22`;
const LBL_DELETE_TITLE = "\u5220\u9664\u786e\u8ba4";
const LBL_DELETE_MSG = (name: string) => `\u786e\u5b9a\u5220\u9664\u300c${name}\u300d\uff1f`;
const LBL_V2RAY_TITLE = "\u542f\u52a8 v2rayN";
const LBL_V2RAY_FAIL = "\u542f\u52a8 v2rayN \u5931\u8d25";

function buildSearchUrl(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//.test(v) || /^[\w-]+\.[\w.-]+/.test(v)) {
    return v.startsWith("http") ? v : `https://${v}`;
  }
  return getCurrentEngine().url(encodeURIComponent(v));
}

function moveIndicator(indicator: HTMLElement, btn: HTMLButtonElement | null) {
  if (!btn) return;
  indicator.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
}

function updatePlaceholder(input: HTMLInputElement) {
  input.classList.add("fade");
  setTimeout(() => {
    input.placeholder = LBL_SEARCH_IN(getCurrentEngine().name);
    input.classList.remove("fade");
  }, 150);
}

function renderEngines(container: HTMLElement, indicator: HTMLElement) {
  const { engineId } = shellStore.getState();
  container.innerHTML = ENGINES.map(
    (e) =>
      `<button type="button" data-id="${e.id}" class="${e.id === engineId ? "active" : ""}" data-tip="${e.name}">${e.icon}</button>`,
  ).join("");
  const active = container.querySelector<HTMLButtonElement>(`button[data-id="${engineId}"]`);
  requestAnimationFrame(() => moveIndicator(indicator, active));
}

function startClock(timeEl: HTMLElement, dateEl: HTMLElement) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const tick = () => {
    const n = new Date();
    timeEl.textContent = n.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    dateEl.textContent = `${months[n.getMonth()]}${n.getDate()}`;
  };
  tick();
  setInterval(tick, 1000);
}

function mountSidebar(container: HTMLElement, root: HTMLElement) {
  const sidebar = document.createElement("div");
  sidebar.className = "shell-sidebar";
  sidebar.innerHTML = `
    <section class="launcher-section">
      <div class="launcher-head">
        <span class="launcher-title">${APP_SVG}${LBL_APPS}</span>
        <button type="button" class="launcher-head-add" id="appsAddBtn" data-tip="${LBL_ADD}" aria-label="${LBL_ADD}">+</button>
      </div>
      <div class="launcher-grid-scroll bookmarks-scroll">
        <div class="launcher-grid bookmarks-grid" id="appsGrid"></div>
      </div>
    </section>
    <section class="launcher-dock">
      <div class="launcher-dock-apps">
        <div class="launcher-head">
          <span class="launcher-title">${BOOKMARK_SVG}${LBL_BOOKMARKS}</span>
          <button type="button" class="launcher-head-add" id="bookmarksAddBtn" data-tip="${LBL_ADD}" aria-label="${LBL_ADD}">+</button>
        </div>
        <div class="launcher-grid-scroll apps-scroll">
          <div class="launcher-grid apps-grid" id="bookmarksGrid"></div>
        </div>
      </div>
      <div class="launcher-dock-local" id="localPanel"></div>
    </section>
  `;

  container.appendChild(sidebar);

  const promptBookmark = mountBookmarkDialog(root);
  const promptApp = mountAppDialog(root);
  const confirmDelete = mountConfirmDialog(root);
  const folderOverlay = mountFolderOverlay(root);
  const askDelete = (name: string, trigger: HTMLElement) =>
    confirmDelete(LBL_DELETE_TITLE, LBL_DELETE_MSG(name), trigger);

  mountLocalPanel(sidebar.querySelector("#localPanel")!, root);

  const bookmarksRef = { current: loadBookmarks() };
  const appsRef = { current: loadApps() };

  const appsGrid = mountAppLauncherGrid({
    gridEl: sidebar.querySelector("#appsGrid")!,
    addBtn: sidebar.querySelector<HTMLButtonElement>("#appsAddBtn")!,
    gridClass: "bookmarks-grid",
    capacity: topGridCapacity,
    ref: appsRef,
    save: saveApps,
    updateLeaf: updateApp,
    updateLeafInFolder: updateAppInFolder,
    folderOverlay,
    dialogRoot: root,
    confirmDelete: askDelete,
    prompt: promptApp,
  });

  const bookmarksGrid = mountBookmarkLauncherGrid({
    gridEl: sidebar.querySelector("#bookmarksGrid")!,
    addBtn: sidebar.querySelector<HTMLButtonElement>("#bookmarksAddBtn")!,
    gridClass: "apps-grid",
    capacity: dockLeftGridCapacity,
    ref: bookmarksRef,
    save: saveBookmarks,
    updateLeaf: updateBookmark,
    updateLeafInFolder: updateBookmarkInFolder,
    folderOverlay,
    dialogRoot: root,
    confirmDelete: askDelete,
    prompt: promptBookmark,
  });

  window.addEventListener("orbita:ui-prefs", () => {
    appsGrid.normalizeOnPrefsChange();
    bookmarksGrid.normalizeOnPrefsChange();
  });

  appsGrid.syncMissingIcons(appsGrid.repaint);
  bookmarksGrid.syncMissingIcons(bookmarksGrid.repaint);
}

export function mountShell(root: HTMLElement) {
  root.innerHTML = `
    <div class="bg bg-light"></div>
    <div class="bg bg-dark"></div>
    <div class="shell">
      <header class="shell-top">
        <div class="shell-top-inner">
          <div class="engines-wrap">
            <div class="engine-indicator" id="indicator"></div>
            <div class="engines" id="engines"></div>
          </div>
          <div class="search-row">
            <div class="clock-block">
              <div class="time" id="time"></div>
              <div class="date" id="date"></div>
            </div>
            <form class="search-bar" id="searchForm">
              <input type="text" id="searchInput" autofocus>
              <button type="submit" class="search-btn">${SEARCH_SVG}</button>
            </form>
            <button type="button" class="v2ray-btn" id="v2rayBtn" data-tip="${LBL_V2RAY_TITLE}">${V2RAY_SVG}</button>
          </div>
        </div>
      </header>
      <main class="shell-body" id="shellBody"></main>
    </div>
    <div class="top-tray">
      <div class="sys-stats" id="sysStats">
        <div class="sys-stat-item sys-stat-fps">
          <span class="sys-stat-label">FPS</span>
          <span class="sys-stat-val" id="statFps">--</span>
        </div>
        <div class="sys-stat-item">
          <span class="sys-stat-label">CPU</span>
          <span class="sys-stat-val" id="statCpu">--</span>
        </div>
        <div class="sys-stat-item">
          <span class="sys-stat-label">MEM</span>
          <span class="sys-stat-val" id="statMem">--</span>
        </div>
      </div>
      <div id="settingsMount"></div>
    </div>
  `;

  const timeEl = root.querySelector<HTMLElement>("#time")!;
  const dateEl = root.querySelector<HTMLElement>("#date")!;
  const indicator = root.querySelector<HTMLElement>("#indicator")!;
  const enginesEl = root.querySelector<HTMLElement>("#engines")!;
  const input = root.querySelector<HTMLInputElement>("#searchInput")!;

  startClock(timeEl, dateEl);
  mountStatsBar(root);
  renderEngines(enginesEl, indicator);
  input.placeholder = LBL_SEARCH_IN(getCurrentEngine().name);

  enginesEl.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!btn?.dataset.id) return;
    const engine = ENGINES.find((item) => item.id === btn.dataset.id);
    if (!engine) return;
    if (shellStore.getState().engineId === engine.id) {
      await openUrl(engine.home);
      return;
    }
    setEngine(engine.id);
    updatePlaceholder(input);
    input.focus();
  });

  shellStore.subscribe(() => renderEngines(enginesEl, indicator));

  window.addEventListener("resize", () => {
    moveIndicator(indicator, enginesEl.querySelector<HTMLButtonElement>("button.active"));
  });

  root.querySelector("#searchForm")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = buildSearchUrl(input.value);
    if (url) await openUrl(url);
  });

  root.querySelector("#v2rayBtn")!.addEventListener("click", () => {
    launchV2ray().catch(() => alert(LBL_V2RAY_FAIL));
  });

  mountSettingsButton(root);
  mountSidebar(root.querySelector<HTMLElement>("#shellBody")!, root);
}
