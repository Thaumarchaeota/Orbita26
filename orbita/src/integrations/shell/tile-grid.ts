import { buildGridSlots } from "./grid-slots";

export function displaySlots<T extends { id: string; slot?: number }>(
  items: T[],
  maxItems?: number,
): (T | null)[] {
  if (maxItems !== undefined) return buildGridSlots(items, maxItems);
  return [...items, null];
}

export type TileGridOptions<T extends { id: string; name: string }> = {
  gridCapacity?: () => number;
  isFolder?: (item: T) => boolean;
  onMoveToFolder?: (sourceId: string, folderId: string) => void;
  onMerge?: (sourceId: string, targetId: string) => void;
  onRemove?: (items: T[], id: string) => T[];
  dragOutPanel?: HTMLElement;
  onDragOutHover?: (active: boolean) => void;
  onMoveOut?: (sourceId: string) => void;
};

const DRAG_THRESHOLD = 4;
const ABSORB_DWELL_MS = 200;
const ZONE_IN = 0.38;
const ZONE_OUT = 0.33;
const FLIP_MS = 0.28;
const GHOST_SCALE = 1.04;

function tileEl(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement).closest<HTMLElement>(".launcher-tile");
}

function capturePositions(grid: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  grid.querySelectorAll<HTMLElement>(".launcher-tile[data-id]").forEach((el) => {
    if (el.dataset.id) map.set(el.dataset.id, el.getBoundingClientRect());
  });
  return map;
}

