import { prefersReducedLayoutMotion } from "../../../ui/layout-flip";

const DEFAULT_DRAG_THRESHOLD = 4;
const FLIP_MS = 200;

export function computeInsertIndex(centers: readonly number[], x: number): number {
  for (let i = 0; i < centers.length; i++) {
    if (x < centers[i]) return i;
  }
  return centers.length;
}

export function reorderKeys(keys: readonly string[], fromIndex: number, insertIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= keys.length) return [...keys];
  const next = [...keys];
  const [item] = next.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(insertIndex, next.length));
  next.splice(clamped, 0, item);
  return next;
}

export function siblingTranslateX(
  index: number,
  dragIndex: number,
  insertIndex: number,
  tabWidth: number,
): number {
  if (index === dragIndex) return 0;
  if (dragIndex < insertIndex) {
    if (index > dragIndex && index < insertIndex) return -tabWidth;
  } else if (dragIndex > insertIndex) {
    if (index >= insertIndex && index < dragIndex) return tabWidth;
  }
  return 0;
}

export type TabDragStartInfo = {
  key: string;
  fromIndex: number;
  startX: number;
  startY: number;
  pointerId: number;
  tabEl: HTMLElement;
  tabWidth: number;
  tabEls: HTMLElement[];
};

export type TabReorderOptions = {
  getKeys: () => string[];
  onReorder: (keys: string[]) => void;
  onCrossDrop?: (key: string, clientX: number) => boolean;
  onTabDragStart?: (info: TabDragStartInfo) => boolean;
  onTabDragEnd?: (commit: boolean, clientX: number, clientY: number) => void;
  dragThreshold?: number;
};

export type TabReorderHandle = {
  dispose: () => void;
};

type DragState = {
  key: string;
  fromIndex: number;
  startX: number;
  startY: number;
  pointerId: number;
  dragging: boolean;
  external: boolean;
  insertIndex: number;
  tabEl: HTMLElement;
  tabWidth: number;
  tabEls: HTMLElement[];
};

export function mountTabReorder(listEl: HTMLElement, opts: TabReorderOptions): TabReorderHandle {
  const threshold = opts.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
  const ac = new AbortController();
  const { signal } = ac;
  let drag: DragState | null = null;

  function tabEls(): HTMLElement[] {
    return [...listEl.querySelectorAll<HTMLElement>(".insight-content-tab[data-tab-key]")];
  }

  function tabKey(el: HTMLElement): string | null {
    return el.dataset.tabKey ?? null;
  }

  function centersExcluding(excludeIndex: number, els: HTMLElement[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < els.length; i++) {
      if (i === excludeIndex) continue;
      const rect = els[i].getBoundingClientRect();
      out.push(rect.left + rect.width / 2);
    }
    return out;
  }

  function clearTransforms(els: HTMLElement[]): void {
    for (const el of els) {
      el.style.transition = "";
      el.style.transform = "";
      el.classList.remove("is-dragging");
    }
  }

  function primeSiblingTransitions(state: DragState): void {
    const reduced = prefersReducedLayoutMotion();
    for (let i = 0; i < state.tabEls.length; i++) {
      if (i === state.fromIndex) continue;
      const el = state.tabEls[i];
      el.style.transition = reduced ? "none" : `transform ${FLIP_MS}ms ease`;
      el.style.transform = "";
    }
  }

  function applySiblingTransforms(state: DragState, pointerX: number): void {
    const centers = centersExcluding(state.fromIndex, state.tabEls);
    const insertIndex = computeInsertIndex(centers, pointerX);
    const insertChanged = insertIndex !== state.insertIndex;
    state.insertIndex = insertIndex;
    const reduced = prefersReducedLayoutMotion();
    for (let i = 0; i < state.tabEls.length; i++) {
      const el = state.tabEls[i];
      if (i === state.fromIndex) continue;
      const offset = siblingTranslateX(i, state.fromIndex, insertIndex, state.tabWidth);
      const nextTransform = offset ? `translateX(${offset}px)` : "";
      if (reduced) {
        el.style.transition = "none";
      } else if (!el.style.transition) {
        el.style.transition = `transform ${FLIP_MS}ms ease`;
      }
      if (!reduced && insertChanged) {
        void el.offsetWidth;
      }
      el.style.transform = nextTransform;
    }
  }

  function finishDrag(commit: boolean, pointerX?: number, pointerY?: number): void {
    if (!drag) return;
    const state = drag;
    drag = null;
    if (state.external) {
      // DragSession owns commit/cancel; local finish only forwards lifecycle.
      opts.onTabDragEnd?.(commit, pointerX ?? state.startX, pointerY ?? state.startY);
      return;
    }
    const els = state.tabEls;
    const keys = opts.getKeys();
    if (commit && state.dragging) {
      if (pointerX !== undefined && opts.onCrossDrop?.(state.key, pointerX)) {
        clearTransforms(els);
        return;
      }
      const next = reorderKeys(keys, state.fromIndex, state.insertIndex);
      if (next.join("\0") !== keys.join("\0")) opts.onReorder(next);
    }
    clearTransforms(els);
  }

  listEl.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest(".insight-content-tab-close")) return;
      const tabEl = target.closest<HTMLElement>(".insight-content-tab[data-tab-key]");
      if (!tabEl || !listEl.contains(tabEl)) return;
      const key = tabKey(tabEl);
      if (!key) return;
      const keys = opts.getKeys();
      const fromIndex = keys.indexOf(key);
      if (fromIndex < 0) return;
      const els = tabEls();
      const rect = tabEl.getBoundingClientRect();
      const info: TabDragStartInfo = {
        key,
        fromIndex,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        tabEl,
        tabWidth: rect.width,
        tabEls: els,
      };
      const external = opts.onTabDragStart?.(info) ?? false;
      drag = {
        key,
        fromIndex,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        dragging: false,
        external,
        insertIndex: fromIndex,
        tabEl,
        tabWidth: rect.width,
        tabEls: els,
      };
      tabEl.setPointerCapture(e.pointerId);
    },
    { signal },
  );

  listEl.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || drag.external) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.dragging) {
        if (Math.hypot(dx, dy) < threshold) return;
        drag.dragging = true;
        drag.tabEl.classList.add("is-dragging");
        drag.tabEl.style.transition = "none";
        primeSiblingTransitions(drag);
      }
      if (!opts.onTabDragStart) {
        drag.tabEl.style.transform = `translateX(${dx}px)`;
      }
      applySiblingTransforms(drag, e.clientX);
    },
    { signal },
  );

  const endDrag = (commit: boolean) => (e: PointerEvent) => {
    if (!drag) return;
    if (drag.external) {
      if (e.type === "pointercancel") {
        opts.onTabDragEnd?.(false, e.clientX, e.clientY);
      }
      drag = null;
      return;
    }
    try {
      drag.tabEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    finishDrag(commit, e.clientX, e.clientY);
  };

  listEl.addEventListener("pointerup", endDrag(true), { signal });
  listEl.addEventListener("pointercancel", endDrag(false), { signal });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && drag) finishDrag(false);
  };
  window.addEventListener("keydown", onKeyDown, { signal });

  return {
    dispose() {
      finishDrag(false);
      ac.abort();
    },
  };
}
