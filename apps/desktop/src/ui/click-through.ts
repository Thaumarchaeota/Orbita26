import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../core/data/client";
import { getSettings, isTransparentTheme } from "../core/settings";
import { hasInteractionLeases, installInteractionBridge } from "./interaction-lease";

const INTERACTIVE =
  ".primary-mood-menu,.shell-sidebar,.ticktick-section,[data-orbita-hit='interactive'],.capture-overlay,.dialog-backdrop,.folder-overlay-scrim,.folder-overlay-panel,.launcher-tile,.local-tree-row,.local-ctx-menu,.launcher-head,.search-bar,button,input,a,textarea,select,form,[contenteditable='true']";
const STRUCTURAL_IDS = new Set(["app"]);
const STRUCTURAL_CLASSES = new Set(["shell", "shell-body", "shell-aside"]);
const ACTIVE_GESTURE = ".is-reordering,.is-dragging,.local-file-list.is-dragging,.folder-overlay-layer.is-dragging-out,.launcher-tile-ghost,.local-tree-row-ghost";

let enabled = false;
let desiredIgnore = false;
let confirmedIgnore = false;
let loopId = 0;
let pollFailures = 0;
let epoch = 0;
let inFlight: Promise<void> = Promise.resolve();
let pollInFlight: Promise<void> | null = null;
let recoveryBlocked = false;
let nativeHealthy = true;
let idleSince = 0;
let initialized = false;
let invalidateTimer = 0;

function reportIssue(reason: string): void {
  console.error(`Panel input recovery: ${reason}`);
  window.dispatchEvent(new CustomEvent("orbita:click-through-diagnostic", { detail: { reason } }));
}

function nativeSet(value: boolean, requestEpoch: number): Promise<void> {
  const operation = inFlight.then(async () => {
    // Stale pass-through requests are discarded; a stale false request still
    // settles its caller only after the native window is explicitly interactive.
    if ((value && requestEpoch !== epoch) || (value && (!enabled || recoveryBlocked || hasInteractionLeases()))) return;
    desiredIgnore = value;
    try {
      await getCurrentWindow().setIgnoreCursorEvents(value);
      if (requestEpoch === epoch) {
        confirmedIgnore = value;
        nativeHealthy = true;
        if (!value && recoveryBlocked) {
          recoveryBlocked = false;
          invalidateClickThrough();
        }
      }
    } catch (error) {
      if (requestEpoch === epoch) {
        desiredIgnore = false;
        recoveryBlocked = true;
        nativeHealthy = false;
      }
      reportIssue("native input mode could not be changed; pass-through is paused");
      if (value) {
        // Best effort repair uses the same serial lane and the current epoch.
        await getCurrentWindow().setIgnoreCursorEvents(false).then(() => {
          if (requestEpoch === epoch) confirmedIgnore = false;
          nativeHealthy = true;
          if (recoveryBlocked) {
            recoveryBlocked = false;
            invalidateClickThrough();
          }
        }).catch(() => reportIssue("native interactive fallback could not be confirmed"));
      } else {
        throw error;
      }
    }
  });
  inFlight = operation.catch(() => {});
  return operation;
}

function requestInteractive(): Promise<void> {
  desiredIgnore = false;
  epoch += 1;
  const requestEpoch = epoch;
  return nativeSet(false, requestEpoch).then(async () => {
    if (enabled) startLoop();
    // Focus and wake can leave a stationary cursor over a transparent gap.
    // Sample the live global cursor once after native interactivity is confirmed.
    if (enabled && !hasInteractionLeases() && !recoveryBlocked) await sampleLiveCursorOnce();
  });
}

async function sampleLiveCursorOnce(): Promise<void> {
  if (!enabled || hasInteractionLeases() || recoveryBlocked) return;
  try {
    const win = getCurrentWindow();
    const [inner, factor, cursor, size] = await Promise.all([
      win.innerPosition(), win.scaleFactor(), cursorPosition(), win.innerSize(),
    ]);
    const x = (cursor.x - inner.x) / factor;
    const y = (cursor.y - inner.y) / factor;
    if (x >= 0 && y >= 0 && x < size.width / factor && y < size.height / factor) {
      await updateAt(x, y);
    }
  } catch {
    // A failed sample must not make a confirmed interactive window unhealthy.
  }
}

