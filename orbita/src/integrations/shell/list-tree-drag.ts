import type { LocalDropPosition } from "./local-tree";

const DRAG_THRESHOLD = 5;
const INTO_DWELL_MS = 320;
const ZONE_BEFORE = 0.28;
const ZONE_AFTER = 0.72;
const LEAF_SPLIT = 0.5;

function rowEl(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement).closest<HTMLElement>(".local-tree-row[data-id]");
}

function groupEl(row: HTMLElement): HTMLElement | null {
  return row.closest<HTMLElement>(".local-tree-group");
}

function rowAtPoint(x: number, y: number, root: HTMLElement, skip?: HTMLElement | null): HTMLElement | null {
  const direct = rowEl(document.elementFromPoint(x, y));
  if (direct && root.contains(direct) && direct !== skip) return direct;
  for (const row of root.querySelectorAll<HTMLElement>(".local-tree-row[data-id]")) {
    if (row === skip) continue;
    const r = row.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return row;
  }
  for (const slot of root.querySelectorAll<HTMLElement>(".local-tree-after-slot")) {
    const r = slot.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const id = slot.dataset.targetId;
      if (!id) continue;
      const row = root.querySelector<HTMLElement>(`.local-tree-row[data-id="${id}"]`);
      if (row && row !== skip) return row;
    }
  }
  return null;
}

export function bindListTreeDrag(
  container: HTMLElement,
  onMove: (sourceId: string, targetId: string | null, position: LocalDropPosition) => void,
) {
  let pointerId: string | null = null;
  let pointerRow: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let ghostOX = 0;
  let ghostOY = 0;
  let hoverId: string | null = null;
  let hoverSince = 0;
  let dropPos: LocalDropPosition = "after";
  let capturePointerId: number | null = null;

  const clearMarks = () => {
    container
      .querySelectorAll(".is-drop-before, .is-drop-into, .is-active")
      .forEach((el) => el.classList.remove("is-drop-before", "is-drop-into", "is-active"));
  };

  const removeGhost = () => {
    ghost?.remove();
    ghost = null;
    if (pointerRow) {
      pointerRow.classList.remove("is-drag-source");
      pointerRow.style.visibility = "";
    }
  };

  const isAfterSlot = (x: number, y: number, row: HTMLElement) => {
    const id = row.dataset.id;
    if (!id) return false;
    const slot = container.querySelector<HTMLElement>(`.local-tree-after-slot[data-target-id="${id}"]`);
    if (!slot) return false;
    const r = slot.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const resolvePosition = (row: HTMLElement, x: number, y: number, isGroup: boolean): LocalDropPosition => {
    if (isAfterSlot(x, y, row)) {
      return "after";
    }
    const rect = row.getBoundingClientRect();
    const rel = (y - rect.top) / rect.height;
    const now = Date.now();
    const id = row.dataset.id!;
    if (hoverId !== id) {
      hoverId = id;
      hoverSince = now;
    }
    if (isGroup) {
      if (rel < ZONE_BEFORE) return "before";
      if (rel > ZONE_AFTER) return "after";
      if (now - hoverSince >= INTO_DWELL_MS) return "into";
      return rel < LEAF_SPLIT ? "before" : "after";
    }
    return rel < LEAF_SPLIT ? "before" : "after";
  };

  const markDrop = (row: HTMLElement, pos: LocalDropPosition) => {
    if (pos === "into") {
      groupEl(row)?.classList.add("is-drop-into");
      return;
    }
    if (pos === "before") {
      row.classList.add("is-drop-before");
      return;
    }
    const slot = container.querySelector<HTMLElement>(
      `.local-tree-after-slot[data-target-id="${row.dataset.id}"]`,
    );
    slot?.classList.add("is-active");
  };

  const detachDoc = () => {
    document.removeEventListener("pointermove", onDocMove);
    document.removeEventListener("pointerup", onDocUp);
    document.removeEventListener("pointercancel", onDocCancel);
  };

  const finish = (e: PointerEvent | undefined, commit: boolean) => {
    detachDoc();
    if (capturePointerId !== null && pointerRow?.hasPointerCapture(capturePointerId)) {
      pointerRow.releasePointerCapture(capturePointerId);
    }

    const sourceId = pointerId;
    const wasDragging = dragging;
    let targetId = hoverId;
    let pos = dropPos;

    if (wasDragging && commit && e) {
      const hover = rowAtPoint(e.clientX, e.clientY, container, pointerRow);
      if (hover?.dataset.id && hover.dataset.id !== sourceId) {
        targetId = hover.dataset.id;
        const isGroup = hover.dataset.kind === "group";
        pos = resolvePosition(hover, e.clientX, e.clientY, isGroup);
      }
    }

    pointerRow?.classList.remove("is-drag-source");
    container.classList.remove("is-dragging");
    clearMarks();
    removeGhost();

    if (wasDragging) {
      container.dataset.suppressRowClick = "1";
    }

    if (wasDragging && commit && sourceId && targetId && targetId !== sourceId) {
      onMove(sourceId, targetId, pos);
    }

    pointerId = null;
    pointerRow = null;
    dragging = false;
    hoverId = null;
    hoverSince = 0;
    capturePointerId = null;
  };

  const onDocCancel = (e: PointerEvent) => finish(e, false);

  const onDocUp = (e: PointerEvent) => finish(e, true);

  const startDrag = (e: PointerEvent) => {
    if (!pointerRow) return;
    dragging = true;
    const rect = pointerRow.getBoundingClientRect();
    ghost = pointerRow.cloneNode(true) as HTMLElement;
    ghost.classList.add("local-tree-row-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.position = "fixed";
    ghost.style.left = "0";
    ghost.style.top = "0";
    ghost.style.zIndex = "300";
    ghost.style.pointerEvents = "none";
    ghost.style.willChange = "transform";
    document.body.appendChild(ghost);
    ghostOX = e.clientX - rect.left;
    ghostOY = e.clientY - rect.top;
    ghost.style.transform = `translate3d(${e.clientX - ghostOX}px, ${e.clientY - ghostOY}px, 0)`;
    pointerRow.classList.add("is-drag-source");
    pointerRow.style.visibility = "hidden";
    container.classList.add("is-dragging");
  };

  const onDocMove = (e: PointerEvent) => {
    if (!pointerId || !pointerRow) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      startDrag(e);
    }
    if (ghost) {
      ghost.style.transform = `translate3d(${e.clientX - ghostOX}px, ${e.clientY - ghostOY}px, 0)`;
    }

    const hover = rowAtPoint(e.clientX, e.clientY, container, pointerRow);
    clearMarks();
    if (!hover) {
      hoverId = null;
      return;
    }

    const isGroup = hover.dataset.kind === "group";
    dropPos = resolvePosition(hover, e.clientX, e.clientY, isGroup);
    markDrop(hover, dropPos);
  };

  container.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const row = rowEl(e.target);
    if (!row) return;
    if ((e.target as HTMLElement).closest('[data-action="edit"]')) return;
    pointerId = row.dataset.id ?? null;
    pointerRow = row;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    hoverId = null;
    hoverSince = 0;
    capturePointerId = e.pointerId;
    row.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", onDocMove);
    document.addEventListener("pointerup", onDocUp);
    document.addEventListener("pointercancel", onDocCancel);
  });
}

export function consumeRowClickSuppress(container: HTMLElement): boolean {
  if (!container.dataset.suppressRowClick) return false;
  delete container.dataset.suppressRowClick;
  return true;
}
