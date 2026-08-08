import { fetchEntries, fetchSettings, postCommit } from "../api/client";
import { RECENT_DAYS } from "../constants";
import { buildCommitPayload, stripMarkers } from "../domain/commit";
import { normalizeEntry } from "../domain/entry";
import { isActiveEntry, ledgerStateEqual } from "../domain/ledger-equal";
import { nextSeqForDate, sortDetailEntries } from "../domain/seq";
import type { EntriesResponse, Entry } from "../types";
import { cloneEntries, todayMinusDays } from "../utils";
import { getWriteTarget, setWriteTarget } from "./write-target";

export type LoadState = "loading" | "partial" | "ready";
export type SaveLock = "checking" | "submitting" | null;

let detailEntries: Entry[] = [];
let baseline: Entry[] = [];
let confirmSnapshot: Entry[] | null = null;
let loadState: LoadState = "loading";
let saveLock: SaveLock = null;
let backgroundLoadPromise: Promise<void> | null = null;

const detailMutatedListeners: Array<() => void> = [];
const afterCommitFilterListeners: Array<() => void> = [];

export function onDetailMutated(fn: () => void): () => void {
  detailMutatedListeners.push(fn);
  return () => {
    const i = detailMutatedListeners.indexOf(fn);
    if (i >= 0) detailMutatedListeners.splice(i, 1);
  };
}

function notifyDetailMutated(): void {
  for (const fn of detailMutatedListeners) fn();
}

export function getDetailEntries(): Entry[] {
  return detailEntries;
}

export function setDetailEntries(entries: Entry[]): void {
  detailEntries = entries;
  sortDetailEntries(detailEntries);
}

export function getBaseline(): Entry[] {
  return baseline;
}

export function getConfirmSnapshot(): Entry[] | null {
  return confirmSnapshot;
}

export function setConfirmSnapshot(v: Entry[] | null): void {
  confirmSnapshot = v;
}

export function resetConfirmSnapshot(): void {
  confirmSnapshot = null;
}

export function getLoadState(): LoadState {
  return loadState;
}

export function getSaveLock(): SaveLock {
  return saveLock;
}

export function setSaveLock(lock: SaveLock): void {
  saveLock = lock;
}

export function isLedgerDirty(): boolean {
  return !ledgerStateEqual(detailEntries, baseline);
}

export function needsMore(
  resp: EntriesResponse,
  dateFrom: string,
  loadedCount: number,
): boolean {
  return (
    (resp.date_min != null && resp.date_min < dateFrom) ||
    resp.has_more === true ||
    (resp.total != null && resp.total > loadedCount)
  );
}

function setBaselineFromDetail(): void {
  baseline = stripMarkers(cloneEntries(detailEntries));
}

function mergeEntriesFromApi(apiEntries: Entry[]): void {
  const byId = new Map(detailEntries.map((e) => [e.id, e]));
  for (const raw of apiEntries) {
    const n = normalizeEntry(raw);
    if (!byId.has(n.id)) {
      detailEntries.push(n);
      byId.set(n.id, n);
    }
  }
  sortDetailEntries(detailEntries);
}

async function backgroundLoadAll(): Promise<void> {
  if (backgroundLoadPromise) return backgroundLoadPromise;
  backgroundLoadPromise = (async () => {
    try {
      const data = await fetchEntries();
      mergeEntriesFromApi(data.entries || []);
      setBaselineFromDetail();
      loadState = "ready";
    } catch {
      loadState = detailEntries.length ? "partial" : "loading";
    } finally {
      backgroundLoadPromise = null;
    }
  })();
  return backgroundLoadPromise;
}

export async function ensureLoadReady(): Promise<boolean> {
  if (loadState === "ready") return true;
  await backgroundLoadAll();
  return getLoadState() === "ready";
}

export async function tryLoadOlder(): Promise<void> {
  if (loadState === "ready") return;
  await backgroundLoadAll();
}

export async function loadSettings(): Promise<void> {
  const data = await fetchSettings();
  setWriteTarget(data.write_target);
}

export async function loadDetail(fromCommit = false): Promise<void> {
  loadState = "loading";
  try {
    const recentFrom = todayMinusDays(RECENT_DAYS);
    const data = await fetchEntries({ date_from: recentFrom });
    detailEntries = (data.entries || []).map(normalizeEntry);
    sortDetailEntries(detailEntries);
    const more = needsMore(data, recentFrom, detailEntries.length);
    if (more) {
      loadState = "partial";
      void backgroundLoadAll();
    } else {
      loadState = "ready";
      setBaselineFromDetail();
    }
    if (!more || fromCommit) {
      setBaselineFromDetail();
    }
    confirmSnapshot = null;
    notifyDetailMutated();
  } catch {
    loadState = "loading";
  }
}

export function pushEntry(entry: Entry): void {
  detailEntries.push(entry);
  sortDetailEntries(detailEntries);
  notifyDetailMutated();
}

export function softDeleteEntry(id: string): boolean {
  const entry = detailEntries.find((e) => e.id === id);
  if (!entry) return false;
  entry._deleted = true;
  notifyDetailMutated();
  return true;
}

export function undoDeleteEntry(id: string): boolean {
  const entry = detailEntries.find((e) => e.id === id);
  if (!entry) return false;
  entry._deleted = false;
  notifyDetailMutated();
  return true;
}

export function applyDetailFiltersAfterCommit(): void {
  for (const fn of afterCommitFilterListeners) fn();
  notifyDetailMutated();
}

export function onAfterCommitFilter(fn: () => void): () => void {
  afterCommitFilterListeners.push(fn);
  return () => {
    const i = afterCommitFilterListeners.indexOf(fn);
    if (i >= 0) afterCommitFilterListeners.splice(i, 1);
  };
}

export async function commitNewEntry(
  partial: Omit<Entry, "id" | "source_file" | "source_line" | "seq">,
): Promise<void> {
  await loadSettings();
  if (loadState === "loading") {
    await loadDetail();
  }
  const target = getWriteTarget();
  const source =
    detailEntries.length > 0
      ? detailEntries
      : (await fetchEntries()).entries.map(normalizeEntry);
  const entry: Entry = {
    ...partial,
    id: `new:${Date.now()}`,
    source_file: target,
    source_line: 999999,
    seq: nextSeqForDate(source, partial.date),
    _is_new: true,
  };
  const active = source.filter(isActiveEntry);
  const payload = buildCommitPayload(target, [...active, entry]);
  const { res, data } = await postCommit(payload);
  if (!data.ok) {
    const err = data.results?.find((r) => !r.ok)?.error || "保存失败";
    throw new Error(err);
  }
  if (!res.ok && res.status !== 207) {
    throw new Error("保存失败");
  }
  await loadDetail(true);
  applyDetailFiltersAfterCommit();
}
