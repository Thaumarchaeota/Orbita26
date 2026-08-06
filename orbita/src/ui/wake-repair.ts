import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../core/data/client";

const HIDDEN_RELOAD_MS = 3 * 60 * 1000;
let hiddenAt = 0;

async function repair(reload: boolean) {
  try {
    await getCurrentWindow().setIgnoreCursorEvents(false);
  } catch {
    /* ignore */
  }
  try {
    await invoke("repair_window", { reload });
  } catch (err) {
    console.error("repair_window failed", err);
  }
}

export function initWakeRepair() {
  if (!isTauri()) return;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const elapsed = hiddenAt > 0 ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    void repair(elapsed >= HIDDEN_RELOAD_MS);
  });

  void getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (focused) void getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
    })
    .catch(() => {});
}
