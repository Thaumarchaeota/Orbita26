import { bindBackdropPressDismiss } from "./backdrop-dismiss";
import { bindDialog } from "./motion";
import { mountModalBackdrop } from "./modal-root";
import "./insight-dialog.css";
import { registerOverlayNavigation, type OverlayNavigationKind } from "./overlay-navigation";

const FOCUSABLE =
  'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])';

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type InsightDialogHandle = {
  backdrop: HTMLElement;
  panel: HTMLFormElement;
  body: HTMLElement;
  errorEl: HTMLElement;
  submitBtn: HTMLButtonElement;
  motion: ReturnType<typeof bindDialog>;
  busy: boolean;
  setError: (message: string) => void;
  setBusy: (busy: boolean) => void;
  open: () => Promise<void>;
  close: () => Promise<void>;
  bindChrome: (onCancel: () => void) => () => void;
  dispose: () => void;
};

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && el.getAttribute("aria-hidden") !== "true",
  );
}

export function createInsightDialog(opts: {
  title: string;
  bodyHtml: string;
  submitLabel: string;
  cancelLabel?: string;
  extraActionsHtml?: string;
  panelClass?: string;
  dangerSubmit?: boolean;
  /** Optional owner scope for confirmations opened inside a floating surface. */
  scope?: HTMLElement;
  mountTarget?: HTMLElement;
  onDispose?: () => void;
  navigationKind?: OverlayNavigationKind;
}): InsightDialogHandle {
  const titleId = `insight-dialog-title-${Math.random().toString(36).slice(2, 9)}`;
  const backdrop = document.createElement("div");
  backdrop.className = "insight-dialog-backdrop motion-dialog";
  backdrop.innerHTML = `
    <form class="insight-dialog-panel motion-dialog-panel${opts.panelClass ? ` ${opts.panelClass}` : ""}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="insight-dialog-header">
        <h2 class="insight-dialog-title" id="${titleId}">${esc(opts.title)}</h2>
      </div>
      <div class="insight-dialog-body">${opts.bodyHtml}</div>
      <div class="insight-dialog-footer">
        <p class="insight-dialog-error" role="alert" hidden></p>
        <div class="insight-dialog-actions">
          <button type="button" class="insight-dialog-btn" data-action="cancel">${esc(opts.cancelLabel ?? "取消")}</button>
          ${opts.extraActionsHtml ?? ""}
          <button type="submit" class="insight-dialog-btn ${opts.dangerSubmit ? "insight-dialog-btn-danger" : "insight-dialog-btn-primary"}">${esc(opts.submitLabel)}</button>
        </div>
      </div>
    </form>`;
  const mountTarget = opts.mountTarget ?? opts.scope ?? null;
  const previousPosition = mountTarget?.style.position ?? "";
  if (mountTarget) {
    backdrop.dataset.dialogScope = "local";
    if (getComputedStyle(mountTarget).position === "static") mountTarget.style.position = "relative";
    mountTarget.appendChild(backdrop);
  } else mountModalBackdrop(backdrop);

  const panel = backdrop.querySelector<HTMLFormElement>("form")!;
  const body = backdrop.querySelector<HTMLElement>(".insight-dialog-body")!;
  const errorEl = backdrop.querySelector<HTMLElement>(".insight-dialog-error")!;
  const submitBtn = panel.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const motion = bindDialog(backdrop, panel);
  let generation = 0;
  let navigationRelease: (() => void) | null = null;
  let busyRelease: (() => void) | null = null;
  let cancelChrome: (() => void) | null = null;
  let closing: Promise<void> | null = null;
  let busy = false;
  let opened = false;
  let disposed = false;
  let chromeCleanup: (() => void) | null = null;
  let restoreFocusEl: Element | null = null;
  let ownerObserver: MutationObserver | null = null;
  let disposeNotified = false;

  const setError = (message: string) => {
    errorEl.hidden = !message;
    errorEl.textContent = message;
  };

  const setBusy = (next: boolean) => {
    busy = next;
    if (next && opened && opts.navigationKind && opts.navigationKind !== "protected") {
      busyRelease ??= registerOverlayNavigation({ kind: "protected" });
    } else if (!next) { busyRelease?.(); busyRelease = null; }
    submitBtn.disabled = next;
    panel.setAttribute("aria-busy", next ? "true" : "false");
  };

  const close = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (!opened) return closing ?? Promise.resolve();
    opened = false;
    const gen = ++generation;
    const release = navigationRelease;
    const releaseBusy = busyRelease;
    busyRelease = null;
    navigationRelease = null;
    chromeCleanup?.();
    chromeCleanup = null;
    const operation = (async () => {
      try { await motion.close(); }
      finally { release?.(); releaseBusy?.(); }
      if (disposed || generation !== gen) return;
      backdrop.remove();
      ownerObserver?.disconnect(); ownerObserver = null;
      if (mountTarget) { if (previousPosition) mountTarget.style.position = previousPosition; else mountTarget.style.removeProperty("position"); }
      const restore = restoreFocusEl;
      restoreFocusEl = null;
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus();
    })();
    closing = operation;
    return operation;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    opened = false;
    navigationRelease?.(); navigationRelease = null;
    busyRelease?.(); busyRelease = null;
    void motion.close();
    chromeCleanup?.();
    chromeCleanup = null;
    backdrop.remove();
    ownerObserver?.disconnect(); ownerObserver = null;
    if (!disposeNotified) { disposeNotified = true; opts.onDispose?.(); }
    if (mountTarget) { if (previousPosition) mountTarget.style.position = previousPosition; else mountTarget.style.removeProperty("position"); }
  };
  const observeOwner = () => {
    if (!mountTarget?.parentNode || ownerObserver) return;
    ownerObserver = new MutationObserver(() => {
      if (!mountTarget.isConnected) dispose();
    });
    ownerObserver.observe(mountTarget.parentNode, { childList: true, subtree: true });
  };
  observeOwner();

  const bindChrome = (onCancel: () => void) => {
    chromeCleanup?.();
    const cancel = () => {
      if (busy) return;
      onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!backdrop.classList.contains("is-open") || e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(panel);
      if (!items.length) return;
      const active = document.activeElement;
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        items[0].focus();
        return;
      }
      const idx = items.indexOf(active as HTMLElement);
      if (e.shiftKey && (idx <= 0)) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && idx === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    };
    cancelChrome = cancel;
    const unbindBackdrop = bindBackdropPressDismiss(backdrop, cancel);
    const cancelButton = panel.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    document.addEventListener("keydown", onKey, true);
    cancelButton?.addEventListener("click", cancel);
    chromeCleanup = () => {
      document.removeEventListener("keydown", onKey, true);
      unbindBackdrop();
      cancelButton?.removeEventListener("click", cancel);
      if (cancelChrome === cancel) cancelChrome = null;
    };
    return chromeCleanup;
  };

  return {
    backdrop,
    panel,
    body,
    errorEl,
    submitBtn,
    motion,
    get busy() {
      return busy;
    },
    setError,
    setBusy,
    open: async () => {
      if (disposed || opened) return;
      opened = true;
      const gen = ++generation;
      const release = registerOverlayNavigation({
        kind: opts.navigationKind ?? "protected",
        close: () => { if (!busy) cancelChrome?.(); },
      });
      navigationRelease = release;
      setBusy(busy);
      restoreFocusEl = document.activeElement;
      // Finish the previous exit before reopening the same motion surface.
      await closing;
      if (disposed || !opened || generation !== gen) return;
      if (!backdrop.isConnected) {
        if (mountTarget) {
          if (getComputedStyle(mountTarget).position === "static") mountTarget.style.position = "relative";
          mountTarget.appendChild(backdrop);
        } else mountModalBackdrop(backdrop);
        observeOwner();
      }
      try { await motion.open(); }
      catch (error) {
        if (generation === gen) { opened = false; navigationRelease = null; busyRelease?.(); busyRelease = null; }
        release();
        throw error;
      }
      if (disposed || !opened || generation !== gen) return;
      if (!motion.isOpen()) { opened = false; navigationRelease = null; busyRelease?.(); busyRelease = null; release(); return; }
      const autofocus = panel.querySelector<HTMLElement>("[autofocus]");
      if (autofocus) autofocus.focus();
      else panel.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    },
    close,
    bindChrome,
    dispose,
  };
}

export function isInsightSurface(): boolean {
  return Boolean(document.querySelector(".admin-app"));
}
