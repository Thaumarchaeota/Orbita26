import type { BookmarkEntry, BookmarkFolder, BookmarkLink } from "../../core/data/types";

export type BookmarkDropPosition = "before" | "after" | "into";

type Loc = { parentId: string | null; index: number; node: BookmarkEntry };

function findLoc(nodes: BookmarkEntry[], id: string, parentId: string | null): Loc | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.id === id) return { parentId, index: i, node };
    if (node.kind === "folder") {
      for (let j = 0; j < node.children.length; j++) {
        const child = node.children[j]!;
        if (child.id === id) return { parentId: node.id, index: j, node: child };
      }
    }
  }
  return null;
}

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

function removeFromParent(tree: BookmarkEntry[], parentId: string | null, index: number): {
  tree: BookmarkEntry[];
  removed: BookmarkEntry | BookmarkLink;
} {
  if (parentId === null) {
    const next = [...tree];
    const [removed] = next.splice(index, 1);
    return { tree: next, removed: removed! };
  }
  const parent = findLoc(tree, parentId, null);
  if (!parent || parent.node.kind !== "folder") throw new Error("parent not found");
  const kids = [...parent.node.children];
  const [removed] = kids.splice(index, 1);
  return { tree: updateFolderChildren(tree, parentId, kids), removed: removed! };
}

function insertIntoParent(
  tree: BookmarkEntry[],
  parentId: string | null,
  index: number,
  node: BookmarkEntry | BookmarkLink,
): BookmarkEntry[] {
  if (parentId === null) {
    const next = [...tree];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node as BookmarkEntry);
    return next;
  }
  const parent = findLoc(tree, parentId, null);
  if (!parent || parent.node.kind !== "folder") return tree;
  const kids = [...parent.node.children];
  kids.splice(Math.max(0, Math.min(index, kids.length)), 0, node as BookmarkLink);
  return updateFolderChildren(tree, parentId, kids);
}

export function locateBookmarkEntry(tree: BookmarkEntry[], id: string): Loc | null {
  return findLoc(tree, id, null);
}

export function moveBookmarkNode(
  tree: BookmarkEntry[],
  sourceId: string,
  targetId: string | null,
  position: BookmarkDropPosition,
): BookmarkEntry[] {
  const src = findLoc(tree, sourceId, null);
  if (!src) return tree;

  if (!targetId) {
    const { tree: without, removed } = removeFromParent(tree, src.parentId, src.index);
    if (position === "before") return insertIntoParent(without, null, 0, removed);
    return insertIntoParent(without, null, without.length, removed);
  }

  if (sourceId === targetId) return tree;

  const tgt = findLoc(tree, targetId, null);
  if (!tgt) return tree;

  if (position === "into") {
    if (tgt.node.kind !== "folder" || src.node.kind === "folder") return tree;
  }

  const fromIndex = src.index;
  const fromParentId = src.parentId;

  let toParentId: string | null;
  let toIndex: number;

  if (position === "into") {
    if (tgt.node.kind !== "folder") return tree;
    toParentId = tgt.node.id;
    toIndex = tgt.node.children.length;
  } else {
    toParentId = tgt.parentId;
    toIndex = position === "before" ? tgt.index : tgt.index + 1;
    if (fromParentId === toParentId && fromIndex < toIndex) toIndex--;
  }

  const { tree: without, removed } = removeFromParent(tree, fromParentId, fromIndex);
  return insertIntoParent(without, toParentId, toIndex, removed);
}

export function removeBookmarkEntry(tree: BookmarkEntry[], id: string): BookmarkEntry[] {
  const loc = findLoc(tree, id, null);
  if (!loc) return tree;

  const { tree: without, removed } = removeFromParent(tree, loc.parentId, loc.index);
  if (removed.kind !== "folder") return without;

  const folder = removed as BookmarkFolder;
  let next = without;
  for (let i = 0; i < folder.children.length; i++) {
    next = insertIntoParent(next, loc.parentId, loc.index + i, folder.children[i]!);
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
  const parent = findLoc(tree, parentId, null);
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
