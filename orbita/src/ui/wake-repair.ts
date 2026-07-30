import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../core/data/client";

const SLEEP_MS = 3 * 60 * 1000;
let hiddenAt = 0;

export function initWakeRepair() {
  if (!isTauri()) return;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const reload = hiddenAt > 0 && Date.now() - hiddenAt >= SLEEP_MS;
    void invoke("repair_window", { reload });
  });
}
