import { isTauri } from "../../core/data/client";
import type { AppEntry, AppLink, BookmarkEntry, BookmarkLink, LauncherFolder, LauncherLeafBase } from "../../core/data/types";
import {
  cacheAppIcon,
  cacheFavicon,
  deleteAppIcon,
  deleteFavicon,
  launchApp,
  openUrl,
  pickAppFile,
  readAppIconData,
  webFaviconSrc,
} from "./adapter";
import { guessAppName } from "./apps";
import { mountAppDialog, mountBookmarkDialog, mountFolderRenameDialog } from "./dialog";
import { mountFolderOverlay } from "./folder-overlay";
import {
  dissolveRootFolders,
  flattenLauncherLeaves,
  getLauncherFolder,
  isLauncherFolder,
  mergeIntoNewFolder,
  moveToFolder,
  moveToRoot,
  removeEntry,
  reorderFolderChildren,
  updateFolderName,
  type LauncherEntry,
} from "./launcher-tree";
import {
  firstEmptySlot,
  migrateDenseSlots,
  normalizeGridEntries,
} from "./grid-slots";
import { renderTile } from "./tiles";
import { bindTileGrid } from "./tile-grid";

const LBL_ADD = "添加";

type LeafBase = LauncherLeafBase & { url?: string; path?: string };

type PayloadKey = "url" | "path";

type LauncherGridConfig<L extends LeafBase, E extends LauncherEntry<L>> = {
  gridEl: HTMLElement;
  addBtn: HTMLButtonElement;
  gridClass: "bookmarks-grid" | "apps-grid";
  leafKind: L["kind"];
  payloadKey: PayloadKey;
  capacity: () => number;
  ref: { current: E[] };
  save: (items: E[]) => void;
  updateLeaf: (id: string, name: string, payload: string, icon?: string) => E[];
  updateLeafInFolder: (folderId: string, id: string, name: string, payload: string, icon?: string) => E[];
  folderOverlay: ReturnType<typeof mountFolderOverlay>;
  dialogRoot: HTMLElement;
  confirmDelete: (name: string, trigger: HTMLElement) => Promise<boolean>;
  prompt: ReturnType<typeof mountBookmarkDialog> | ReturnType<typeof mountAppDialog>;
  onActivateLeaf: (leaf: L) => void | Promise<void>;
  cacheIcon: (id: string, payload: string) => Promise<string | null | undefined>;
  deleteIcon: (iconPath: string) => void | Promise<void>;
  pickPayload?: () => Promise<string | null>;
  promptEditReadonlyPayload?: boolean;
};

function normalizeUrl(url: string): string {
  const t = url.trim();
  return t.startsWith("http") ? t : `https://${t}`;
}

function payloadOf<L extends LeafBase>(leaf: L, key: PayloadKey): string {
  return (key === "url" ? leaf.url : leaf.path) ?? "";
}

function tileAttrs<L extends LeafBase>(leaf: L | null, leafKind: L["kind"], payloadKey: PayloadKey): Record<string, string> {
  if (!leaf || leaf.kind === "folder") return {};
  return payloadKey === "url"
    ? { url: leaf.url ?? "", kind: String(leafKind) }
    : { path: leaf.path ?? "", kind: String(leafKind) };
}

