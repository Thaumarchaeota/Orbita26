import { postCommit, postValidate } from "../../api/client";
import { buildCommitPayload } from "../../domain/commit";
import { isActiveEntry } from "../../domain/entry";
import {
  applyDetailFiltersAfterCommit,
  applyIdentityBackfill,
  beginSaveCheck,
  beginSaveSubmit,
  ensureLoadReady,
  enterConfirming,
  enterRefreshFailedAfterCommit,
  getConfirmSnapshot,
  getDetailEntries,
  getLoadDiagnostics,
  getSavePhase,
  getValidationSession,
  hasLoadDiagnostics,
  isRefreshFailedPhase,
  loadDetail,
  markSaveSucceeded,
  returnToConfirmingAfterSubmitFailure,
  returnToEditedAfterCheckFailure,
  resetConfirmSnapshot,
} from "../../state/ledger";
import type { CandidateDiagnostic, IdentityBackfill } from "../../types";
import type { SaveChromeHandle } from "../../ui/chrome";
import { showSaveSuccess } from "../../ui/chrome";
import { cloneEntries, sleep } from "../../utils";
import type { DetailSurfaceHandle } from "./surface";

export type DetailSaveController = {
  handleSave: () => Promise<void>;
  recompute: () => void;
  dispose: () => void;
};

export type DetailSaveControllerOptions = {
  chrome: SaveChromeHandle;
  surface: Pick<DetailSurfaceHandle, "showValidationErrors" | "animateCommitRemovals" | "applyFilters" | "commitEdit">;
};

async function validateDirtyEntries(): Promise<
  | { ok: true; token: string; hash: string; identityBackfill: IdentityBackfill[] }
  | { ok: false; errors: CandidateDiagnostic[] }
> {
  const entries = getDetailEntries().filter(isActiveEntry);
  const { data } = await postValidate(entries);
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

export function createDetailSaveController(
  options: DetailSaveControllerOptions,
): DetailSaveController {
  let disposed = false;
  const recompute = () => {
    if (!disposed) options.chrome.recompute();
  };
  const shake = async () => {
    if (!disposed) await options.chrome.shake();
  };

  async function submitCommit(): Promise<void> {
    const session = getValidationSession();
    if (!session) {
      resetConfirmSnapshot();
      recompute();
      return;
    }

    const payload = buildCommitPayload(getDetailEntries(), session.token, session.hash);
    if (!payload.items.length) {
      resetConfirmSnapshot();
      recompute();
      return;
    }

    beginSaveSubmit();
    recompute();
    try {
      const { data } = await postCommit(payload);
      if (data.ok) {
        const removedIds = getDetailEntries().filter((entry) => entry._deleted).map((entry) => entry.id);
        try {
          await loadDetail(true);
          applyDetailFiltersAfterCommit();
          markSaveSucceeded();
          if (!disposed) await showSaveSuccess(options.chrome);
          if (removedIds.length) await options.surface.animateCommitRemovals(removedIds);
          options.surface.applyFilters();
          recompute();
        } catch {
          enterRefreshFailedAfterCommit();
          await shake();
          recompute();
          alert("已提交，但刷新账本失败，请重试刷新");
        }
        return;
      }
      returnToConfirmingAfterSubmitFailure();
      await shake();
      recompute();
      alert(data.error || "保存失败");
    } catch {
      returnToConfirmingAfterSubmitFailure();
      await shake();
      recompute();
      alert("保存失败");
    }
  }

  async function retryAuthoritativeReload(): Promise<void> {
    beginSaveSubmit();
    recompute();
    try {
      const removedIds = getDetailEntries().filter((entry) => entry._deleted).map((entry) => entry.id);
      await loadDetail(true);
      applyDetailFiltersAfterCommit();
      markSaveSucceeded();
      if (!disposed) await showSaveSuccess(options.chrome);
      if (removedIds.length) await options.surface.animateCommitRemovals(removedIds);
      options.surface.applyFilters();
      recompute();
    } catch {
      enterRefreshFailedAfterCommit();
      await shake();
      recompute();
      alert("已提交，但刷新账本失败，请重试刷新");
    }
  }

  async function handleSave(): Promise<void> {
    const phase = getSavePhase();
    if (phase === "checking" || phase === "submitting") return;
    options.surface.commitEdit();

    if (isRefreshFailedPhase()) {
      await retryAuthoritativeReload();
      return;
    }

    const confirmSnapshot = getConfirmSnapshot();
    if (phase === "confirming" && confirmSnapshot) {
      await submitCommit();
      return;
    }
    if (!(await ensureLoadReady())) {
      alert("数据仍在加载，请稍候再保存");
      return;
    }
    if (hasLoadDiagnostics()) {
      const messages = getLoadDiagnostics().map((diagnostic) => diagnostic.message).join("\n");
      alert(`账本文件存在阻断性诊断，无法保存：\n${messages}`);
      return;
    }

    beginSaveCheck();
    recompute();
    await sleep(50);
    try {
      const result = await validateDirtyEntries();
      if (!result.ok) {
        returnToEditedAfterCheckFailure();
        recompute();
        options.surface.showValidationErrors(result.errors);
        await shake();
        return;
      }
      if (result.identityBackfill.length) applyIdentityBackfill(result.identityBackfill);
      enterConfirming(cloneEntries(getDetailEntries()), result.token, result.hash);
      recompute();
    } catch {
      returnToEditedAfterCheckFailure();
      recompute();
      await shake();
    }
  }

  return {
    handleSave,
    recompute,
    dispose: () => {
      disposed = true;
    },
  };
}
