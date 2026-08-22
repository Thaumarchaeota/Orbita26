import { postCommit, postValidate } from "../api/client";
import { buildCommitPayload } from "../domain/commit";
import { getActiveCommitItems } from "../domain/detail-item-api";
import { isTransactionItem } from "../domain/detail-item";
import {
  applyDetailFiltersAfterCommit,
  applyIdentityBackfill,
  beginSaveCheck,
  beginSaveSubmit,
  clearPostCommitRefreshFailed,
  ensureLoadReady,
  enterConfirming,
  enterPostCommitRefreshFailed,
  establishCommitBaseline,
  getConfirmSnapshot,
  getDetailItems,
  getLoadDiagnostics,
  getSavePhase,
  getValidationSession,
  getWorkGeneration,
  hasLoadDiagnostics,
  isPostCommitRefreshFailed,
  loadDetail,
  markSaveSucceeded,
  returnToConfirmingAfterSubmitFailure,
  returnToEditedAfterCheckFailure,
  resetConfirmSnapshot,
} from "../state/ledger";
import type { CandidateDiagnostic, IdentityBackfill } from "../types";
import { cloneDetailItems, sleep } from "../utils";

export type CardStoreSaveCallbacks = {
  onValidationErrors: (errors: CandidateDiagnostic[]) => void;
  onSavePhaseChange: () => void;
  onBeforeReload?: (removedIds: string[]) => void;
  onCommitSuccess: (removedIds: string[]) => Promise<void>;
  shake: () => Promise<void>;
};

async function validateDirtyItems(): Promise<
  | { ok: true; token: string; hash: string; identityBackfill: IdentityBackfill[] }
  | { ok: false; errors: CandidateDiagnostic[] }
> {
  const items = getActiveCommitItems(getDetailItems());
  const { data } = await postValidate(items);
  if (data.ok && data.validation_token && data.candidate_hash) {
    return {
      ok: true,
      token: data.validation_token,
      hash: data.candidate_hash,
      identityBackfill: data.identity_backfill ?? [],
    };
  }
  if (data.diagnostics?.length) return { ok: false, errors: data.diagnostics };
  return {
    ok: false,
    errors: (data.errors || []).map((error) => ({
      message: error.error,
      item_ids: error.entry_id ? [error.entry_id] : [],
    })),
  };
}

async function runBackgroundReload(
  callbacks: CardStoreSaveCallbacks,
  workGen: number,
): Promise<void> {
  try {
    await loadDetail(true, workGen);
    applyDetailFiltersAfterCommit();
    clearPostCommitRefreshFailed();
    callbacks.onSavePhaseChange();
  } catch {
    enterPostCommitRefreshFailed();
    callbacks.onSavePhaseChange();
  }
}

async function retryPostCommitReload(callbacks: CardStoreSaveCallbacks): Promise<void> {
  const workGen = getWorkGeneration();
  clearPostCommitRefreshFailed();
  callbacks.onSavePhaseChange();
  try {
    await loadDetail(true, workGen);
    applyDetailFiltersAfterCommit();
    clearPostCommitRefreshFailed();
    callbacks.onSavePhaseChange();
  } catch {
    enterPostCommitRefreshFailed();
    await callbacks.shake();
    callbacks.onSavePhaseChange();
  }
}

async function finishCommitSuccess(
  callbacks: CardStoreSaveCallbacks,
  removedIds: string[],
): Promise<void> {
  void callbacks.onBeforeReload?.(removedIds);
  establishCommitBaseline();
  markSaveSucceeded();
  callbacks.onSavePhaseChange();
  await callbacks.onCommitSuccess(removedIds);
  const workGen = getWorkGeneration();
  void runBackgroundReload(callbacks, workGen);
}

/** Store-owned validate/commit; only invoked from LedgerCardStore.handleSave. */
export async function runCardStoreSave(
  callbacks: CardStoreSaveCallbacks,
  commitEdit?: () => void,
): Promise<void> {
  const phase = getSavePhase();
  if (phase === "checking" || phase === "submitting") return;
  commitEdit?.();

  if (isPostCommitRefreshFailed()) {
    await retryPostCommitReload(callbacks);
    return;
  }

  const confirmSnapshot = getConfirmSnapshot();
  if (phase === "confirming" && confirmSnapshot) {
    const session = getValidationSession();
    if (!session) {
      resetConfirmSnapshot();
      callbacks.onSavePhaseChange();
      return;
    }
    const payload = buildCommitPayload(getDetailItems(), session.token, session.hash);
    if (!payload.items.length) {
      resetConfirmSnapshot();
      callbacks.onSavePhaseChange();
      return;
    }
    beginSaveSubmit();
    callbacks.onSavePhaseChange();
    try {
      const { data } = await postCommit(payload);
      if (data.ok) {
        const removedIds = getDetailItems()
          .filter(isTransactionItem)
          .filter((entry) => entry._deleted)
          .map((entry) => entry.id);
        await finishCommitSuccess(callbacks, removedIds);
        return;
      }
      returnToConfirmingAfterSubmitFailure();
      await callbacks.shake();
      callbacks.onSavePhaseChange();
      alert(data.error || "保存失败");
    } catch {
      returnToConfirmingAfterSubmitFailure();
      await callbacks.shake();
      callbacks.onSavePhaseChange();
      alert("保存失败");
    }
    return;
  }

  if (!(await ensureLoadReady())) {
    alert("数据仍在加载，请稍候再保存");
    return;
  }
  if (hasLoadDiagnostics()) {
    const messages = getLoadDiagnostics().map((d) => d.message).join("\n");
    alert(`账本文件存在阻断性诊断，无法保存：\n${messages}`);
    return;
  }

  beginSaveCheck();
  callbacks.onSavePhaseChange();
  await sleep(50);
  try {
    const result = await validateDirtyItems();
    if (!result.ok) {
      returnToEditedAfterCheckFailure();
      callbacks.onValidationErrors(result.errors);
      callbacks.onSavePhaseChange();
      await callbacks.shake();
      return;
    }
    if (result.identityBackfill.length) applyIdentityBackfill(result.identityBackfill);
    enterConfirming(cloneDetailItems(getDetailItems()), result.token, result.hash);
    callbacks.onSavePhaseChange();
  } catch {
    returnToEditedAfterCheckFailure();
    callbacks.onSavePhaseChange();
    await callbacks.shake();
  }
}
