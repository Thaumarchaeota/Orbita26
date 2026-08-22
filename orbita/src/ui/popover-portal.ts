import { closePopover, isPopoverOpen, openPopover } from "./motion";
import { getModalRoot } from "./modal-root";

export type PopoverPortalHandle = {
  open: () => Promise<void>;
  close: () => Promise<void>;
  isOpen: () => boolean;
  dispose: () => void;
};

export type PopoverPortalOptions = {
  anchor: HTMLElement;
  popover: HTMLElement;
  onOpenChange?: (open: boolean) => void;
};

let activePortal: PopoverPortalHandle | null = null;

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const gap = 4;
  const margin = 8;
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
  const left = Math.min(Math.max(margin, anchorRect.left), maxLeft);
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - popoverRect.height - gap;
  const top = below + popoverRect.height <= window.innerHeight - margin || above < margin
    ? below
    : above;

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(Math.max(margin, top))}px`;
}

/**
 * Popovers must leave scrolling Finance surfaces. The shared portal keeps their
 * DOM and listeners tied to the picker handle without changing modal semantics.
 * See docs/plans/v0.0.17-finance-rebuild.md §4.
 */
export function mountPopoverPortal(options: PopoverPortalOptions): PopoverPortalHandle {
  const { anchor, popover, onOpenChange } = options;
  const portalRoot = getModalRoot();
  let disposed = false;
  let listenersAttached = false;

  popover.classList.add("orbita-popover-portal-item");
  portalRoot.appendChild(popover);

  const close = async () => {
    if (!isPopoverOpen(popover)) return;
    if (activePortal === handle) activePortal = null;
    detachListeners();
    onOpenChange?.(false);
    await closePopover(popover);
  };

  const reposition = () => {
    if (disposed || !isPopoverOpen(popover)) return;
    positionPopover(anchor, popover);
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!target || anchor.contains(target) || popover.contains(target)) return;
    void close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    void close();
    anchor.focus();
  };
  const attachListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  };
  const detachListeners = () => {
    if (!listenersAttached) return;
    listenersAttached = false;
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  };
  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(reposition);
  resizeObserver?.observe(anchor);
  resizeObserver?.observe(popover);
  const observer = new MutationObserver(() => {
    if (!anchor.isConnected) handle.dispose();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const handle: PopoverPortalHandle = {
    open: async () => {
      if (disposed || isPopoverOpen(popover)) return;
      await activePortal?.close();
      activePortal = handle;
      positionPopover(anchor, popover);
      attachListeners();
      onOpenChange?.(true);
      await openPopover(popover, anchor);
    },
    close,
    isOpen: () => isPopoverOpen(popover),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (activePortal === handle) activePortal = null;
      detachListeners();
      resizeObserver?.disconnect();
      observer.disconnect();
      onOpenChange?.(false);
      popover.remove();
    },
  };

  return handle;
}
