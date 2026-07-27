import { ENGINES } from "./engines";
import { getCurrentEngine, setEngine, shellStore } from "./store";
import {
  launchApp,
  launchV2ray,
  openUrl,
  pickAppFile,
  cacheAppIcon,
  deleteAppIcon,
  readAppIconData,
  cacheFavicon,
  deleteFavicon,
  webFaviconSrc,
} from "./adapter";
import {
  loadBookmarks,
  saveBookmarks,
  updateBookmark,
  updateBookmarkInFolder,
  type BookmarkEntry,
  type BookmarkLink,
} from "./bookmarks";
import {
  guessAppName,
  loadApps,
  saveApps,
  updateApp,
  updateAppInFolder,
  type AppEntry,
  type AppLink,
} from "./apps";
import {
  appsGridCapacity,
  bookmarksGridCapacity,
  firstEmptySlot,
  insertAtSlot,
  migrateDenseSlots,
  normalizeGridEntries,
} from "./grid-slots";
import { renderTile } from "./tiles";
import { bindTileGrid } from "./tile-grid";
import { mountAppDialog, mountBookmarkDialog, mountConfirmDialog } from "./dialog";
import { mountLocalPanel } from "./local-panel";
import { mountSettingsButton } from "./settings-dialog";
import { mountFolderOverlay } from "./folder-overlay";
import {
  flattenBookmarkLeaves,
  flattenAppLeaves,
  getBookmarkFolder,
  getAppFolder,
  isBookmarkFolder,
  isAppFolder,
  dissolveRootAppFolders,
  dissolveRootBookmarkFolders,
  mergeAppsIntoNewFolder,
  mergeBookmarksIntoNewFolder,
  moveAppToFolder,
  moveAppToRoot,
  moveBookmarkToFolder,
  moveBookmarkToRoot,
  removeAppEntry,
  removeBookmarkEntry,
  reorderFolderApps,
  reorderFolderBookmarks,
  updateAppFolderName,
  updateBookmarkFolderName,
} from "./launcher-tree";

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
      `<button type="button" data-id="${e.id}" class="${e.id === engineId ? "active" : ""}" title="${e.name}">${e.icon}</button>`,
  ).join("");
  const active = container.querySelector<HTMLButtonElement>(`button[data-id="${engineId}"]`);
  requestAnimationFrame(() => moveIndicator(indicator, active));
}

