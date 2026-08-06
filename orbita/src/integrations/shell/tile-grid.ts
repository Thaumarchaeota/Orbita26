import {
  capturePositions,
  flipElements,
  DRAG_THRESHOLD,
  createPointerGhost,
  movePointerGhost,
  animatePopIn,
} from "../../ui/pointer-drag";
import { inAbsorbZone, isAppendZone, outsidePanel, tileAtPoint, tileEl } from "./tile-grid-hit";
import type { TileGridDragHandoff, TileGridOptions } from "./tile-grid-types";

export type { TileGridDragHandoff, TileGridOptions } from "./tile-grid-types";

const GHOST_SCALE = 1;
const FLIP_DRAG_SEC = 0.22;
const REORDER_DWELL_MS = 20;
const ABSORB_DWELL_MS = 200;

function captureTilePositions(grid: HTMLElement): Map<string, DOMRect> {
  return capturePositions(grid, ".launcher-tile[data-id]");
}

function flipAnimate(grid: HTMLElement, before: Map<string, DOMRect>) {
  flipElements(grid, before, ".launcher-tile[data-id]", "data-id", FLIP_DRAG_SEC);
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

export function bindTileGrid<T extends { id: string; name: string; slot?: number }>(
  grid: HTMLElement,
  getItems: () => T[],
  setItems: (items: T[]) => void,
  render: (item: T | null, editMode: boolean, draggable: boolean, slot: number) => string,
  onActivate: (item: T, trigger: HTMLElement) => void | Promise<void>,
  onAdd: (trigger: HTMLElement, slot: number) => T[] | null | Promise<T[] | null>,
  onEdit: (item: T, trigger: HTMLElement) => T[] | null | Promise<T[] | null>,
  confirmDelete: (id: string, name: string, trigger: HTMLElement) => Promise<boolean>,
  _maxItems?: number,
  options: TileGridOptions<T> = {},
) {
  const denseItems = !!options.denseItems;
  const folderOps = !!(options.onMerge || options.onMoveToFolder);

  let editMode = false;
  let pointerId: string | null = null;
  let pointerTile: HTMLElement | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerDragging = false;
  let suppressClick = false;
  let previewDirty = false;
  let lastHoverKey: string | null = null;
  let pendingHoverKey: string | null = null;
  let hoverSince = 0;
  let ghost: HTMLElement | null = null;
  let ghostOffsetX = 0;
  let ghostOffsetY = 0;
  let ghostHalfW = 0;
  let ghostHalfH = 0;
  let outsideFolder = false;
  let capturePointerId: number | null = null;
  let absorbTile: HTMLElement | null = null;
  let absorbTargetId: string | null = null;
  let absorbKind: "merge" | "into" | null = null;
  let absorbSince = 0;
  let absorbReady = false;
  let lastClientX = 0;
  let lastClientY = 0;
  let handedOff = false;
  let handoffAttempted = false;
  let externalDrag = false;

  const paint = () => {
    const items = getItems();
    grid.classList.toggle("is-edit-mode", editMode);
    if (denseItems) {
      const sorted = [...items].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
      grid.innerHTML = sorted
        .map((item, index) => render(item, editMode, !editMode, index))
        .join("");
    } else {
      grid.innerHTML = [...items, null]
        .map((item, slot) => render(item, editMode, !editMode && !!item, slot))
        .join("");
    }
  };

  const paintWithFlip = () => {
    const before = captureTilePositions(grid);
    paint();
    requestAnimationFrame(() => flipAnimate(grid, before));
  };

  const paintItemChange = () => {
    if (editMode) paint();
    else paintWithFlip();
  };

  const exitEditMode = () => {
    if (!editMode) return;
    editMode = false;
    paint();
  };

  const setOutsideFolder = (active: boolean) => {
    if (active === outsideFolder) return;
    outsideFolder = active;
    options.onDragOutHover?.(active);
  };

  const clearAbsorb = () => {
    grid.querySelectorAll(".is-drop-merge, .is-drop-into").forEach((el) => {
      el.classList.remove("is-drop-merge", "is-drop-into");
    });
    absorbTile = null;
    absorbTargetId = null;
    absorbKind = null;
    absorbSince = 0;
    absorbReady = false;
  };

  const updateAbsorb = (x: number, y: number): boolean => {
    if (!folderOps || !pointerId || !pointerTile) return false;

    const under = tileAtPoint(x, y, grid, pointerTile);
    if (!under || under.classList.contains("is-empty") || !under.dataset.id) {
      clearAbsorb();
      return false;
    }

    const latched = absorbTile === under;
    if (!inAbsorbZone(under, x, y, latched)) {
      clearAbsorb();
      return false;
    }

    const id = under.dataset.id!;
    const item = getItems().find((i) => i.id === id);
    const isFolder = (item && options.isFolder?.(item)) || under.dataset.kind === "folder";

    if (isFolder && options.onMoveToFolder) {
      if (absorbTile !== under) {
        clearAbsorb();
        absorbTile = under;
        absorbTargetId = id;
        absorbKind = "into";
        absorbSince = Date.now();
      }
    } else if (!isFolder && options.onMerge) {
      const source = getItems().find((i) => i.id === pointerId);
      if (source && options.isFolder?.(source)) {
        clearAbsorb();
        return false;
      }
      if (absorbTile !== under) {
        clearAbsorb();
        absorbTile = under;
        absorbTargetId = id;
        absorbKind = "merge";
        absorbSince = Date.now();
      }
    } else {
      clearAbsorb();
      return false;
    }

    absorbReady = Date.now() - absorbSince >= ABSORB_DWELL_MS;
    under.classList.toggle("is-drop-into", absorbKind === "into");
    under.classList.toggle("is-drop-merge", absorbKind === "merge");
    return true;
  };

  const hitPoint = (x: number, y: number) => {
    if (!ghost) return { x, y };
    return { x: x - ghostOffsetX + ghostHalfW, y: y - ghostOffsetY + ghostHalfH };
  };

  const slotFromDom = (sourceId: string | null) => {
    if (!sourceId) return 0;
    let slot = 0;
    for (const el of grid.querySelectorAll<HTMLElement>(".launcher-tile[data-id]")) {
      if (el.dataset.id === sourceId) return slot;
      slot += 1;
    }
    return slot;
  };

  const releaseDragForHandoff = () => {
    if (!pointerId || !pointerDragging) return;
    const capId = capturePointerId;
    const tile = pointerTile;
    detachDocDrag();
    if (capId !== null && tile?.hasPointerCapture(capId)) {
      try {
        tile.releasePointerCapture(capId);
      } catch {
        /* ignore */
      }
    }
    tile?.classList.remove("is-dragging", "is-drag-source");
    grid.classList.remove("is-reordering");
    clearAbsorb();
    setOutsideFolder(false);
    ghost = null;
    pointerId = null;
    pointerTile = null;
    pointerDragging = false;
    previewDirty = false;
    lastHoverKey = null;
    pendingHoverKey = null;
    outsideFolder = false;
    capturePointerId = null;
    handedOff = true;
  };

  const acceptDragHandoff = (h: TileGridDragHandoff): boolean => {
    if (pointerId || editMode) return false;

    let tile: HTMLElement | null = null;
    externalDrag = !!h.external;
    if (h.external && h.placeholderHtml) {
      const wrap = document.createElement("div");
      wrap.innerHTML = h.placeholderHtml.trim();
      tile = wrap.querySelector<HTMLElement>(".launcher-tile");
      if (!tile) return false;
      tile.classList.add("is-drag-placeholder");
      grid.appendChild(tile);
      previewDirty = true;
    } else {
      paint();
      tile = grid.querySelector<HTMLElement>(`.launcher-tile[data-id="${h.sourceId}"]`);
      if (!tile) return false;
    }

    pointerId = h.sourceId;
    pointerTile = tile;
    pointerDragging = true;
    ghost = h.ghost;
    ghostOffsetX = h.ghostOffsetX;
    ghostOffsetY = h.ghostOffsetY;
    ghostHalfW = h.ghostHalfW;
    ghostHalfH = h.ghostHalfH;
    capturePointerId = h.capturePointerId;
    previewDirty = h.external ? true : false;
    lastHoverKey = null;
    pendingHoverKey = null;
    outsideFolder = false;
    handedOff = false;

    grid.classList.add("is-reordering");
    tile.classList.add("is-dragging", "is-drag-source");
    tile.style.visibility = "hidden";
    moveGhost(h.clientX, h.clientY);
    document.addEventListener("pointermove", onDocPointerMove, true);
    document.addEventListener("pointerup", onDocPointerUp, true);
    document.addEventListener("pointercancel", onDocPointerCancel, true);
    try {
      document.body.setPointerCapture(h.capturePointerId);
    } catch {
      /* ignore */
    }
    onPointerMove(h.clientX, h.clientY);
    return true;
  };

  const removeGhost = () => {
    ghost?.remove();
    ghost = null;
    ghostHalfW = 0;
    ghostHalfH = 0;
    if (pointerTile) {
      pointerTile.classList.remove("is-drag-source", "is-dragging");
      pointerTile.style.visibility = "";
    }
  };

  const createGhost = (tile: HTMLElement, x: number, y: number) => {
    const rect = tile.getBoundingClientRect();
    const extra: string[] = [];
    if (grid.classList.contains("bookmarks-grid")) extra.push("from-bookmarks");
    else if (grid.classList.contains("apps-grid")) extra.push("from-apps");
    const { ghost: g } = createPointerGhost(tile, "launcher-tile-ghost", extra, GHOST_SCALE);
    ghost = g;
    ghostOffsetX = x - rect.left;
    ghostOffsetY = y - rect.top;
    ghostHalfW = rect.width / 2;
    ghostHalfH = rect.height / 2;
    tile.classList.add("is-drag-source");
    tile.style.visibility = "hidden";
  };

  const moveGhost = (x: number, y: number) => {
    if (!ghost) return;
    movePointerGhost(ghost, x, y, ghostOffsetX, ghostOffsetY, GHOST_SCALE);
  };

  const previewMoveTo = (hover: HTMLElement) => {
    if (!pointerId || !pointerTile || hover === pointerTile) return;
    if (pointerTile.nextElementSibling === hover) return;
    const before = captureTilePositions(grid);
    grid.insertBefore(pointerTile, hover);
    flipAnimate(grid, before);
    previewDirty = true;
  };

  const previewMoveAfter = (hover: HTMLElement) => {
    if (!pointerTile || hover === pointerTile) return;
    const next = hover.nextElementSibling;
    if (next === pointerTile) return;
    const before = captureTilePositions(grid);
    if (next) grid.insertBefore(pointerTile, next);
    else grid.appendChild(pointerTile);
    flipAnimate(grid, before);
    previewDirty = true;
  };

  const previewMoveToEnd = () => {
    if (!pointerTile) return;
    const trailing = grid.querySelector<HTMLElement>(".launcher-tile.is-empty:last-child");
    if (trailing && trailing !== pointerTile) {
      if (pointerTile.nextElementSibling === trailing) return;
      const before = captureTilePositions(grid);
      grid.insertBefore(pointerTile, trailing);
      flipAnimate(grid, before);
      previewDirty = true;
      return;
    }
    if (grid.lastElementChild === pointerTile) return;
    const before = captureTilePositions(grid);
    grid.appendChild(pointerTile);
    flipAnimate(grid, before);
    previewDirty = true;
  };

  const resetTileTransforms = () => {
    grid.querySelectorAll<HTMLElement>(".launcher-tile").forEach((el) => {
      el.style.transition = "";
      el.style.transform = "";
    });
  };

  const detachDocDrag = () => {
    document.removeEventListener("pointermove", onDocPointerMove, true);
    document.removeEventListener("pointerup", onDocPointerUp, true);
    document.removeEventListener("pointercancel", onDocPointerCancel, true);
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
    const { x: hx, y: hy } = hitPoint(x, y);

    if (options.dragOutPanel) {
      const outside = outsidePanel(options.dragOutPanel, hx, hy);
      if (outside && pointerDragging && !handedOff && !handoffAttempted && options.onDragOutLeave && pointerId && ghost) {
        handoffAttempted = true;
        const payload: TileGridDragHandoff = {
          sourceId: pointerId,
          ghost,
          ghostOffsetX,
          ghostOffsetY,
          ghostHalfW,
          ghostHalfH,
          clientX: x,
          clientY: y,
          capturePointerId: capturePointerId ?? 0,
        };
        if (options.onDragOutLeave(payload.sourceId, payload)) {
          releaseDragForHandoff();
          return;
        }
        handoffAttempted = false;
      }
      setOutsideFolder(outside);
      if (!outside) handoffAttempted = false;
    }

    if (updateAbsorb(hx, hy)) {
      pendingHoverKey = null;
      lastHoverKey = null;
      return;
    }

    const hover = tileAtPoint(hx, hy, grid, pointerTile);
    let hoverKey: string | null = null;
    let apply: (() => void) | null = null;

    if (hover && hover !== pointerTile) {
      if (hover.classList.contains("is-empty")) {
        hoverKey = "__append__";
        apply = previewMoveToEnd;
      } else {
        const r = hover.getBoundingClientRect();
        const after = hx > r.left + r.width * 0.5;
        hoverKey = `${hover.dataset.id ?? ""}:${after ? "r" : "l"}`;
        const h = hover;
        apply = () => (after ? previewMoveAfter(h) : previewMoveTo(h));
      }
    } else if (isAppendZone(hx, hy, grid, pointerTile)) {
      hoverKey = "__append__";
      apply = previewMoveToEnd;
    }

    if (!hoverKey || !apply) {
      pendingHoverKey = null;
      return;
    }
    if (hoverKey === lastHoverKey) return;
    if (hoverKey !== pendingHoverKey) {
      pendingHoverKey = hoverKey;
      hoverSince = Date.now();
      return;
    }
    if (Date.now() - hoverSince < REORDER_DWELL_MS) return;
    lastHoverKey = hoverKey;
    apply();
  };

  const finishPointer = (e: PointerEvent | undefined, commit: boolean) => {
    if (handedOff) {
      handedOff = false;
      return;
    }
    detachDocDrag();
    const tile = pointerTile;
    const capId = capturePointerId;
    tile?.classList.remove("is-dragging", "is-drag-source");
    grid.classList.remove("is-reordering");
    if (capId !== null) {
      try {
        if (document.body.hasPointerCapture(capId)) document.body.releasePointerCapture(capId);
        else if (tile?.hasPointerCapture(capId)) tile.releasePointerCapture(capId);
      } catch {
        /* ignore */
      }
    }

    const sourceId = pointerId;
    const wasDragging = pointerDragging;
    const leftFolder = outsideFolder;
    const upX = e?.clientX ?? lastClientX;
    const upY = e?.clientY ?? lastClientY;
    const { x: hx, y: hy } = hitPoint(upX, upY);
    const targetId = absorbTargetId;
    const kind = absorbKind;
    const absorbEl = absorbTile;
    const wasAbsorbReady = absorbReady;
    const inZone = absorbEl && inAbsorbZone(absorbEl, hx, hy, true);
    const shouldAbsorb = !!(targetId && kind && (inZone || wasAbsorbReady));

    clearAbsorb();
    resetTileTransforms();
    removeGhost();
    setOutsideFolder(false);

    if (wasDragging) suppressClick = true;

    if (wasDragging && externalDrag && sourceId) {
      const slot = slotFromDom(sourceId);
      if (commit && options.onExternalCommit) {
        const absorb = shouldAbsorb && targetId && kind ? { kind, targetId } : undefined;
        options.onExternalCommit(sourceId, slot, absorb);
      } else if (!commit && options.onExternalCancel) {
        options.onExternalCancel(sourceId);
      }
      pointerTile?.remove();
      externalDrag = false;
    } else if (wasDragging && commit && sourceId) {
      if (options.onMoveOut && leftFolder && options.dragOutPanel) {
        options.onMoveOut(sourceId);
      } else if (shouldAbsorb && kind === "into" && options.onMoveToFolder) {
        options.onMoveToFolder(sourceId, targetId);
        paintItemChange();
      } else if (shouldAbsorb && kind === "merge" && options.onMerge) {
        const targetRect = absorbEl?.getBoundingClientRect();
        const before = captureTilePositions(grid);
        const folderId = options.onMerge(sourceId, targetId!);
        paint();
        requestAnimationFrame(() => {
          flipAnimate(grid, before);
          if (folderId && targetRect) {
            const folderEl = grid.querySelector<HTMLElement>(`.launcher-tile[data-id="${folderId}"]`);
            if (folderEl) animatePopIn(folderEl, targetRect);
          }
        });
      } else if (previewDirty) {
        const next = orderFromDom(grid, getItems());
        const prevSlots = new Map(getItems().map((i) => [i.id, i.slot]));
        const changed = next.some((item) => item.slot !== prevSlots.get(item.id));
        if (changed) setItems(next);
      }
    } else if (wasDragging && previewDirty) {
      paint();
    }

    pointerId = null;
    pointerTile = null;
    pointerDragging = false;
    previewDirty = false;
    lastHoverKey = null;
    pendingHoverKey = null;
    outsideFolder = false;
    capturePointerId = null;
    handoffAttempted = false;
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
    pendingHoverKey = null;
    outsideFolder = false;
    handedOff = false;
    handoffAttempted = false;
    clearAbsorb();
    capturePointerId = e.pointerId;
    tile.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", onDocPointerMove, true);
    document.addEventListener("pointerup", onDocPointerUp, true);
    document.addEventListener("pointercancel", onDocPointerCancel, true);
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
      paintItemChange();
      return;
    }

    const editFolderBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="edit-folder"]');
    if (editFolderBtn) {
      e.stopPropagation();
      const tile = editFolderBtn.closest<HTMLElement>(".launcher-tile");
      if (!tile?.dataset.id) return;
      const item = getItems().find((i) => i.id === tile.dataset.id);
      if (!item || !options.onRenameFolder) return;
      const next = await Promise.resolve(options.onRenameFolder(item, editFolderBtn));
      if (next) setItems(next);
      paintItemChange();
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
      paintItemChange();
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

  return { paint, paintWithFlip, acceptDragHandoff };
}
