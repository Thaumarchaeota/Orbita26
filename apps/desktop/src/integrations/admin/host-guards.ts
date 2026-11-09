import type { InsightDisposeReason } from "./types";

type GuardFn = (reason: InsightDisposeReason) => boolean | Promise<boolean>;

let dataDirGuard: GuardFn | null = null;
let localSwitchAuthorized = false;
let domainWritesPaused = false;

export function setHostDataDirGuard(fn: GuardFn | null): void {
  dataDirGuard = fn;
}

export async function canProceedWithDataDirChange(): Promise<boolean> {
  if (!dataDirGuard) return true;
  return dataDirGuard("data-dir-change");
}

/** Originating window already passed dirty confirm; cleanup must not prompt again. */
export function markLocalDataDirSwitchAuthorized(): void {
  localSwitchAuthorized = true;
}

export function consumeLocalDataDirSwitchAuthorized(): boolean {
  const next = localSwitchAuthorized;
  localSwitchAuthorized = false;
  return next;
}

export function clearLocalDataDirSwitchAuthorized(): void {
  localSwitchAuthorized = false;
}

export function pauseInsightDomainWrites(): void {
  domainWritesPaused = true;
}

export function resumeInsightDomainWrites(): void {
  domainWritesPaused = false;
}

export function insightDomainWritesPaused(): boolean {
  return domainWritesPaused;
}
