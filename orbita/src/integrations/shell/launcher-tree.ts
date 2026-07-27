import type { AppEntry, AppLink, BookmarkEntry, BookmarkLink } from "../../core/data/types";

export function isBookmarkFolder(e: BookmarkEntry): e is Extract<BookmarkEntry, { kind: "folder" }> {
  return e.kind === "folder";
}

export function isAppFolder(e: AppEntry): e is Extract<AppEntry, { kind: "folder" }> {
  return e.kind === "folder";
}

export function flattenBookmarkLeaves(entries: BookmarkEntry[]): BookmarkLink[] {
  const out: BookmarkLink[] = [];
  for (const e of entries) {
    if (e.kind === "link") out.push(e);
    else out.push(...e.children);
  }
  return out;
}

export function flattenAppLeaves(entries: AppEntry[]): AppLink[] {
  const out: AppLink[] = [];
  for (const e of entries) {
    if (e.kind === "app") out.push(e);
    else out.push(...e.children);
  }
  return out;
}

function findBookmarkIndex(entries: BookmarkEntry[], id: string): { index: number; entry: BookmarkEntry } | null {
  const i = entries.findIndex((e) => e.id === id);
  return i >= 0 ? { index: i, entry: entries[i]! } : null;
}

function findAppIndex(entries: AppEntry[], id: string): { index: number; entry: AppEntry } | null {
  const i = entries.findIndex((e) => e.id === id);
  return i >= 0 ? { index: i, entry: entries[i]! } : null;
}

function removeBookmarkAt(entries: BookmarkEntry[], id: string): { entries: BookmarkEntry[]; removed: BookmarkEntry | null } {
  const hit = findBookmarkIndex(entries, id);
  if (!hit) return { entries, removed: null };
  const next = [...entries];
  const [removed] = next.splice(hit.index, 1);
  return { entries: next, removed: removed ?? null };
}

function removeAppAt(entries: AppEntry[], id: string): { entries: AppEntry[]; removed: AppEntry | null } {
  const hit = findAppIndex(entries, id);
  if (!hit) return { entries, removed: null };
  const next = [...entries];
  const [removed] = next.splice(hit.index, 1);
  return { entries: next, removed: removed ?? null };
}

function toBookmarkLeaf(entry: BookmarkEntry): BookmarkLink | null {
  return entry.kind === "link" ? entry : null;
}

function toAppLeaf(entry: AppEntry): AppLink | null {
  return entry.kind === "app" ? entry : null;
}

export function moveBookmarkToFolder(
  entries: BookmarkEntry[],
  sourceId: string,
  folderId: string,
): BookmarkEntry[] {
  if (sourceId === folderId) return entries;
  const folder = entries.find((e) => e.id === folderId && e.kind === "folder");
  if (!folder || folder.kind !== "folder") return entries;
  const { entries: without, removed } = removeBookmarkAt(entries, sourceId);
  if (!removed) return entries;
  const leaf = toBookmarkLeaf(removed);
  if (!leaf) return entries;
  return without.map((e) =>
    e.id === folderId && e.kind === "folder" ? { ...e, children: [...e.children, leaf] } : e,
  );
}

export function moveAppToFolder(entries: AppEntry[], sourceId: string, folderId: string): AppEntry[] {
  if (sourceId === folderId) return entries;
  const folder = entries.find((e) => e.id === folderId && e.kind === "folder");
  if (!folder || folder.kind !== "folder") return entries;
  const { entries: without, removed } = removeAppAt(entries, sourceId);
  if (!removed) return entries;
  const leaf = toAppLeaf(removed);
  if (!leaf) return entries;
  return without.map((e) =>
    e.id === folderId && e.kind === "folder" ? { ...e, children: [...e.children, leaf] } : e,
  );
}

export function dissolveRootBookmarkFolders(entries: BookmarkEntry[]): BookmarkEntry[] {
  const out: BookmarkEntry[] = [];
  for (const e of entries) {
    if (e.kind !== "folder") out.push(e);
    else if (e.children.length === 1) out.push({ ...e.children[0]!, slot: e.slot });
    else if (e.children.length > 1) out.push(e);
  }
  return out;
}

export function dissolveRootAppFolders(entries: AppEntry[]): AppEntry[] {
  const out: AppEntry[] = [];
  for (const e of entries) {
    if (e.kind !== "folder") out.push(e);
    else if (e.children.length === 1) out.push({ ...e.children[0]!, slot: e.slot });
    else if (e.children.length > 1) out.push(e);
  }
  return out;
}

export function moveBookmarkToRoot(entries: BookmarkEntry[], sourceId: string, folderId: string): BookmarkEntry[] {
  const folderIdx = entries.findIndex((e) => e.id === folderId && e.kind === "folder");
  if (folderIdx < 0) return entries;
  const folder = entries[folderIdx]!;
  if (folder.kind !== "folder") return entries;
  const child = folder.children.find((c) => c.id === sourceId);
  if (!child) return entries;

  const remaining = folder.children.filter((c) => c.id !== sourceId);
  let next = entries.map((e) =>
    e.id === folderId && e.kind === "folder" ? { ...e, children: remaining } : e,
  );

  if (remaining.length === 0) {
    next = next.filter((e) => e.id !== folderId);
    next.splice(folderIdx, 0, child);
  } else {
    next = [...next, child];
  }
  return dissolveRootBookmarkFolders(next);
}

