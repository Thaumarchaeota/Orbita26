import "./popover-portal.css";
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

type PortalEntry = {
  handle: PopoverPortalHandle;
  anchor: HTMLElement;
  popover: HTMLElement;
};

let portalStack: PortalEntry[] = [];

function popoverBaseZ(): number {
  const raw = getComputedStyle(getModalRoot()).getPropertyValue("--orbita-popover-z").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 205;
}

function measurePopoverRect(popover: HTMLElement): DOMRect {
  const wasOpen = popover.classList.contains("is-open");
  if (!wasOpen) {
    popover.style.visibility = "hidden";
    popover.style.pointerEvents = "none";
    popover.classList.add("is-open");
  }
  const rect = popover.getBoundingClientRect();
  if (!wasOpen) {
    popover.classList.remove("is-open");
    popover.style.visibility = "";
    popover.style.pointerEvents = "";
  }
  return rect;
}

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const gap = 4;
  const margin = 8;
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = measurePopoverRect(popover);
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

function isNestedAnchor(anchor: HTMLElement): boolean {
  for (const entry of portalStack) {
    if (entry.popover.contains(anchor) || entry.anchor.contains(anchor)) return true;
  }
  return false;
}

function removeFromStack(handle: PopoverPortalHandle): void {
  portalStack = portalStack.filter((entry) => entry.handle !== handle);
}

/**
 * Popovers must leave scrolling Finance surfaces. The shared portal keeps their
 * DOM and listeners tied to the picker handle without changing modal semantics.
 * See docs/UI-PRIMITIVES.md.
 */
export function mountPopoverPortal(options: PopoverPortalOptions): PopoverPortalHandle {
  const { anchor, popover, onOpenChange } = options;
  const portalRoot = getModalRoot();
  let disposed = false;
  let listenersAttached = false;
  // Motion adds .is-open after two animation frames. Keep interaction state
  // separately so a close/dispose during that gap is never ignored.
  let requestedOpen = false;

  popover.classList.add("orbita-popover-portal-item");
  popover.style.position = "fixed";
  portalRoot.appendChild(popover);

  const close = async () => {
    if (!requestedOpen) return;
    requestedOpen = false;
    removeFromStack(handle);
    detachListeners();
    onOpenChange?.(false);
    await closePopover(popover);
  };

  const reposition = () => {
    if (disposed || !requestedOpen) return;
    positionPopover(anchor, popover);
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!target || anchor.contains(target) || popover.contains(target)) return;
    for (const entry of portalStack) {
      if (entry.popover.contains(target)) return;
    }
    void close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const top = portalStack[portalStack.length - 1];
    if (top?.handle !== handle) return;
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
      if (disposed || requestedOpen) return;
      requestedOpen = true;
      if (!isNestedAnchor(anchor)) {
        while (portalStack.length > 0) {
          const top = portalStack[portalStack.length - 1]!;
          await top.handle.close();
        }
      }
      popover.style.zIndex = String(popoverBaseZ() + portalStack.length);
      portalStack.push({ handle, anchor, popover });
      positionPopover(anchor, popover);
      attachListeners();
      onOpenChange?.(true);
      await openPopover(popover, anchor);
      // A click can request close before openPopover reaches its first frame.
      // CSS state then catches up here without reviving a logically closed portal.
      if (!requestedOpen || disposed) {
        await closePopover(popover);
        return;
      }
      positionPopover(anchor, popover);
    },
    close,
    isOpen: () => requestedOpen,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      requestedOpen = false;
      removeFromStack(handle);
      detachListeners();
      resizeObserver?.disconnect();
      observer.disconnect();
      onOpenChange?.(false);
      popover.remove();
    },
  };

  return handle;
}
