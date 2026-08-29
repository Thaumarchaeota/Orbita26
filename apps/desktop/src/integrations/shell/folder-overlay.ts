import { bindTileGrid, type TileGridDragHandoff, type TileGridOptions } from "./tile-grid";
import { setDialogFly } from "../../ui/motion";

type LeafItem = { id: string; name: string; kind?: string };

export type FolderOverlayConfig<T extends LeafItem> = {
  title: string;
  folderId: string;
  getItems: () => T[];
  gridClass: string;
  renderTile: (item: T | null, editMode: boolean) => string;
  onActivate: (item: T) => void | Promise<void>;
  onAdd?: (trigger: HTMLElement) => T[] | null | Promise<T[] | null>;
  onEdit: (item: T, trigger: HTMLElement) => T[] | null | Promise<T[] | null>;
  onRenameTitle?: (name: string) => void | Promise<void>;
  confirmDelete: (id: string, name: string, trigger: HTMLElement) => Promise<boolean>;
  onReorder: (folderId: string, items: T[]) => void;
  onMoveOut: (folderId: string, itemId: string) => void;
  onDragOutLeave?: (folderId: string, itemId: string, handoff: TileGridDragHandoff) => boolean;
};

const OPEN_MS = 340;
const CLOSE_MS = 260;
const DRAG_DISMISS_MS = 460;

function gridCols(gridClass: string): number {
  const root = document.documentElement;
  const raw = gridClass.includes("apps")
    ? getComputedStyle(root).getPropertyValue("--apps-cols")
    : getComputedStyle(root).getPropertyValue("--bookmarks-cols");
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : gridClass.includes("apps") ? 2 : 6;
}

function positionPanel(trigger: HTMLElement, panel: HTMLElement, gridClass: string) {
  const rect = trigger.getBoundingClientRect();
  const margin = 12;
  const cols = gridCols(gridClass);
  const gap = 12;
  const tileW = rect.width || 64;
  const panelW = Math.min(cols * tileW + (cols - 1) * gap + 28, window.innerWidth - margin * 2);
  let left = rect.left + rect.width / 2 - panelW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));

  panel.style.width = `${panelW}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${rect.bottom + margin}px`;

  const originX = rect.left + rect.width / 2 - left;
  panel.style.setProperty("--fo-ox", `${originX}px`);
  panel.style.setProperty("--fo-oy", `${rect.height / 2}px`);

  requestAnimationFrame(() => {
    const panelRect = panel.getBoundingClientRect();
    let top = rect.bottom + margin;
    if (panelRect.bottom > window.innerHeight - margin) {
      top = rect.top - margin - panelRect.height;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - panelRect.height));
    panel.style.top = `${top}px`;
    panel.style.setProperty("--fo-oy", `${rect.top + rect.height / 2 - top}px`);
  });
}

function waitPanelTransition(panel: HTMLElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      panel.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === panel && e.propertyName === "transform") finish();
    };
    panel.addEventListener("transitionend", onEnd);
    window.setTimeout(finish, ms);
  });
}

function startInlineTitleEdit(
  titleEl: HTMLElement,
  onRename: ((name: string) => void | Promise<void>) | null,
) {
  if (titleEl.isContentEditable) return;
  const prev = titleEl.textContent ?? "";
  titleEl.contentEditable = "true";
  titleEl.classList.add("is-editing");
  titleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const finish = (save: boolean) => {
    titleEl.contentEditable = "false";
    titleEl.classList.remove("is-editing");
    const name = (save ? titleEl.textContent?.trim() : prev) || prev;
    titleEl.textContent = name;
    if (save && name !== prev && onRename) void Promise.resolve(onRename(name));
  };

  const onBlur = () => {
    titleEl.removeEventListener("keydown", onKey);
    finish(true);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      titleEl.removeEventListener("blur", onBlur);
      finish(true);
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      titleEl.removeEventListener("blur", onBlur);
      finish(false);
    }
  };
  titleEl.addEventListener("blur", onBlur, { once: true });
  titleEl.addEventListener("keydown", onKey);
}

