import "./popover-portal.css";
import { registerOverlayNavigation } from "./overlay-navigation";
import { closePopover, isPopoverOpen, openPopover } from "./motion";
import { getModalRoot, topModalRootZ } from "./modal-root";
import { acquireInteraction, type InteractionLease } from "./interaction-lease";

export type PopoverPortalHandle = {
  open: () => Promise<void>;
  close: () => Promise<void>;
  isOpen: () => boolean;
  dispose: () => void;
};

export type PopoverPlacement = "below" | "right" | "left";

export type PopoverPortalOptions = {
  anchor: HTMLElement;
  popover: HTMLElement;
  onOpenChange?: (open: boolean) => void;
  /** Default below. Right/left align popover top to anchor top with 4px gap. */
  placement?: PopoverPlacement;
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

// Layout box only: scale lives on transform. Never toggle .is-open to measure,
// or the enter animation cannot run. See docs/adr/0040-anchored-popover-motion.md.
function measurePopoverSize(popover: HTMLElement): { width: number; height: number } {
  return { width: popover.offsetWidth, height: popover.offsetHeight };
}

function positionPopover(
  anchor: HTMLElement,
  popover: HTMLElement,
  placement: PopoverPlacement = "below",
  lockedSide?: "left" | "right",
): "left" | "right" | undefined {
  const gap = 4;
  const margin = 8;
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = measurePopoverSize(popover);

  if (placement === "right" || placement === "left") {
    const rightLeft = anchorRect.right + gap;
    const leftLeft = anchorRect.left - popoverRect.width - gap;
    const fitsRight = rightLeft + popoverRect.width <= window.innerWidth - margin;
    const fitsLeft = leftLeft >= margin;
    const availableRight = window.innerWidth - margin - rightLeft;
    const availableLeft = anchorRect.left - gap - margin;
    const preferred = placement;
    const side = lockedSide ?? (preferred === "right"
      ? (fitsRight ? "right" : fitsLeft ? "left" : availableRight >= availableLeft ? "right" : "left")
      : (fitsLeft ? "left" : fitsRight ? "right" : availableLeft >= availableRight ? "left" : "right"));
    const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
    const left = Math.min(Math.max(margin, side === "right" ? rightLeft : leftLeft), maxLeft);
    const maxTop = Math.max(margin, window.innerHeight - popoverRect.height - margin);
    const top = Math.min(Math.max(margin, anchorRect.top), maxTop);

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
    return side;
  }

  const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
  const left = Math.min(Math.max(margin, anchorRect.left), maxLeft);
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - popoverRect.height - gap;
  const top = below + popoverRect.height <= window.innerHeight - margin || above < margin
    ? below
    : above;

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(Math.max(margin, top))}px`;
  return undefined;
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
  const { anchor, popover, onOpenChange, placement = "below" } = options;
  const portalRoot = getModalRoot();
  let generation = 0;
  let navigationRelease: (() => void) | null = null;
  let closing: Promise<void> | null = null;
  let openingMotion: Promise<void> | null = null;
  let disposed = false;
  let listenersAttached = false;
  // Motion adds .is-open after two animation frames. Keep interaction state
  // separately so a close/dispose during that gap is never ignored.
  let requestedOpen = false;
  let opening = false;
  let openingSide: "left" | "right" | undefined;
  let interactionLease: InteractionLease | null = null;

  const notifyOpenChange = (open: boolean) => {
    try {
      onOpenChange?.(open);
    } catch (error) {
      console.error("Popover state callback failed", error);
    }
  };

  const releaseInteraction = () => {
    interactionLease?.release();
    interactionLease = null;
  };

  popover.classList.add("orbita-popover-portal-item");
  popover.style.position = "fixed";
  // A mounted picker is closed regardless of its page/theme CSS (SPEC-0004 lifecycle boundary).
  popover.hidden = true;
  portalRoot.appendChild(popover);

  const close = (): Promise<void> => {
    if (!requestedOpen) return closing ?? Promise.resolve();
    requestedOpen = false;
    const gen = ++generation;
    const release = navigationRelease;
    navigationRelease = null;
    const lease = interactionLease;
    interactionLease = null;
    removeFromStack(handle);
    detachListeners();
    const pendingOpen = openingMotion;
    const operation = (async () => {
      try {
        // An enter may still be between animation frames; finish it before exit.
        try { await pendingOpen; } catch { /* Exit still owns cleanup after a failed enter. */ }
        await closePopover(popover);
        if (generation === gen) {
          popover.hidden = true;
          window.dispatchEvent(new CustomEvent("orbita:modal-layer"));
        }
      } finally { release?.(); lease?.release(); }
    })();
    closing = operation;
    notifyOpenChange(false);
    return operation;
  };

  const reposition = () => {
    if (disposed || !requestedOpen) return;
    // Enter already placed at final coords; do not move left/top during animation.
    if (opening) return;
    positionPopover(anchor, popover, placement);
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
      const gen = ++generation;
      const release = registerOverlayNavigation({ kind: "temporary", close });
      navigationRelease = release;
      await closing;
      if (disposed || !requestedOpen || generation !== gen) return;
      opening = false;
      openingMotion = null;
      interactionLease ??= acquireInteraction("popover");
      try {
        await interactionLease.ready;
      } catch (error) {
        if (generation !== gen) return;
        release(); navigationRelease = null;
        requestedOpen = false;
        popover.hidden = true;
        releaseInteraction();
        // Readiness rejection means native interactivity was not confirmed.
        // Abort quietly; click-driven callers often intentionally fire-and-forget.
        console.error("Popover could not open because window interactivity was not confirmed", error);
        return;
      }
      if (disposed || !requestedOpen || generation !== gen) return;
      if (!isNestedAnchor(anchor)) {
        while (portalStack.length > 0) {
          const top = portalStack[portalStack.length - 1]!;
          await top.handle.close();
          if (disposed || !requestedOpen || generation !== gen) return;
        }
      }
      if (disposed || !requestedOpen || generation !== gen || !anchor.isConnected) {
        if (generation !== gen) return;
        release(); navigationRelease = null;
        requestedOpen = false;
        releaseInteraction();
        return;
      }
      popover.hidden = false;
      popover.style.zIndex = String(Math.max(popoverBaseZ(), topModalRootZ(popover)) + 1);
      portalStack.push({ handle, anchor, popover });
      opening = true;
      openingSide = positionPopover(anchor, popover, placement);
      attachListeners();
      try {
        notifyOpenChange(true);
        if (!requestedOpen || disposed || generation !== gen) return;
        openingMotion = openPopover(popover, anchor);
        await openingMotion;
        // A click can request close before openPopover reaches its first frame.
        // CSS state then catches up here without reviving a logically closed portal.
        if (!requestedOpen || disposed || generation !== gen) return;
        positionPopover(anchor, popover, placement, openingSide);
      } catch (error) {
        if (generation !== gen) return;
        await close();
        throw error;
      } finally {
        if (generation === gen) {
          opening = false;
          openingSide = undefined;
          openingMotion = null;
        }
      }
    },
    close,
    isOpen: () => requestedOpen,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      removeFromStack(handle);
      detachListeners();
      resizeObserver?.disconnect();
      observer.disconnect();
      if (!requestedOpen) notifyOpenChange(false);
      void (async () => {
        await close();
        requestedOpen = false;
        popover.hidden = true;
        popover.remove();
        releaseInteraction();
        window.dispatchEvent(new CustomEvent("orbita:modal-layer"));
      })();
    },
  };

  return handle;
}
