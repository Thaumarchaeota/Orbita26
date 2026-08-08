import { moveEntryOnDate, sortDetailEntries } from "../../domain/seq";
import { getDetailEntries } from "../../state/ledger";
import { sleep } from "../../utils";
import { applyDetailFilters, dragEnabled } from "./filters";
import { cancelEdit } from "./edit";
import { findEntry } from "./render";
import { recomputeSaveUI } from "./save";

type DragState = {
  id: string;
  date: string;
  crossDay: boolean;
  hoverId: string | null;
  targetId: string | null;
  insertAfter: boolean;
  pointerId: number;
  captureEl: HTMLElement;
  srcWrap: HTMLElement;
  startX: number;
  startY: number;
};

async function shakeDragReject(wrapEl: HTMLElement | null): Promise<void> {
  const block = wrapEl?.querySelector<HTMLElement>(".entry-block");
  if (!block) return;
  block.classList.add("drag-reject");
  await sleep(450);
  block.classList.remove("drag-reject");
}

export function initDetailDrag(ac: AbortController): void {
  const list = document.getElementById("detail-list");
  if (!list) return;
  const { signal } = ac;
  let dragState: DragState | null = null;

  function clearDragOver(): void {
    list!.querySelectorAll<HTMLElement>(".entry-block-wrap.drag-over").forEach((el) => {
      el.classList.remove("drag-over", "drag-over-after");
    });
  }

  function wrapAtPoint(x: number, y: number): HTMLElement | null {
    const dragging = list!.querySelector<HTMLElement>(".entry-block-wrap.is-dragging");
    if (dragging) dragging.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    if (dragging) dragging.style.pointerEvents = "";
    const wrap = (el as HTMLElement | null)?.closest<HTMLElement>(".entry-block-wrap") || null;
    return wrap?.classList.contains("is-dragging") ? null : wrap;
  }

  function updateDragPos(ev: PointerEvent): void {
    if (!dragState?.srcWrap) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    dragState.srcWrap.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function updateHover(clientX: number, clientY: number): void {
    if (!dragState) return;
    const wrap = wrapAtPoint(clientX, clientY);
    clearDragOver();
    if (!wrap) return;

    const target = findEntry(wrap.dataset.entryId!);
    if (!target || target._deleted) return;

    if (target.date !== dragState.date) {
      dragState.crossDay = true;
      dragState.hoverId = wrap.dataset.entryId!;
      dragState.targetId = null;
      return;
    }

    dragState.crossDay = false;
    dragState.hoverId = wrap.dataset.entryId!;
    const rect = wrap.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    wrap.classList.add("drag-over");
    wrap.classList.toggle("drag-over-after", after);
    dragState.insertAfter = after;
    dragState.targetId = wrap.dataset.entryId!;
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!dragState) return;
    ev.preventDefault();
    updateDragPos(ev);
    updateHover(ev.clientX, ev.clientY);
  }

  async function endDrag(commit: boolean): Promise<void> {
    const state = dragState;
    if (!state) return;

    if (state.captureEl) {
      try {
        state.captureEl.releasePointerCapture(state.pointerId);
      } catch {
        /* ignore */
      }
    }

    const srcWrap = list!.querySelector<HTMLElement>(
      `.entry-block-wrap[data-entry-id="${state.id}"]`,
    );
    if (srcWrap) {
      srcWrap.classList.remove("is-dragging");
      srcWrap.style.transform = "";
    }
    clearDragOver();
    dragState = null;

    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);

    if (!commit) return;

    if (state.crossDay) {
      const wrap = state.hoverId
        ? list!.querySelector<HTMLElement>(`.entry-block-wrap[data-entry-id="${state.hoverId}"]`)
        : list!.querySelector<HTMLElement>(`.entry-block-wrap[data-entry-id="${state.id}"]`);
      await shakeDragReject(wrap);
      return;
    }

    if (!state.targetId || state.targetId === state.id) return;
    const entries = getDetailEntries();
    if (!moveEntryOnDate(entries, state.id, state.targetId, state.insertAfter)) return;
    sortDetailEntries(entries);
    applyDetailFilters();
    recomputeSaveUI();
  }

  function onPointerUp(): void {
    void endDrag(true);
  }

  list.addEventListener(
    "pointerdown",
    (ev) => {
      const target = ev.target as HTMLElement;
      const handle = target.closest<HTMLElement>(".entry-drag-handle");
      if (!handle || !dragEnabled() || ev.button !== 0) return;

      const wrap = handle.closest<HTMLElement>(".entry-block-wrap");
      if (!wrap) return;
      const entry = findEntry(wrap.dataset.entryId!);
      if (!entry || entry._deleted) return;

      ev.preventDefault();
      cancelEdit();

      dragState = {
        id: entry.id,
        date: entry.date,
        crossDay: false,
        hoverId: null,
        targetId: null,
        insertAfter: false,
        pointerId: ev.pointerId,
        captureEl: handle,
        srcWrap: wrap,
        startX: ev.clientX,
        startY: ev.clientY,
      };
      handle.setPointerCapture(ev.pointerId);
      wrap.classList.add("is-dragging");

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    },
    { signal },
  );
}
