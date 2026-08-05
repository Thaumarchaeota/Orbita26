import { isTauri } from "../../core/data/client";
import { ENGINES } from "./engines";
import { getCurrentEngine, setEngine, shellStore } from "./store";
import { openUrl } from "./adapter";
import {
  loadApps,
  saveApps,
  updateApp,
  updateAppInFolder,
} from "./apps";
import { topGridCapacity } from "./grid-slots";
import { mountAppDialog, mountConfirmDialog } from "./dialog";
import { mountBookmarksPanel } from "./bookmarks-panel";
import { mountLocalPanel } from "./local-panel";
import { mountFolderOverlay } from "./folder-overlay";
import { mountAppLauncherGrid } from "./launcher-grid";
import { mountTopToolkit, topToolkitHtml } from "./top-toolkit";

const APP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
const WORK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;
const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
const LBL_APPS = "\u5e94\u7528";
const LBL_WORK = "\u5de5\u4f5c";
const LBL_WORK_PLACEHOLDER = "\u656c\u8bf7\u671f\u5f85";
const LBL_ADD = "\u6dfb\u52a0";
const LBL_SEARCH_IN = (name: string) => `\u5728 ${name} \u4e2d\u641c\u7d22`;
const LBL_DELETE_TITLE = "\u5220\u9664\u786e\u8ba4";
const LBL_DELETE_MSG = (name: string) => `\u786e\u5b9a\u5220\u9664\u300c${name}\u300d\uff1f`;
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
      <div class="launcher-dock-apps" id="bookmarksPanel"></div>
      <div class="launcher-dock-local" id="localPanel"></div>
    </section>
  `;

  container.appendChild(sidebar);

  const promptApp = mountAppDialog(root);
  const confirmDelete = mountConfirmDialog(root);
  const folderOverlay = mountFolderOverlay(root);
  const askDelete = (name: string, trigger: HTMLElement) =>
    confirmDelete(LBL_DELETE_TITLE, LBL_DELETE_MSG(name), trigger);

  mountBookmarksPanel(sidebar.querySelector("#bookmarksPanel")!, root);
  mountLocalPanel(sidebar.querySelector("#localPanel")!, root);

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

  window.addEventListener("orbita:ui-prefs", () => {
    appsGrid.normalizeOnPrefsChange();
  });

  appsGrid.syncMissingIcons(appsGrid.repaint);
}

export function mountShell(root: HTMLElement) {
  if (!isTauri()) document.body.classList.add("is-web-preview");
  root.innerHTML = `
    <div class="bg bg-light"></div>
    <div class="bg bg-dark"></div>
    <div class="shell">
      <header class="shell-top">
        <div class="primary-mood-mount" id="primaryMoodMount"></div>
        <div class="search-band">
          <div class="search-band-center">
            <div class="engines-wrap">
              <div class="engine-indicator" id="indicator"></div>
              <div class="engines" id="engines"></div>
            </div>
            <div class="search-bar-line">
              <div class="clock-block">
                <div class="time" id="time"></div>
                <div class="date" id="date"></div>
              </div>
              <form class="search-bar" id="searchForm">
                <input type="text" id="searchInput" autofocus>
                <button type="submit" class="search-btn">${SEARCH_SVG}</button>
              </form>
            </div>
          </div>
          ${topToolkitHtml()}
        </div>
      </header>
      <main class="shell-body" id="shellBody"></main>
    </div>
  `;

  const timeEl = root.querySelector<HTMLElement>("#time")!;
  const dateEl = root.querySelector<HTMLElement>("#date")!;
  const indicator = root.querySelector<HTMLElement>("#indicator")!;
  const enginesEl = root.querySelector<HTMLElement>("#engines")!;
  const input = root.querySelector<HTMLInputElement>("#searchInput")!;

  startClock(timeEl, dateEl);
  mountTopToolkit(root);
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

  const body = root.querySelector<HTMLElement>("#shellBody")!;

  mountSidebar(body, root);

  const today = document.createElement("section");
  today.className = "today-section";
  today.id = "todayZone";
  body.appendChild(today);

  const work = document.createElement("section");
  work.className = "work-section";
  work.id = "workZone";
  work.innerHTML = `
    <div class="launcher-head">
      <span class="launcher-title">${WORK_SVG}${LBL_WORK}</span>
    </div>
    <div class="work-panel">
      <p class="work-placeholder">${LBL_WORK_PLACEHOLDER}</p>
    </div>
  `;
  body.appendChild(work);
}
