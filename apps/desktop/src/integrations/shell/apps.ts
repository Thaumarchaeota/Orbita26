import { readApps, writeApps } from "../../core/data/client";
import type { AppEntry, AppLink } from "../../core/data/types";
import { createLauncherStore } from "./launcher-store";

export type { AppEntry, AppLink };
export type AppItem = AppLink;

const store = createLauncherStore<AppLink, AppEntry>({
  name: "apps",
  read: readApps,
  write: writeApps,
  applyPayload: (leaf, name, path, icon) => {
    const item: AppLink = { ...leaf, name: name.trim(), path: path.trim() };
    if (icon) item.icon = icon;
    return item;
  },
});

export const initApps = store.init;
export const loadApps = store.load;
export const saveApps = store.save;
export const updateApp = store.updateLeaf;
export const updateAppInFolder = store.updateLeafInFolder;

export function guessAppName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.(exe|lnk)$/i, "");
}
