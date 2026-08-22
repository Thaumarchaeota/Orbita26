import { fetchEntries, fetchSettings } from "../api/client";
import { RECENT_DAYS, REMARK_MAX_LENGTH } from "../constants";
import { stripMarkers } from "../domain/commit";
import { getActiveCommitItems } from "../domain/detail-item-api";
import {
  assignImportSeq,
  type CsvImportOrder,
  transactionDraftToEntry,
} from "../domain/csv-import";
import { isTransactionItem, normalizeDetailItem } from "../domain/detail-item";
import type { SavePhase, Transaction } from "../domain/ledger-item";
import { detailStateEqual, ledgerStateEqual } from "../domain/ledger-equal";
import { normalizeEntry } from "../domain/entry";
import { newOrbitaId } from "../domain/orbita-id";
import { nextSeqForDate, sortDetailEntries } from "../domain/seq";
import {
  countTimeMetadataKeys,
  rewriteTxnTimeDate,
  upsertTxnTimeMetadata,
} from "../domain/txn-time";
import type { DetailItem, EntriesResponse, Entry, IdentityBackfill, CandidateDiagnostic } from "../types";
import { cloneDetailItems, cloneEntries, todayMinusDays } from "../utils";
import { getWriteTarget, setWriteTarget } from "./write-target";

export type EntryFieldPatch =
  | { field: "date"; value: string }
  | { field: "flag"; value: string }
  | { field: "time"; value: string }
  | { field: "remark"; value: string }
  | { field: "payee"; value: string }
  | { field: "tags"; value: string }
  | { field: "type"; value: Entry["type"] }
  | { field: "account"; postingIndex: number; value: string }
  | { field: "amount"; postingIndex: number; value: number }
  | { field: "currency"; postingIndex: number; value: string }
  | { field: "cost_amount"; postingIndex: number; value: number | null }
  | { field: "cost_currency"; postingIndex: number; value: string };

export type LoadState = "loading" | "partial" | "ready";

export type MutationBlockedReason = "save-in-progress" | "invalid-target";

export type StoreMutationResult =
  | { ok: true }
  | { ok: false; reason: MutationBlockedReason };

/** @deprecated use getSavePhase */
export type SaveLock = "checking" | "submitting" | null;

let detailItems: DetailItem[] = [];
let baseline: Entry[] = [];
let loadState: LoadState = "loading";
let savePhase: SavePhase = "unedited";
let confirmSnapshot: DetailItem[] | null = null;
let validationToken: string | null = null;
let candidateHash: string | null = null;
let backgroundLoadPromise: Promise<void> | null = null;
let loadGeneration = 0;
let workGeneration = 0;
let postCommitRefreshFailed = false;
let loadAbort: AbortController | null = null;
let loadDiagnostics: CandidateDiagnostic[] = [];
let loadError: string | null = null;

const mutatedListeners: Array<() => void> = [];
const savePhaseListeners: Array<() => void> = [];
const afterCommitFilterListeners: Array<() => void> = [];

function notifyMutated(): void {
  for (const fn of mutatedListeners) fn();
}

function notifySavePhase(): void {
  for (const fn of savePhaseListeners) fn();
}

function clearValidationSession(): void {
  validationToken = null;
  candidateHash = null;
}

function bumpWorkGeneration(): void {
  workGeneration += 1;
}

function rejectIfBlocked(): StoreMutationResult | null {
  if (savePhase === "checking" || savePhase === "submitting") {
    return { ok: false, reason: "save-in-progress" };
  }
  return null;
}

export function isSemanticMutationBlocked(): boolean {
  return savePhase === "checking" || savePhase === "submitting";
}

export function getWorkGeneration(): number {
  return workGeneration;
}

function syncIdleSavePhase(): void {
  if (savePhase === "checking" || savePhase === "submitting") return;
  if (!isLedgerDirty()) {
    confirmSnapshot = null;
    clearValidationSession();
    savePhase = "unedited";
    return;
  }
  if (
    confirmSnapshot &&
    validationToken &&
    candidateHash &&
    detailStateEqual(detailItems, confirmSnapshot)
  ) {
    savePhase = "confirming";
    return;
  }
  if (confirmSnapshot && !detailStateEqual(detailItems, confirmSnapshot)) {
    confirmSnapshot = null;
    clearValidationSession();
  }
  savePhase = "edited";
}

function invalidateOnMutation(): void {
  if (savePhase === "checking" || savePhase === "submitting") return;
  bumpWorkGeneration();
  postCommitRefreshFailed = false;
  if (confirmSnapshot && !detailStateEqual(detailItems, confirmSnapshot)) {
    confirmSnapshot = null;
    clearValidationSession();
  }
  syncIdleSavePhase();
}

