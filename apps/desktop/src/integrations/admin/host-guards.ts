import type { InsightDisposeReason } from "./types";

type GuardFn = (reason: InsightDisposeReason) => boolean | Promise<boolean>;

let dataDirGuard: GuardFn | null = null;

export function setHostDataDirGuard(fn: GuardFn | null): void {
  dataDirGuard = fn;
}

export async function canProceedWithDataDirChange(): Promise<boolean> {
  if (!dataDirGuard) return true;
  return dataDirGuard("data-dir-change");
}
