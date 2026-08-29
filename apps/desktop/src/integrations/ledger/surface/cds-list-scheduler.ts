export type CdsListScheduler = {
  fullReconcileCount: number;
  patchCount: number;
  layoutLocked: boolean;
  setLayoutLocked(locked: boolean): void;
  noteFullReconcile(): void;
  notePatch(): void;
  shouldDeferHeavyWork(): boolean;
  onLayoutSettled(cb: () => void): () => void;
};

export function createCdsListScheduler(): CdsListScheduler {
  let layoutLocked = false;
  let fullReconcileCount = 0;
  let patchCount = 0;
  const settledCbs = new Set<() => void>();
  let pendingSettled = false;

  function flushSettled(): void {
    if (pendingSettled) return;
    pendingSettled = true;
    queueMicrotask(() => {
      pendingSettled = false;
      if (layoutLocked) return;
      for (const cb of settledCbs) cb();
    });
  }

  return {
    get fullReconcileCount() {
      return fullReconcileCount;
    },
    get patchCount() {
      return patchCount;
    },
    get layoutLocked() {
      return layoutLocked;
    },
    setLayoutLocked(locked: boolean) {
      layoutLocked = locked;
      if (!locked) flushSettled();
    },
    noteFullReconcile() {
      fullReconcileCount += 1;
    },
    notePatch() {
      patchCount += 1;
    },
    shouldDeferHeavyWork() {
      return layoutLocked;
    },
    onLayoutSettled(cb: () => void) {
      settledCbs.add(cb);
      return () => settledCbs.delete(cb);
    },
  };
}
