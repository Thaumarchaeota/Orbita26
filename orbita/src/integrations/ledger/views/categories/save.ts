import { CHECK_ICON, SUCCESS_MIN_MS } from "../../constants";
import { fetchAccounts, postCategoriesCommit } from "../../api/client";
import { setAccounts } from "../../state/accounts";
import {
  categoriesForCommit,
  isCategoriesDirty,
  loadCategoriesFromAccounts,
  resetCategoriesBaseline,
} from "../../state/categories";
import { sleep } from "../../utils";
import { renderCategoriesView } from "./render";

type SaveState = "unedited" | "edited" | "submitting" | "success";

let saveLock = false;

function setSaveBtnVisual(
  btn: HTMLButtonElement,
  state: SaveState,
  label: string,
  disabled: boolean,
  spinning: boolean,
): void {
  btn.className = "categories-save-btn";
  btn.classList.add(`categories-save-${state}`);
  btn.disabled = disabled;
  if (spinning) {
    btn.innerHTML = `<span class="categories-save-spinner"></span>${label}`;
  } else if (state === "success") {
    btn.innerHTML = CHECK_ICON;
  } else {
    btn.textContent = label;
  }
}

export function recomputeCategorySaveUI(btn: HTMLButtonElement): void {
  if (saveLock) return;
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
        setSaveBtnVisual(btn, "success", "", true, false);
        await sleep(SUCCESS_MIN_MS);
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
      setSaveBtnVisual(btn, "success", "", true, false);
      await sleep(SUCCESS_MIN_MS);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
      setSaveBtnVisual(btn, "edited", "保存", false, false);
    } finally {
      saveLock = false;
      recomputeCategorySaveUI(btn);
    }
  });
  recomputeCategorySaveUI(btn);
}
