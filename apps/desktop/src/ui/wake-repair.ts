import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../core/data/client";
import { recoverClickThrough } from "./click-through";

const HIDDEN_RELOAD_MS = 3 * 60 * 1000;
let hiddenAt = 0;

async function repair(reload: boolean) {
  // The Panel controller invalidates stale pointer polls before recovery; this
  // remains bounded so native input trouble cannot block window repair.
  await recoverClickThrough().catch((err) => console.error("Click-through recovery failed", err));
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
    void (async () => {
      const wantReload = elapsed >= HIDDEN_RELOAD_MS;
      if (!wantReload) {
        await repair(false);
        return;
      }
      let skip = false;
      try {
        if (getCurrentWindow().label === "admin") {
          skip = await invoke<boolean>("insight_has_unsaved");
        }
      } catch {
        skip = false;
      }
      await repair(wantReload && !skip);
    })();
  });

  void getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (focused) void recoverClickThrough().catch((err) => console.error("Click-through focus recovery failed", err));
    })
    .catch(() => {});
}
