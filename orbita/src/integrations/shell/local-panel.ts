import { escAttr, escHtml } from "../../core/html";
import { getSettings } from "../../core/settings";
import { hideHoverTip } from "../../ui/hover-tip";
import { crossfadeSwap } from "../../ui/motion";
import { mountContextMenu, type MenuItemDef } from "../../ui/context-menu";
import {
  openLocalPath,
  pickLocalFile,
  pickLocalFolder,
  getFileTypeIcons,
  searchEverything,
  openWithSystemDialog,
  openWithCursor,
  openRecycleBin,
  revealPathInExplorer,
  type EverythingHit,
} from "./adapter";
import { mountLocalEntryDialog } from "./dialog";
import type { LocalEntry } from "../../core/data/types";
import {
  addLocalFile,
  addLocalGroupEntry,
  guessLocalName,
  loadLocalFiles,
  removeLocalFile,
  renameLocalGroup,
  saveLocalFiles,
  updateLocalFile,
  type LocalEntryKind,
} from "./local-files";
import { bindListTreeDrag, consumeRowClickSuppress } from "./list-tree-drag";
import { locateLocalEntry, moveLocalNode } from "./local-tree";
import { setLocalTab, shellStore, type LocalTab } from "./store";
import { FOLDER_OPEN_SVG, FOLDER_SVG, TOOLBAR_ADD_FILE_SVG, TOOLBAR_ADD_FOLDER_SVG, TOOLBAR_ADD_GROUP_SVG, TOOLBAR_RECYCLE_SVG, applyShellIcon, localItemIcon } from "./local-icons";

const LOCAL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-7l-2-2H4a1 1 0 0 0-1 1z"/></svg>`;
const ARTICLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
const NOTE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

function noteDisplayName(name: string, path: string): string {
  const n = (name || "").trim();
  if (n && !/[\\/]/.test(n) && !/\.md$/i.test(n)) return n;
  const base = path.replace(/\\/g, "/").split("/").pop() || n;
  return base.replace(/\.md$/i, "") || n;
}

const LOCAL_TABS: { id: LocalTab; label: string }[] = [
  { id: "file", label: "文件" },
  { id: "literature", label: "文献" },
  { id: "note", label: "笔记" },
];

const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>`;

const ADD_ACTIONS_HTML = `
  <button type="button" class="local-explorer-add" data-add-kind="file" data-tip="添加文件" aria-label="添加文件">${TOOLBAR_ADD_FILE_SVG}</button>
  <button type="button" class="local-explorer-add" data-add-kind="folder" data-tip="添加文件夹" aria-label="添加文件夹">${TOOLBAR_ADD_FOLDER_SVG}</button>
  <button type="button" class="local-explorer-add" data-add-kind="group" data-tip="添加分组" aria-label="添加分组">${TOOLBAR_ADD_GROUP_SVG}</button>
  <button type="button" class="local-explorer-add" data-action="recycle-bin" data-tip="回收站" aria-label="回收站">${TOOLBAR_RECYCLE_SVG}</button>
