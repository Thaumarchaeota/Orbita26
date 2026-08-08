import { getAccounts } from "../../state/accounts";
import { findCategory, loadCategoriesFromAccounts } from "../../state/categories";
import { applyLabel } from "../../state/category-display";
import { renderCategoriesView, updateCategoryRowVisual } from "./render";
import { initCategorySave, recomputeCategorySaveUI } from "./save";

type ActiveEdit = {
  el: HTMLElement;
  input: HTMLInputElement;
  field: string;
  id: string;
};

function fieldRaw(cat: ReturnType<typeof findCategory>, field: string): string {
  if (!cat) return "";
  if (field === "name") return cat.name;
  if (field === "label") return cat.label || "";
  return "";
}

export function mountCategoriesView(panel: HTMLElement): () => void {
  loadCategoriesFromAccounts(getAccounts());

  panel.innerHTML = `
    <div class="categories-view">
      <div class="categories-main">
        <div class="categories-column">
          <h2 class="categories-column-title">支出</h2>
          <div id="categories-expenses-list" class="categories-list"></div>
        </div>
        <div class="categories-column">
          <h2 class="categories-column-title">收入</h2>
          <div id="categories-income-list" class="categories-list"></div>
        </div>
      </div>
      <aside class="categories-sidebar">
        <div class="categories-save-dock">
          <button type="button" id="category-save-btn" class="categories-save-btn categories-save-unedited" disabled>保存</button>
        </div>
      </aside>
    </div>`;

  const expensesEl = panel.querySelector<HTMLElement>("#categories-expenses-list")!;
  const incomeEl = panel.querySelector<HTMLElement>("#categories-income-list")!;
  const saveBtn = panel.querySelector<HTMLButtonElement>("#category-save-btn")!;
  const root = panel.querySelector<HTMLElement>(".categories-view")!;

  let activeEdit: ActiveEdit | null = null;

  function cancelEdit(): void {
    if (!activeEdit) return;
    activeEdit = null;
    renderCategoriesView(expensesEl, incomeEl);
  }

  function commitEdit(): void {
    if (!activeEdit) return;
    const { input, field, id } = activeEdit;
    const cat = findCategory(id);
    if (!cat) {
      cancelEdit();
      return;
    }
    const value = input.value.trim();
    if (field === "name") cat.name = value;
    else if (field === "label") applyLabel(cat, value);
    activeEdit = null;
    renderCategoriesView(expensesEl, incomeEl);
    updateCategoryRowVisual(id);
    recomputeCategorySaveUI(saveBtn);
  }

  function startEdit(el: HTMLElement): void {
    const field = el.dataset.field || "";
    const id = el.dataset.id || "";
    const cat = findCategory(id);
    if (!cat) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "categories-editable-input";
    input.value = fieldRaw(cat, field);

    el.classList.add("editing");
    el.textContent = "";
    el.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    });

    activeEdit = { el, input, field, id };
  }

  const ac = new AbortController();
  const { signal } = ac;

  renderCategoriesView(expensesEl, incomeEl);
  initCategorySave(saveBtn, expensesEl, incomeEl, () => commitEdit());

  root.addEventListener(
    "click",
    (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".categories-editable");
      if (!el || !root.contains(el)) return;
      if (activeEdit && activeEdit.el !== el) commitEdit();
      if (el.classList.contains("editing")) return;
      startEdit(el);
    },
    { signal },
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!activeEdit) return;
      if ((e.target as HTMLElement).closest(".categories-editable.editing")) return;
      commitEdit();
    },
    { signal },
  );

  return () => ac.abort();
}
