import { hideHoverTip } from "./hover-tip";
import { getModalRoot, hideModalBackdrop, raiseModalBackdrop } from "./modal-root";
import { acquireInteraction, type InteractionLease } from "./interaction-lease";

export type MotionTrigger = HTMLElement | MouseEvent | { x: number; y: number };

const POPOVER_MS = 180;
const DIALOG_MS = 400;
const DIALOG_CLOSE_MS = 280;
const DIALOG_BIAS_OPEN = 0.2;
const DIALOG_BIAS_CLOSE = 0.12;
const DIALOG_MAX_BIAS = 36;
const DIALOG_SCALE_OPEN = 0.9;
const DIALOG_SCALE_CLOSE = 0.94;
type DialogState = {
  lease: InteractionLease;
  generation: number;
  closing: Promise<void> | null;
};
const dialogLeases = new WeakMap<HTMLElement, DialogState>();

function holdDialog(backdrop: HTMLElement): DialogState {
  let state = dialogLeases.get(backdrop);
  if (!state) {
    state = { lease: acquireInteraction("modal"), generation: 0, closing: null };
    dialogLeases.set(backdrop, state);
  }
  state.generation += 1;
  // A new open intent cancels any pending close. Let a later close request
  // start its own operation instead of reusing the now-stale promise.
  state.closing = null;
  return state;
}

function releaseDialog(backdrop: HTMLElement, state: DialogState): void {
  if (dialogLeases.get(backdrop) !== state) return;
  dialogLeases.delete(backdrop);
  state.lease.release();
}

function clampBias(value: number) {
  return Math.max(-DIALOG_MAX_BIAS, Math.min(DIALOG_MAX_BIAS, value));
}

function flushLayout(el: HTMLElement) {
  void el.getBoundingClientRect();
}

function motionEnabled() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionPoint(trigger?: MotionTrigger): { x: number; y: number } | null {
  if (!trigger) return null;
  if (trigger instanceof MouseEvent) return { x: trigger.clientX, y: trigger.clientY };
  if (trigger instanceof HTMLElement) {
    const r = trigger.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return trigger;
}

function waitTransition(el: HTMLElement, property: string, ms: number): Promise<void> {
  if (!motionEnabled()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.target === el && ev.propertyName === property) finish();
    };
    el.addEventListener("transitionend", onEnd);
    window.setTimeout(finish, ms);
  });
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

function notifyModalLayer() {
  window.dispatchEvent(new CustomEvent("orbita:modal-layer"));
}

function prepareModalBackdrop(backdrop: HTMLElement) {
  getModalRoot().appendChild(backdrop);
  backdrop.removeAttribute("hidden");
  raiseModalBackdrop(backdrop);
  hideHoverTip();
}

// Origin vs unscaled layout box (fixed left/top + offset size), not GBR which
// includes the closed-state scale. See docs/adr/0040-anchored-popover-motion.md.
export function setPopoverOrigin(el: HTMLElement, trigger: MotionTrigger) {
  const p = motionPoint(trigger);
  if (!p) return;
  const left = Number.parseFloat(el.style.left);
  const top = Number.parseFloat(el.style.top);
  const originX = p.x - (Number.isFinite(left) ? left : 0);
  const originY = p.y - (Number.isFinite(top) ? top : 0);
  el.style.transformOrigin = `${originX}px ${originY}px`;
}

export function isPopoverOpen(el: HTMLElement) {
  return el.classList.contains("is-open");
}

export async function openPopover(el: HTMLElement, trigger: MotionTrigger) {
  if (el.classList.contains("is-open")) return;
  el.classList.add("motion-popover");
  setPopoverOrigin(el, trigger);
  await nextFrame();
  el.classList.add("is-open");
  await waitTransition(el, "transform", POPOVER_MS);
}

export async function closePopover(el: HTMLElement, trigger?: MotionTrigger) {
  if (!el.classList.contains("is-open")) return;
  if (trigger) setPopoverOrigin(el, trigger);
  el.classList.remove("is-open");
  await waitTransition(el, "transform", POPOVER_MS);
}

export async function togglePopover(el: HTMLElement, trigger: MotionTrigger) {
  if (el.classList.contains("is-open")) {
    await closePopover(el, trigger);
    return false;
  }
  await openPopover(el, trigger);
  return true;
}

function dialogPanel(backdrop: HTMLElement, panel?: HTMLElement) {
  return panel ?? backdrop.querySelector<HTMLElement>(".dialog-panel, form.dialog-panel")!;
}

