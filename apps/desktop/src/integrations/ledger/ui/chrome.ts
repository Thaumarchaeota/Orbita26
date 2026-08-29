import { SUCCESS_MIN_MS } from "../constants";

import {

  getLoadDiagnostics,

  getLoadState,

  getSavePhase,

  hasLoadDiagnostics,

  isLedgerDirty,

  isPostCommitRefreshFailed,

  recomputeSavePhase,

} from "../state/ledger";

import {
  applyActionPendingVisual,
  clearActionMotion,
  ensureActionButton,
  isActionVisualHeld,
  playActionShake,
  playActionSuccess,
} from "../../../ui/action-motion";



export type SaveChromeHandle = {

  recompute: () => void;

  playSuccess: (minMs?: number) => Promise<void>;

  shake: () => Promise<void>;

};

export type DiscardChromeHandle = {
  recompute: () => void;
};



function setSaveBtnVisual(
  btn: HTMLButtonElement,
  state: string,
  label: string,
  disabled: boolean,
  spinning: boolean,
): void {
  ensureActionButton(btn);
  btn.className = "save-btn orbita-action-btn";
  btn.classList.add(`save-${state}`);
  if (state === "checking" || state === "submitting") {
    applyActionPendingVisual(btn, { label, spinning: true, disabled: true });
    return;
  }
  if (state === "confirming") {
    applyActionPendingVisual(btn, { label, spinning: false, disabled: false });
    return;
  }
  clearActionMotion(btn);
  btn.disabled = disabled;
  if (spinning) {
    btn.innerHTML = `<span class="orbita-action-spinner" aria-hidden="true"></span>${label}`;
  } else {
    btn.textContent = label;
  }
}



export function createSaveChrome(btn: HTMLButtonElement): SaveChromeHandle {

  ensureActionButton(btn);



  function recompute(): void {

    if (isActionVisualHeld(btn)) return;

    recomputeSavePhase();

    const phase = getSavePhase();



    if (phase === "checking") {

      setSaveBtnVisual(btn, "checking", "保存", true, true);

      return;

    }

    if (phase === "submitting") {

      setSaveBtnVisual(btn, "submitting", "确认保存", true, true);

      return;

    }

    if (isPostCommitRefreshFailed()) {

      setSaveBtnVisual(btn, "refresh-failed", "已保存，刷新失败 · 重试", false, false);

      btn.title = "账本已保存，但刷新失败";

      return;

    }

    if (getLoadState() === "partial") {

      setSaveBtnVisual(btn, "unedited", "加载中…", true, true);

      return;

    }

    if (hasLoadDiagnostics()) {

      setSaveBtnVisual(btn, "unedited", "保存", true, false);

      btn.title = getLoadDiagnostics().map((d) => d.message).join("\n");

      return;

    }

    btn.title = "";

    if (phase === "unedited") {

      setSaveBtnVisual(btn, "unedited", "保存", true, false);

      return;

    }

    if (phase === "confirming") {

      setSaveBtnVisual(btn, "confirming", "确认保存", false, false);

      return;

    }

    setSaveBtnVisual(btn, "edited", "保存", false, false);

  }



  return {

    recompute,

    playSuccess(minMs = SUCCESS_MIN_MS) {

      return playActionSuccess(btn, { minMs, onDone: recompute });

    },

    shake() {

      return playActionShake(btn);

    },

  };

}



export function mountSaveChrome(

  btn: HTMLButtonElement,

  onSave: () => void | Promise<void>,

  signal: AbortSignal,

): SaveChromeHandle {

  const handle = createSaveChrome(btn);

  btn.addEventListener("click", () => void onSave(), { signal });

  window.addEventListener(

    "beforeunload",

    (e) => {

      const phase = getSavePhase();

      if (

        phase === "checking" ||

        phase === "submitting" ||

        isLedgerDirty()

      ) {

        e.preventDefault();

        e.returnValue = "";

      }

    },

    { signal },

  );

  return handle;

}

export function createDiscardChrome(btn: HTMLButtonElement): DiscardChromeHandle {
  btn.className = "save-btn finance-detail-discard-btn orbita-action-btn";
  btn.type = "button";
  btn.textContent = "撤销全部";

  function recompute(): void {
    recomputeSavePhase();
    const phase = getSavePhase();
    const blocked =
      phase === "checking"
      || phase === "submitting"
      || isPostCommitRefreshFailed()
      || getLoadState() === "partial"
      || hasLoadDiagnostics();
    const enabled = !blocked && isLedgerDirty();
    btn.disabled = !enabled;
    btn.classList.toggle("is-active", enabled);
    btn.title = enabled ? "舍弃当前未保存的编辑" : "";
  }

  return { recompute };
}

export function mountDiscardChrome(
  btn: HTMLButtonElement,
  onDiscard: () => void | Promise<void>,
  signal: AbortSignal,
): DiscardChromeHandle {
  const handle = createDiscardChrome(btn);
  btn.addEventListener("click", () => void onDiscard(), { signal });
  return handle;
}

export async function showSaveSuccess(

  chrome: SaveChromeHandle,

  minMs = SUCCESS_MIN_MS,

): Promise<void> {

  await chrome.playSuccess(minMs);

}