export function onDetailMutated(fn: () => void): () => void {
  mutatedListeners.push(fn);
  return () => {
    const i = mutatedListeners.indexOf(fn);
    if (i >= 0) mutatedListeners.splice(i, 1);
  };
}

export function onSavePhaseChanged(fn: () => void): () => void {
  savePhaseListeners.push(fn);
  return () => {
    const i = savePhaseListeners.indexOf(fn);
    if (i >= 0) savePhaseListeners.splice(i, 1);
  };
}

export function getDetailItems(): DetailItem[] {
  return detailItems;
}

export function getDetailEntries(): Entry[] {
  return detailItems.filter(isTransactionItem);
}

export function setDetailEntries(items: DetailItem[]): StoreMutationResult {
  const blocked = rejectIfBlocked();
  if (blocked) return blocked;
  detailItems = items;
  sortDetailEntries(detailItems);
  invalidateOnMutation();
  notifyMutated();
  return { ok: true };
}

export function getBaseline(): Entry[] {
  return baseline;
}

export function getConfirmSnapshot(): DetailItem[] | null {
  return confirmSnapshot;
}

/** @deprecated internal save flow uses enterConfirming */
export function setConfirmSnapshot(v: DetailItem[] | null): void {
  confirmSnapshot = v;
  syncIdleSavePhase();
  notifySavePhase();
}

export function resetConfirmSnapshot(): void {
  confirmSnapshot = null;
  clearValidationSession();
  syncIdleSavePhase();
  notifySavePhase();
}

export function getLoadDiagnostics(): CandidateDiagnostic[] {
  return loadDiagnostics;
}

export function hasLoadDiagnostics(): boolean {
  return loadDiagnostics.length > 0;
}

function setLoadDiagnostics(diags: CandidateDiagnostic[] | undefined): void {
  loadDiagnostics = diags ?? [];
}

export function getLoadState(): LoadState {
  return loadState;
}

export function getLoadError(): string | null {
  return loadError;
}

export function getSavePhase(): SavePhase {
  return savePhase;
}

/** @deprecated use getSavePhase */
export function getSaveLock(): SaveLock {
  if (savePhase === "checking") return "checking";
  if (savePhase === "submitting") return "submitting";
  return null;
}

/** @deprecated use beginSaveCheck / beginSaveSubmit / syncIdleSavePhase */
export function setSaveLock(lock: SaveLock): void {
  if (lock === "checking") beginSaveCheck();
  else if (lock === "submitting") beginSaveSubmit();
  else syncIdleSavePhase();
  notifySavePhase();
}

export function getValidationSession(): { token: string; hash: string } | null {
  if (!validationToken || !candidateHash) return null;
  return { token: validationToken, hash: candidateHash };
}

export function setValidationSession(token: string, hash: string): void {
  validationToken = token;
  candidateHash = hash;
}

export function beginSaveCheck(): void {
  loadGeneration++;
  loadAbort?.abort();
  loadAbort = null;
  savePhase = "checking";
  notifySavePhase();
}

export function enterConfirming(snapshot: DetailItem[], token: string, hash: string): void {
  confirmSnapshot = snapshot;
  validationToken = token;
  candidateHash = hash;
  savePhase = "confirming";
  notifySavePhase();
}

export function returnToEditedAfterCheckFailure(): void {
  savePhase = "edited";
  notifySavePhase();
}

export function beginSaveSubmit(): void {
  loadGeneration++;
  loadAbort?.abort();
  loadAbort = null;
  savePhase = "submitting";
  notifySavePhase();
}

export function returnToConfirmingAfterSubmitFailure(): void {
  savePhase =
    confirmSnapshot && validationToken && candidateHash ? "confirming" : "edited";
  notifySavePhase();
}

export function enterPostCommitRefreshFailed(): void {
  postCommitRefreshFailed = true;
  notifySavePhase();
}

export function enterRefreshFailedAfterCommit(): void {
  enterPostCommitRefreshFailed();
}

export function isPostCommitRefreshFailed(): boolean {
  return postCommitRefreshFailed;
}

export function isRefreshFailedPhase(): boolean {
  return postCommitRefreshFailed;
}

export function clearPostCommitRefreshFailed(): void {
  postCommitRefreshFailed = false;
  notifySavePhase();
}

export function establishCommitBaseline(): void {
  detailItems = detailItems.filter(
    (item) => !(isTransactionItem(item) && item._deleted),
  );
  setBaselineFromDetail();
}

