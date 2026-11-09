import { mountInlineTextField } from "../../../../ui/inline-text-field";
import type { HealthMealFoodSnapshot, HealthMealSnapshot } from "../../../journal/client";

type FoodDraft = {
  text: string; kcal: string; servingText: string;
  carbsGrams: string; proteinGrams: string; fatGrams: string; sugarGrams: string;
  fiberGrams: string; sodiumMilligrams: string; vitaminCMilligrams: string;
  kcalEstimated: boolean; servingEstimated: boolean | null; nutrientsEstimated: boolean | null;
};
const fields: { key: keyof FoodDraft; label: string; unit?: string }[] = [
  { key: "text", label: "食物" }, { key: "servingText", label: "份量" }, { key: "kcal", label: "热量", unit: "kcal" },
  { key: "carbsGrams", label: "碳水", unit: "g" }, { key: "proteinGrams", label: "蛋白", unit: "g" }, { key: "fatGrams", label: "脂肪", unit: "g" },
  { key: "sugarGrams", label: "糖", unit: "g" }, { key: "fiberGrams", label: "纤维", unit: "g" }, { key: "sodiumMilligrams", label: "钠", unit: "mg" },
  { key: "vitaminCMilligrams", label: "维C", unit: "mg" },
];
function draft(food?: HealthMealFoodSnapshot): FoodDraft {
  const str = (value: number | null | undefined) => value == null ? "" : String(value);
  return { text: food?.text ?? "", kcal: str(food?.kcal), servingText: food?.servingText ?? "", carbsGrams: str(food?.carbsGrams),
    proteinGrams: str(food?.proteinGrams), fatGrams: str(food?.fatGrams), sugarGrams: str(food?.sugarGrams), fiberGrams: str(food?.fiberGrams),
    sodiumMilligrams: str(food?.sodiumMilligrams), vitaminCMilligrams: str(food?.vitaminCMilligrams), kcalEstimated: food?.kcalEstimated ?? false,
    servingEstimated: food?.servingEstimated ?? null, nutrientsEstimated: food?.nutrientsEstimated ?? null };
}
export function makeFoodDrafts(meal: HealthMealSnapshot): FoodDraft[] {
  if (meal.recordShape === "legacy") {
    const items = (meal.items ?? []).map((text) => ({ ...draft(), text }));
    // A root-only calorie total is not an individual food fact. Require an
    // explicit food and calorie entry before converting (SPEC-0017).
    if (items.length === 0 && meal.mealKcal != null) items.push(draft());
    return items;
  }
  return meal.foods.slice().sort((a, b) => a.position - b.position).map(draft);
}
export function mountMealFoodEditor(root: HTMLElement, rows: FoodDraft[], commit: (foods: Record<string, unknown>[]) => Promise<boolean>, legacy: boolean): () => void {
  const handles: { dispose: () => void; setReadOnly: (value: boolean) => void }[] = [];
  let busy = false;
  const message = document.createElement("p"); message.setAttribute("role", "alert");
  const body = document.createElement("div");
  root.replaceChildren(body, message);
  async function submit(nextRows: FoodDraft[] = rows): Promise<boolean> {
    if (busy) return false;
    // Every legacy member must be accounted for before any conversion, even deletion.
    if (legacy && rows.some((row) => !row.text.trim() || !row.kcal.trim() || !Number.isFinite(Number(row.kcal)) || Number(row.kcal) < 0)) {
      message.textContent = "请先为旧记录的每项食物补齐有效热量"; return false;
    }
    const parsed: Record<string, unknown>[] = [];
    for (const row of nextRows) {
      const kcal = Number(row.kcal);
      if (!row.text.trim() || !row.kcal.trim() || !Number.isFinite(kcal) || kcal < 0) { message.textContent = "请为每项食物填写名称和有效热量"; return false; }
      const item: Record<string, unknown> = { text: row.text.trim(), kcal, kcalEstimated: row.kcalEstimated,
        servingText: row.servingText.trim() || null, servingEstimated: row.servingText.trim() ? row.servingEstimated ?? false : null };
      let hasNutrients = false;
      for (const { key } of fields.slice(3)) {
        const value = String(row[key]).trim();
        if (!value) { item[key] = null; continue; }
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) { message.textContent = "营养数值须为非负数字"; return false; }
        item[key] = number; hasNutrients = true;
      }
      item.nutrientsEstimated = hasNutrients ? row.nutrientsEstimated ?? false : null;
      parsed.push(item);
    }
    message.textContent = "";
    busy = true;
    handles.forEach((handle) => handle.setReadOnly(true));
    body.querySelectorAll<HTMLButtonElement>("[data-remove-food]").forEach((button) => { button.disabled = true; });
    try { return await commit(parsed); }
    finally {
      busy = false;
      handles.forEach((handle) => handle.setReadOnly(false));
      body.querySelectorAll<HTMLButtonElement>("[data-remove-food]").forEach((button) => { button.disabled = false; });
    }
  }
  function render(): void {
    handles.splice(0).forEach((handle) => handle.dispose()); body.replaceChildren();
    rows.forEach((row, index) => {
      const line = document.createElement("div"); line.className = "health-meal-food-edit-row";
      const leading = document.createElement("div"); leading.className = "health-meal-food-leading"; line.append(leading);
      const nameServing = document.createElement("div"); nameServing.className = "health-meal-food-name-serving"; leading.append(nameServing);
      fields.forEach(({ key, label, unit }, fieldIndex) => {
        const wrapper = document.createElement("div"); wrapper.className = "health-meal-food-field";
        if (fieldIndex < 3) wrapper.classList.add("is-primary");
        if (fieldIndex < 2) wrapper.classList.add("is-leading");
        if (fieldIndex === 0) wrapper.classList.add("is-name");
        if (key === "kcal") wrapper.classList.add("is-calorie");
        if (fieldIndex === 0) {
          const number = document.createElement("span"); number.className = "health-meal-food-number"; number.textContent = `${index + 1}.`;
          number.setAttribute("aria-label", `第 ${index + 1} 项`); wrapper.append(number);
        }
        if (fieldIndex >= 3) {
          const prefix = document.createElement("span"); prefix.className = "health-meal-food-affix"; prefix.textContent = label;
          prefix.setAttribute("aria-hidden", "true"); wrapper.append(prefix);
        }
        const cell = document.createElement("div"); cell.className = "health-meal-food-input";
        if (unit) cell.classList.add("is-number");
        wrapper.append(cell);
        if (unit) {
          const suffix = document.createElement("span"); suffix.className = "health-meal-food-affix"; suffix.textContent = unit;
          suffix.setAttribute("aria-hidden", "true"); wrapper.append(suffix);
        }
        (fieldIndex < 2 ? nameServing : fieldIndex === 2 ? leading : line).append(wrapper);
        handles.push(mountInlineTextField({ container: cell, value: String(row[key]), placeholder: fieldIndex >= 3 ? "—" : label, ariaLabel: unit ? `${label}（${unit}）` : label, contentSized: fieldIndex < 2 || Boolean(unit),
          onCommit(value) { (row as unknown as Record<string, unknown>)[key] = value; void submit(); } }));
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.dataset.removeFood = "";
      const removeLabel = row.text.trim() ? `删除食物：${row.text.trim()}` : "删除食物";
      remove.setAttribute("aria-label", removeLabel); remove.title = removeLabel;
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
      remove.addEventListener("click", () => {
        const remaining = rows.filter((_, i) => i !== index);
        remove.disabled = true;
        void submit(remaining).then((saved) => {
          remove.disabled = false;
          if (!saved) return;
          const currentIndex = rows.indexOf(row);
          if (currentIndex >= 0) rows.splice(currentIndex, 1);
          render();
        });
      }); line.append(remove); body.append(line);
    });
  }
  render();
  return () => handles.forEach((handle) => handle.dispose());
}