function startClock(timeEl: HTMLElement, dateEl: HTMLElement) {
  const tick = () => {
    const n = new Date();
    timeEl.textContent = n.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    dateEl.textContent = n.toLocaleDateString("zh-CN", { weekday: "long", month: "long", day: "numeric" });
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
        <span class="launcher-title">${BOOKMARK_SVG}${LBL_BOOKMARKS}</span>
        <button type="button" class="launcher-head-add" id="bookmarksAddBtn" title="${LBL_ADD}" aria-label="${LBL_ADD}">+</button>
      </div>
      <div class="launcher-grid-scroll bookmarks-scroll">
        <div class="launcher-grid bookmarks-grid" id="bookmarksGrid"></div>
      </div>
    </section>
    <section class="launcher-dock">
      <div class="launcher-dock-apps">
        <div class="launcher-head">
          <span class="launcher-title">${APP_SVG}${LBL_APPS}</span>
          <button type="button" class="launcher-head-add" id="appsAddBtn" title="${LBL_ADD}" aria-label="${LBL_ADD}">+</button>
        </div>
        <div class="launcher-grid-scroll apps-scroll">
          <div class="launcher-grid apps-grid" id="appsGrid"></div>
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
  const askDeleteById = (_id: string, name: string, trigger: HTMLElement) => askDelete(name, trigger);

  mountLocalPanel(sidebar.querySelector("#localPanel")!, root, askDelete);

  let bookmarks = loadBookmarks();
  let apps = loadApps();
  if (!bookmarks.some((e) => e.slot !== undefined)) {
    bookmarks = migrateDenseSlots(bookmarks);
    saveBookmarks(bookmarks);
  }
  if (!apps.some((e) => e.slot !== undefined)) {
    apps = migrateDenseSlots(apps);
    saveApps(apps);
  }

  const bookmarksAddBtn = sidebar.querySelector<HTMLButtonElement>("#bookmarksAddBtn")!;
  const appsAddBtn = sidebar.querySelector<HTMLButtonElement>("#appsAddBtn")!;
  const appIconSrcCache = new Map<string, string>();
  const bookmarkIconSrcCache = new Map<string, string>();

  async function rememberAppIcon(appId: string, iconPath?: string) {
    if (!iconPath) {
      appIconSrcCache.delete(appId);
      return;
    }
    const dataUrl = await readAppIconData(iconPath);
    if (dataUrl) appIconSrcCache.set(appId, dataUrl);
  }

  async function rememberBookmarkIcon(bookmark: BookmarkLink, iconPath?: string) {
    const path = iconPath ?? bookmark.icon;
    if (path) {
      const dataUrl = await readAppIconData(path);
      if (dataUrl) {
        bookmarkIconSrcCache.set(bookmark.id, dataUrl);
        return;
      }
    }
    bookmarkIconSrcCache.set(bookmark.id, webFaviconSrc(bookmark.url));
  }

  function bookmarkPreview(folder: Extract<BookmarkEntry, { kind: "folder" }>) {
    return folder.children.map((c) => ({
      name: c.name,
      iconSrc: bookmarkIconSrcCache.get(c.id),
    }));
  }

  function appPreview(folder: Extract<AppEntry, { kind: "folder" }>) {
    return folder.children.map((c) => ({
      name: c.name,
      iconSrc: appIconSrcCache.get(c.id),
    }));
  }

  function renderBookmarkTile(item: BookmarkEntry | null, editMode: boolean, slot = 0) {
    if (item?.kind === "folder") {
      return renderTile(
        { id: item.id, name: item.name, kind: "folder" },
        {},
        LBL_ADD,
        editMode,
        false,
        undefined,
        bookmarkPreview(item),
        slot,
      );
    }
    const link = item as BookmarkLink | null;
    return renderTile(
      link,
      link ? { url: link.url, kind: "link" } : {},
      LBL_ADD,
      editMode,
      false,
      link ? bookmarkIconSrcCache.get(link.id) : undefined,
      undefined,
      slot,
    );
  }

  function renderAppTile(item: AppEntry | null, editMode: boolean, slot = 0) {
    if (item?.kind === "folder") {
      return renderTile(
        { id: item.id, name: item.name, kind: "folder" },
        {},
        LBL_ADD,
        editMode,
        false,
        undefined,
        appPreview(item),
        slot,
      );
    }
    const link = item as AppLink | null;
    return renderTile(
      link,
      link ? { path: link.path, kind: "app" } : {},
      LBL_ADD,
      editMode,
      false,
      link ? appIconSrcCache.get(link.id) : undefined,
      undefined,
      slot,
    );
  }

  async function addBookmarkAtSlot(slot: number, trigger: HTMLElement): Promise<BookmarkEntry[] | null> {
    const data = await promptBookmark(undefined, trigger);
    if (!data) return null;
    const id = crypto.randomUUID();
    const icon = await cacheFavicon(id, data.url);
    const url = data.url.trim().startsWith("http") ? data.url.trim() : `https://${data.url.trim()}`;
    const link: BookmarkLink = {
      kind: "link",
      id,
      name: data.name.trim(),
      url,
      slot,
      ...(icon ? { icon } : {}),
    };
    if (icon) await rememberBookmarkIcon(link, icon);
    else await rememberBookmarkIcon(link);
    return insertAtSlot(bookmarks, link, slot);
  }

  async function addAppAtSlot(slot: number, trigger: HTMLElement): Promise<AppEntry[] | null> {
    const path = await pickAppFile();
    if (!path) return null;
    const data = await promptApp({ name: guessAppName(path), path }, false, trigger);
    if (!data) return null;
    const id = crypto.randomUUID();
    const icon = await cacheAppIcon(id, data.path);
    const link: AppLink = {
      kind: "app",
      id,
      name: data.name.trim(),
      path: data.path.trim(),
      slot,
      ...(icon ? { icon } : {}),
    };
    if (icon) await rememberAppIcon(id, icon);
    return insertAtSlot(apps, link, slot);
  }

  function openBookmarkFolder(folderId: string, trigger: HTMLElement) {
    const folder = getBookmarkFolder(bookmarks, folderId);
    if (!folder) return;
    folderOverlay.open({
      title: folder.name,
      folderId,
      getItems: () => getBookmarkFolder(bookmarks, folderId)?.children ?? [],
      gridClass: "bookmarks-grid",
      renderTile: (item, editMode) =>
        renderTile(
          item,
          item ? { url: item.url, kind: "link" } : {},
          LBL_ADD,
          editMode,
          false,
          item ? bookmarkIconSrcCache.get(item.id) : undefined,
        ),
      onActivate: (item) => openUrl(item.url),
      onAdd: async (trigger) => {
        const data = await promptBookmark(undefined, trigger);
        if (!data) return null;
        const id = crypto.randomUUID();
        const icon = await cacheFavicon(id, data.url);
        const url = data.url.trim().startsWith("http") ? data.url.trim() : `https://${data.url.trim()}`;
        const link: BookmarkLink = { kind: "link", id, name: data.name.trim(), url, ...(icon ? { icon } : {}) };
        if (icon) await rememberBookmarkIcon(link, icon);
        else await rememberBookmarkIcon(link);
        bookmarks = bookmarks.map((e) =>
          e.id === folderId && e.kind === "folder" ? { ...e, children: [...e.children, link] } : e,
        );
        saveBookmarks(bookmarks);
        repaintBookmarks();
        return getBookmarkFolder(bookmarks, folderId)?.children ?? null;
      },
      onRenameTitle: (name) => {
        bookmarks = updateBookmarkFolderName(bookmarks, folderId, name);
        saveBookmarks(bookmarks);
        repaintBookmarks();
      },
      onEdit: async (item, trigger) => {
        const data = await promptBookmark({ name: item.name, url: item.url }, trigger);
        if (!data) return null;
        bookmarks = updateBookmarkInFolder(folderId, item.id, data.name, data.url);
        return getBookmarkFolder(bookmarks, folderId)?.children ?? null;
      },
      confirmDelete: askDeleteById,
      onReorder: (fid, children) => {
        bookmarks = reorderFolderBookmarks(bookmarks, fid, children.map((c) => c.id));
        bookmarks = dissolveRootBookmarkFolders(bookmarks);
        saveBookmarks(bookmarks);
        if (!getBookmarkFolder(bookmarks, fid)) {
          void folderOverlay.close();
          repaintBookmarksFlip();
          return;
        }
        repaintBookmarks();
        folderOverlay.repaint();
      },
      onMoveOut: (fid, itemId) => {
        bookmarks = moveBookmarkToRoot(bookmarks, itemId, fid);
        saveBookmarks(bookmarks);
        repaintBookmarksFlip();
      },
    }, trigger);
  }

  function openAppFolder(folderId: string, trigger: HTMLElement) {
    const folder = getAppFolder(apps, folderId);
    if (!folder) return;
    folderOverlay.open({
      title: folder.name,
      folderId,
      getItems: () => getAppFolder(apps, folderId)?.children ?? [],
      gridClass: "apps-grid",
      renderTile: (item, editMode) =>
        renderTile(
          item,
          item ? { path: item.path, kind: "app" } : {},
          LBL_ADD,
          editMode,
          false,
          item ? appIconSrcCache.get(item.id) : undefined,
        ),
      onActivate: (item) => launchApp(item.path),
      onAdd: async (trigger) => {
        const path = await pickAppFile();
        if (!path) return null;
        const data = await promptApp({ name: guessAppName(path), path }, false, trigger);
        if (!data) return null;
        const id = crypto.randomUUID();
        const icon = await cacheAppIcon(id, data.path);
        const link: AppLink = { kind: "app", id, name: data.name.trim(), path: data.path.trim(), ...(icon ? { icon } : {}) };
        if (icon) await rememberAppIcon(id, icon);
        apps = apps.map((e) =>
          e.id === folderId && e.kind === "folder" ? { ...e, children: [...e.children, link] } : e,
        );
        saveApps(apps);
        repaintApps();
        return getAppFolder(apps, folderId)?.children ?? null;
      },
      onRenameTitle: (name) => {
        apps = updateAppFolderName(apps, folderId, name);
        saveApps(apps);
        repaintApps();
      },
      onEdit: async (item, trigger) => {
        const data = await promptApp({ name: item.name, path: item.path }, true, trigger);
        if (!data) return null;
        apps = updateAppInFolder(folderId, item.id, data.name, data.path);
        return getAppFolder(apps, folderId)?.children ?? null;
      },
      confirmDelete: askDeleteById,
      onReorder: (fid, children) => {
        apps = reorderFolderApps(apps, fid, children.map((c) => c.id));
        apps = dissolveRootAppFolders(apps);
        saveApps(apps);
        if (!getAppFolder(apps, fid)) {
          void folderOverlay.close();
          repaintAppsFlip();
          return;
        }
        repaintApps();
        folderOverlay.repaint();
      },
      onMoveOut: (fid, itemId) => {
        apps = moveAppToRoot(apps, itemId, fid);
        saveApps(apps);
        repaintAppsFlip();
      },
    }, trigger);
  }

  async function syncMissingBookmarkIcons(repaint: () => void) {
    let changed = false;
    const leaves = flattenBookmarkLeaves(bookmarks);
    const nextLeaves = await Promise.all(
      leaves.map(async (bookmark) => {
        if ("__TAURI_INTERNALS__" in window) {
          const icon = await cacheFavicon(bookmark.id, bookmark.url);
          if (icon) {
            await rememberBookmarkIcon(bookmark, icon);
            if (bookmark.icon !== icon) {
              changed = true;
              return { ...bookmark, icon };
            }
            return bookmark;
          }
        }
        await rememberBookmarkIcon(bookmark);
        return bookmark;
      }),
    );
    if (changed) {
      const map = new Map(nextLeaves.map((b) => [b.id, b]));
      bookmarks = bookmarks.map((e) => {
        if (e.kind === "link") return map.get(e.id) ?? e;
        return { ...e, children: e.children.map((c) => map.get(c.id) ?? c) };
      });
      saveBookmarks(bookmarks);
    }
    repaint();
  }

  async function syncMissingAppIcons(repaint: () => void) {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let changed = false;
    const leaves = flattenAppLeaves(apps);
    const nextLeaves = await Promise.all(
      leaves.map(async (app) => {
        const icon = await cacheAppIcon(app.id, app.path);
        if (!icon) return app;
        await rememberAppIcon(app.id, icon);
        if (app.icon === icon) return app;
        changed = true;
        return { ...app, icon };
      }),
    );
    if (changed) {
      const map = new Map(nextLeaves.map((a) => [a.id, a]));
      apps = apps.map((e) => {
        if (e.kind === "app") return map.get(e.id) ?? e;
        return { ...e, children: e.children.map((c) => map.get(c.id) ?? c) };
      });
      saveApps(apps);
    }
    repaint();
  }

  const bookmarksGrid = bindTileGrid(
    sidebar.querySelector("#bookmarksGrid")!,
    () => bookmarks,
    (next) => {
      const oldLeaves = new Set(flattenBookmarkLeaves(bookmarks).map((b) => b.id));
      const newLeaves = new Set(flattenBookmarkLeaves(next).map((b) => b.id));
      oldLeaves.forEach((id) => {
        if (!newLeaves.has(id)) {
          const b = flattenBookmarkLeaves(bookmarks).find((x) => x.id === id);
          if (b?.icon) deleteFavicon(b.icon);
          bookmarkIconSrcCache.delete(id);
        }
      });
      bookmarks = next;
      saveBookmarks(next);
    },
    (item, editMode, _draggable, slot) => renderBookmarkTile(item, editMode, slot),
    (item, trigger) => {
      if (item.kind === "folder") openBookmarkFolder(item.id, trigger);
      else void openUrl(item.url);
    },
    async (_trigger, slot) => addBookmarkAtSlot(slot, _trigger),
    async (item, trigger) => {
      if (item.kind === "folder") return null;
      const data = await promptBookmark({ name: item.name, url: item.url }, trigger);
      if (!data) return null;
      let icon = item.icon;
      if (data.url !== item.url) {
        if (item.icon) deleteFavicon(item.icon);
        icon = (await cacheFavicon(item.id, data.url)) ?? undefined;
      }
      if (icon) await rememberBookmarkIcon({ ...item, url: data.url }, icon);
      else await rememberBookmarkIcon({ ...item, name: data.name, url: data.url });
      return updateBookmark(item.id, data.name, data.url, icon);
    },
    async (_id, name, trigger) => (await askDelete(name, trigger)) ? true : false,
    undefined,
    {
      gridCapacity: bookmarksGridCapacity,
      isFolder: (item) => isBookmarkFolder(item),
      onMoveToFolder: (sourceId, folderId) => {
        bookmarks = moveBookmarkToFolder(bookmarks, sourceId, folderId);
        saveBookmarks(bookmarks);
      },
      onMerge: (sourceId, targetId) => {
        bookmarks = mergeBookmarksIntoNewFolder(bookmarks, sourceId, targetId);
        saveBookmarks(bookmarks);
      },
      onRemove: (items, id) => removeBookmarkEntry(items, id),
    },
  );
  const repaintBookmarksBase = bookmarksGrid.paint;
  const repaintBookmarksFlip = bookmarksGrid.paintWithFlip;
  const repaintBookmarks = () => {
    bookmarksAddBtn.disabled = firstEmptySlot(bookmarks, bookmarksGridCapacity()) === null;
    repaintBookmarksBase();
  };

  const appsGrid = bindTileGrid(
    sidebar.querySelector("#appsGrid")!,
    () => apps,
    (next) => {
      const oldLeaves = new Set(flattenAppLeaves(apps).map((a) => a.id));
      const newLeaves = new Set(flattenAppLeaves(next).map((a) => a.id));
      oldLeaves.forEach((id) => {
        if (!newLeaves.has(id)) {
          const a = flattenAppLeaves(apps).find((x) => x.id === id);
          if (a?.icon) deleteAppIcon(a.icon);
          appIconSrcCache.delete(id);
        }
      });
      apps = next;
      saveApps(next);
    },
    (item, editMode, _draggable, slot) => renderAppTile(item, editMode, slot),
    (item, trigger) => {
      if (item.kind === "folder") openAppFolder(item.id, trigger);
      else void launchApp(item.path);
    },
    async (_trigger, slot) => addAppAtSlot(slot, _trigger),
    async (item, trigger) => {
      if (item.kind === "folder") return null;
      const data = await promptApp({ name: item.name, path: item.path }, true, trigger);
      if (!data) return null;
      let icon = item.icon;
      if (data.path !== item.path) {
        if (item.icon) deleteAppIcon(item.icon);
        icon = (await cacheAppIcon(item.id, data.path)) ?? undefined;
      }
      if (icon) await rememberAppIcon(item.id, icon);
      else appIconSrcCache.delete(item.id);
      return updateApp(item.id, data.name, data.path, icon);
    },
    async (_id, name, trigger) => (await askDelete(name, trigger)) ? true : false,
    undefined,
    {
      gridCapacity: appsGridCapacity,
      isFolder: (item) => isAppFolder(item),
      onMoveToFolder: (sourceId, folderId) => {
        apps = moveAppToFolder(apps, sourceId, folderId);
        saveApps(apps);
      },
      onMerge: (sourceId, targetId) => {
        apps = mergeAppsIntoNewFolder(apps, sourceId, targetId);
        saveApps(apps);
      },
      onRemove: (items, id) => removeAppEntry(items, id),
    },
  );
  const repaintAppsBase = appsGrid.paint;
  const repaintAppsFlip = appsGrid.paintWithFlip;
  const repaintApps = () => {
    appsAddBtn.disabled = firstEmptySlot(apps, appsGridCapacity()) === null;
    repaintAppsBase();
  };

  bookmarksAddBtn.addEventListener("click", async (e) => {
    const slot = firstEmptySlot(bookmarks, bookmarksGridCapacity());
    if (slot === null) return;
    const next = await addBookmarkAtSlot(slot, e.currentTarget as HTMLElement);
    if (!next) return;
    bookmarks = next;
    saveBookmarks(next);
    repaintBookmarksFlip();
  });

  appsAddBtn.addEventListener("click", async (e) => {
    const slot = firstEmptySlot(apps, appsGridCapacity());
    if (slot === null) return;
    const next = await addAppAtSlot(slot, e.currentTarget as HTMLElement);
    if (!next) return;
    apps = next;
    saveApps(next);
    repaintAppsFlip();
  });

  window.addEventListener("orbita:ui-prefs", () => {
    bookmarks = normalizeGridEntries(bookmarks, bookmarksGridCapacity());
    apps = normalizeGridEntries(apps, appsGridCapacity());
    saveBookmarks(bookmarks);
    saveApps(apps);
    repaintBookmarks();
    repaintApps();
  });

  syncMissingBookmarkIcons(repaintBookmarks);
  syncMissingAppIcons(repaintApps);
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
            <button type="button" class="v2ray-btn" id="v2rayBtn" title="${LBL_V2RAY_TITLE}">${V2RAY_SVG}</button>
          </div>
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
