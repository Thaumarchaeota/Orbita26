import { mountDecoupledDatePicker, type DecoupledDatePickerHandle } from "../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker, type DecoupledTimePickerHandle } from "../../ui/decoupled-time-picker";
import { normalizeHhMm } from "../../ui/time-picker";
import {
  mealSlotRowHtml,
  bindMealSlotRow,
  newMealId,
  normalizeMealSlot,
  type MealEntry,
  type MealFoodEntry,
  type MealCategory,
} from "../../core/data/meals";
import { escHtml } from "../../core/html";
import { bindBackdropPressDismiss } from "../../ui/backdrop-dismiss";
import { bindDialog } from "../../ui/motion";
import { completeChat } from "../ai/adapter";
import { getActiveEntry, loadAiConfig } from "../ai/config";
import { beijingToday, healthCreateMeal, healthDeleteMeal, healthListMeals, healthUpdateMeal } from "./client";
import {
  archiveMealToEntry,
  computeMealNutritionTotals,
  defaultMealTitle,
  mealEntryToCreateReq,
  mealEntryToUpdateReq,
  MEAL_AI_SYSTEM,
  mealFoodEntryFromSnapshot,
  mealFoodSearchHits,
  searchMealFoods,
  type MealEntryWithRevision,
} from "./meals-archive";

const DEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`;

const MEAL_DIALOG_STYLES = `
.meal-dialog-panel .meal-food-search-wrap { position: relative; margin: 6px 0 8px; }
.meal-dialog-panel .meal-food-search-input { width: 100%; padding: 6px 8px; font-size: 12px; border: 1px solid var(--dialog-border, #ddd); border-radius: 6px; }
.meal-dialog-panel .meal-food-search-results { position: absolute; z-index: 6; left: 0; right: 0; top: calc(100% + 4px); max-height: 160px; overflow-y: auto; border: 1px solid var(--dialog-border, #ddd); border-radius: 8px; background: var(--dialog-bg, #fff); box-shadow: 0 4px 12px rgba(0,0,0,.12); }
.meal-dialog-panel .meal-food-search-hit { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px 10px; border: none; border-bottom: 1px solid var(--dialog-border, #eee); background: transparent; text-align: left; cursor: pointer; }
.meal-dialog-panel .meal-food-search-hit:last-child { border-bottom: none; }
.meal-dialog-panel .meal-food-search-hit-name { font-size: 13px; }
.meal-dialog-panel .meal-food-search-hit-meta { font-size: 11px; opacity: .7; }
.meal-dialog-panel .meal-food-search-empty { margin: 0; padding: 8px 10px; font-size: 12px; opacity: .7; }
.meal-dialog-panel .meal-nutrition-totals { margin: 10px 0; padding: 10px; border: 1px solid var(--dialog-border, #ddd); border-radius: 8px; }
.meal-dialog-panel .meal-nutrition-totals-head { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
.meal-dialog-panel .meal-nutrition-totals-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.meal-dialog-panel .meal-nutrition-total-item { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; }
.meal-dialog-panel .meal-nutrition-total-warn { font-size: 10px; color: #d97706; background: rgba(217,119,6,.12); padding: 1px 5px; border-radius: 4px; }
.meal-dialog-panel .meal-ai-row { display: flex; gap: 8px; margin: 8px 0; }
.meal-dialog-panel .meal-ai-row input { flex: 1; padding: 8px 10px; font-size: 13px; border: 1px solid var(--dialog-border, #ddd); border-radius: 16px; }
.meal-dialog-panel .meal-ai-row button { width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--accent, #3b82f6); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.meal-dialog-panel .meal-ai-hint { font-size: 12px; color: #e53e3e; min-height: 16px; margin-bottom: 4px; }
`;

async function loadMealsForDate(date: string): Promise<{ meals: MealEntry[]; revisions: Map<string, number> }> {
  const { meals } = await healthListMeals({ localDateFrom: date, localDateTo: date });
  const revisions = new Map<string, number>();
  const entries = meals
    .filter((m) => !m.deletedAt)
    .map((m) => {
      revisions.set(m.id, m.revision);
      return archiveMealToEntry(m, date);
    });
  return { meals: entries, revisions };
}

async function createMealOnArchive(date: string, entry: MealEntry) {
  await healthCreateMeal(mealEntryToCreateReq(date, entry));
}

async function updateMealOnArchive(date: string, entry: MealEntry, revision: number) {
  await healthUpdateMeal({
    meal: { id: entry.id, expectedRevision: revision },
    ...mealEntryToUpdateReq(date, entry),
  });
}

async function deleteMealOnArchive(id: string, revision: number) {
  await healthDeleteMeal({ meal: { id, expectedRevision: revision } });
}

function slotField(selected: MealCategory): string {
  return `<div class="dialog-field"><label>餐次</label>${mealSlotRowHtml(selected)}</div>`;
}

function numStr(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(v) : "";
}

function foodRowHtml(food: MealFoodEntry, index: number): string {
  const n = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? String(v) : "");
  return `<div class="meal-food-row" data-index="${index}">
    <div class="meal-food-row-head">
      <strong>食物 ${index + 1}</strong>
      <button type="button" class="meal-food-del" aria-label="删除食物">${DEL_SVG}</button>
    </div>
    <div class="meal-food-search-wrap">
      <input type="search" class="meal-food-search-input" placeholder="搜索历史食物…" autocomplete="off">
      <div class="meal-food-search-results" hidden></div>
    </div>
    <div class="dialog-field"><label>食物 *</label><input type="text" class="food-text" value="${escHtml(food.text)}" required></div>
    <div class="dialog-field"><label>热量 kcal *</label><input type="number" class="food-kcal" min="0" step="1" value="${food.kcal || ""}" required></div>
    <label class="meal-estimate-check"><input type="checkbox" class="food-kcal-estimated" ${food.kcalEstimated ? "checked" : ""}> 热量为估算</label>
    <div class="dialog-field"><label>份量</label><input type="text" class="food-serving" value="${escHtml(food.servingText ?? "")}"></div>
    <label class="meal-estimate-check food-serving-est-wrap"><input type="checkbox" class="food-serving-estimated" ${food.servingEstimated ? "checked" : ""}> 份量为估算</label>
    <div class="meal-food-nutrients">
      <div class="dialog-field"><label>碳水 g</label><input type="number" class="food-carbs" min="0" step="0.1" value="${n(food.carbsGrams)}"></div>
      <div class="dialog-field"><label>蛋白 g</label><input type="number" class="food-protein" min="0" step="0.1" value="${n(food.proteinGrams)}"></div>
      <div class="dialog-field"><label>脂肪 g</label><input type="number" class="food-fat" min="0" step="0.1" value="${n(food.fatGrams)}"></div>
      <div class="dialog-field"><label>糖 g</label><input type="number" class="food-sugar" min="0" step="0.1" value="${n(food.sugarGrams)}"></div>
      <div class="dialog-field"><label>纤维 g</label><input type="number" class="food-fiber" min="0" step="0.1" value="${n(food.fiberGrams)}"></div>
      <div class="dialog-field"><label>钠 mg</label><input type="number" class="food-sodium" min="0" step="1" value="${n(food.sodiumMilligrams)}"></div>
      <div class="dialog-field"><label>维C mg</label><input type="number" class="food-vitamin-c" min="0" step="1" value="${n(food.vitaminCMilligrams)}"></div>
    </div>
    <label class="meal-estimate-check food-nutrients-est-wrap"><input type="checkbox" class="food-nutrients-estimated" ${food.nutrientsEstimated ? "checked" : ""}> 营养素为估算</label>
  </div>`;
}

function readOptionalNumber(input: HTMLInputElement | null): number | null {
  if (!input) return null;
  const raw = input.value.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function collectFoodDrafts(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(".meal-food-row")].map((row) => ({
    text: row.querySelector<HTMLInputElement>(".food-text")!.value,
    kcal: row.querySelector<HTMLInputElement>(".food-kcal")!.value,
    kcalMissing: false,
    servingText: row.querySelector<HTMLInputElement>(".food-serving")!.value,
    carbsGrams: row.querySelector<HTMLInputElement>(".food-carbs")!.value,
    proteinGrams: row.querySelector<HTMLInputElement>(".food-protein")!.value,
    fatGrams: row.querySelector<HTMLInputElement>(".food-fat")!.value,
    sugarGrams: row.querySelector<HTMLInputElement>(".food-sugar")!.value,
    fiberGrams: row.querySelector<HTMLInputElement>(".food-fiber")!.value,
    sodiumMilligrams: row.querySelector<HTMLInputElement>(".food-sodium")!.value,
    vitaminCMilligrams: row.querySelector<HTMLInputElement>(".food-vitamin-c")!.value,
  }));
}

function renderNutritionTotals(root: HTMLElement) {
  const el = root.querySelector<HTMLElement>(".meal-nutrition-totals");
  if (!el) return;
  const t = computeMealNutritionTotals(collectFoodDrafts(root));
  const row = (label: string, unit: string, total: { sum: number | null; incomplete: boolean }, integer = false) => {
    const badge = total.incomplete ? `<span class="meal-nutrition-total-warn">不完整</span>` : "";
    const val = total.sum == null ? "—" : integer ? String(Math.round(total.sum)) : String(Math.round(total.sum * 10) / 10);
    return `<div class="meal-nutrition-total-item"><span>${label}</span><strong>${val} ${unit}</strong>${badge}</div>`;
  };
  el.innerHTML = `
    <div class="meal-nutrition-totals-head">营养合计</div>
    <div class="meal-nutrition-totals-grid">
      ${row("热量", "千卡", t.kcal, true)}
      ${row("碳水", "克", t.carbsGrams)}
      ${row("蛋白质", "克", t.proteinGrams)}
      ${row("脂肪", "克", t.fatGrams)}
      ${row("糖", "克", t.sugarGrams)}
      ${row("膳食纤维", "克", t.fiberGrams)}
      ${row("钠", "毫克", t.sodiumMilligrams, true)}
      ${row("维生素 C", "毫克", t.vitaminCMilligrams, true)}
    </div>`;
}

function applyFoodEntryToRow(row: HTMLElement, entry: MealFoodEntry) {
  row.querySelector<HTMLInputElement>(".food-text")!.value = entry.text;
  row.querySelector<HTMLInputElement>(".food-kcal")!.value = String(entry.kcal);
  row.querySelector<HTMLInputElement>(".food-kcal-estimated")!.checked = entry.kcalEstimated;
  row.querySelector<HTMLInputElement>(".food-serving")!.value = entry.servingText ?? "";
  const servingWrap = row.querySelector<HTMLElement>(".food-serving-est-wrap")!;
  servingWrap.hidden = !entry.servingText?.trim();
  row.querySelector<HTMLInputElement>(".food-serving-estimated")!.checked = entry.servingEstimated ?? false;
  row.querySelector<HTMLInputElement>(".food-carbs")!.value = numStr(entry.carbsGrams);
  row.querySelector<HTMLInputElement>(".food-protein")!.value = numStr(entry.proteinGrams);
  row.querySelector<HTMLInputElement>(".food-fat")!.value = numStr(entry.fatGrams);
  row.querySelector<HTMLInputElement>(".food-sugar")!.value = numStr(entry.sugarGrams);
  row.querySelector<HTMLInputElement>(".food-fiber")!.value = numStr(entry.fiberGrams);
  row.querySelector<HTMLInputElement>(".food-sodium")!.value = numStr(entry.sodiumMilligrams);
  row.querySelector<HTMLInputElement>(".food-vitamin-c")!.value = numStr(entry.vitaminCMilligrams);
  const anyNutrient =
    entry.carbsGrams != null ||
    entry.proteinGrams != null ||
    entry.fatGrams != null ||
    entry.sugarGrams != null ||
    entry.fiberGrams != null ||
    entry.sodiumMilligrams != null ||
    entry.vitaminCMilligrams != null;
  row.querySelector<HTMLInputElement>(".food-nutrients-estimated")!.checked = entry.nutrientsEstimated ?? false;
  row.querySelector<HTMLElement>(".food-nutrients-est-wrap")!.hidden = !anyNutrient;
}

function bindFoodRow(row: HTMLElement, form: HTMLElement, searchTimers: Map<HTMLElement, ReturnType<typeof setTimeout>>) {
  row.querySelector(".meal-food-del")?.addEventListener("click", () => {
    row.remove();
    renderNutritionTotals(form);
  });
  const serving = row.querySelector<HTMLInputElement>(".food-serving")!;
  const servingWrap = row.querySelector<HTMLElement>(".food-serving-est-wrap")!;
  const syncServing = () => {
    servingWrap.hidden = !serving.value.trim();
  };
  serving.addEventListener("input", syncServing);
  syncServing();
  const kcalInput = row.querySelector<HTMLInputElement>(".food-kcal")!;
  const kcalEst = row.querySelector<HTMLInputElement>(".food-kcal-estimated")!;
  kcalInput.addEventListener("input", () => {
    if (kcalInput.value !== "") kcalEst.checked = false;
    renderNutritionTotals(form);
  });
  row.querySelectorAll<HTMLInputElement>("input").forEach((inp) => {
    if (inp.classList.contains("food-kcal")) return;
    inp.addEventListener("input", () => renderNutritionTotals(form));
  });

  const searchInput = row.querySelector<HTMLInputElement>(".meal-food-search-input")!;
  const searchPanel = row.querySelector<HTMLElement>(".meal-food-search-results")!;
  searchInput.addEventListener("input", () => {
    const prev = searchTimers.get(row);
    if (prev) clearTimeout(prev);
    const q = searchInput.value.trim();
    if (!q) {
      searchPanel.hidden = true;
      searchPanel.innerHTML = "";
      return;
    }
    searchTimers.set(
      row,
      setTimeout(() => {
        searchTimers.delete(row);
        void (async () => {
          try {
            const { meals } = await searchMealFoods({ text: q });
            const hits = mealFoodSearchHits(meals, q).slice(0, 8);
            if (hits.length === 0) {
              searchPanel.innerHTML = `<p class="meal-food-search-empty">无匹配</p>`;
              searchPanel.hidden = false;
              return;
            }
            searchPanel.innerHTML = hits
              .map((hit, hi) => {
                const title = hit.mealTitle?.trim() || "未命名餐食";
                const date = hit.mealStartedAt.slice(0, 10);
                return `<button type="button" class="meal-food-search-hit" data-hit="${hi}">
                  <span class="meal-food-search-hit-name">${escHtml(hit.food.text)}</span>
                  <span class="meal-food-search-hit-meta">${escHtml(title)} · ${escHtml(date)} · ${Math.round(hit.food.kcal)} 千卡</span>
                </button>`;
              })
              .join("");
            searchPanel.hidden = false;
            searchPanel.querySelectorAll<HTMLButtonElement>(".meal-food-search-hit").forEach((btn, hi) => {
              btn.addEventListener("click", () => {
                const hit = hits[hi];
                if (!hit) return;
                applyFoodEntryToRow(row, mealFoodEntryFromSnapshot(hit.food));
                searchPanel.hidden = true;
                searchPanel.innerHTML = "";
                searchInput.value = "";
                renderNutritionTotals(form);
              });
            });
          } catch (e) {
            searchPanel.innerHTML = `<p class="meal-food-search-empty">${escHtml(String(e))}</p>`;
            searchPanel.hidden = false;
          }
        })();
      }, 280),
    );
  });
}

function bindFoodRows(root: HTMLElement, searchTimers: Map<HTMLElement, ReturnType<typeof setTimeout>>) {
  const list = root.querySelector<HTMLElement>(".meal-food-list")!;
  list.querySelectorAll<HTMLElement>(".meal-food-row").forEach((row) => bindFoodRow(row, root, searchTimers));
  root.querySelector<HTMLButtonElement>(".meal-food-add")?.addEventListener("click", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = foodRowHtml({ text: "", kcal: 0, kcalEstimated: false }, list.children.length);
    const row = wrap.firstElementChild as HTMLElement;
    list.appendChild(row);
    bindFoodRow(row, root, searchTimers);
    renderNutritionTotals(root);
  });
}

function collectFoods(root: HTMLElement): MealFoodEntry[] {
  return [...root.querySelectorAll<HTMLElement>(".meal-food-row")].map((row) => {
    const text = row.querySelector<HTMLInputElement>(".food-text")!.value.trim();
    const kcal = Number(row.querySelector<HTMLInputElement>(".food-kcal")!.value);
    const servingText = row.querySelector<HTMLInputElement>(".food-serving")!.value.trim();
    const nutrients = {
      carbsGrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-carbs")),
      proteinGrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-protein")),
      fatGrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-fat")),
      sugarGrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-sugar")),
      fiberGrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-fiber")),
      sodiumMilligrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-sodium")),
      vitaminCMilligrams: readOptionalNumber(row.querySelector<HTMLInputElement>(".food-vitamin-c")),
    };
    const anyNutrient = Object.values(nutrients).some((v) => v != null);
    return {
      text,
      kcal: Math.round(kcal),
      kcalEstimated: row.querySelector<HTMLInputElement>(".food-kcal-estimated")!.checked,
      servingText: servingText || undefined,
      servingEstimated: servingText
        ? row.querySelector<HTMLInputElement>(".food-serving-estimated")!.checked
        : null,
      ...nutrients,
      nutrientsEstimated: anyNutrient
        ? row.querySelector<HTMLInputElement>(".food-nutrients-estimated")!.checked
        : null,
    };
  });
}

function parseAiJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(text);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function strOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function draftJsonFromForm(
  form: HTMLElement,
  slotHidden: HTMLInputElement,
  datePicker: DecoupledDatePickerHandle,
  timePicker: DecoupledTimePickerHandle,
) {
  const date = datePicker.getValue();
  const time = timePicker.getValue();
  const foods = collectFoods(form).map((f) => ({
    text: f.text,
    kcal: f.kcal,
    kcalEstimated: f.kcalEstimated,
    servingText: f.servingText ?? null,
    carbsGrams: f.carbsGrams,
    proteinGrams: f.proteinGrams,
    fatGrams: f.fatGrams,
    sugarGrams: f.sugarGrams,
    fiberGrams: f.fiberGrams,
    sodiumMilligrams: f.sodiumMilligrams,
    vitaminCMilligrams: f.vitaminCMilligrams,
    nutrientsEstimated: f.nutrientsEstimated,
  }));
  return {
    title: form.querySelector<HTMLInputElement>("#mealTitle")!.value,
    text: form.querySelector<HTMLInputElement>("#mealText")!.value,
    iconKey: form.querySelector<HTMLInputElement>("#mealIconKey")?.value || null,
    date,
    time,
    slot: normalizeMealSlot(slotHidden.value),
    foods,
  };
}

function applyAiResultToForm(
  form: HTMLElement,
  slotHidden: HTMLInputElement,
  searchTimers: Map<HTMLElement, ReturnType<typeof setTimeout>>,
  data: Record<string, unknown>,
  datePicker: DecoupledDatePickerHandle,
  timePicker: DecoupledTimePickerHandle,
) {
  if (typeof data.title === "string") form.querySelector<HTMLInputElement>("#mealTitle")!.value = data.title;
  if (typeof data.text === "string") form.querySelector<HTMLInputElement>("#mealText")!.value = data.text;
  if (typeof data.date === "string" && data.date) datePicker.setValue(data.date);
  if (typeof data.time === "string" && data.time) timePicker.setValue(data.time.slice(0, 5));
  if (Object.prototype.hasOwnProperty.call(data, "slot")) {
    const unknownSlot = form.dataset.unrecognizedMealSlot;
    const slot = normalizeMealSlot(data.slot);
    if (!unknownSlot || (data.slot !== unknownSlot && data.slot !== null && data.slot !== "")) {
      form.dataset.mealSlotEdited = "true";
    }
    slotHidden.value = slot ?? "";
    form.querySelectorAll<HTMLButtonElement>(".meal-slot-btn").forEach((btn) => {
      btn.classList.toggle("is-active", normalizeMealSlot(btn.dataset.slot) === slot);
    });
  }
  if (Object.prototype.hasOwnProperty.call(data, "iconKey")) {
    form.querySelector<HTMLInputElement>("#mealIconKey")!.value = typeof data.iconKey === "string" ? data.iconKey : "";
  }
  if (!Array.isArray(data.foods)) {
    renderNutritionTotals(form);
    return;
  }
  const list = form.querySelector<HTMLElement>(".meal-food-list")!;
  list.innerHTML = "";
  data.foods.forEach((item, i) => {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const kcalVal = numOrNull(o.kcal);
    const entry: MealFoodEntry = {
      text: strOrEmpty(o.text),
      kcal: kcalVal != null ? Math.round(kcalVal) : 0,
      kcalEstimated: o.kcalEstimated === true,
      servingText: o.servingText ? strOrEmpty(o.servingText) : undefined,
      carbsGrams: numOrNull(o.carbsGrams),
      proteinGrams: numOrNull(o.proteinGrams),
      fatGrams: numOrNull(o.fatGrams),
      sugarGrams: numOrNull(o.sugarGrams),
      fiberGrams: numOrNull(o.fiberGrams),
      sodiumMilligrams: numOrNull(o.sodiumMilligrams),
      vitaminCMilligrams: numOrNull(o.vitaminCMilligrams),
      nutrientsEstimated:
        o.nutrientsEstimated === true || o.nutrientsEstimated === false ? o.nutrientsEstimated : null,
    };
    const wrap = document.createElement("div");
    wrap.innerHTML = foodRowHtml(entry, i);
    const row = wrap.firstElementChild as HTMLElement;
    list.appendChild(row);
    bindFoodRow(row, form, searchTimers);
  });
  renderNutritionTotals(form);
}

export async function deleteMeal(date: string, mealId: string, revision?: number) {
  let rev = revision;
  if (rev == null) {
    const loaded = await loadMealsForDate(date);
    rev = loaded.revisions.get(mealId);
  }
  if (rev == null) throw new Error("餐食不存在");
  await deleteMealOnArchive(mealId, rev);
}

export type TodayPanelRefresh = {
  cachedMealsForDate?: (date: string) => MealEntry[];
  refreshRings: () => void;
  refreshFeed: () => void;
  repaintFull: () => void | Promise<void>;
  optimisticMeals: (date: string, meals: MealEntry[]) => () => void;
  optimisticMealPatches: (patches: { date: string; meals: MealEntry[] }[]) => () => void;
  optimisticEvent: (entry: Record<string, unknown>, existingId?: string) => () => void;
  optimisticMood: (entry: Record<string, unknown>, existingId?: string) => () => void;
};

export function openMealDialog(
  root: HTMLElement,
  meal: MealEntryWithRevision | null,
  panel: TodayPanelRefresh,
  defaultDate?: string,
) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  const date = defaultDate ?? beijingToday();
  const originDate = meal ? date : undefined;
  const slot = meal?.slot ?? "other";
  const at = meal?.at ?? "";
  const foods = meal?.foods?.length ? meal.foods : [];
  const searchTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  backdrop.innerHTML = `
    <style>${MEAL_DIALOG_STYLES}</style>
    <form class="dialog-panel meal-dialog-panel" id="mealForm">
      <div class="dialog-title">${meal ? "编辑吃饭" : "记吃饭"}</div>
      <input type="hidden" id="mealIconKey" value="${escHtml(meal?.iconKey ?? "")}">
      <div class="dialog-field"><label>日期</label><div id="mealDateMount"></div></div>
      <div class="dialog-field"><label>时间</label><div id="mealAtMount"></div></div>
      ${slotField(slot)}
      <div class="dialog-field"><label>餐名</label><input type="text" id="mealTitle" value="${escHtml(meal?.title ?? "")}" placeholder="留空则用日期+餐次"></div>
      <div class="dialog-field meal-food-section">
        <div class="meal-food-section-head"><label>食物</label><button type="button" class="dialog-btn meal-food-add">添加食物</button></div>
        <div class="meal-food-list">${foods.map((f, i) => foodRowHtml(f, i)).join("")}</div>
      </div>
      <div class="meal-nutrition-totals"></div>
      <div class="meal-ai-row">
        <input type="text" id="mealAiInput" placeholder="用自然语言描述餐食…" autocomplete="off">
        <button type="button" id="mealAiSend" aria-label="发送">${ARROW_SVG}</button>
      </div>
      <div class="meal-ai-hint" id="mealAiHint"></div>
      <div class="dialog-field"><label>备注</label><input type="text" id="mealText" value="${escHtml(meal?.text ?? "")}"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#mealForm")!;
  if (meal?.unrecognizedSlot) form.dataset.unrecognizedMealSlot = meal.unrecognizedSlot;
  const datePicker = mountDecoupledDatePicker({ defaultTrigger: { container: form.querySelector("#mealDateMount")! },
    value: date,
  });
  const timePicker = mountDecoupledTimePicker({ defaultTrigger: { container: form.querySelector("#mealAtMount")! },
    value: normalizeHhMm(at) || at,
  });
  bindFoodRows(form, searchTimers);
  const slotHidden = bindMealSlotRow(form);
  renderNutritionTotals(form);

  const aiInput = form.querySelector<HTMLInputElement>("#mealAiInput")!;
  const aiSendBtn = form.querySelector<HTMLButtonElement>("#mealAiSend")!;
  const aiHint = form.querySelector<HTMLElement>("#mealAiHint")!;
  let aiBusy = false;

  async function runAi() {
    const text = aiInput.value.trim();
    if (!text || aiBusy) return;
    aiHint.textContent = "";
    aiBusy = true;
    aiSendBtn.disabled = true;
    aiInput.disabled = true;
    const snapshot = draftJsonFromForm(form, slotHidden, datePicker, timePicker);
    try {
      const config = await loadAiConfig();
      const entry = getActiveEntry(config);
      if (!entry) {
        aiHint.textContent = "请先在 AI 设置中添加 API";
        return;
      }
      if (!entry.apiKey.trim()) {
        aiHint.textContent = "请先在设置中填写 API Key";
        return;
      }
      const raw = await completeChat(
        MEAL_AI_SYSTEM,
        JSON.stringify(snapshot) + "\n\n用户：" + text,
        entry,
        config.activeModel,
      );
      aiInput.value = "";
      const parsed = parseAiJson(raw);
      if (!parsed) {
        aiHint.textContent = "AI 返回格式无法解析";
        return;
      }
      applyAiResultToForm(form, slotHidden, searchTimers, parsed, datePicker, timePicker);
    } catch (e) {
      aiHint.textContent = String(e);
    } finally {
      aiBusy = false;
      aiSendBtn.disabled = false;
      aiInput.disabled = false;
    }
  }

  aiSendBtn.addEventListener("click", () => void runAi());
  aiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void runAi();
    }
  });

  const close = async () => {
    datePicker.dispose();
    timePicker.dispose();
    await motion.close();
    backdrop.remove();
  };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  bindBackdropPressDismiss(backdrop, () => void close());
  void motion.open();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = datePicker.getValue();
    const mealSlot = normalizeMealSlot(slotHidden.value);
    if (form.dataset.unrecognizedMealSlot && form.dataset.mealSlotEdited !== "true") {
      alert("餐食分类值未知，请先明确选择一个分类或未分类后再保存");
      return;
    }
    const collectedFoods = collectFoods(form);
    if (meal && !meal.title && collectedFoods.length === 0) {
      alert("这条旧餐没有逐条食物。请添加食物并填写热量后再保存。");
      return;
    }
    for (const food of collectedFoods) {
      if (!food.text) {
        alert("每条食物须填写文字");
        return;
      }
      if (!Number.isFinite(food.kcal) || food.kcal < 0) {
        alert("每条食物须填写有效热量");
        return;
      }
    }
    const titleInput = form.querySelector<HTMLInputElement>("#mealTitle")!.value.trim();
    const title = titleInput || defaultMealTitle(d, mealSlot);
    const entry: MealEntry = {
      id: meal?.id ?? newMealId(),
      title,
      at: timePicker.getValue() || undefined,
      slot: mealSlot,
      iconKey: form.querySelector<HTMLInputElement>("#mealIconKey")?.value || undefined,
      foods: collectedFoods,
      items: collectedFoods.map((f) => f.text),
      text: form.querySelector<HTMLInputElement>("#mealText")!.value.trim(),
      kcal: collectedFoods.reduce((s, f) => s + (f.kcal || 0), 0),
      source: meal?.source ?? "manual",
      revision: meal?.revision,
    };
    let rollback = () => {};
    if (meal && originDate && d !== originDate) {
      const oldLoaded = await loadMealsForDate(originDate);
      const newLoaded = await loadMealsForDate(d);
      const oldMeals = oldLoaded.meals.filter((m) => m.id !== entry.id);
      const newMeals = [...newLoaded.meals.filter((m) => m.id !== entry.id), entry];
      rollback = panel.optimisticMealPatches([
        { date: originDate, meals: oldMeals },
        { date: d, meals: newMeals },
      ]);
      await close();
      panel.refreshRings();
      panel.refreshFeed();
      void (async () => {
        try {
          if (meal.revision != null) {
            await deleteMealOnArchive(meal.id, meal.revision);
          }
          await createMealOnArchive(d, entry);
          window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
        } catch (err) {
          rollback();
          alert(String(err));
        }
      })();
    } else {
      const cached = panel.cachedMealsForDate?.(d);
      let prev: Awaited<ReturnType<typeof loadMealsForDate>> | null = null;
      const meals = cached
        ? meal
          ? cached.some((m) => m.id === entry.id)
            ? cached.map((m) => (m.id === entry.id ? entry : m))
            : [...cached, entry]
          : [...cached, entry]
        : null;
      let finalMeals: MealEntry[];
      if (meals) {
        finalMeals = meals;
      } else {
        prev = await loadMealsForDate(d);
        finalMeals = meal
          ? prev.meals.some((m) => m.id === entry.id)
            ? prev.meals.map((m) => (m.id === entry.id ? entry : m))
            : [...prev.meals, entry]
          : [...prev.meals, entry];
      }
      rollback = panel.optimisticMeals(d, finalMeals);
      await close();
      panel.refreshRings();
      panel.refreshFeed();
      void (async () => {
        try {
          if (!prev) prev = await loadMealsForDate(d);
          if (meal?.revision != null) {
            await updateMealOnArchive(d, entry, meal.revision);
          } else {
            await createMealOnArchive(d, entry);
          }
          window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
        } catch (err) {
          rollback();
          alert(String(err));
        }
      })();
    }
  });
}