export function moveAppToRoot(entries: AppEntry[], sourceId: string, folderId: string): AppEntry[] {
  const folderIdx = entries.findIndex((e) => e.id === folderId && e.kind === "folder");
  if (folderIdx < 0) return entries;
  const folder = entries[folderIdx]!;
  if (folder.kind !== "folder") return entries;
  const child = folder.children.find((c) => c.id === sourceId);
  if (!child) return entries;

  const remaining = folder.children.filter((c) => c.id !== sourceId);
  let next = entries.map((e) =>
    e.id === folderId && e.kind === "folder" ? { ...e, children: remaining } : e,
  );

  if (remaining.length === 0) {
    next = next.filter((e) => e.id !== folderId);
    next.splice(folderIdx, 0, child);
  } else {
    next = [...next, child];
  }
  return dissolveRootAppFolders(next);
}

export function reorderFolderBookmarks(
  entries: BookmarkEntry[],
  folderId: string,
  orderedIds: string[],
): BookmarkEntry[] {
  const folder = entries.find((e) => e.id === folderId && e.kind === "folder");
  const map = new Map(folder?.kind === "folder" ? folder.children.map((c) => [c.id, c]) : []);
  const children = orderedIds.map((id) => map.get(id)).filter((c): c is BookmarkLink => !!c);
  return entries.map((e) => (e.id === folderId && e.kind === "folder" ? { ...e, children } : e));
}

export function reorderFolderApps(entries: AppEntry[], folderId: string, orderedIds: string[]): AppEntry[] {
  const folder = entries.find((e) => e.id === folderId && e.kind === "folder");
  const map = new Map(folder?.kind === "folder" ? folder.children.map((c) => [c.id, c]) : []);
  const children = orderedIds.map((id) => map.get(id)).filter((c): c is AppLink => !!c);
  return entries.map((e) => (e.id === folderId && e.kind === "folder" ? { ...e, children } : e));
}

export function mergeBookmarksIntoNewFolder(
  entries: BookmarkEntry[],
  sourceId: string,
  targetId: string,
): BookmarkEntry[] {
  if (sourceId === targetId) return entries;
  const target = entries.find((e) => e.id === targetId);
  if (!target) return entries;
  if (target.kind === "folder") return moveBookmarkToFolder(entries, sourceId, targetId);
  const { entries: without, removed: src } = removeBookmarkAt(entries, sourceId);
  const srcIdx = without.findIndex((e) => e.id === targetId);
  if (srcIdx < 0 || !src || src.kind !== "link") return entries;
  const tgt = without[srcIdx]!;
  if (tgt.kind !== "link") return entries;
  const srcLeaf = toBookmarkLeaf(src);
  if (!srcLeaf) return entries;
  const folder: BookmarkEntry = {
    kind: "folder",
    id: crypto.randomUUID(),
    name: "文件夹",
    children: [tgt, srcLeaf],
    slot: tgt.slot,
  };
  const next = [...without];
  next.splice(srcIdx, 1, folder);
  return next;
}

export function mergeAppsIntoNewFolder(entries: AppEntry[], sourceId: string, targetId: string): AppEntry[] {
  if (sourceId === targetId) return entries;
  const target = entries.find((e) => e.id === targetId);
  if (!target) return entries;
  if (target.kind === "folder") return moveAppToFolder(entries, sourceId, targetId);
  const { entries: without, removed: src } = removeAppAt(entries, sourceId);
  const srcIdx = without.findIndex((e) => e.id === targetId);
  if (srcIdx < 0 || !src || src.kind !== "app") return entries;
  const tgt = without[srcIdx]!;
  if (tgt.kind !== "app") return entries;
  const srcLeaf = toAppLeaf(src);
  if (!srcLeaf) return entries;
  const folder: AppEntry = {
    kind: "folder",
    id: crypto.randomUUID(),
    name: "文件夹",
    children: [tgt, srcLeaf],
    slot: tgt.slot,
  };
  const next = [...without];
  next.splice(srcIdx, 1, folder);
  return next;
}

export function removeBookmarkEntry(entries: BookmarkEntry[], id: string): BookmarkEntry[] {
  const hit = findBookmarkIndex(entries, id);
  if (!hit) return entries;
  const { entry } = hit;
  if (entry.kind === "folder") {
    const { entries: without } = removeBookmarkAt(entries, id);
    return [...without, ...entry.children];
  }
  return removeBookmarkAt(entries, id).entries;
}

export function removeAppEntry(entries: AppEntry[], id: string): AppEntry[] {
  const hit = findAppIndex(entries, id);
  if (!hit) return entries;
  const { entry } = hit;
  if (entry.kind === "folder") {
    const { entries: without } = removeAppAt(entries, id);
    return [...without, ...entry.children];
  }
  return removeAppAt(entries, id).entries;
}

export function updateBookmarkFolderName(entries: BookmarkEntry[], id: string, name: string): BookmarkEntry[] {
  return entries.map((e) => (e.id === id && e.kind === "folder" ? { ...e, name: name.trim() } : e));
}

export function updateAppFolderName(entries: AppEntry[], id: string, name: string): AppEntry[] {
  return entries.map((e) => (e.id === id && e.kind === "folder" ? { ...e, name: name.trim() } : e));
}

export function getBookmarkFolder(entries: BookmarkEntry[], id: string) {
  const e = entries.find((x) => x.id === id);
  return e?.kind === "folder" ? e : null;
}

export function getAppFolder(entries: AppEntry[], id: string) {
  const e = entries.find((x) => x.id === id);
  return e?.kind === "folder" ? e : null;
}

