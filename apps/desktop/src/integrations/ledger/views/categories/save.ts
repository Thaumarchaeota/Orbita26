import { SUCCESS_MIN_MS } from "../../constants";
import { fetchAccounts, postCategoriesCommit } from "../../api/client";
import { ensureActionButton, isActionVisualHeld, applyActionPendingVisual, playActionSuccess } from "../../../../ui/action-motion";
import { setAccounts } from "../../state/accounts";
import {
  categoriesForCommit,
  isCategoriesDirty,
  loadCategoriesFromAccounts,
  resetCategoriesBaseline,
} from "../../state/categories";
import { renderCategoriesView } from "./render";

type SaveState = "unedited" | "edited" | "submitting";

let saveLock = false;

function setSaveBtnVisual(
  btn: HTMLButtonElement,
  state: SaveState,
  label: string,
  disabled: boolean,
  spinning: boolean,
): void {
  ensureActionButton(btn);
  btn.className = "categories-save-btn orbita-action-btn";
  btn.classList.add(`categories-save-${state}`);
  if (state === "submitting") {
    applyActionPendingVisual(btn, { label, spinning: true, disabled: true });
    return;
  }
  btn.disabled = disabled;
  if (spinning) {
    btn.innerHTML = `<span class="categories-save-spinner"></span>${label}`;
  } else {
    btn.textContent = label;
  }
}

async function showCategorySaveSuccess(btn: HTMLButtonElement): Promise<void> {
  ensureActionButton(btn);
  btn.className = "categories-save-btn orbita-action-btn";
  await playActionSuccess(btn, { minMs: SUCCESS_MIN_MS, onDone: () => recomputeCategorySaveUI(btn) });
}

export function recomputeCategorySaveUI(btn: HTMLButtonElement): void {
  if (saveLock || isActionVisualHeld(btn)) return;
  if (isCategoriesDirty()) {
    setSaveBtnVisual(btn, "edited", "保存", false, false);
  } else {
    setSaveBtnVisual(btn, "unedited", "保存", true, false);
  }
}

export function initCategorySave(
  btn: HTMLButtonElement,
  expensesEl: HTMLElement,
  incomeEl: HTMLElement,
  onBeforeSave: () => void,
): void {
  btn.addEventListener("click", async () => {
    if (saveLock || !isCategoriesDirty()) return;
    onBeforeSave();
    saveLock = true;
    setSaveBtnVisual(btn, "submitting", "保存中", true, true);
    try {
      const payload = categoriesForCommit();
      if (!payload.length) {
        resetCategoriesBaseline();
        renderCategoriesView(expensesEl, incomeEl);
        await showCategorySaveSuccess(btn);
        return;
      }
      const { res, data } = await postCategoriesCommit({ categories: payload });
      if (!res.ok) {
        throw new Error(data.error || "保存失败");
      }
      const acc = await fetchAccounts();
      setAccounts(acc);
      loadCategoriesFromAccounts(acc);
      resetCategoriesBaseline();
      renderCategoriesView(expensesEl, incomeEl);
      await showCategorySaveSuccess(btn);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
      setSaveBtnVisual(btn, "edited", "保存", false, false);
    } finally {
      saveLock = false;
      if (!isActionVisualHeld(btn)) recomputeCategorySaveUI(btn);
    }
  });
  recomputeCategorySaveUI(btn);
}
