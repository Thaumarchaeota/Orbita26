import { isTauri } from "../../core/data/client";
import type { BookmarkEntry, BookmarkLink } from "../../core/data/types";
import { normalizeUrl } from "../../core/url";
import { hideHoverTip } from "../../ui/hover-tip";
import { getConfirmDialog } from "../shell/dialog";
import { showCommandMenuAt, type MenuItemDef } from "../../ui/command-menu-popover";
import {
  cacheFavicon,
  deleteFavicon,
  openUrl,
  readAppIconData,
  webFaviconSrc,
} from "./adapter";
import { mountBookmarkDialog, mountFolderRenameDialog } from "./dialog";
import {
  addBookmarkFolder,
  addBookmarkLink,
  locateBookmarkEntry,
  moveBookmarkNode,
  removeBookmarkEntry,
  sortBookmarksBySlot,
  stripBookmarkSlots,
  updateBookmarkFolderName,
  updateBookmarkLink,
} from "./bookmark-tree";
import { bindListTreeDrag, consumeRowClickSuppress } from "./list-tree-drag";
import { initBookmarks, loadBookmarks, saveBookmarks } from "./bookmarks";
import { FOLDER_OPEN_SVG, FOLDER_SVG, applyShellIcon } from "./local-icons";
import {
  renderTreeList,
  renderTreeLeafRow,
  renderTreeContainerRow,
  TREE_CHEVRON_SVG,
  toggleTreeContainerRow,
} from "./tree-list-render";

const BOOKMARK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const FOLDER_ADD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V6.5A2 2 0 0 1 5 4.5h4.5L11 6h8a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5z"/><line x1="16" y1="17" x2="20" y2="17"/><line x1="18" y1="15" x2="18" y2="19"/></svg>`;

const LBL_BOOKMARKS = "书签";
const LBL_ADD = "添加";

function renderTree(items: BookmarkEntry[], expanded: Set<string>): string {
  return renderTreeList({
    containerKind: "folder",
    emptyLabel: "暂无书签",
    expanded,
    items,
    isContainer: (item) => item.kind === "folder",
    renderLeaf: (item, depth) => {
      if (item.kind !== "link") return "";
      return renderTreeLeafRow({
        id: item.id,
        kind: "link",
        depth,
        label: item.name,
        iconHtml: `<span class="local-tree-icon local-item-icon is-file">${BOOKMARK_SVG}</span>`,
        url: item.url,
      });
    },
    renderContainer: (item, depth, childrenHtml, open) => {
      if (item.kind !== "folder") return "";
      return renderTreeContainerRow({
        id: item.id,
        containerKind: "folder",
        depth,
        label: item.name,
        tip: item.name,
        open,
        childrenHtml,
        twistieHtml: TREE_CHEVRON_SVG,
        iconHtml: `<span class="local-tree-icon local-item-icon is-folder">${open ? FOLDER_OPEN_SVG : FOLDER_SVG}</span>`,
      });
    },
  });
}

function toggleFolderRow(row: HTMLElement, id: string, open: boolean, expanded: Set<string>) {
  toggleTreeContainerRow(row, id, open, expanded, FOLDER_OPEN_SVG, FOLDER_SVG);
}

function collectLinks(items: BookmarkEntry[]): BookmarkLink[] {
  const out: BookmarkLink[] = [];
  for (const item of items) {
    if (item.kind === "link") out.push(item);
    else out.push(...item.children);
  }
  return out;
}

