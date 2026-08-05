import { readLocalFiles, writeLocalFiles } from "../../core/data/client";
import type { LocalEntry, LocalEntryKind, LocalFileLeaf } from "../../core/data/types";
import { addLocalGroup, addLocalLeaf, removeLocalEntry, updateLocalGroupName, updateLocalLeaf } from "./local-tree";

export type { LocalEntryKind, LocalFileLeaf };
export type LocalFileItem = LocalFileLeaf;

let cache: LocalEntry[] | null = null;

export async function initLocalFiles(): Promise<LocalEntry[]> {
  cache = await readLocalFiles();
  return cache;
}

export function guessLocalName(path: string): string {
  return path.split(/[/\\]/).pop() ?? "";
}

export function loadLocalFiles(): LocalEntry[] {
  if (!cache) throw new Error("local files not loaded");
  return cache;
}

export function saveLocalFiles(items: LocalEntry[]): void {
  cache = items;
  void writeLocalFiles(items);
}

export function addLocalFile(
  name: string,
  path: string,
  kind: LocalEntryKind,
  parentId?: string | null,
): LocalEntry[] {
  const leaf: LocalFileLeaf = {
    kind,
    id: crypto.randomUUID(),
    name: name.trim(),
    path: path.trim(),
  };
  const next = addLocalLeaf(loadLocalFiles(), leaf, parentId ?? null);
  saveLocalFiles(next);
  return next;
}

export function addLocalGroupEntry(name: string, parentId?: string | null): LocalEntry[] {
  const next = addLocalGroup(loadLocalFiles(), name, parentId ?? null);
  saveLocalFiles(next);
  return next;
}

export function removeLocalFile(id: string): LocalEntry[] {
  const next = removeLocalEntry(loadLocalFiles(), id);
  saveLocalFiles(next);
  return next;
}

export function renameLocalGroup(id: string, name: string, color?: string): LocalEntry[] {
  const next = updateLocalGroupName(loadLocalFiles(), id, name, color);
  saveLocalFiles(next);
  return next;
}

export function updateLocalFile(id: string, name: string, path: string, color?: string): LocalEntry[] {
  const next = updateLocalLeaf(loadLocalFiles(), id, name, path, color);
  saveLocalFiles(next);
  return next;
}