`;

function moveSegmentIndicator(indicator: HTMLElement, btn: HTMLButtonElement | null) {
  if (!btn) return;
  indicator.style.width = `${btn.offsetWidth}px`;
  indicator.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function iconStyle(color?: string): string {
  return color ? ` style="--icon-color:${escAttr(color)}"` : "";
}

function renderFileRow(item: LocalEntry, depth: number, expanded: Set<string>): string {
  if (item.kind === "group") {
    const open = expanded.has(item.id);
    const iconAttr = iconStyle(item.color);
    const childrenHtml = item.children
      .map((c) => renderFileRow(c, depth + 1, expanded))
      .join("");
    return `
      <div class="local-tree-group" data-group-id="${escAttr(item.id)}">
        <button type="button" class="local-tree-row local-tree-folder${open ? " is-expanded" : ""}" data-id="${escAttr(item.id)}" data-kind="group" style="--depth:${depth}" data-tip="${escAttr(item.name)}">
          <span class="local-tree-twistie${open ? " is-open" : ""}">${CHEVRON_SVG}</span>
          <span class="local-tree-icon local-item-icon is-folder"${iconAttr}>${open ? FOLDER_OPEN_SVG : FOLDER_SVG}</span>
          <span class="local-tree-label">${escHtml(item.name)}</span>
        </button>
        <div class="local-tree-children-wrap${open ? " is-open" : ""}">
          <div class="local-tree-children">${childrenHtml}</div>
        </div>
        <div class="local-tree-after-slot" data-target-id="${escAttr(item.id)}" aria-hidden="true"></div>
      </div>
    `;
  }
  const iconKind = item.kind === "folder" ? "folder" : "file";
  const iconAttr = iconStyle(item.color);
  return `
    <button type="button" class="local-tree-row local-tree-leaf" data-id="${escAttr(item.id)}" data-kind="${escAttr(item.kind)}" data-path="${escAttr(item.path)}" style="--depth:${depth}">
      <span class="local-tree-twistie is-leaf"></span>
      ${localItemIcon(iconKind, "local-tree-icon", iconAttr)}
      <span class="local-tree-label">${escHtml(item.name)}</span>
    </button>
    <div class="local-tree-after-slot" data-target-id="${escAttr(item.id)}" aria-hidden="true"></div>
  `;
}

function renderTree(items: LocalEntry[], expanded: Set<string>): string {
  if (!items.length) return `<div class="local-tree-empty">暂无文件</div>`;
  return items.map((item) => renderFileRow(item, 0, expanded)).join("");
}

function buildIdPathMap(items: LocalEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: LocalEntry[]) => {
    for (const node of nodes) {
      if (node.kind === "group") walk(node.children);
      else map.set(node.id, node.path);
    }
  };
  walk(items);
  return map;
}

function applyTreeIcons(
  listEl: HTMLElement,
  idPath: Map<string, string>,
  icons: Map<string, string>,
) {
  for (const row of listEl.querySelectorAll<HTMLElement>(".local-tree-leaf")) {
    const id = row.dataset.id;
    if (!id) continue;
    const path = idPath.get(id);
    const url = path ? icons.get(path) : undefined;
    if (url) applyShellIcon(row, url);
  }
}
function collectIconItems(items: LocalEntry[]): Pick<EverythingHit, "path" | "isDir">[] {
  const out: Pick<EverythingHit, "path" | "isDir">[] = [];
  const walk = (nodes: LocalEntry[]) => {
    for (const node of nodes) {
      if (node.kind === "group") walk(node.children);
      else out.push({ path: node.path, isDir: node.kind === "folder" });
    }
  };
  walk(items);
  return out;
}

function toggleGroupRow(row: HTMLElement, id: string, open: boolean, expanded: Set<string>) {
  const group = row.closest<HTMLElement>(".local-tree-group");
  const wrap = group?.querySelector<HTMLElement>(".local-tree-children-wrap");
  const twistie = row.querySelector<HTMLElement>(".local-tree-twistie");
  const icon = row.querySelector<HTMLElement>(".local-tree-icon");
  if (open) expanded.add(id);
  else expanded.delete(id);
  row.classList.toggle("is-expanded", open);
  twistie?.classList.toggle("is-open", open);
  wrap?.classList.toggle("is-open", open);
  if (icon) icon.innerHTML = open ? FOLDER_OPEN_SVG : FOLDER_SVG;
}

function mountFileList(
  container: HTMLElement,
  promptEntry: ReturnType<typeof mountLocalEntryDialog>,
  signal: AbortSignal,
) {
  const explorerEl = container.querySelector<HTMLElement>("#localExplorer")!;
  const listEl = container.querySelector<HTMLElement>("#localFileList")!;
  const searchEl = explorerEl.querySelector<HTMLInputElement>("#localFileSearch")!;

  let items = loadLocalFiles();
  const expanded = new Set<string>();
  let addParentId: string | null = null;
  let searchTimer = 0;
  let searchQuery = "";
  let lastTreeIconKey = "";
  const treeIconCache = new Map<string, string>();

  const paint = () => {
    if (signal.aborted || searchQuery) return;
    hideHoverTip();
    listEl.innerHTML = renderTree(items, expanded);
    void paintTreeIcons();
  };

  const showSearchResults = (hits: EverythingHit[]) => {
    hideHoverTip();
    if (!hits.length) {
      listEl.innerHTML = `<div class="local-tree-empty">无结果</div>`;
      return;
    }
    listEl.innerHTML = hits
      .map(
        (hit) => `
      <button type="button" class="local-file-row local-search-hit" data-path="${escAttr(hit.path)}" data-is-dir="${hit.isDir ? "1" : "0"}">
        ${localItemIcon(hit.isDir ? "folder" : "file", "local-file-icon")}
        <span class="local-file-meta">
          <span class="local-file-name">${escHtml(hit.name)}</span>
        </span>
      </button>`,
      )
      .join("");
  };

  const paintSearchIcons = async (hits: EverythingHit[], q: string) => {
    try {
      const icons = await getFileTypeIcons(hits);
      if (signal.aborted || searchQuery !== q) return;
      for (const row of listEl.querySelectorAll<HTMLElement>(".local-search-hit")) {
        const path = row.dataset.path;
        const url = path ? icons.get(path) : undefined;
        if (url) applyShellIcon(row, url);
      }
    } catch {
      /* fallback to svg */
    }
  };

  const paintTreeIcons = async () => {
    const iconItems = collectIconItems(items);
    if (!iconItems.length) return;
    const iconKey = iconItems.map((i) => i.path).join("\0");
    const idPath = buildIdPathMap(items);
    if (iconKey === lastTreeIconKey) {
      applyTreeIcons(listEl, idPath, treeIconCache);
      return;
    }
    try {
      const icons = await getFileTypeIcons(iconItems);
      if (signal.aborted || searchQuery) return;
      for (const [path, url] of icons) treeIconCache.set(path, url);
      lastTreeIconKey = iconKey;
      applyTreeIcons(listEl, idPath, icons);
    } catch {
      /* fallback to svg */
    }
  };

  const runSearch = async (query: string) => {
    const q = query.trim();
    searchQuery = q;
    if (!q) {
      paint();
      return;
    }
    listEl.innerHTML = `<div class="local-tree-empty">搜索中…</div>`;
    try {
      const hits = await searchEverything(q);
      if (signal.aborted || searchQuery !== q) return;
      showSearchResults(hits);
      void paintSearchIcons(hits, q);
    } catch (err) {
      if (signal.aborted || searchQuery !== q) return;
      listEl.innerHTML = `<div class="local-tree-empty">${escHtml(err instanceof Error ? err.message : "搜索失败")}</div>`;
    }
  };

  const setItems = (next: LocalEntry[]) => {
    items = next;
    saveLocalFiles(next);
    paint();
  };

  bindListTreeDrag(listEl, (sourceId, targetId, position) => {
    if (position === "into" && targetId) expanded.add(targetId);
    setItems(moveLocalNode(items, sourceId, targetId, position));
  });

  const ctxMenu = mountContextMenu(signal);

  const editEntry = async (loc: NonNullable<ReturnType<typeof locateLocalEntry>>, trigger: HTMLElement) => {
    if (loc.node.kind === "group") {
      const data = await promptEntry("修改分组", { name: loc.node.name, color: loc.node.color }, trigger, {
        isEdit: true,
        groupOnly: true,
      });
      if (data && !signal.aborted) setItems(renameLocalGroup(loc.node.id, data.name, data.color));
      return;
    }
    const data = await promptEntry(
      "修改快捷方式",
      { name: loc.node.name, path: loc.node.path, color: loc.node.color },
      trigger,
      { isEdit: true },
    );
    if (data && !signal.aborted) setItems(updateLocalFile(loc.node.id, data.name, data.path, data.color));
  };

  const hasCursor = () => !!getSettings().integrations.cursor.exePath.trim();

  const favoriteMenuItems = (kind: "file" | "folder"): MenuItemDef[] => {
    const items: MenuItemDef[] = [{ action: "edit", label: "编辑" }];
    if (kind === "file") items.push({ action: "open-with", label: "打开方式" });
    if (kind === "folder" && hasCursor()) items.push({ action: "cursor", label: "用 Cursor 打开" });
    items.push({ action: "reveal", label: "打开文件路径" });
    items.push({ action: "remove", label: "移除收藏", danger: true, confirm: true });
    return items;
  };

  const groupMenuItems = (): MenuItemDef[] => [
    { action: "edit", label: "编辑" },
    { action: "remove", label: "删除分组", danger: true, confirm: true },
  ];

  const searchMenuItems = (isDir: boolean): MenuItemDef[] => {
    const items: MenuItemDef[] = [{ action: "add", label: "添加到收藏" }];
    if (!isDir) items.push({ action: "open-with", label: "打开方式" });
    if (isDir && hasCursor()) items.push({ action: "cursor", label: "用 Cursor 打开" });
    items.push({ action: "reveal", label: "打开文件路径" });
    return items;
  };

  paint();

  searchEl.addEventListener(
    "input",
    () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void runSearch(searchEl.value), 300);
    },
    { signal },
  );

  const addEntry = async (kind: LocalEntryKind | "group", trigger: HTMLElement) => {
    if (kind === "group") {
      const data = await promptEntry("添加分组", { name: "新分组" }, trigger, { groupOnly: true });
      if (!data?.name.trim() || signal.aborted) return;
      setItems(addLocalGroupEntry(data.name, addParentId));
      if (addParentId) expanded.add(addParentId);
      return;
    }
    const path = kind === "folder" ? await pickLocalFolder() : await pickLocalFile();
    if (!path || signal.aborted) return;
    const title = kind === "folder" ? "添加快捷方式" : "添加文件";
    const data = await promptEntry(title, { name: guessLocalName(path), path }, trigger);
    if (!data || signal.aborted) return;
    setItems(addLocalFile(data.name, data.path, kind, addParentId));
    if (addParentId) expanded.add(addParentId);
  };

  explorerEl.addEventListener(
    "click",
    async (e) => {
      const searchRow = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-file-row[data-path]");
      if (searchRow?.dataset.path && listEl.contains(searchRow)) {
        await openLocalPath(searchRow.dataset.path);
        return;
      }

      const addBtn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add-kind]");
      if (addBtn?.dataset.addKind) {
        e.stopPropagation();
        const kind = addBtn.dataset.addKind;
        if (kind === "file" || kind === "folder") void addEntry(kind, addBtn);
        if (kind === "group") void addEntry("group", addBtn);
        return;
      }

      const recycleBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="recycle-bin"]');
      if (recycleBtn) {
        e.stopPropagation();
        void openRecycleBin();
        return;
      }

      const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-tree-row[data-id]");
      if (!row || !listEl.contains(row)) return;
      if (searchQuery) return;
      if (consumeRowClickSuppress(listEl)) return;
      if (row.dataset.kind === "group") {
        const id = row.dataset.id!;
        toggleGroupRow(row, id, !expanded.has(id), expanded);
        return;
      }
      const loc = locateLocalEntry(items, row.dataset.id!);
      if (!loc || loc.node.kind === "group") return;
      await openLocalPath(loc.node.path);
    },
    { signal },
  );

  listEl.addEventListener(
    "contextmenu",
    async (e) => {
      hideHoverTip();
      const searchRow = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-search-hit[data-path]");
      if (searchRow?.dataset.path && searchQuery) {
        e.preventDefault();
        const path = searchRow.dataset.path;
        const isDir = searchRow.dataset.isDir === "1";
        ctxMenu.show(e.clientX, e.clientY, searchMenuItems(isDir), (action) => {
          if (action === "add") {
            const name = guessLocalName(path);
            const kind = isDir ? "folder" : "file";
            setItems(addLocalFile(name, path, kind, addParentId));
            return;
          }
          if (action === "open-with") void openWithSystemDialog(path);
          if (action === "cursor") void openWithCursor(path);
          if (action === "reveal") void revealPathInExplorer(path);
        });
        e.stopPropagation();
        return;
      }

      const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-tree-row");
      if (!row?.dataset.id) return;
      e.preventDefault();
      const loc = locateLocalEntry(items, row.dataset.id);
      if (!loc) return;
      if (loc.node.kind === "group") {
        const groupId = row.dataset.id;
        ctxMenu.show(e.clientX, e.clientY, groupMenuItems(), (action, trigger) => {
          if (action === "edit") void editEntry(loc, trigger);
          if (action === "remove") setItems(removeLocalFile(groupId));
        });
        e.stopPropagation();
        return;
      }
      const leafKind = loc.node.kind;
      const leafPath = loc.node.path;
      ctxMenu.show(e.clientX, e.clientY, favoriteMenuItems(leafKind), (action, trigger) => {
        if (action === "edit") void editEntry(loc, trigger);
        if (action === "open-with") {
          if (leafKind === "file") void openWithSystemDialog(leafPath);
          else void openLocalPath(leafPath);
        }
        if (action === "cursor") void openWithCursor(leafPath);
        if (action === "reveal") void revealPathInExplorer(leafPath);
        if (action === "remove") setItems(removeLocalFile(row.dataset.id!));
      });
      e.stopPropagation();
    },
    { signal },
  );
}

function renderTabContent(tab: LocalTab): string {
  if (tab === "file") {
    return `
      <div class="local-explorer" id="localExplorer">
        <div class="local-explorer-toolbar">
          <input type="search" class="local-explorer-search" id="localFileSearch" placeholder="搜索…" autocomplete="off" spellcheck="false" />
          <div class="local-add-wrap">${ADD_ACTIONS_HTML}</div>
        </div>
        <div class="local-file-list vscode-tree" id="localFileList"></div>
      </div>
    `;
  }
  if (tab === "literature") {
    return `
      <div class="local-literature-pane" id="literaturePane">
        <div class="local-literature-bar">
          <button type="button" class="local-refresh-btn" id="literatureRefresh" data-tip="刷新">${REFRESH_SVG}</button>
        </div>
        <div class="local-file-list" id="literatureList"><div class="local-placeholder">加载中…</div></div>
      </div>
    `;
  }
  return `
    <div class="local-literature-pane" id="notePane">
      <div class="local-literature-bar">
        <button type="button" class="local-refresh-btn" id="noteRefresh" data-tip="刷新">${REFRESH_SVG}</button>
      </div>
      <div class="local-file-list" id="noteList"><div class="local-placeholder">加载中…</div></div>
    </div>
  `;
}

function mountLiteratureList(container: HTMLElement, signal: AbortSignal) {
  const pane = container.querySelector<HTMLElement>("#literaturePane")!;
  const listEl = pane.querySelector<HTMLElement>("#literatureList")!;
  const refreshBtn = pane.querySelector<HTMLButtonElement>("#literatureRefresh")!;

  const load = async () => {
    if (signal.aborted) return;
    listEl.innerHTML = `<div class="local-placeholder">加载中…</div>`;
    try {
      const { listZoteroItems } = await import("./zotero");
      const items = await listZoteroItems(20);
      if (signal.aborted) return;
      if (!items.length) {
        listEl.innerHTML = `<div class="local-placeholder">无文献</div>`;
        return;
      }
      listEl.innerHTML = items
        .map((item) => {
          const title = escHtml(item.title || "(无标题)");
          const noteBtn = item.note_path
            ? `<span class="local-note-badge" data-action="note" data-path="${escAttr(item.note_path)}" data-tip="打开笔记">${NOTE_SVG}</span>`
            : "";
          return `
        <button type="button" class="local-file-row" data-key="${escAttr(item.key)}" data-tip="${escAttr(item.item_type)} · ${escAttr(item.date_modified)}">
          <span class="local-file-icon">${ARTICLE_SVG}</span>
          <span class="local-file-name">${title}</span>
          ${noteBtn}
        </button>`;
        })
        .join("");
    } catch (err) {
      if (signal.aborted) return;
      listEl.innerHTML = `<div class="local-placeholder">${escHtml(err instanceof Error ? err.message : "读取失败")}</div>`;
    }
  };

  pane.addEventListener(
    "click",
    (e) => {
      if ((e.target as HTMLElement).closest("#literatureRefresh")) return;
      const noteBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="note"]');
      if (noteBtn?.dataset.path) {
        e.stopPropagation();
        void import("./zotero").then((m) => m.openObsidianNote(noteBtn.dataset.path!));
        return;
      }
      const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-file-row");
      if (row?.dataset.key) void import("./zotero").then((m) => m.openZoteroItem(row.dataset.key!));
    },
    { signal },
  );

  refreshBtn.addEventListener("click", () => void load(), { signal });
  void load();
}

function mountNoteList(container: HTMLElement, signal: AbortSignal) {
  const pane = container.querySelector<HTMLElement>("#notePane")!;
  const listEl = pane.querySelector<HTMLElement>("#noteList")!;
  const refreshBtn = pane.querySelector<HTMLButtonElement>("#noteRefresh")!;

  const load = async () => {
    if (signal.aborted) return;
    listEl.innerHTML = `<div class="local-placeholder">加载中…</div>`;
    try {
      const { listObsidianNotes } = await import("./obsidian");
      const items = await listObsidianNotes(50);
      if (signal.aborted) return;
      if (!items.length) {
        listEl.innerHTML = `<div class="local-placeholder">无笔记</div>`;
        return;
      }
      listEl.innerHTML = items
        .map((item) => {
          const title = escHtml(noteDisplayName(item.name, item.path) || "(无标题)");
          return `
        <button type="button" class="local-file-row" data-path="${escAttr(item.path)}">
          <span class="local-file-icon">${NOTE_SVG}</span>
          <span class="local-file-name">${title}</span>
        </button>`;
        })
        .join("");
    } catch (err) {
      if (signal.aborted) return;
      listEl.innerHTML = `<div class="local-placeholder">${escHtml(err instanceof Error ? err.message : "读取失败")}</div>`;
    }
  };

  pane.addEventListener(
    "click",
    (e) => {
      if ((e.target as HTMLElement).closest("#noteRefresh")) return;
      const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-file-row");
      if (row?.dataset.path) {
        void import("./obsidian").then((m) => m.openObsidianNote(row.dataset.path!));
      }
    },
    { signal },
  );

  refreshBtn.addEventListener("click", () => void load(), { signal });
  void load();
}

export function mountLocalPanel(
  container: HTMLElement,
  root: HTMLElement,
) {
  const { localTab } = shellStore.getState();
  container.innerHTML = `
    <div class="launcher-head"><span class="launcher-title">${LOCAL_SVG}本地</span></div>
    <div class="local-segment-wrap">
      <div class="local-segment-indicator" id="localIndicator"></div>
      <div class="local-segment" id="localSegment">
        ${LOCAL_TABS.map(
          (t) =>
            `<button type="button" data-id="${t.id}" class="${t.id === localTab ? "active" : ""}">${t.label}</button>`,
        ).join("")}
      </div>
    </div>
    <div class="local-content" id="localContent"></div>
  `;

  const indicator = container.querySelector<HTMLElement>("#localIndicator")!;
  const segment = container.querySelector<HTMLElement>("#localSegment")!;
  const content = container.querySelector<HTMLElement>("#localContent")!;
  const promptEntry = mountLocalEntryDialog(root);
  let tabAbort: AbortController | null = null;
  let contentReady = false;

  const syncIndicator = () => {
    const active = segment.querySelector<HTMLButtonElement>("button.active");
    requestAnimationFrame(() => moveSegmentIndicator(indicator, active));
  };

  const renderContent = async () => {
    const mount = () => {
      tabAbort?.abort();
      tabAbort = new AbortController();
      const { signal } = tabAbort;
      const tab = shellStore.getState().localTab;
      content.innerHTML = renderTabContent(tab);
      if (tab === "file") mountFileList(content, promptEntry, signal);
      if (tab === "literature") mountLiteratureList(content, signal);
      if (tab === "note") mountNoteList(content, signal);
    };
    if (!contentReady) {
      mount();
      contentReady = true;
      return;
    }
    await crossfadeSwap(content, mount);
  };

  syncIndicator();
  void renderContent();

  segment.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!btn || btn.classList.contains("active")) return;
    setLocalTab(btn.dataset.id as LocalTab);
    segment.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    syncIndicator();
    void renderContent();
  });

  window.addEventListener("resize", syncIndicator);
  shellStore.subscribe(() => {
    syncIndicator();
  });
}