export function setDialogFly(panel: HTMLElement, trigger?: MotionTrigger, phase: "open" | "close" = "open") {
  const point = motionPoint(trigger);
  const bias = phase === "open" ? DIALOG_BIAS_OPEN : DIALOG_BIAS_CLOSE;
  const scale = phase === "open" ? DIALOG_SCALE_OPEN : DIALOG_SCALE_CLOSE;
  if (!point) {
    panel.style.setProperty("--motion-fly-x", "0px");
    panel.style.setProperty("--motion-fly-y", phase === "open" ? "10px" : "6px");
    panel.style.setProperty("--motion-fly-scale", String(scale));
    return;
  }
  const rect = panel.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  panel.style.setProperty("--motion-fly-x", `${clampBias((point.x - cx) * bias)}px`);
  panel.style.setProperty("--motion-fly-y", `${clampBias((point.y - cy) * bias)}px`);
  panel.style.setProperty("--motion-fly-scale", String(scale));
}

export function isDialogOpen(backdrop: HTMLElement) {
  return backdrop.classList.contains("is-open");
}

export async function openDialog(backdrop: HTMLElement, trigger?: MotionTrigger, panel?: HTMLElement) {
  const p = dialogPanel(backdrop, panel);
  const state = holdDialog(backdrop);
  const generation = state.generation;
  try {
    await state.lease.ready;
  } catch {
    if (dialogLeases.get(backdrop) === state && state.generation === generation) {
      hideModalBackdrop(backdrop);
      releaseDialog(backdrop, state);
      notifyModalLayer();
    }
    return;
  }
  if (dialogLeases.get(backdrop) !== state || state.generation !== generation) return;
  if (backdrop.classList.contains("is-open")) {
    notifyModalLayer();
    return;
  }
  prepareModalBackdrop(backdrop);
  backdrop.classList.add("motion-dialog");
  p.classList.add("motion-dialog-panel");
  backdrop.classList.remove("is-open");
  setDialogFly(p, trigger, "open");
  flushLayout(p);
  await nextFrame();
  if (dialogLeases.get(backdrop) !== state || state.generation !== generation) return;
  backdrop.classList.add("is-open");
  notifyModalLayer();
  await Promise.all([
    waitTransition(backdrop, "opacity", 280),
    waitTransition(p, "transform", DIALOG_MS),
  ]);
}

export async function closeDialog(backdrop: HTMLElement, trigger?: MotionTrigger, panel?: HTMLElement) {
  const state = dialogLeases.get(backdrop);
  if (!state) return;
  if (state.closing) return state.closing;
  state.generation += 1;
  const generation = state.generation;
  const closeOperation = (async () => {
    if (!backdrop.classList.contains("is-open")) {
      hideModalBackdrop(backdrop);
      if (dialogLeases.get(backdrop) === state && state.generation === generation) {
        releaseDialog(backdrop, state);
        notifyModalLayer();
      }
      return;
    }
    const p = dialogPanel(backdrop, panel);
    setDialogFly(p, trigger, "close");
    flushLayout(p);
    await nextFrame();
    if (dialogLeases.get(backdrop) !== state || state.generation !== generation) return;
    backdrop.classList.remove("is-open");
    notifyModalLayer();
    await Promise.all([
      waitTransition(backdrop, "opacity", DIALOG_CLOSE_MS),
      waitTransition(p, "transform", DIALOG_CLOSE_MS),
    ]);
    if (dialogLeases.get(backdrop) !== state || state.generation !== generation) return;
    p.style.removeProperty("--motion-fly-x");
    p.style.removeProperty("--motion-fly-y");
    p.style.removeProperty("--motion-fly-scale");
    hideModalBackdrop(backdrop);
    releaseDialog(backdrop, state);
    notifyModalLayer();
  })();
  state.closing = closeOperation;
  try {
    await closeOperation;
  } finally {
    if (state.closing === closeOperation) state.closing = null;
  }
}

const CROSSFADE_MS = 120;

export async function crossfadeSwap(el: HTMLElement, swap: () => void) {
  if (!motionEnabled()) {
    swap();
    return;
  }
  el.classList.add("motion-crossfade-out");
  await waitTransition(el, "opacity", CROSSFADE_MS);
  swap();
  el.classList.remove("motion-crossfade-out");
  el.classList.add("motion-crossfade-in");
  flushLayout(el);
  await nextFrame();
  el.classList.remove("motion-crossfade-in");
  await waitTransition(el, "opacity", CROSSFADE_MS);
}

export function bindDialog(backdrop: HTMLElement, panel?: HTMLElement) {
  let lastTrigger: MotionTrigger | undefined;
  const getPanel = () => dialogPanel(backdrop, panel);
  return {
    open: async (trigger?: MotionTrigger) => {
      lastTrigger = trigger;
      await openDialog(backdrop, trigger, getPanel());
    },
    close: async (trigger?: MotionTrigger) => {
      await closeDialog(backdrop, trigger ?? lastTrigger, getPanel());
    },
    isOpen: () => isDialogOpen(backdrop),
  };
}
