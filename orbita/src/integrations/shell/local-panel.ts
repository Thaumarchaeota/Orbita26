import { escAttr, escHtml } from "../../core/html";
import { closePopover, crossfadeSwap, isPopoverOpen, openPopover, setPopoverOrigin } from "../../ui/motion";
import { openLocalPath, pickLocalFile, pickLocalFolder } from "./adapter";
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
import { EDIT_SVG } from "./tiles";

const LOCAL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-7l-2-2H4a1 1 0 0 0-1 1z"/></svg>`;
const FILE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
const FOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-7l-2-2H4a1 1 0 0 0-1 1z"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const ARTICLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
const NOTE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

const LOCAL_TABS: { id: LocalTab; label: string }[] = [
  { id: "file", label: "文件" },
  { id: "literature", label: "文献" },
  { id: "note", label: "笔记" },
];

const GROUP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`;
const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>`;
const FOLDER_OPEN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h12a2 2 0 0 1 2 2v1"/><path d="M5 19h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H9l-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>`;

const ADD_MENU_HTML = `
  <div class="local-add-menu motion-popover" id="localAddMenu">
    <button type="button" data-kind="file">${FILE_SVG}文件</button>
    <button type="button" data-kind="folder">${FOLDER_SVG}文件夹</button>
    <button type="button" data-kind="group">${GROUP_SVG}分组</button>
  </div>
`;

function moveSegmentIndicator(indicator: HTMLElement, btn: HTMLButtonElement | null) {
  if (!btn) return;
  indicator.style.width = `${btn.offsetWidth}px`;
  indicator.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function rowEditBtn(): string {
  return `<span class="local-tree-edit" data-action="edit" aria-label="编辑">${EDIT_SVG}</span>`;
}

function iconStyle(color?: string): string {
  return color ? ` style="--icon-color:${escAttr(color)}"` : "";
}

function renderFileRow(item: LocalEntry, depth: number, expanded: Set<string>): string {
  if (item.kind === "group") {
    const open = expanded.has(item.id);
    const actions = rowEditBtn();
    const iconAttr = iconStyle(item.color);
    const childrenHtml = item.children
      .map((c) => renderFileRow(c, depth + 1, expanded))
      .join("");
    return `
      <div class="local-tree-group" data-group-id="${escAttr(item.id)}">
        <button type="button" class="local-tree-row local-tree-folder${open ? " is-expanded" : ""}" data-id="${escAttr(item.id)}" data-kind="group" style="--depth:${depth}" title="${escAttr(item.name)}">
          ${actions}
          <span class="local-tree-twistie${open ? " is-open" : ""}">${CHEVRON_SVG}</span>
          <span class="local-tree-icon"${iconAttr}>${open ? FOLDER_OPEN_SVG : FOLDER_SVG}</span>
          <span class="local-tree-label">${escHtml(item.name)}</span>
        </button>
        <div class="local-tree-children-wrap${open ? " is-open" : ""}">
          <div class="local-tree-children">${childrenHtml}</div>
        </div>
        <div class="local-tree-after-slot" data-target-id="${escAttr(item.id)}" aria-hidden="true"></div>
      </div>
    `;
  }
  const icon = item.kind === "folder" ? FOLDER_SVG : FILE_SVG;
  const actions = rowEditBtn();
  const iconAttr = iconStyle(item.color);
  return `
    <button type="button" class="local-tree-row local-tree-leaf" data-id="${escAttr(item.id)}" data-kind="${escAttr(item.kind)}" style="--depth:${depth}" title="${escAttr(item.path)}">
      ${actions}
      <span class="local-tree-twistie is-leaf"></span>
      <span class="local-tree-icon"${iconAttr}>${icon}</span>
      <span class="local-tree-label">${escHtml(item.name)}</span>
    </button>
    <div class="local-tree-after-slot" data-target-id="${escAttr(item.id)}" aria-hidden="true"></div>
  `;
}

function renderTree(items: LocalEntry[], expanded: Set<string>): string {
  if (!items.length) return `<div class="local-tree-empty">暂无文件</div>`;
  return items.map((item) => renderFileRow(item, 0, expanded)).join("");
}

function positionAddMenu(root: HTMLElement) {
  const menu = root.querySelector<HTMLElement>("#localAddMenu");
  const btn = root.querySelector<HTMLElement>("#localAddBtn");
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  const menuH = menu.offsetHeight || 36;
  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  menu.style.position = "fixed";
  menu.style.left = `${rect.left}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  if (spaceAbove >= menuH + 4 || spaceAbove >= spaceBelow) {
    menu.style.top = `${rect.top - menuH - 4}px`;
  } else {
    menu.style.top = `${rect.bottom + 4}px`;
  }
}