export function mountLauncherGrid<L extends LeafBase, E extends LauncherEntry<L>>(
  cfg: LauncherGridConfig<L, E>,
) {
  const iconSrcCache = new Map<string, string>();
  const pendingIcons = new Set<string>();
  const promptRenameFolder = mountFolderRenameDialog(cfg.dialogRoot);
  let items = cfg.ref.current;

  if (!items.some((e) => e.slot !== undefined)) {
    items = migrateDenseSlots(items) as E[];
    cfg.ref.current = items;
    cfg.save(items);
  }

  function applyWebFallback(leaf: L) {
    if (cfg.payloadKey === "url" && leaf.url) {
      iconSrcCache.set(leaf.id, webFaviconSrc(leaf.url));
    }
  }

  async function rememberIcon(leaf: L, iconPath?: string) {
    const path = iconPath ?? leaf.icon;
    if (path) {
      const dataUrl = await readAppIconData(path);
      if (dataUrl) {
        iconSrcCache.set(leaf.id, dataUrl);
        return;
      }
    }
    applyWebFallback(leaf);
  }

  function folderPreview(folder: LauncherFolder<L>) {
    return folder.children.map((c) => ({
      name: c.name,
      iconSrc: iconSrcCache.get(c.id),
    }));
  }

  function renderLauncherTile(item: E | null, editMode: boolean, slot = 0) {
    if (item && isLauncherFolder(item)) {
      return renderTile(
        { id: item.id, name: item.name, kind: "folder" },
        {},
        LBL_ADD,
        editMode,
        false,
        undefined,
        folderPreview(item as LauncherFolder<L>),
        slot,
      );
    }
    const leaf = item as L | null;
    return renderTile(
      leaf,
      tileAttrs(leaf, cfg.leafKind, cfg.payloadKey),
      LBL_ADD,
      editMode,
      false,
      leaf ? iconSrcCache.get(leaf.id) : undefined,
      undefined,
      slot,
    );
  }

  async function promptAdd(trigger: HTMLElement, initialPayload = "") {
    if (cfg.payloadKey === "url") {
      return (cfg.prompt as ReturnType<typeof mountBookmarkDialog>)(undefined, trigger);
    }
    return (cfg.prompt as ReturnType<typeof mountAppDialog>)(
      { name: guessAppName(initialPayload), path: initialPayload },
      false,
      trigger,
    );
  }

  async function promptEdit(leaf: L, trigger: HTMLElement) {
    if (cfg.payloadKey === "url") {
      return (cfg.prompt as ReturnType<typeof mountBookmarkDialog>)(
        { name: leaf.name, url: leaf.url ?? "" },
        trigger,
      );
    }
    return (cfg.prompt as ReturnType<typeof mountAppDialog>)(
      { name: leaf.name, path: leaf.path ?? "" },
      !!cfg.promptEditReadonlyPayload,
      trigger,
    );
  }

  async function patchLeafIcon(id: string, icon: string) {
    items = items.map((e) => {
      if (e.kind === cfg.leafKind && e.id === id) return { ...e, icon } as E;
      if (isLauncherFolder(e)) {
        const folder = e as LauncherFolder<L>;
        const children = folder.children.map((c) => (c.id === id ? { ...c, icon } : c));
        if (children.some((c, i) => c !== folder.children[i])) {
          return { ...folder, children } as E;
        }
      }
      return e;
    }) as E[];
    cfg.ref.current = items;
    cfg.save(items);
    repaint();
  }

  function queueIconFetch(leaf: L, payload: string) {
    if (leaf.icon || pendingIcons.has(leaf.id)) return;
    pendingIcons.add(leaf.id);
    void (async () => {
      try {
        const icon = await cfg.cacheIcon(leaf.id, payload);
        if (!icon) {
          if (cfg.payloadKey === "url" && !isTauri()) {
            applyWebFallback({ ...leaf, [cfg.payloadKey]: payload } as L);
            repaint();
          }
          return;
        }
        const exists = flattenLauncherLeaves(items, cfg.leafKind).some((l) => l.id === leaf.id);
        if (!exists) return;
        await rememberIcon({ ...leaf, [cfg.payloadKey]: payload, icon } as L, icon);
        await patchLeafIcon(leaf.id, icon);
      } finally {
        pendingIcons.delete(leaf.id);
      }
    })();
  }

  async function addAtSlot(slot: number, trigger: HTMLElement): Promise<E[] | null> {
    let initialPayload = "";
    if (cfg.pickPayload) {
      const picked = await cfg.pickPayload();
      if (!picked) return null;
      initialPayload = picked;
    }
    const data = await promptAdd(trigger, initialPayload);
    if (!data) return null;
    const resolvedPayload = cfg.payloadKey === "url"
      ? normalizeUrl((data as { url: string }).url)
      : (data as { path: string }).path.trim();
    const id = crypto.randomUUID();
    const link = {
      kind: cfg.leafKind,
      id,
      name: data.name.trim(),
      [cfg.payloadKey]: resolvedPayload,
      slot,
    } as L;
    queueIconFetch(link, resolvedPayload);
    return [...items, { ...link, slot }] as E[];
  }

  function openFolder(folderId: string, trigger: HTMLElement) {
    const folder = getLauncherFolder(items, folderId);
    if (!folder) return;
    cfg.folderOverlay.open({
      title: folder.name,
      folderId,
      getItems: () => getLauncherFolder(items, folderId)?.children ?? [],
      gridClass: cfg.gridClass,
      renderTile: (item, editMode) =>
        renderTile(
          item,
          item ? tileAttrs(item as L, cfg.leafKind, cfg.payloadKey) : {},
          LBL_ADD,
          editMode,
          false,
          item ? iconSrcCache.get(item.id) : undefined,
        ),
      onActivate: (item) => cfg.onActivateLeaf(item as L),
      onAdd: async (addTrigger) => {
        let initialPayload = "";
        if (cfg.pickPayload) {
          const picked = await cfg.pickPayload();
          if (!picked) return null;
          initialPayload = picked;
        }
        const data = await promptAdd(addTrigger, initialPayload);
        if (!data) return null;
        const resolvedPayload = cfg.payloadKey === "url"
          ? normalizeUrl((data as { url: string }).url)
          : (data as { path: string }).path.trim();
        const id = crypto.randomUUID();
        const link = {
          kind: cfg.leafKind,
          id,
          name: data.name.trim(),
          [cfg.payloadKey]: resolvedPayload,
        } as unknown as L;
        items = items.map((e) =>
          e.id === folderId && isLauncherFolder(e)
            ? { ...e, children: [...(e as LauncherFolder<L>).children, link] }
            : e,
        ) as E[];
        cfg.ref.current = items;
        cfg.save(items);
        repaint();
        queueIconFetch(link, resolvedPayload);
        return getLauncherFolder(items, folderId)?.children ?? null;
      },
      onRenameTitle: (name) => {
        items = updateFolderName(items, folderId, name) as E[];
        cfg.ref.current = items;
        cfg.save(items);
        repaint();
      },
      onEdit: async (item, editTrigger) => {
        const leaf = item as L;
        const data = await promptEdit(leaf, editTrigger);
        if (!data) return null;
        const resolvedPayload = cfg.payloadKey === "url"
          ? normalizeUrl((data as { url: string }).url)
          : (data as { path: string }).path.trim();
        items = cfg.updateLeafInFolder(folderId, leaf.id, data.name, resolvedPayload);
        cfg.ref.current = items;
        return getLauncherFolder(items, folderId)?.children ?? null;
      },
      confirmDelete: (_id, name, delTrigger) => cfg.confirmDelete(name, delTrigger),
      onReorder: (fid, children) => {
        items = reorderFolderChildren(
          items,
          fid,
          children.map((c) => c.id),
        ) as E[];
        items = dissolveRootFolders(items) as E[];
        cfg.ref.current = items;
        cfg.save(items);
        if (!getLauncherFolder(items, fid)) {
          void cfg.folderOverlay.close();
          repaintFlip();
          return;
        }
        repaint();
        cfg.folderOverlay.repaint();
      },
      onMoveOut: (fid, itemId) => {
        items = moveToRoot(items, itemId, fid) as E[];
        cfg.ref.current = items;
        cfg.save(items);
        repaintFlip();
      },
    }, trigger);
  }

  async function syncMissingIcons(repaintFn: () => void) {
    if (cfg.payloadKey === "path" && !isTauri()) return;
    let needsRepaint = false;
    const leaves = flattenLauncherLeaves(items, cfg.leafKind);
    for (const leaf of leaves) {
      if (leaf.icon) {
        if (!iconSrcCache.has(leaf.id)) {
          await rememberIcon(leaf, leaf.icon);
          needsRepaint = true;
        }
        continue;
      }
      if (cfg.payloadKey === "url" && !isTauri()) {
        applyWebFallback(leaf);
        needsRepaint = true;
        continue;
      }
      queueIconFetch(leaf, payloadOf(leaf, cfg.payloadKey));
    }
    if (needsRepaint) repaintFn();
  }

  const grid = bindTileGrid(
    cfg.gridEl,
    () => items,
    (next) => {
      const oldLeaves = new Set(flattenLauncherLeaves(items, cfg.leafKind).map((l) => l.id));
      const newLeaves = new Set(flattenLauncherLeaves(next as E[], cfg.leafKind).map((l) => l.id));
      oldLeaves.forEach((id) => {
        if (!newLeaves.has(id)) {
          pendingIcons.delete(id);
          const leaf = flattenLauncherLeaves(items, cfg.leafKind).find((x) => x.id === id);
          if (leaf?.icon) void cfg.deleteIcon(leaf.icon);
          iconSrcCache.delete(id);
        }
      });
      items = next as E[];
      cfg.ref.current = items;
      cfg.save(items);
    },
    (item, editMode, _draggable, slot) => renderLauncherTile(item as E | null, editMode, slot),
    (item, trigger) => {
      if (isLauncherFolder(item)) openFolder(item.id, trigger);
      else void cfg.onActivateLeaf(item as L);
    },
    async (trigger, slot) => addAtSlot(slot, trigger),
    async (item, trigger) => {
      if (isLauncherFolder(item)) return null;
      const leaf = item as L;
      const data = await promptEdit(leaf, trigger);
      if (!data) return null;
      const resolvedPayload = cfg.payloadKey === "url"
        ? normalizeUrl((data as { url: string }).url)
        : (data as { path: string }).path.trim();
      let icon = leaf.icon;
      if (resolvedPayload !== payloadOf(leaf, cfg.payloadKey)) {
        if (leaf.icon) void cfg.deleteIcon(leaf.icon);
        icon = undefined;
        iconSrcCache.delete(leaf.id);
      }
      const updatedLeaf = { ...leaf, name: data.name.trim(), [cfg.payloadKey]: resolvedPayload } as L;
      if (resolvedPayload !== payloadOf(leaf, cfg.payloadKey)) {
        queueIconFetch(updatedLeaf, resolvedPayload);
      } else if (icon) {
        await rememberIcon(updatedLeaf, icon);
      }
      return cfg.updateLeaf(leaf.id, data.name, resolvedPayload, icon);
    },
    async (_id, name, trigger) => (await cfg.confirmDelete(name, trigger)) ? true : false,
    undefined,
    {
      gridCapacity: cfg.capacity,
      isFolder: (item) => isLauncherFolder(item as E),
      onMoveToFolder: (sourceId, folderId) => {
        items = moveToFolder(items, sourceId, folderId, cfg.leafKind) as E[];
        cfg.ref.current = items;
        cfg.save(items);
      },
      onMerge: (sourceId, targetId) => {
        items = mergeIntoNewFolder(items, sourceId, targetId, cfg.leafKind) as E[];
        cfg.ref.current = items;
        cfg.save(items);
      },
      onRemove: (list, id) => removeEntry(list as E[], id) as E[],
      onRenameFolder: async (item, trigger) => {
        const name = await promptRenameFolder(item.name, trigger);
        if (!name?.trim() || name.trim() === item.name) return null;
        items = updateFolderName(items, item.id, name.trim()) as E[];
        cfg.ref.current = items;
        cfg.save(items);
        return items;
      },
    },
  );

  const repaintBase = grid.paint;
  const repaintFlip = grid.paintWithFlip;
  const repaint = () => {
    cfg.addBtn.disabled = firstEmptySlot(items, cfg.capacity()) === null;
    repaintBase();
  };

  cfg.addBtn.addEventListener("click", async (e) => {
    const slot = firstEmptySlot(items, cfg.capacity());
    if (slot === null) return;
    const next = await addAtSlot(slot, e.currentTarget as HTMLElement);
    if (!next) return;
    items = next;
    cfg.ref.current = items;
    cfg.save(items);
    repaintFlip();
  });

  return {
    repaint,
    normalizeOnPrefsChange: () => {
      items = normalizeGridEntries(items, cfg.capacity()) as E[];
      cfg.ref.current = items;
      cfg.save(items);
      repaint();
    },
    syncMissingIcons,
  };
}