export function mountFolderOverlay(root: HTMLElement) {
  const layer = document.createElement("div");
  layer.className = "folder-overlay-layer";
  layer.innerHTML = `
    <div class="folder-overlay-scrim"></div>
    <div class="folder-overlay-panel motion-dialog-panel">
      <h3 class="folder-overlay-title" id="folderOverlayTitle"></h3>
      <div class="launcher-grid-scroll folder-overlay-scroll">
        <div class="launcher-grid" id="folderOverlayGrid"></div>
      </div>
    </div>
  `;

  root.appendChild(layer);

  const panel = layer.querySelector<HTMLElement>(".folder-overlay-panel")!;
  const scrim = layer.querySelector<HTMLElement>(".folder-overlay-scrim")!;
  const titleEl = layer.querySelector<HTMLElement>("#folderOverlayTitle")!;
  const gridEl = layer.querySelector<HTMLElement>("#folderOverlayGrid")!;

  let open = false;
  let closing = false;
  let activeTrigger: HTMLElement | null = null;
  let activeGridClass = "";
  let activeFolderId: string | null = null;
  let onRenameTitle: ((name: string) => void | Promise<void>) | null = null;
  let repaint: (() => void) | null = null;

  const clearTrigger = () => {
    activeTrigger?.classList.remove("is-folder-open");
    activeTrigger = null;
  };

  const close = async () => {
    if (!open || closing) return;
    closing = true;
    setDialogFly(panel, activeTrigger ?? undefined, "close");
    void panel.offsetHeight;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    layer.classList.remove("is-open");
    clearTrigger();
    await waitPanelTransition(panel, CLOSE_MS);
    repaint = null;
    gridEl.innerHTML = "";
    open = false;
    closing = false;
    activeFolderId = null;
    onRenameTitle = null;
    activeGridClass = "";
  };

  const dismissForDrag = () => {
    if (!open || closing) return;
    closing = true;
    layer.classList.add("is-dismissing-for-drag");
    setDialogFly(panel, activeTrigger ?? undefined, "close");
    layer.classList.remove("is-dragging-out");
    void panel.offsetHeight;
    requestAnimationFrame(() => {
      layer.classList.remove("is-open");
      clearTrigger();
    });
    void waitPanelTransition(panel, DRAG_DISMISS_MS).then(() => {
      layer.classList.remove("is-dismissing-for-drag");
      repaint = null;
      gridEl.innerHTML = "";
      open = false;
      closing = false;
      activeFolderId = null;
      onRenameTitle = null;
      activeGridClass = "";
    });
  };

  const onResize = () => {
    if (open && activeTrigger) positionPanel(activeTrigger, panel, activeGridClass);
  };

  scrim.addEventListener("click", () => void close());
  panel.addEventListener("click", (e) => e.stopPropagation());
  titleEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startInlineTitleEdit(titleEl, onRenameTitle);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open && !titleEl.isContentEditable) void close();
  });
  window.addEventListener("resize", onResize);

  return {
    open<T extends LeafItem>(next: FolderOverlayConfig<T>, trigger: HTMLElement) {
      void (async () => {
        if (open && activeFolderId === next.folderId) {
          await close();
          return;
        }
        if (open) await close();

        activeTrigger = trigger;
        activeGridClass = next.gridClass;
        activeFolderId = next.folderId;
        onRenameTitle = next.onRenameTitle ?? null;
        trigger.classList.add("is-folder-open");

        titleEl.textContent = next.title;
        gridEl.className = `launcher-grid ${next.gridClass}`;

        const opts: TileGridOptions<LeafItem> = {
          dragOutPanel: panel,
          onDragOutHover: (active) => layer.classList.toggle("is-dragging-out", active),
          onDragOutLeave: next.onDragOutLeave
            ? (sourceId, handoff) => next.onDragOutLeave!(next.folderId, sourceId, handoff)
            : undefined,
          onMoveOut: (sourceId) => {
            next.onMoveOut(next.folderId, sourceId);
            void close();
          },
        };
        repaint = bindTileGrid(
          gridEl,
          () => next.getItems() as LeafItem[],
          (items) => next.onReorder(next.folderId, items as T[]),
          (item, editMode, _draggable, _slot) => next.renderTile(item as T | null, editMode),
          (item, _trigger) => next.onActivate(item as T),
          async (t) => (next.onAdd ? next.onAdd(t) as Promise<LeafItem[] | null> : null),
          (item, t) => next.onEdit(item as T, t) as Promise<LeafItem[] | null>,
          next.confirmDelete,
          undefined,
          opts,
        ).paint;
        repaint();
        positionPanel(trigger, panel, next.gridClass);

        setDialogFly(panel, trigger, "open");
        layer.classList.remove("is-open");
        void panel.offsetHeight;
        requestAnimationFrame(() => layer.classList.add("is-open"));
        open = true;
        await waitPanelTransition(panel, OPEN_MS);
      })();
    },
    close: () => void close(),
    dismissForDrag: () => dismissForDrag(),
    isOpen: () => open,
    getOpenFolderId: () => activeFolderId,
    repaint: () => repaint?.(),
  };
}