export function mountBookmarksPanel(container: HTMLElement, root: HTMLElement) {
  container.innerHTML = `
    <div class="launcher-head">
      <span class="launcher-title">${BOOKMARK_SVG}${LBL_BOOKMARKS}</span>
      <div class="launcher-head-actions">
        <button type="button" class="launcher-head-add" id="bookmarksAddFolderBtn" data-tip="添加文件夹" aria-label="添加文件夹">${FOLDER_ADD_SVG}</button>
        <button type="button" class="launcher-head-add" id="bookmarksAddBtn" data-tip="${LBL_ADD}" aria-label="${LBL_ADD}">+</button>
      </div>
    </div>
    <div class="bookmarks-tree-scroll">
      <div class="local-file-list vscode-tree" id="bookmarkTreeList"></div>
    </div>
  `;

  const listEl = container.querySelector<HTMLElement>("#bookmarkTreeList")!;
  const addBtn = container.querySelector<HTMLButtonElement>("#bookmarksAddBtn")!;
  const addFolderBtn = container.querySelector<HTMLButtonElement>("#bookmarksAddFolderBtn")!;
  const promptBookmark = mountBookmarkDialog(root);
  const promptFolder = mountFolderRenameDialog(root);
  const confirmRemove = getConfirmDialog();

  let items = stripBookmarkSlots(sortBookmarksBySlot(loadBookmarks()));
  const expanded = new Set<string>();
  const iconCache = new Map<string, string>();
  const pendingIcons = new Set<string>();
  let lastIconKey = "";

  const setItems = (next: BookmarkEntry[]) => {
    items = next;
    saveBookmarks(stripBookmarkSlots(next));
    paint();
  };

  const applyIcons = () => {
    for (const row of listEl.querySelectorAll<HTMLElement>(".local-tree-leaf[data-url]")) {
      const id = row.dataset.id;
      if (!id) continue;
      const url = iconCache.get(id);
      if (url) applyShellIcon(row, url);
    }
  };

  const syncIcons = async () => {
    const links = collectLinks(items);
    const key = links.map((l) => `${l.id}:${l.icon ?? ""}:${l.url}`).join("\0");
    if (key === lastIconKey) {
      applyIcons();
      return;
    }
    for (const link of links) {
      if (link.icon) {
        const dataUrl = await readAppIconData(link.icon);
        if (dataUrl) iconCache.set(link.id, dataUrl);
        else if (!isTauri()) iconCache.set(link.id, webFaviconSrc(link.url));
      } else if (!isTauri()) {
        iconCache.set(link.id, webFaviconSrc(link.url));
      }
    }
    lastIconKey = key;
    applyIcons();
    for (const link of links) {
      if (link.icon || pendingIcons.has(link.id)) continue;
      if (!isTauri()) continue;
      pendingIcons.add(link.id);
      void (async () => {
        try {
          const icon = await cacheFavicon(link.id, link.url);
          if (!icon) return;
          const current = locateBookmarkEntry(items, link.id);
          if (!current || current.node.kind !== "link") return;
          const dataUrl = await readAppIconData(icon);
          if (dataUrl) iconCache.set(link.id, dataUrl);
          setItems(updateBookmarkLink(items, link.id, current.node.name, current.node.url, icon));
        } finally {
          pendingIcons.delete(link.id);
        }
      })();
    }
  };

  const paint = () => {
    hideHoverTip();
    listEl.innerHTML = renderTree(items, expanded);
    void syncIcons();
  };

  bindListTreeDrag(listEl, (sourceId, targetId, position) => {
    if (position === "into" && targetId) expanded.add(targetId);
    setItems(moveBookmarkNode(items, sourceId, targetId, position));
  });

  const menuItems = (): MenuItemDef[] => [
    { action: "edit", label: "编辑" },
    { action: "remove", label: "删除", danger: true },
  ];

  const editEntry = async (loc: NonNullable<ReturnType<typeof locateBookmarkEntry>>, trigger: HTMLElement) => {
    if (loc.node.kind === "folder") {
      const name = await promptFolder(loc.node.name, trigger);
      if (!name?.trim()) return;
      setItems(updateBookmarkFolderName(items, loc.node.id, name));
      return;
    }
    const data = await promptBookmark({ name: loc.node.name, url: loc.node.url }, trigger);
    if (!data) return;
    const url = normalizeUrl(data.url);
    let icon = loc.node.icon;
    if (url !== loc.node.url && icon) {
      void deleteFavicon(icon);
      icon = undefined;
      iconCache.delete(loc.node.id);
      lastIconKey = "";
    }
    const next = updateBookmarkLink(items, loc.node.id, data.name, url, icon);
    setItems(next);
    if (!icon) {
      void cacheFavicon(loc.node.id, url).then((cached) => {
        if (!cached) return;
        const current = locateBookmarkEntry(items, loc.node.id);
        if (!current || current.node.kind !== "link") return;
        setItems(updateBookmarkLink(items, loc.node.id, current.node.name, current.node.url, cached));
      });
    }
  };

  const addLink = async (trigger: HTMLElement) => {
    const data = await promptBookmark(undefined, trigger);
    if (!data) return;
    const link: BookmarkLink = {
      kind: "link",
      id: crypto.randomUUID(),
      name: data.name.trim(),
      url: normalizeUrl(data.url),
    };
    setItems(addBookmarkLink(items, link, null));
    void cacheFavicon(link.id, link.url).then((icon) => {
      if (!icon) return;
      const current = locateBookmarkEntry(items, link.id);
      if (!current || current.node.kind !== "link") return;
      setItems(updateBookmarkLink(items, link.id, current.node.name, current.node.url, icon));
    });
  };

  addBtn.addEventListener("click", (e) => void addLink(e.currentTarget as HTMLElement));
  addFolderBtn.addEventListener("click", (e) => {
    void (async () => {
      const name = await promptFolder("新文件夹", e.currentTarget as HTMLElement);
      if (!name?.trim()) return;
      setItems(addBookmarkFolder(items, name));
    })();
  });

  listEl.addEventListener("click", async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-tree-row[data-id]");
    if (!row || !listEl.contains(row)) return;
    if (consumeRowClickSuppress(listEl)) return;
    if (row.dataset.kind === "folder") {
      const id = row.dataset.id!;
      toggleFolderRow(row, id, !expanded.has(id), expanded);
      return;
    }
    const url = row.dataset.url;
    if (url) await openUrl(url);
  });

  listEl.addEventListener("contextmenu", (e) => {
    hideHoverTip();
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".local-tree-row");
    if (!row?.dataset.id) return;
    e.preventDefault();
    const loc = locateBookmarkEntry(items, row.dataset.id);
    if (!loc) return;
    const id = row.dataset.id;
    showCommandMenuAt(
      e.clientX,
      e.clientY,
      menuItems().map((item) => ({ value: item.action, label: item.label, danger: item.danger })),
      (action) => {
        if (action === "edit") void editEntry(loc, row);
        if (action === "remove") {
          void (async () => {
            if (!(await confirmRemove("删除确认", "确定删除该书签？", row))) return;
            setItems(removeBookmarkEntry(items, id));
          })();
        }
      },
      { returnFocus: row },
    );
    e.stopPropagation();
  });

  paint();

  window.addEventListener("orbita:launcher-reload", () => {
    void initBookmarks().then((next) => {
      items = stripBookmarkSlots(sortBookmarksBySlot(next));
      paint();
    });
  });
}
