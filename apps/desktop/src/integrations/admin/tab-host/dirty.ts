export type DirtyStatus = { dirty: boolean; inFlight: boolean; failed: boolean };

const EMPTY: DirtyStatus = { dirty: false, inFlight: false, failed: false };

const statusMap = new Map<string, DirtyStatus>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  listeners.get(key)?.forEach((fn) => fn());
}

export function setDirtyStatus(key: string, status: DirtyStatus): void {
  statusMap.set(key, status);
  notify(key);
}

export function getDirtyStatus(key: string): DirtyStatus {
  return statusMap.get(key) ?? EMPTY;
}

export function anyBlockingDraft(): boolean {
  for (const status of statusMap.values()) {
    if (status.dirty || status.inFlight || status.failed) return true;
  }
  return false;
}

export function clearAllDirty(): void {
  statusMap.clear();
}

export async function waitAllInFlight(timeoutMs = 15000): Promise<boolean> {
  const keys = [...statusMap.keys()];
  const results = await Promise.all(keys.map((key) => waitInFlight(key, timeoutMs)));
  return results.every(Boolean);
}

export function waitInFlight(key: string, timeoutMs = 15000): Promise<boolean> {
  if (!getDirtyStatus(key).inFlight) return Promise.resolve(true);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setInterval> | null = null;
    let listener: (() => void) | null = null;

    const cleanup = () => {
      if (timer !== null) clearInterval(timer);
      if (listener) listeners.get(key)?.delete(listener);
    };

    const check = () => {
      if (!getDirtyStatus(key).inFlight) {
        cleanup();
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        cleanup();
        resolve(false);
      }
    };

    listener = check;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(listener);
    timer = setInterval(check, 50);
    check();
  });
}
