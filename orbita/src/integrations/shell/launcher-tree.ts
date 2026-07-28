import type { LauncherEntryOf, LauncherFolder, LauncherLeafBase } from "../../core/data/types";

export type LauncherEntry<L extends LauncherLeafBase = LauncherLeafBase> = LauncherEntryOf<L>;
export type { LauncherFolder };

export function isLauncherFolder<E extends { kind: string }>(
  e: E,
): e is Extract<E, { kind: "folder" }> {
  return e.kind === "folder";
}

function findIndex<E extends { id: string }>(entries: E[], id: string) {
  const i = entries.findIndex((e) => e.id === id);
  return i >= 0 ? { index: i, entry: entries[i]! } : null;
}

function removeAt<E extends { id: string }>(entries: E[], id: string) {
  const hit = findIndex(entries, id);
  if (!hit) return { entries, removed: null as E | null };
  const next = [...entries];
  const [removed] = next.splice(hit.index, 1);
  return { entries: next, removed: removed ?? null };
}

function toLeaf<L extends LauncherLeafBase>(entry: LauncherEntry<L>, leafKind: L["kind"]): L | null {
  return entry.kind === leafKind ? (entry as L) : null;
}

export function flattenLauncherLeaves<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  leafKind: L["kind"],
): L[] {
  const out: L[] = [];
  for (const e of entries) {
    if (e.kind === leafKind) out.push(e as L);
    else if (e.kind === "folder") out.push(...(e as LauncherFolder<L>).children);
  }
  return out;
}

export function moveToFolder<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  sourceId: string,
  folderId: string,
  leafKind: L["kind"],
): LauncherEntry<L>[] {
  if (sourceId === folderId) return entries;
  const folder = entries.find((e) => e.id === folderId && e.kind === "folder") as LauncherFolder<L> | undefined;
  if (!folder) return entries;
  const { entries: without, removed } = removeAt(entries, sourceId);
  if (!removed) return entries;
  const leaf = toLeaf(removed, leafKind);
  if (!leaf) return entries;
  return without.map((e) =>
    e.id === folderId && e.kind === "folder" ? { ...e, children: [...(e as LauncherFolder<L>).children, leaf] } : e,
  );
}

export function dissolveRootFolders<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
): LauncherEntry<L>[] {
  const out: LauncherEntry<L>[] = [];
  for (const e of entries) {
    if (e.kind !== "folder") out.push(e);
    else {
      const folder = e as LauncherFolder<L>;
      if (folder.children.length === 1) out.push({ ...folder.children[0]!, slot: folder.slot });
      else if (folder.children.length > 1) out.push(e);
    }
  }
  return out;
}

export function moveToRoot<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  sourceId: string,
  folderId: string,
): LauncherEntry<L>[] {
  const folderIdx = entries.findIndex((e) => e.id === folderId && e.kind === "folder");
  if (folderIdx < 0) return entries;
  const folder = entries[folderIdx] as LauncherFolder<L>;
  const child = folder.children.find((c) => c.id === sourceId);
  if (!child) return entries;

  const remaining = folder.children.filter((c) => c.id !== sourceId);
  let next = entries.map((e) =>
    e.id === folderId && e.kind === "folder" ? { ...e, children: remaining } : e,
  ) as LauncherEntry<L>[];

  if (remaining.length === 0) {
    next = next.filter((e) => e.id !== folderId);
    next.splice(folderIdx, 0, child);
  } else {
    next = [...next, child];
  }
  return dissolveRootFolders(next);
}

export function reorderFolderChildren<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  folderId: string,
  orderedIds: string[],
): LauncherEntry<L>[] {
  const folder = entries.find((e) => e.id === folderId && e.kind === "folder") as LauncherFolder<L> | undefined;
  const map = new Map(folder ? folder.children.map((c) => [c.id, c]) : []);
  const children = orderedIds.map((id) => map.get(id)).filter((c): c is L => !!c);
  return entries.map((e) => (e.id === folderId && e.kind === "folder" ? { ...e, children } : e));
}

export function mergeIntoNewFolder<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  sourceId: string,
  targetId: string,
  leafKind: L["kind"],
): LauncherEntry<L>[] {
  if (sourceId === targetId) return entries;
  const target = entries.find((e) => e.id === targetId);
  if (!target) return entries;
  if (target.kind === "folder") return moveToFolder(entries, sourceId, targetId, leafKind);
  const { entries: without, removed: src } = removeAt(entries, sourceId);
  const srcIdx = without.findIndex((e) => e.id === targetId);
  if (srcIdx < 0 || !src || src.kind !== leafKind) return entries;
  const tgt = without[srcIdx] as L;
  const srcLeaf = toLeaf(src, leafKind);
  if (!srcLeaf) return entries;
  const folder: LauncherFolder<L> = {
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

export function removeEntry<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  id: string,
): LauncherEntry<L>[] {
  const hit = findIndex(entries, id);
  if (!hit) return entries;
  const { entry } = hit;
  if (entry.kind === "folder") {
    const { entries: without } = removeAt(entries, id);
    return [...without, ...(entry as LauncherFolder<L>).children];
  }
  return removeAt(entries, id).entries;
}

export function updateFolderName<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  id: string,
  name: string,
): LauncherEntry<L>[] {
  return entries.map((e) => (e.id === id && e.kind === "folder" ? { ...e, name: name.trim() } : e));
}

export function getLauncherFolder<L extends LauncherLeafBase>(
  entries: LauncherEntry<L>[],
  id: string,
): LauncherFolder<L> | null {
  const e = entries.find((x) => x.id === id);
  return e?.kind === "folder" ? (e as LauncherFolder<L>) : null;
}
