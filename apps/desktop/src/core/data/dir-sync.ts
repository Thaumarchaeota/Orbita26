import { isTauri } from "./client";

const REV_KEY = "orbita.data.dir-rev";

export function notifyDataDirChanged(): void {
  localStorage.setItem(REV_KEY, String(Date.now()));
  window.dispatchEvent(new CustomEvent("orbita:data-dir-changed"));
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ emit }) => emit("orbita:data-dir-changed"));
  }
}

export function bindDataDirChanged(handler: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === REV_KEY) handler();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("orbita:data-dir-changed", handler);
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen("orbita:data-dir-changed", handler).then((fn) => {
        unlisten = fn;
      });
    });
  }
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("orbita:data-dir-changed", handler);
    unlisten?.();
  };
}