export function mountBookmarkLauncherGrid(
  cfg: Omit<
    LauncherGridConfig<BookmarkLink, BookmarkEntry>,
    "leafKind" | "payloadKey" | "onActivateLeaf" | "cacheIcon" | "deleteIcon"
  >,
) {
  return mountLauncherGrid<BookmarkLink, BookmarkEntry>({
    ...cfg,
    leafKind: "link",
    payloadKey: "url",
    onActivateLeaf: (leaf) => openUrl(leaf.url),
    cacheIcon: cacheFavicon,
    deleteIcon: deleteFavicon,
  });
}

export function mountAppLauncherGrid(
  cfg: Omit<
    LauncherGridConfig<AppLink, AppEntry>,
    "leafKind" | "payloadKey" | "onActivateLeaf" | "cacheIcon" | "deleteIcon" | "pickPayload" | "promptEditReadonlyPayload"
  >,
) {
  return mountLauncherGrid<AppLink, AppEntry>({
    ...cfg,
    leafKind: "app",
    payloadKey: "path",
    onActivateLeaf: (leaf) => launchApp(leaf.path),
    cacheIcon: cacheAppIcon,
    deleteIcon: deleteAppIcon,
    pickPayload: pickAppFile,
    promptEditReadonlyPayload: true,
  });
}