function resetAddMenu(root: HTMLElement) {
  const menu = root.querySelector<HTMLElement>("#localAddMenu");
  if (!menu) return;
  menu.style.position = "";
  menu.style.left = "";
  menu.style.top = "";
  menu.style.right = "";
  menu.style.bottom = "";
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
  askDelete: (name: string, trigger: HTMLElement) => Promise<boolean>,
  signal: AbortSignal,
) {
  const explorerEl = container.querySelector<HTMLElement>("#localExplorer")!;
  const listEl = container.querySelector<HTMLElement>("#localFileList")!;

  let items = loadLocalFiles();
  let addMenuOpen = false;
  const expanded = new Set<string>();
  let addParentId: string | null = null;

  const closeAddMenu = async () => {
    addMenuOpen = false;
    const menu = explorerEl.querySelector<HTMLElement>("#localAddMenu");
    if (menu && isPopoverOpen(menu)) await closePopover(menu);
    resetAddMenu(explorerEl);
  };

  const paint = () => {
    if (signal.aborted) return;
    listEl.innerHTML = renderTree(items, expanded);
    if (addMenuOpen) {
      const btn = explorerEl.querySelector<HTMLElement>("#localAddBtn");
      const menu = explorerEl.querySelector<HTMLElement>("#localAddMenu");
      if (btn && menu) {
        positionAddMenu(explorerEl);
        menu.classList.add("motion-popover", "is-open");
        setPopoverOrigin(menu, btn);
      }
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

  paint();

  const addEntry = async (kind: LocalEntryKind | "group", trigger: HTMLElement) => {
    await closeAddMenu();
    if (kind === "group") {
      const name = window.prompt("分组名称", "新分组");
      if (!name?.trim() || signal.aborted) return;
      setItems(addLocalGroupEntry(name, addParentId));
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
      const addBtn = (e.target as HTMLElement).closest<HTMLElement>("#localAddBtn");
      if (addBtn) {
        e.stopPropagation();
        const menu = explorerEl.querySelector<HTMLElement>("#localAddMenu");
        if (!menu) return;
        if (isPopoverOpen(menu)) {
          await closeAddMenu();
          return;
        }
        addMenuOpen = true;
        positionAddMenu(explorerEl);
        void openPopover(menu, addBtn);
        return;
      }

      const addMenu = explorerEl.querySelector<HTMLElement>("#localAddMenu");
      const kindBtn =
        addMenu?.contains(e.target as Node) &&
        (e.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
      if (kindBtn) {
        e.stopPropagation();
        const kind = kindBtn.dataset.kind;
        if (kind === "file" || kind === "folder") void addEntry(kind, kindBtn);
        if (kind === "group") void addEntry("group", kindBtn);
        return;
      }

      const editBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="edit"]');
      if (editBtn) {
        e.stopPropagation();
        const row = editBtn.closest<HTMLButtonElement>(".local-tree-row");
        if (!row?.dataset.id) return;
        const loc = locateLocalEntry(items, row.dataset.id);
        if (!loc) return;
        if (loc.node.kind === "group") {
          const data = await promptEntry("修改分组", { name: loc.node.name, color: loc.node.color }, editBtn, {
            isEdit: true,
            groupOnly: true,
          });
          if (data && !signal.aborted) setItems(renameLocalGroup(loc.node.id, data.name, data.color));
        } else {
          const data = await promptEntry(
            "修改快捷方式",
            { name: loc.node.name, path: loc.node.path, color: loc.node.color },
            editBtn,
            { isEdit: true },
          );
          if (data && !signal.aborted) setItems(updateLocalFile(loc.node.id, data.name, data.path, data.color));
        }
        return;
      }

      const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-tree-row[data-id]");
      if (!row || !listEl.contains(row)) return;
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
      const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-tree-row");
      if (!row?.dataset.id) return;
      e.preventDefault();
      await closeAddMenu();
      const loc = locateLocalEntry(items, row.dataset.id);
      if (!loc) return;
      if (await askDelete(loc.node.name, row)) {
        setItems(removeLocalFile(row.dataset.id));
      }
    },
    { signal },
  );

  document.addEventListener(
    "click",
    (e) => {
      if (explorerEl.querySelector("#localAddWrap")?.contains(e.target as Node)) return;
      if (addMenuOpen) void closeAddMenu();
    },
    { signal },
  );

  window.addEventListener(
    "resize",
    () => {
      if (addMenuOpen) positionAddMenu(explorerEl);
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      void closeAddMenu();
    },
    { signal },
  );
}

function renderTabContent(tab: LocalTab): string {
  if (tab === "file") {
    return `
      <div class="local-explorer" id="localExplorer">
        <div class="local-explorer-toolbar">
          <div class="local-add-wrap" id="localAddWrap">
            ${ADD_MENU_HTML}
            <button type="button" class="local-explorer-action" id="localAddBtn" title="新建">${PLUS_SVG}</button>
          </div>
        </div>
        <div class="local-file-list vscode-tree" id="localFileList"></div>
      </div>
    `;
  }
  if (tab === "literature") {
    return `
      <div class="local-literature-pane" id="literaturePane">
        <div class="local-literature-bar">
          <button type="button" class="local-refresh-btn" id="literatureRefresh" title="刷新">${REFRESH_SVG}</button>
        </div>
        <div class="local-file-list" id="literatureList"><div class="local-placeholder">加载中…</div></div>
      </div>
    `;
  }
  return `
    <div class="local-literature-pane" id="notePane">
      <div class="local-literature-bar">
        <button type="button" class="local-refresh-btn" id="noteRefresh" title="刷新">${REFRESH_SVG}</button>
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
            ? `<span class="local-note-badge" data-action="note" data-path="${escAttr(item.note_path)}" title="打开笔记">${NOTE_SVG}</span>`
            : "";
          return `
        <button type="button" class="local-file-row" data-key="${escAttr(item.key)}" title="${escAttr(item.item_type)} · ${escAttr(item.date_modified)}">
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
      const { formatNoteTime, listObsidianNotes } = await import("./obsidian");
      const items = await listObsidianNotes(50);
      if (signal.aborted) return;
      if (!items.length) {
        listEl.innerHTML = `<div class="local-placeholder">无笔记</div>`;
        return;
      }
      listEl.innerHTML = items
        .map((item) => {
          const title = escHtml(item.name || "(无标题)");
          const time = escAttr(formatNoteTime(item.modified));
          return `
        <button type="button" class="local-file-row" data-path="${escAttr(item.path)}" title="${time}">
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
  askDelete: (name: string, trigger: HTMLElement) => Promise<boolean>,
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
      if (tab === "file") mountFileList(content, promptEntry, askDelete, signal);
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
