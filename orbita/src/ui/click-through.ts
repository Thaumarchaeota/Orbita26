import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../core/data/client";
import { getSettings, isTransparentTheme } from "../core/settings";

const INTERACTIVE =
  ".shell-top-inner,.shell-sidebar,.ai-section,.ticktick-section,.top-tray,.dialog-backdrop,.folder-overlay-scrim,.folder-overlay-panel,.launcher-tile,.local-tree-row,.local-ctx-menu,.launcher-tile-ghost,.local-tree-row-ghost,button,input,a,textarea,select,[contenteditable='true']";

let enabled = false;
let ignoring = false;
let loopId = 0;

function dragging(): boolean {
  return !!document.querySelector(
    ".is-reordering,.is-dragging,.local-file-list.is-dragging,.folder-overlay-layer.is-dragging-out",
  );
}

function shouldPassThrough(x: number, y: number): boolean {
  if (dragging()) return false;
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest(INTERACTIVE)) return false;
    if (
      el === document.body ||
      el === document.documentElement ||
      el.id === "app" ||
      el.classList.contains("bg") ||
      el.classList.contains("shell") ||
      el.classList.contains("shell-body") ||
      el.classList.contains("shell-top") ||
      el.classList.contains("shell-aside")
    ) {
      continue;
    }
    return false;
  }
  return true;
}

async function forceInteractive() {
  if (!ignoring) return;
  ignoring = false;
  try {
    await getCurrentWindow().setIgnoreCursorEvents(false);
  } catch {
    /* ignore */
  }
}

async function updateAt(x: number, y: number) {
  if (!enabled) return;
  const pass = shouldPassThrough(x, y);
  if (!pass) {
    await forceInteractive();
    return;
  }
  if (ignoring) return;
  ignoring = true;
  try {
    await getCurrentWindow().setIgnoreCursorEvents(true);
  } catch (err) {
    console.error("setIgnoreCursorEvents failed", err);
    ignoring = false;
  }
}

function onPointerMove(e: PointerEvent) {
  void updateAt(e.clientX, e.clientY);
}

async function pollCursor() {
  if (!enabled) return;
  try {
    const win = getCurrentWindow();
    const [inner, factor, cursor, size] = await Promise.all([
      win.innerPosition(),
      win.scaleFactor(),
      cursorPosition(),
      win.innerSize(),
    ]);
    const x = (cursor.x - inner.x) / factor;
    const y = (cursor.y - inner.y) / factor;
    const w = size.width / factor;
    const h = size.height / factor;
    if (x < 0 || y < 0 || x >= w || y >= h) {
      await forceInteractive();
    } else {
      await updateAt(x, y);
    }
  } catch {
    /* ignore */
  }
}

function loop() {
  if (!enabled) {
    loopId = 0;
    return;
  }
  if (ignoring) void pollCursor();
  loopId = window.setTimeout(() => {
    loopId = 0;
    loop();
  }, ignoring ? 16 : 120);
}

function startLoop() {
  if (loopId) return;
  loop();
}

function stopLoop() {
  if (!loopId) return;
  clearTimeout(loopId);
  loopId = 0;
}

async function enable() {
  if (enabled) return;
  enabled = true;
  await forceInteractive();
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  startLoop();
}

async function disable() {
  if (!enabled) return;
  enabled = false;
  document.removeEventListener("pointermove", onPointerMove);
  stopLoop();
  await forceInteractive();
}

function sync() {
  if (!isTauri()) return;
  if (isTransparentTheme(getSettings().theme)) void enable();
  else void disable();
}

function watchTheme() {
  const obs = new MutationObserver(() => sync());
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export function initClickThrough() {
  if (!isTauri()) return;
  void getCurrentWindow()
    .setIgnoreCursorEvents(false)
    .catch(() => {});
  watchTheme();
  sync();
  window.addEventListener("orbita:ui-prefs", sync);
}
