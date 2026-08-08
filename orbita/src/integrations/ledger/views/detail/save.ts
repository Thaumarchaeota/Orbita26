import { CHECK_ICON, SUCCESS_MIN_MS } from "../../constants";
import { postCommit, postValidate } from "../../api/client";
import { buildCommitPayload } from "../../domain/commit";
import { isActiveEntry } from "../../domain/entry";
import { ledgerStateEqual } from "../../domain/ledger-equal";
import { getWriteTarget } from "../../state/write-target";
import {
  applyDetailFiltersAfterCommit,
  ensureLoadReady,
  getBaseline,
  getConfirmSnapshot,
  getDetailEntries,
  getLoadState,
  getSaveLock,
  isLedgerDirty,
  loadDetail,
  setConfirmSnapshot,
  setSaveLock,
} from "../../state/ledger";
import type { ValidateError } from "../../types";
import { cloneEntries, sleep } from "../../utils";
import { commitEdit } from "./edit";
import { animateCommitRemovals } from "./list";

function setSaveBtnVisual(
  state: string,
  label: string,
  disabled: boolean,
  spinning: boolean,
): void {
  const btn = document.getElementById("save-btn");
  if (!btn) return;
  btn.className = "save-btn";
  btn.classList.add(`save-${state}`);
  (btn as HTMLButtonElement).disabled = disabled;
  if (spinning) {
    btn.innerHTML = `<span class="save-spinner"></span>${label}`;
  } else {
    btn.textContent = label;
  }
}

function setSaveBtnSuccess(): void {
  const btn = document.getElementById("save-btn");
  if (!btn) return;
  btn.className = "save-btn save-success";
  (btn as HTMLButtonElement).disabled = true;
  btn.innerHTML = CHECK_ICON;
}

export function recomputeSaveUI(): void {
  const detailEntries = getDetailEntries();
  const baseline = getBaseline();
  const confirmSnapshot = getConfirmSnapshot();
  const saveLock = getSaveLock();

  if (saveLock === "checking") {
    setSaveBtnVisual("checking", "保存", true, true);
    return;
  }
  if (saveLock === "submitting") {
    setSaveBtnVisual("submitting", "确认保存", true, true);
    return;
  }
  if (getLoadState() === "partial") {
    setSaveBtnVisual("unedited", "加载中…", true, true);
    return;
  }
  if (ledgerStateEqual(detailEntries, baseline)) {
    setConfirmSnapshot(null);
    setSaveBtnVisual("unedited", "保存", true, false);
    return;
  }
  if (confirmSnapshot && ledgerStateEqual(detailEntries, confirmSnapshot)) {
    setSaveBtnVisual("confirming", "确认保存", false, false);
    return;
  }
  setSaveBtnVisual("edited", "保存", false, false);
}

async function shakeSaveBtn(): Promise<void> {
  const btn = document.getElementById("save-btn");
  if (!btn) return;
  btn.classList.add("save-error");
  await sleep(350);
  btn.classList.remove("save-error");
}

function markEntryValidationErrors(errors: ValidateError[]): void {
  document.querySelectorAll<HTMLElement>(".entry-block.field-error-block").forEach((el) => {
    el.classList.remove("field-error-block");
  });
  if (!errors.length) return;
  const first = errors[0];
  const block = document.querySelector<HTMLElement>(
    `.entry-block[data-entry-id="${first.entry_id}"]`,
  );
  if (block) {
    block.classList.add("field-error-block");
    block.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function validateDirtyEntries(): Promise<ValidateError[]> {
  const entries = getDetailEntries().filter(isActiveEntry);
  const { data } = await postValidate(entries);
  if (data.ok) return [];
  return data.errors || [];
}

export async function handleSaveClick(): Promise<void> {
  if (getSaveLock()) return;
  commitEdit();

  const detailEntries = getDetailEntries();
  const confirmSnapshot = getConfirmSnapshot();

  if (confirmSnapshot && ledgerStateEqual(detailEntries, confirmSnapshot)) {
    await submitCommit();
    return;
  }

  if (!(await ensureLoadReady())) {
    alert("数据仍在加载，请稍候再保存");
    return;
  }

  setSaveLock("checking");
  recomputeSaveUI();
  await sleep(50);

  try {
    const errors = await validateDirtyEntries();
    if (errors.length) {
      setSaveLock(null);
      recomputeSaveUI();
      markEntryValidationErrors(errors);
      await shakeSaveBtn();
      return;
    }
    setConfirmSnapshot(cloneEntries(detailEntries));
    setSaveLock(null);
    recomputeSaveUI();
  } catch {
    setSaveLock(null);
    recomputeSaveUI();
    await shakeSaveBtn();
  }
}

async function submitCommit(): Promise<void> {
  const payload = buildCommitPayload(getWriteTarget(), getDetailEntries());
  if (!Object.keys(payload.files).length) {
    setConfirmSnapshot(null);
    recomputeSaveUI();
    return;
  }

  setSaveLock("submitting");
  recomputeSaveUI();

  try {
    const { data } = await postCommit(payload);
    if (data.ok) {
      const removedIds = getDetailEntries().filter((e) => e._deleted).map((e) => e.id);
      setSaveLock(null);
      setSaveBtnSuccess();
      await sleep(SUCCESS_MIN_MS);
      if (removedIds.length) await animateCommitRemovals(removedIds);
      await loadDetail(true);
      applyDetailFiltersAfterCommit();
      recomputeSaveUI();
      return;
    }
    const failed = (data.results || []).filter((r) => !r.ok);
    const msg = failed.map((r) => `${r.file}: ${r.error || "失败"}`).join("\n");
    setSaveLock(null);
    await shakeSaveBtn();
    recomputeSaveUI();
    alert(msg || "保存失败");
  } catch {
    setSaveLock(null);
    await shakeSaveBtn();
    recomputeSaveUI();
    alert("保存失败");
  }
}

export function initSaveUI(ac: AbortController): void {
  const btn = document.getElementById("save-btn");
  if (!btn) return;
  const { signal } = ac;
  btn.addEventListener("click", () => void handleSaveClick(), { signal });
  window.addEventListener(
    "beforeunload",
    (e) => {
      if (getSaveLock() || isLedgerDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
    { signal },
  );
}