export function markSaveSucceeded(): void {
  confirmSnapshot = null;
  clearValidationSession();
  postCommitRefreshFailed = false;
  savePhase = "unedited";
  notifySavePhase();
}

export function notifyWorkCopyEdited(): void {
  invalidateOnMutation();
  notifySavePhase();
}

export function touchWorkCopy(): void {
  invalidateOnMutation();
  notifyMutated();
  notifySavePhase();
}

export function isLedgerDirty(): boolean {
  return !ledgerStateEqual(getDetailEntries(), baseline);
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
  baseline = stripMarkers(cloneEntries(getDetailEntries()));
}

function establishBaselineFromEntries(entries: Entry[]): void {
  baseline = stripMarkers(cloneEntries(entries));
}

function extendBaselineFromEntries(entries: Entry[]): void {
  if (!entries.length) return;
  const known = new Set(baseline.map((e) => e.id));
  const additions = stripMarkers(cloneEntries(entries)).filter((e) => !known.has(e.id));
  if (!additions.length) return;
  baseline = [...baseline, ...additions];
}

function isLoadStale(gen: number): boolean {
  return gen !== loadGeneration;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function beginLoadSession(): { gen: number; signal: AbortSignal } {
  loadAbort?.abort();
  loadAbort = new AbortController();
  const gen = ++loadGeneration;
  backgroundLoadPromise = null;
  loadError = null;
  return { gen, signal: loadAbort.signal };
}

export function invalidateLedgerLoads(): void {
  loadGeneration++;
  loadAbort?.abort();
  loadAbort = null;
  backgroundLoadPromise = null;
  loadError = null;
}

function mergeEntriesFromApi(apiEntries: DetailItem[]): void {
  const byId = new Map(detailItems.map((e) => [e.id, e]));
  for (const raw of apiEntries) {
    const n = normalizeDetailItem(raw);
    if (!byId.has(n.id)) {
      detailItems.push(n);
      byId.set(n.id, n);
    }
  }
  sortDetailEntries(detailItems);
}

async function backgroundLoadAll(sessionGen: number, signal?: AbortSignal): Promise<void> {
  if (backgroundLoadPromise) return backgroundLoadPromise;
  backgroundLoadPromise = (async () => {
    try {
      const data = await fetchEntries({}, signal);
      if (isLoadStale(sessionGen)) return;
      setLoadDiagnostics(data.diagnostics);
      mergeEntriesFromApi(data.entries || []);
      extendBaselineFromEntries(
        (data.entries || []).filter(isTransactionItem).map((e) => normalizeEntry(e as Entry)),
      );
      loadState = "ready";
      loadError = null;
      notifyMutated();
    } catch (err) {
      if (isLoadStale(sessionGen) || isAbortError(err)) return;
      loadError = err instanceof Error ? err.message : "加载失败";
      loadState = detailItems.length ? "partial" : "loading";
      notifyMutated();
    } finally {
      backgroundLoadPromise = null;
    }
  })();
  return backgroundLoadPromise;
}

export async function ensureLoadReady(): Promise<boolean> {
  if (loadState === "ready") return true;
  await backgroundLoadAll(loadGeneration, loadAbort?.signal);
  return getLoadState() === "ready";
}

export async function tryLoadOlder(): Promise<void> {
  if (loadState === "ready") return;
  await backgroundLoadAll(loadGeneration, loadAbort?.signal);
}

export async function loadSettings(): Promise<void> {
  const gen = loadGeneration;
  const signal = loadAbort?.signal;
  try {
    const data = await fetchSettings(signal);
    if (isLoadStale(gen)) return;
    setWriteTarget(data.write_target);
  } catch (err) {
    if (isLoadStale(gen) || isAbortError(err)) return;
    throw err;
  }
}

export async function loadDetail(fromCommit = false, workGenGuard?: number): Promise<void> {
  const { gen, signal } = beginLoadSession();
  loadState = "loading";
  const fail = (err: unknown): never => {
    const message = err instanceof Error ? err.message : "加载失败";
    loadError = message;
    notifyMutated();
    throw err instanceof Error ? err : new Error(message);
  };
  try {
    const recentFrom = todayMinusDays(RECENT_DAYS);
    const data = await fetchEntries({ date_from: recentFrom }, signal);
    if (isLoadStale(gen)) {
      if (fromCommit) fail(new Error("重读被中断"));
      return;
    }
    if (fromCommit && workGenGuard !== undefined && workGenGuard !== workGeneration) {
      return;
    }
    setLoadDiagnostics(data.diagnostics);
    detailItems = (data.entries || []).map(normalizeDetailItem);
    sortDetailEntries(detailItems);
    const more = needsMore(data, recentFrom, detailItems.length);
    const firstPageEntries = getDetailEntries();
    establishBaselineFromEntries(firstPageEntries);
    if (more) {
      loadState = "partial";
      void backgroundLoadAll(gen, signal);
    } else {
      loadState = "ready";
    }
    if (fromCommit) {
      setBaselineFromDetail();
    }
    confirmSnapshot = null;
    clearValidationSession();
    if (!fromCommit) {
      savePhase = "unedited";
    }
    loadError = null;
    notifyMutated();
    notifySavePhase();
  } catch (err) {
    if (isAbortError(err)) {
      if (fromCommit) fail(err);
      if (isLoadStale(gen)) return;
    }
    if (isLoadStale(gen)) {
      if (fromCommit) fail(new Error("重读被中断"));
      return;
    }
    if (fromCommit) fail(err);
    loadError = err instanceof Error ? err.message : "加载失败";
    loadState = "error";
    notifyMutated();
  }
}

export function pushEntry(entry: Entry): StoreMutationResult {
  const blocked = rejectIfBlocked();
  if (blocked) return blocked;
  detailItems.push(entry);
  sortDetailEntries(detailItems);
  invalidateOnMutation();
  notifyMutated();
  return { ok: true };
}

export function mergeCsvBatch(drafts: Transaction[], orderMode: CsvImportOrder): string {
  const blocked = rejectIfBlocked();
  if (blocked) return "";
  const entries = drafts.map(transactionDraftToEntry);
  assignImportSeq(entries, orderMode, getDetailEntries());
  for (const e of entries) {
    detailItems.push(e);
  }
  sortDetailEntries(detailItems);
  invalidateOnMutation();
  notifyMutated();
  notifySavePhase();
  const focusIdx = orderMode === "reverse" ? entries.length - 1 : 0;
  return entries[focusIdx]?.id ?? "";
}

export function softDeleteEntry(
  id: string,
  options?: { notify?: boolean },
): StoreMutationResult {
  const blocked = rejectIfBlocked();
  if (blocked) return blocked;
  const entry = detailItems.find((e) => e.id === id);
  if (!entry || !isTransactionItem(entry)) return { ok: false, reason: "invalid-target" };
  if (entry._is_new) {
    const idx = detailItems.indexOf(entry);
    if (idx < 0) return { ok: false, reason: "invalid-target" };
    detailItems.splice(idx, 1);
    invalidateOnMutation();
    if (options?.notify !== false) {
      notifyMutated();
      notifySavePhase();
    }
    return { ok: true };
  }
  entry._deleted = true;
  invalidateOnMutation();
  if (options?.notify !== false) {
    notifyMutated();
    notifySavePhase();
  }
  return { ok: true };
}

export function undoDeleteEntry(
  id: string,
  options?: { notify?: boolean },
): StoreMutationResult {
  const blocked = rejectIfBlocked();
  if (blocked) return blocked;
  const entry = detailItems.find((e) => e.id === id);
  if (!entry || !isTransactionItem(entry)) return { ok: false, reason: "invalid-target" };
  entry._deleted = false;
  invalidateOnMutation();
  if (options?.notify !== false) {
    notifyMutated();
    notifySavePhase();
  }
  return { ok: true };
}

export function updateEntryField(id: string, patch: EntryFieldPatch): StoreMutationResult {
  const blocked = rejectIfBlocked();
  if (blocked) return blocked;
  const entry = detailItems.find((e) => e.id === id);
  if (!entry || !isTransactionItem(entry)) return { ok: false, reason: "invalid-target" };

  switch (patch.field) {
    case "date":
      if (entry.date !== patch.value) {
        if (countTimeMetadataKeys(entry.metadata) > 1) {
          return { ok: false, reason: "invalid-target" };
        }
        const oldDate = entry.date;
        entry.date = patch.value;
        entry.seq = nextSeqForDate(getDetailEntries(), patch.value, entry.id);
        if (entry.metadata?.some((m) => m.key === "time")) {
          entry.metadata = rewriteTxnTimeDate(entry.metadata, patch.value, oldDate);
        }
        sortDetailEntries(detailItems);
      }
      break;
    case "flag":
      entry.flag = patch.value;
      break;
    case "time":
      if (countTimeMetadataKeys(entry.metadata) > 1) {
        return { ok: false, reason: "invalid-target" };
      }
      entry.metadata = upsertTxnTimeMetadata(entry.metadata, entry.date, patch.value);
      sortDetailEntries(detailItems);
      break;
    case "remark":
      entry.remark = patch.value.slice(0, REMARK_MAX_LENGTH);
      break;
    case "payee":
      entry.payee = patch.value;
      break;
    case "tags":
      entry.tags = patch.value;
      break;
    case "type":
      entry.type = patch.value;
      break;
    case "account": {
      const posting = entry.postings[patch.postingIndex];
      if (!posting) return { ok: false, reason: "invalid-target" };
      posting.account = patch.value;
      break;
    }
    case "amount": {
      const posting = entry.postings[patch.postingIndex];
      if (!posting) return { ok: false, reason: "invalid-target" };
      posting.amount = patch.value;
      break;
    }
    case "currency": {
      const posting = entry.postings[patch.postingIndex];
      if (!posting) return { ok: false, reason: "invalid-target" };
      posting.currency = patch.value;
      break;
    }
    case "cost_amount": {
      const posting = entry.postings[patch.postingIndex];
      if (!posting) return { ok: false, reason: "invalid-target" };
      posting.cost_amount = patch.value;
      break;
    }
    case "cost_currency": {
      const posting = entry.postings[patch.postingIndex];
      if (!posting) return { ok: false, reason: "invalid-target" };
      posting.cost_currency = patch.value;
      break;
    }
  }
  invalidateOnMutation();
  notifyMutated();
  notifySavePhase();
  return { ok: true };
}

export function createNewTransaction(
  partial: Omit<Entry, "kind" | "id" | "source_file" | "source_line" | "seq">,
): string {
  const blocked = rejectIfBlocked();
  if (blocked) return "";
  const entry: Entry = {
    ...partial,
    kind: "transaction",
    id: newOrbitaId(),
    source_file: getWriteTarget(),
    source_line: 0,
    seq: nextSeqForDate(getDetailEntries(), partial.date),
    _is_new: true,
  };
  pushEntry(entry);
  notifySavePhase();
  return entry.id;
}

export function applyIdentityBackfill(backfill: IdentityBackfill[]): void {
  if (!backfill.length) return;
  const byOld = new Map(backfill.map((b) => [b.from_id, b]));
  let changed = false;
  for (const item of detailItems) {
    if (!isTransactionItem(item)) continue;
    const patch = byOld.get(item.id);
    if (!patch) continue;
    item.id = patch.id;
    changed = true;
  }
  if (!changed) return;
  invalidateOnMutation();
  notifyMutated();
}

export function applyDetailFiltersAfterCommit(): void {
  for (const fn of afterCommitFilterListeners) fn();
  notifyMutated();
}

export function onAfterCommitFilter(fn: () => void): () => void {
  afterCommitFilterListeners.push(fn);
  return () => {
    const i = afterCommitFilterListeners.indexOf(fn);
    if (i >= 0) afterCommitFilterListeners.splice(i, 1);
  };
}

export async function commitNewEntry(
  partial: Omit<Entry, "id" | "source_file" | "source_line" | "seq" | "kind">,
): Promise<void> {
  await loadSettings();
  if (loadState === "loading") {
    await loadDetail();
  }
  const target = getWriteTarget();
  const transactions = getDetailEntries();
  const gen = loadGeneration;
  const source =
    transactions.length > 0
      ? transactions
      : (await fetchEntries({}, loadAbort?.signal)).entries
          .filter(isTransactionItem)
          .map(normalizeEntry);
  if (isLoadStale(gen)) return;
  const entry: Entry = {
    ...partial,
    kind: "transaction",
    id: `new:${Date.now()}`,
    source_file: target,
    source_line: 0,
    seq: nextSeqForDate(source, partial.date),
    _is_new: true,
  };
  pushEntry(entry);
}

export function recomputeSavePhase(): void {
  const before = savePhase;
  syncIdleSavePhase();
  if (savePhase !== before) notifySavePhase();
}

/** @internal test-only */
export function __testGetLoadGeneration(): number {
  return loadGeneration;
}

/** @internal test-only reset */
export function __testResetLedgerStore(): void {
  detailItems = [];
  baseline = [];
  loadState = "loading";
  savePhase = "unedited";
  confirmSnapshot = null;
  clearValidationSession();
  backgroundLoadPromise = null;
  loadGeneration = 0;
  workGeneration = 0;
  postCommitRefreshFailed = false;
  loadAbort = null;
  loadDiagnostics = [];
  loadError = null;
}

/** @internal test-only */
export function __testEstablishBaseline(entries: Entry[]): void {
  establishBaselineFromEntries(entries);
}