function flipAnimate(grid: HTMLElement, before: Map<string, DOMRect>) {
  grid.querySelectorAll<HTMLElement>(".launcher-tile[data-id]").forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    const prev = before.get(id);
    if (!prev) return;
    const next = el.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${FLIP_MS}s var(--spring)`;
      el.style.transform = "";
      const done = () => {
        el.style.transition = "";
        el.removeEventListener("transitionend", done);
      };
      el.addEventListener("transitionend", done);
    });
  });
}

function orderFromDom<T extends { id: string; slot?: number }>(grid: HTMLElement, items: T[]): T[] {
  const map = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  grid.querySelectorAll<HTMLElement>(".launcher-tile").forEach((el, index) => {
    if (!el.dataset.id) return;
    const item = map.get(el.dataset.id);
    if (item) result.push({ ...item, slot: index });
  });
  return result;
}

function tileAtPoint(x: number, y: number, grid: HTMLElement): HTMLElement | null {
  const direct = tileEl(document.elementFromPoint(x, y));
  if (direct && grid.contains(direct)) return direct;
  for (const tile of grid.querySelectorAll<HTMLElement>(".launcher-tile")) {
    const r = tile.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return tile;
  }
  return null;
}

function inAbsorbZone(tile: HTMLElement, x: number, y: number, latched: boolean): boolean {
  const r = tile.getBoundingClientRect();
  const lo = latched ? ZONE_OUT : ZONE_IN;
  const hi = latched ? 1 - ZONE_OUT : 1 - ZONE_IN;
  const relX = (x - r.left) / r.width;
  const relY = (y - r.top) / r.height;
  return relX > lo && relX < hi && relY > lo && relY < hi;
}

function readGridCols(grid: HTMLElement): number {
  const root = getComputedStyle(document.documentElement);
  if (grid.classList.contains("bookmarks-grid")) {
    const n = parseInt(root.getPropertyValue("--bookmarks-cols").trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (grid.classList.contains("apps-grid")) {
    const n = parseInt(root.getPropertyValue("--apps-cols").trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const tiles = grid.querySelectorAll<HTMLElement>(".launcher-tile");
  if (!tiles.length) return 1;
  const rowTop = tiles[0]!.offsetTop;
  let cols = 0;
  for (const t of tiles) {
    if (Math.abs(t.offsetTop - rowTop) > 2) break;
    cols++;
  }
  return Math.max(1, cols);
}

function slotFromPoint(grid: HTMLElement, x: number, y: number): number | null {
  const tiles = grid.querySelectorAll<HTMLElement>(".launcher-tile");
  if (!tiles.length) return null;
  const cell = tiles[0]!.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  const gapX = parseFloat(style.columnGap || style.gap) || 8;
  const gapY = parseFloat(style.rowGap || style.gap) || 8;
  const cols = readGridCols(grid);
  const stepX = cell.width + gapX;
  const stepY = cell.height + gapY;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((x - gridRect.left + stepX / 2) / stepX)));
  const row = Math.max(0, Math.floor((y - gridRect.top + stepY / 2) / stepY));
  const slot = row * cols + col;
  return slot < tiles.length ? slot : tiles.length - 1;
}

function outsidePanel(panel: HTMLElement, x: number, y: number): boolean {
  const r = panel.getBoundingClientRect();
  return x < r.left || x > r.right || y < r.top || y > r.bottom;
}

export function bindTileGrid<T extends { id: string; name: string; slot?: number }>(
  grid: HTMLElement,
  getItems: () => T[],
  setItems: (items: T[]) => void,
  render: (item: T | null, editMode: boolean, draggable: boolean, slot: number) => string,
  onActivate: (item: T, trigger: HTMLElement) => void | Promise<void>,
  onAdd: (trigger: HTMLElement, slot: number) => T[] | null | Promise<T[] | null>,
  onEdit: (item: T, trigger: HTMLElement) => T[] | null | Promise<T[] | null>,
  confirmDelete: (id: string, name: string, trigger: HTMLElement) => Promise<boolean>,
  maxItems?: number,
  options: TileGridOptions<T> = {},
) {
  const folderOps = !!(options.onMerge || options.onMoveToFolder);
  const fixedSlots = !!options.gridCapacity;

  let editMode = false;
  let pointerId: string | null = null;
  let pointerTile: HTMLElement | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerDragging = false;
  let suppressClick = false;
  let previewDirty = false;
  let lastHoverKey: string | null = null;
  let ghost: HTMLElement | null = null;
  let ghostOffsetX = 0;
  let ghostOffsetY = 0;
  let outsideFolder = false;
  let absorbTile: HTMLElement | null = null;
  let absorbTargetId: string | null = null;
  let absorbKind: "merge" | "into" | null = null;
  let absorbSince = 0;
  let absorbReady = false;
  let lastClientX = 0;
  let lastClientY = 0;
  let capturePointerId: number | null = null;

  const paint = () => {
    const items = getItems();
    const cap = options.gridCapacity?.() ?? maxItems;
    grid.classList.toggle("is-edit-mode", editMode);
    grid.innerHTML = displaySlots(items, cap)
      .map((item, slot) => render(item, editMode, !editMode && !!item, slot))
      .join("");
  };

  const paintWithFlip = () => {
    const before = capturePositions(grid);
    paint();
    requestAnimationFrame(() => flipAnimate(grid, before));
  };

  const exitEditMode = () => {
    if (!editMode) return;
    editMode = false;
    paint();
  };

  const clearAbsorbMarks = () => {
    grid.querySelectorAll(".is-drop-merge, .is-drop-into").forEach((el) => {
      el.classList.remove("is-drop-merge", "is-drop-into");
    });
    absorbTile = null;
    absorbTargetId = null;
    absorbKind = null;
    absorbSince = 0;
    absorbReady = false;
  };

  const setOutsideFolder = (active: boolean) => {
    if (active === outsideFolder) return;
    outsideFolder = active;
    options.onDragOutHover?.(active);
  };

  const removeGhost = () => {
    ghost?.remove();
    ghost = null;
    if (pointerTile) {
      pointerTile.classList.remove("is-drag-source", "is-dragging");
      pointerTile.style.visibility = "";
    }
  };

  const createGhost = (tile: HTMLElement, x: number, y: number) => {
    const rect = tile.getBoundingClientRect();
    ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("launcher-tile-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = "0";
    ghost.style.top = "0";
    ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(${GHOST_SCALE})`;
    ghost.style.transition = "none";
    document.body.appendChild(ghost);
    ghostOffsetX = x - rect.left;
    ghostOffsetY = y - rect.top;
    tile.classList.add("is-drag-source");
    tile.style.visibility = "hidden";
  };

  const moveGhost = (x: number, y: number) => {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${x - ghostOffsetX}px, ${y - ghostOffsetY}px, 0) scale(${GHOST_SCALE})`;
  };

  const previewMoveToSlot = (targetSlot: number) => {
    if (!pointerId || !pointerTile) return;
    const count = grid.children.length;
    if (targetSlot < 0 || targetSlot >= count) return;
    const current = Array.from(grid.children).indexOf(pointerTile);
    if (current === targetSlot) return;
    const ref = grid.children[targetSlot] as HTMLElement;
    if (!ref || ref === pointerTile) return;
    const before = capturePositions(grid);
    grid.insertBefore(pointerTile, ref);
    flipAnimate(grid, before);
    previewDirty = true;
  };

  const previewMoveTo = (hover: HTMLElement) => {
    if (!pointerId || !pointerTile || hover === pointerTile) return;
    if (pointerTile.nextElementSibling === hover) return;
    const before = capturePositions(grid);
    grid.insertBefore(pointerTile, hover);
    flipAnimate(grid, before);
    previewDirty = true;
  };

  const updateAbsorb = (x: number, y: number) => {
    if (!folderOps || !pointerId || !pointerTile) return false;

    const under = tileAtPoint(x, y, grid);
    if (!under || under === pointerTile || under.classList.contains("is-empty") || !under.dataset.id) {
      clearAbsorbMarks();
      return false;
    }

    const latched = absorbTile === under;
    if (!inAbsorbZone(under, x, y, latched)) {
      clearAbsorbMarks();
      return false;
    }

    const id = under.dataset.id!;
    const item = getItems().find((i) => i.id === id);
    const isFolder = (item && options.isFolder?.(item)) || under.dataset.kind === "folder";

    if (isFolder && options.onMoveToFolder) {
      if (absorbTile !== under) {
        clearAbsorbMarks();
        absorbTile = under;
        absorbTargetId = id;
        absorbKind = "into";
        absorbSince = Date.now();
      }
    } else if (!isFolder && options.onMerge) {
      const source = getItems().find((i) => i.id === pointerId);
      if (source && options.isFolder?.(source)) {
        clearAbsorbMarks();
        return false;
      }
      if (absorbTile !== under) {
        clearAbsorbMarks();
        absorbTile = under;
        absorbTargetId = id;
        absorbKind = "merge";
        absorbSince = Date.now();
      }
    } else {
      clearAbsorbMarks();
      return false;
    }

    const show = Date.now() - absorbSince >= ABSORB_DWELL_MS;
    absorbReady = show;
    under.classList.toggle("is-drop-into", absorbKind === "into" && show);
    under.classList.toggle("is-drop-merge", absorbKind === "merge" && show);
    return true;
  };

  const resetTileTransforms = () => {
    grid.querySelectorAll<HTMLElement>(".launcher-tile").forEach((el) => {
      el.style.transition = "";
      el.style.transform = "";
    });
  };

  const detachDocDrag = () => {
    document.removeEventListener("pointermove", onDocPointerMove);
    document.removeEventListener("pointerup", onDocPointerUp);
    document.removeEventListener("pointercancel", onDocPointerCancel);
  };

  const onDocPointerCancel = (e: PointerEvent) => {
    if (!pointerId) return;
    detachDocDrag();
    finishPointer(e, false);
  };

  const onDocPointerMove = (e: PointerEvent) => {
    if (!pointerId || !pointerTile) return;
    if (!pointerDragging) {
      const dx = e.clientX - pointerStartX;
      const dy = e.clientY - pointerStartY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      pointerDragging = true;
      grid.classList.add("is-reordering");
      pointerTile.classList.add("is-dragging");
      createGhost(pointerTile, e.clientX, e.clientY);
    }
    moveGhost(e.clientX, e.clientY);
    onPointerMove(e.clientX, e.clientY);
  };

  const onDocPointerUp = (e: PointerEvent) => {
    if (!pointerId) return;
    detachDocDrag();
    finishPointer(e, true);
  };

  const onPointerMove = (x: number, y: number) => {
    lastClientX = x;
    lastClientY = y;
    if (options.dragOutPanel) {
      setOutsideFolder(outsidePanel(options.dragOutPanel, x, y));
    }

    if (updateAbsorb(x, y)) {
      lastHoverKey = null;
      return;
    }

    if (fixedSlots) {
      const slot = slotFromPoint(grid, x, y);
      if (slot === null) {
        lastHoverKey = null;
        return;
      }
      const key = `slot_${slot}`;
      if (key === lastHoverKey) return;
      lastHoverKey = key;
      previewMoveToSlot(slot);
      return;
    }

    const hover = tileAtPoint(x, y, grid);
    if (!hover || hover === pointerTile) {
      lastHoverKey = null;
      return;
    }

    const hoverKey = hover.classList.contains("is-empty")
      ? `__empty_${Array.from(grid.children).indexOf(hover)}`
      : (hover.dataset.id ?? "");
    if (hoverKey === lastHoverKey) return;
    lastHoverKey = hoverKey;
    previewMoveTo(hover);
  };

  const finishPointer = (e: PointerEvent | undefined, commit: boolean) => {
    detachDocDrag();
    pointerTile?.classList.remove("is-dragging", "is-drag-source");
    grid.classList.remove("is-reordering");
    if (capturePointerId !== null && pointerTile?.hasPointerCapture(capturePointerId)) {
      pointerTile.releasePointerCapture(capturePointerId);
    }

    const sourceId = pointerId;
    const wasDragging = pointerDragging;
    const targetId = absorbTargetId;
    const kind = absorbKind;
    const absorbEl = absorbTile;
    const wasAbsorbReady = absorbReady;
    const leftFolder = outsideFolder;
    const upX = e?.clientX ?? lastClientX;
    const upY = e?.clientY ?? lastClientY;
    const inZone = absorbEl && inAbsorbZone(absorbEl, upX, upY, true);
    const shouldAbsorb = !!(targetId && kind && (inZone || wasAbsorbReady));

    clearAbsorbMarks();
    resetTileTransforms();
    removeGhost();
    setOutsideFolder(false);

    if (wasDragging) suppressClick = true;

    if (wasDragging && commit && sourceId) {
      if (options.onMoveOut && leftFolder && options.dragOutPanel) {
        options.onMoveOut(sourceId);
      } else if (shouldAbsorb && kind === "into" && options.onMoveToFolder) {
        options.onMoveToFolder(sourceId, targetId);
        paint();
      } else if (shouldAbsorb && kind === "merge" && options.onMerge) {
        options.onMerge(sourceId, targetId);
        paint();
      } else if (previewDirty) {
        const next = orderFromDom(grid, getItems());
        const prevSlots = new Map(getItems().map((i) => [i.id, i.slot]));
        const changed =
          next.length !== getItems().length ||
          next.some((item) => item.slot !== prevSlots.get(item.id));
        if (changed) setItems(next);
        else paint();
      } else {
        paint();
      }
    } else if (wasDragging && previewDirty) {
      paint();
    }

    pointerId = null;
    pointerTile = null;
    pointerDragging = false;
    previewDirty = false;
    lastHoverKey = null;
    outsideFolder = false;
    capturePointerId = null;
  };

  paint();

  grid.addEventListener("pointerdown", (e) => {
    if (editMode || e.button !== 0) return;
    const tile = tileEl(e.target);
    if (!tile || tile.classList.contains("is-empty") || !tile.dataset.id) return;
    suppressClick = false;
    pointerId = tile.dataset.id;
    pointerTile = tile;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    pointerDragging = false;
    previewDirty = false;
    lastHoverKey = null;
    outsideFolder = false;
    capturePointerId = null;
    clearAbsorbMarks();
    capturePointerId = e.pointerId;
    tile.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", onDocPointerMove);
    document.addEventListener("pointerup", onDocPointerUp);
    document.addEventListener("pointercancel", onDocPointerCancel);
  });

  grid.addEventListener("click", async (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const deleteBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      const tile = deleteBtn.closest<HTMLElement>(".launcher-tile");
      if (!tile?.dataset.id) return;
      const item = getItems().find((i) => i.id === tile.dataset.id);
      if (!item) return;
      if (await confirmDelete(item.id, item.name, deleteBtn)) {
        const next = options.onRemove
          ? options.onRemove(getItems(), item.id)
          : getItems().filter((i) => i.id !== item.id);
        setItems(next);
      }
      editMode = false;
      paint();
      return;
    }

    const editFolderBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="edit-folder"]');
    if (editFolderBtn) {
      e.stopPropagation();
      const tile = editFolderBtn.closest<HTMLElement>(".launcher-tile");
      if (!tile?.dataset.id) return;
      const item = getItems().find((i) => i.id === tile.dataset.id);
      if (!item) return;
      const name = window.prompt("文件夹名称", item.name);
      if (name?.trim()) setItems(getItems().map((i) => (i.id === item.id ? { ...i, name: name.trim() } : i)));
      paint();
      return;
    }

    const editBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="edit"]');
    if (editBtn) {
      e.stopPropagation();
      const tile = editBtn.closest<HTMLElement>(".launcher-tile");
      if (!tile?.dataset.id) return;
      const item = getItems().find((i) => i.id === tile.dataset.id);
      if (!item) return;
      const next = await Promise.resolve(onEdit(item, editBtn));
      if (next) setItems(next);
      paint();
      return;
    }

    const tile = tileEl(e.target);
    if (!tile) return;
    if (editMode) return;
    if (tile.classList.contains("is-empty")) {
      const slot = Number(tile.dataset.slot ?? 0);
      const next = await Promise.resolve(onAdd(tile, slot));
      if (!next) return;
      setItems(next);
      paintWithFlip();
      return;
    }
    const item = getItems().find((i) => i.id === tile.dataset.id);
    if (item) await onActivate(item, tile);
  });

  grid.addEventListener("contextmenu", (e) => {
    const tile = tileEl(e.target);
    if (!tile || tile.classList.contains("is-empty")) return;
    e.preventDefault();
    editMode = true;
    paint();
  });

  document.addEventListener("click", (e) => {
    if (!editMode) return;
    if (grid.contains(e.target as Node)) return;
    exitEditMode();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") exitEditMode();
  });

  return { paint, paintWithFlip };
}
