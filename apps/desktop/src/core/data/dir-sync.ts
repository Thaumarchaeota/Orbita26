import { isTauri } from "./client";

const REV_KEY = "orbita.data.dir-rev";
const EVENT = "orbita:data-dir-changed";
const SEEN_CAP = 32;

export type DataDirChangeStamp = {
  version: string;
  dataDir: string;
};

export function createDataDirChangeStamp(dataDir: string): DataDirChangeStamp {
  const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return { version, dataDir };
}

export function parseDataDirChangeStamp(raw: unknown): DataDirChangeStamp | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return parseDataDirChangeStamp(JSON.parse(trimmed) as unknown);
    } catch {
      return { version: trimmed, dataDir: "" };
    }
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const version = typeof o.version === "string" ? o.version.trim() : "";
    const dataDir = typeof o.dataDir === "string" ? o.dataDir : "";
    if (!version) return null;
    return { version, dataDir };
  }
  return null;
}

export function notifyDataDirChanged(dataDir = ""): DataDirChangeStamp {
  const stamp = createDataDirChangeStamp(dataDir);
  localStorage.setItem(REV_KEY, JSON.stringify(stamp));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: stamp }));
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ emit }) => emit(EVENT, stamp));
  }
  return stamp;
}

export function bindDataDirChanged(handler: (stamp: DataDirChangeStamp) => void): () => void {
  const deliver = (raw: unknown) => {
    const stamp = parseDataDirChangeStamp(raw) ?? parseDataDirChangeStamp(localStorage.getItem(REV_KEY));
    if (stamp) handler(stamp);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === REV_KEY) deliver(e.newValue);
  };
  const onLocal = (e: Event) => {
    deliver((e as CustomEvent).detail);
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onLocal);
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen(EVENT, (ev) => {
        deliver(ev.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    });
  }
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onLocal);
    unlisten?.();
  };
}

export function createIdempotentDataDirHandler(
  handler: (stamp: DataDirChangeStamp) => void,
): (stamp: DataDirChangeStamp) => void {
  const seen: string[] = [];
  return (stamp) => {
    if (seen.includes(stamp.version)) return;
    seen.push(stamp.version);
    if (seen.length > SEEN_CAP) seen.shift();
    handler(stamp);
  };
}