function visible(node: HTMLElement): boolean {
  if (!node.isConnected || node.hidden) return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function hasBlockingSurface(): boolean {
  return !!document.querySelector(
    ".dialog-backdrop.is-open:not([hidden]),.folder-overlay-layer.is-open,.capture-overlay.is-open",
  );
}

function shouldPassThrough(x: number, y: number): boolean {
  if (hasInteractionLeases() || hasBlockingSurface() || document.querySelector(ACTIVE_GESTURE) || recoveryBlocked) return false;
  const stack = document.elementsFromPoint(x, y);
  if (stack.length === 0) return false;
  for (const element of stack) {
    if (!(element instanceof HTMLElement) || !visible(element)) continue;
    if (element.closest(INTERACTIVE)) return false;
    if (
      element === document.body ||
      element === document.documentElement ||
      STRUCTURAL_IDS.has(element.id) ||
      Array.from(element.classList).some((name) => STRUCTURAL_CLASSES.has(name)) ||
      element.classList.contains("bg")
    ) continue;
    // Unknown DOM remains conservative: only explicitly structural empty nodes pass.
    return false;
  }
  return true;
}

function updateAt(x: number, y: number): Promise<void> {
  if (!enabled) return Promise.resolve();
  const pass = shouldPassThrough(x, y);
  if (!pass) {
    if (!confirmedIgnore && !desiredIgnore) return Promise.resolve();
    return requestInteractive();
  }
  if (confirmedIgnore || desiredIgnore || hasInteractionLeases() || recoveryBlocked) return Promise.resolve();
  desiredIgnore = true;
  const requestEpoch = epoch;
  return nativeSet(true, requestEpoch);
}

function onPointerMove(event: PointerEvent): void {
  idleSince = performance.now();
  void updateAt(event.clientX, event.clientY).catch(() => {});
}

async function pollCursorOnce(sampleInteractive = false): Promise<void> {
  if (!enabled || (!confirmedIgnore && !sampleInteractive) || pollInFlight) return;
  const current = (async () => {
    try {
      const win = getCurrentWindow();
      const [inner, factor, cursor, size] = await Promise.all([
        win.innerPosition(), win.scaleFactor(), cursorPosition(), win.innerSize(),
      ]);
      const x = (cursor.x - inner.x) / factor;
      const y = (cursor.y - inner.y) / factor;
      pollFailures = 0;
      if (x < 0 || y < 0 || x >= size.width / factor || y >= size.height / factor) {
        await requestInteractive();
      } else {
        await updateAt(x, y);
      }
    } catch {
      pollFailures += 1;
      if (pollFailures >= 3) {
        reportIssue("cursor position polling failed repeatedly; pass-through is paused");
        await requestInteractive().catch(() => {});
      }
    }
  })();
  pollInFlight = current;
  try { await current; } finally { if (pollInFlight === current) pollInFlight = null; }
}

function loop(): void {
  if (!enabled) { loopId = 0; return; }
  if (confirmedIgnore && !recoveryBlocked) void pollCursorOnce();
  const idleMs = idleSince > 0 ? performance.now() - idleSince : 0;
  loopId = window.setTimeout(loop, confirmedIgnore ? (idleMs > 500 ? 120 : 16) : 120);
}

function startLoop(): void { if (!loopId) loop(); }
function stopLoop(): void { if (loopId) { clearTimeout(loopId); loopId = 0; } }

async function enable(): Promise<void> {
  if (enabled) return;
  enabled = true;
  // Install recovery hooks before the first native request. If that request
  // fails, focus/wake events can still retry explicitly without a timer loop
  // repeatedly issuing native changes.
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("keydown", onKeyDown);
  try {
    await requestInteractive();
  } catch {
    return;
  }
  void pollCursorOnce(true);
  invalidateClickThrough();
}

async function disable(): Promise<void> {
  if (!enabled && !confirmedIgnore && !desiredIgnore) return;
  enabled = false;
  epoch += 1;
  recoveryBlocked = false;
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("keydown", onKeyDown);
  stopLoop();
  desiredIgnore = false;
  try { await nativeSet(false, epoch); } catch { /* keep the native failure state visible */ }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") void requestInteractive().catch(() => {});
}

function sync(): void {
  if (!isTauri()) return;
  if (isTransparentTheme(getSettings().theme)) void enable();
  else void disable();
}

function onInteractionChanged(): void {
  invalidateClickThrough();
  if (enabled && !hasInteractionLeases() && !confirmedIgnore && !recoveryBlocked) {
    void sampleLiveCursorOnce();
  }
}

export function invalidateClickThrough(): void {
  if (invalidateTimer) cancelAnimationFrame(invalidateTimer);
  invalidateTimer = requestAnimationFrame(() => {
    invalidateTimer = 0;
    if (!enabled) return;
    const x = lastPointer?.x ?? -1;
    const y = lastPointer?.y ?? -1;
    if (x >= 0 && y >= 0) void updateAt(x, y).catch(() => {});
    else void pollCursorOnce(true);
  });
}

let lastPointer: { x: number; y: number } | null = null;
function rememberPointer(event: PointerEvent): void { lastPointer = { x: event.clientX, y: event.clientY }; }

export async function recoverClickThrough(): Promise<void> {
  if (!isTauri()) return;
  recoveryBlocked = true;
  nativeHealthy = false;
  epoch += 1;
  desiredIgnore = false;
  const recovery = requestInteractive();
  const settled = await Promise.race([
    recovery.then(() => true),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1500)),
  ]).catch(() => false);
  if (!settled || !nativeHealthy) reportIssue("wake recovery timed out; pass-through remains paused");
}

export function initClickThrough(): void {
  if (!isTauri() || initialized) return;
  initialized = true;
  installInteractionBridge({ acquire: requestInteractive, changed: onInteractionChanged });
  document.addEventListener("pointermove", rememberPointer, { passive: true });
  void requestInteractive().catch(() => {});
  void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) void requestInteractive().catch(() => {});
  }).catch(() => {});
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target === document.documentElement && record.attributeName === "data-theme")) {
      sync();
      return;
    }
    invalidateClickThrough();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style"] });
  window.addEventListener("orbita:ui-prefs", sync);
  window.addEventListener("resize", invalidateClickThrough);
  window.addEventListener("orbita:modal-layer", invalidateClickThrough);
  sync();
}
