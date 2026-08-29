import type { LauncherEntry, LauncherFolder } from "./launcher-tree";
import type { LauncherLeafBase } from "../../core/data/types";
import { isLauncherFolder } from "./launcher-tree";

type LauncherStoreConfig<L extends LauncherLeafBase, E extends LauncherEntry<L>> = {
  name: string;
  read: () => Promise<E[]>;
  write: (items: E[]) => Promise<void>;
  defaults?: E[];
  applyPayload: (leaf: L, name: string, payload: string, icon?: string) => L;
};

export function createLauncherStore<L extends LauncherLeafBase, E extends LauncherEntry<L>>(
  cfg: LauncherStoreConfig<L, E>,
) {
  let cache: E[] | null = null;

  async function init(): Promise<E[]> {
    const items = await cfg.read();
    if (items.length) {
      cache = items;
      return cache;
    }
    cache = cfg.defaults?.length ? [...cfg.defaults] : [];
    if (cache.length) await cfg.write(cache);
    return cache;
  }

  function load(): E[] {
    if (!cache) throw new Error(`${cfg.name} not loaded`);
    return cache;
  }

  function save(items: E[]): void {
    cache = items;
    void cfg.write(items);
  }

  function updateLeaf(id: string, name: string, payload: string, icon?: string): E[] {
    const items = load();
    const next = items.map((entry) => {
      if (isLauncherFolder(entry)) return entry;
      if (entry.id !== id) return entry;
      return cfg.applyPayload(entry as L, name, payload, icon) as E;
    });
    save(next);
    return next;
  }

  function updateLeafInFolder(
    folderId: string,
    id: string,
    name: string,
    payload: string,
    icon?: string,
  ): E[] {
    const items = load();
    const next = items.map((entry) => {
      if (!isLauncherFolder(entry) || entry.id !== folderId) return entry;
      const folder = entry as LauncherFolder<L>;
      return {
        ...folder,
        children: folder.children.map((child) => {
          if (child.id !== id) return child;
          return cfg.applyPayload(child, name, payload, icon);
        }),
      } as E;
    });
    save(next);
    return next;
  }

  return { init, load, save, updateLeaf, updateLeafInFolder };
}
