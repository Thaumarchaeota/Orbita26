import { readApps, writeApps } from "../../core/data/client";
import type { AppEntry, AppLink } from "../../core/data/types";

export type { AppEntry, AppLink };
export type AppItem = AppLink;

let cache: AppEntry[] | null = null;

export async function initApps(): Promise<AppEntry[]> {
  cache = await readApps();
  return cache;
}

export function loadApps(): AppEntry[] {
  if (!cache) throw new Error("apps not loaded");
  return cache;
}

export function saveApps(apps: AppEntry[]): void {
  cache = apps;
  void writeApps(apps);
}

export function guessAppName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.(exe|lnk)$/i, "");
}

export function updateApp(id: string, name: string, path: string, icon?: string): AppEntry[] {
  const apps = loadApps();
  const next = apps.map((a) => {
    if (a.kind === "folder") return a;
    if (a.id !== id) return a;
    const item: AppLink = {
      ...a,
      name: name.trim(),
      path: path.trim(),
    };
    if (icon) item.icon = icon;
    return item;
  });
  saveApps(next);
  return next;
}

export function updateAppInFolder(
  folderId: string,
  id: string,
  name: string,
  path: string,
  icon?: string,
): AppEntry[] {
  const apps = loadApps();
  const next = apps.map((a) => {
    if (a.kind !== "folder" || a.id !== folderId) return a;
    return {
      ...a,
      children: a.children.map((c) => {
        if (c.id !== id) return c;
        const item: AppLink = { ...c, name: name.trim(), path: path.trim() };
        if (icon) item.icon = icon;
        return item;
      }),
    };
  });
  saveApps(next);
  return next;
}
