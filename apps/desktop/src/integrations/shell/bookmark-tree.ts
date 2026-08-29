import type { BookmarkEntry, BookmarkFolder, BookmarkLink } from "../../core/data/types";
import {
  insertTreeNode,
  locateTreeNode,
  moveTreeNode,
  removeTreeNode,
  type TreeDropPosition,
  type TreeOps,
} from "../../core/tree-ops";

export type BookmarkDropPosition = TreeDropPosition;

const bookmarkTreeOps: TreeOps<BookmarkEntry> = {
  containerKind: "folder",
  recursive: false,
  getChildren: (node) => (node.kind === "folder" ? node.children : []),
  setChildren: (node, children) =>
    node.kind === "folder" ? { ...node, children: children as BookmarkLink[] } : node,
  canDropInto: (source, target) => target.kind === "folder" && source.kind !== "folder",
};

function updateFolderChildren(
  nodes: BookmarkEntry[],
  folderId: string,
  children: BookmarkLink[],
): BookmarkEntry[] {
  return nodes.map((n) => {
    if (n.id === folderId && n.kind === "folder") return { ...n, children };
    return n;
  });
}

export function locateBookmarkEntry(tree: BookmarkEntry[], id: string) {
  return locateTreeNode(tree, id, bookmarkTreeOps);
}

export function moveBookmarkNode(
  tree: BookmarkEntry[],
  sourceId: string,
  targetId: string | null,
  position: BookmarkDropPosition,
): BookmarkEntry[] {
  return moveTreeNode(tree, sourceId, targetId, position, bookmarkTreeOps);
}

export function removeBookmarkEntry(tree: BookmarkEntry[], id: string): BookmarkEntry[] {
  const loc = locateBookmarkEntry(tree, id);
  if (!loc) return tree;

  const { tree: without, removed } = removeTreeNode(tree, loc.parentId, loc.index, bookmarkTreeOps);
  if (removed.kind !== "folder") return without;

  const folder = removed as BookmarkFolder;
  let next = without;
  for (let i = 0; i < folder.children.length; i++) {
    next = insertTreeNode(next, loc.parentId, loc.index + i, folder.children[i]!, bookmarkTreeOps);
  }
  return next;
}

export function addBookmarkFolder(tree: BookmarkEntry[], name: string): BookmarkEntry[] {
  const folder: BookmarkFolder = {
    kind: "folder",
    id: crypto.randomUUID(),
    name: name.trim() || "文件夹",
    children: [],
  };
  return [...tree, folder];
}

export function addBookmarkLink(tree: BookmarkEntry[], link: BookmarkLink, parentId: string | null): BookmarkEntry[] {
  if (!parentId) return [...tree, link];
  const parent = locateBookmarkEntry(tree, parentId);
  if (!parent || parent.node.kind !== "folder") return [...tree, link];
  return updateFolderChildren(tree, parentId, [...parent.node.children, link]);
}

export function updateBookmarkFolderName(tree: BookmarkEntry[], id: string, name: string): BookmarkEntry[] {
  return tree.map((n) => (n.id === id && n.kind === "folder" ? { ...n, name: name.trim() } : n));
}

export function updateBookmarkLink(
  tree: BookmarkEntry[],
  id: string,
  name: string,
  url: string,
  icon?: string,
): BookmarkEntry[] {
  const patch = (link: BookmarkLink): BookmarkLink => {
    const item: BookmarkLink = { ...link, name: name.trim(), url };
    if (icon) item.icon = icon;
    else delete item.icon;
    return item;
  };
  const walk = (nodes: BookmarkEntry[]): BookmarkEntry[] =>
    nodes.map((n) => {
      if (n.id === id && n.kind === "link") return patch(n);
      if (n.kind === "folder") {
        return { ...n, children: n.children.map((c) => (c.id === id ? patch(c) : c)) };
      }
      return n;
    });
  return walk(tree);
}

export function sortBookmarksBySlot(items: BookmarkEntry[]): BookmarkEntry[] {
  return [...items].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

export function stripBookmarkSlots(items: BookmarkEntry[]): BookmarkEntry[] {
  return items.map((e) => {
    if (e.kind === "folder") {
      const { slot: _, ...rest } = e;
      return { ...rest, children: e.children.map(({ slot: __, ...c }) => c) };
    }
    const { slot: _, ...rest } = e;
    return rest;
  });
}
