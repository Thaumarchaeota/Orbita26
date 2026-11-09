import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../admin/domain-write-guard";
import { normalizeMealSlot, mealSlotLabel, type MealFoodEntry, type MealSlot } from "../../core/data/meals";
import { MOOD_EMOJI_PRESETS } from "../../core/data/mood-emojis";
import { escHtml } from "../../core/html";
import { mountDecoupledDatePicker, type DecoupledDatePickerHandle } from "../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker, type DecoupledTimePickerHandle } from "../../ui/decoupled-time-picker";
import { normalizeDecoupledHhMm } from "../../ui/decoupled-time-wheels";
import { mountFlatSelectPopover } from "../../ui/flat-select-popover";
import { bindBackdropPressDismiss } from "../../ui/backdrop-dismiss";
import { bindDialog } from "../../ui/motion";
import { createInsightDialog, isInsightSurface } from "../../ui/insight-dialog";
import { beijingToday, unixToTimeParts, type HealthMealSnapshot } from "../journal/client";
import { archiveMealToEntry, computeMealNutritionTotals, getMeal } from "../journal/meals-archive";

export type ToolConfirmEvent = {
  confirmId?: string;
  confirm_id?: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
};

function str(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strArr(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

const MEAL_SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "late_night", "coffee", "beverage", "snack", "other"];

function mealSlotOptions(): Array<{ value: string; label: string }> {
  return [{ value: "", label: mealSlotLabel(null) }, ...MEAL_SLOT_ORDER.map((s) => ({ value: s, label: mealSlotLabel(s) }))];
}

type FoodDraft = {
  text: string;
  kcal: string;
  servingText: string;
  carbsGrams: string;
  proteinGrams: string;
  fatGrams: string;
  sugarGrams: string;
  fiberGrams: string;
  sodiumMilligrams: string;
  vitaminCMilligrams: string;
  kcalEstimated: boolean;
  servingEstimated: boolean | null;
  nutrientsEstimated: boolean | null;
};

type MealConfirmPrep = {
  args: Record<string, unknown>;
  blocked?: string;
};

function finiteNonNeg(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function numField(v: unknown): string {
  const n = finiteNonNeg(v);
  return n === undefined ? "" : String(n);
}

function emptyFoodDraft(): FoodDraft {
  return {
    text: "",
    kcal: "",
    servingText: "",
    carbsGrams: "",
    proteinGrams: "",
    fatGrams: "",
    sugarGrams: "",
    fiberGrams: "",
    sodiumMilligrams: "",
    vitaminCMilligrams: "",
    kcalEstimated: false,
    servingEstimated: null,
    nutrientsEstimated: null,
  };
}

function foodDraftFromRecord(o: Record<string, unknown>, kcalEstimatedDefault: boolean): FoodDraft {
  return {
    text: typeof o.text === "string" ? o.text : "",
    kcal: numField(o.kcal),
    servingText: typeof o.servingText === "string" ? o.servingText : "",
    carbsGrams: numField(o.carbsGrams),
    proteinGrams: numField(o.proteinGrams),
    fatGrams: numField(o.fatGrams),
    sugarGrams: numField(o.sugarGrams),
    fiberGrams: numField(o.fiberGrams),
    sodiumMilligrams: numField(o.sodiumMilligrams),
    vitaminCMilligrams: numField(o.vitaminCMilligrams),
    kcalEstimated: typeof o.kcalEstimated === "boolean" ? o.kcalEstimated : kcalEstimatedDefault,
    servingEstimated: typeof o.servingEstimated === "boolean" ? o.servingEstimated : null,
    nutrientsEstimated: typeof o.nutrientsEstimated === "boolean" ? o.nutrientsEstimated : null,
  };
}

function foodDraftsFromArgs(args: Record<string, unknown>): FoodDraft[] {
  if (!Array.isArray(args.foods)) return [];
  return args.foods.map((item) =>
    foodDraftFromRecord(item && typeof item === "object" ? (item as Record<string, unknown>) : {}, true),
  );
}

function foodEntryArg(f: MealFoodEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { text: f.text, kcalEstimated: f.kcalEstimated };
  const kcal = finiteNonNeg(f.kcal);
  if (kcal !== undefined) out.kcal = kcal;
  if (f.servingText?.trim()) {
    out.servingText = f.servingText;
    if (typeof f.servingEstimated === "boolean") out.servingEstimated = f.servingEstimated;
  }
  const nutrients = [
    ["carbsGrams", f.carbsGrams],
    ["proteinGrams", f.proteinGrams],
    ["fatGrams", f.fatGrams],
    ["sugarGrams", f.sugarGrams],
    ["fiberGrams", f.fiberGrams],
    ["sodiumMilligrams", f.sodiumMilligrams],
    ["vitaminCMilligrams", f.vitaminCMilligrams],
  ] as const;
  let any = false;
  for (const [key, val] of nutrients) {
    const n = finiteNonNeg(val);
    if (n === undefined) continue;
    out[key] = n;
    any = true;
  }
  if (any && typeof f.nutrientsEstimated === "boolean") out.nutrientsEstimated = f.nutrientsEstimated;
  return out;
}

function mealWhen(meal: HealthMealSnapshot): { date: string; time: string } {
  const ts = Math.floor(Date.parse(meal.startedAt) / 1000);
  if (!Number.isFinite(ts)) return { date: beijingToday(), time: meal.atHm ?? "" };
  const parts = unixToTimeParts(ts);
  return { date: parts.date, time: meal.atHm ?? "" };
}

async function prepareMealConfirm(name: string, args: Record<string, unknown>): Promise<MealConfirmPrep> {
  if (name !== "journal_update_meal" && name !== "journal_delete_meal") return { args };
  const id = str(args, "id");
  if (!id) return { args, blocked: "缺少餐食 ID" };
  let meal: HealthMealSnapshot;
  try {
    meal = (await getMeal(id)).meal;
  } catch {
    return { args: { id }, blocked: "找不到该餐食" };
  }
  if (meal.deletedAt) return { args: { id }, blocked: "该餐食已删除" };
  const when = mealWhen(meal);
  const entry = archiveMealToEntry(meal, when.date);
  if (
    name === "journal_update_meal" &&
    Array.isArray(args.foods) &&
    args.foods.length === 0 &&
    meal.recordShape !== "foods" &&
    ((meal.items ?? []).some((text) => text.trim()) || meal.mealKcal != null)
  ) {
    return { args: { id }, blocked: "该旧餐食的食物明细不能直接清空；请先为原有每项食物补齐热量，再确认修改，避免丢失原热量" };
  }
  if (name === "journal_delete_meal") {
    return {
      args: {
        id,
        date: when.date,
        at: entry.at ?? when.time,
        slot: entry.slot,
        iconKey: entry.iconKey,
        title: entry.title ?? "",
        text: entry.text,
        foods: entry.foods.map(foodEntryArg),
      },
    };
  }
  const out: Record<string, unknown> = {
    id,
    date: when.date,
    at: entry.at ?? "",
    _originalDate: when.date,
    _originalAt: entry.at ?? "",
    slot: entry.unrecognizedSlot ?? entry.slot,
    _unrecognizedSlot: entry.unrecognizedSlot ?? "",
    _metadataOnly: true,
    iconKey: entry.iconKey,
    title: entry.title ?? "",
    text: entry.text,
    foods: meal.recordShape === "foods"
      ? entry.foods.map(foodEntryArg)
      : (meal.items ?? []).map((text) => ({ text: text.trim() })).filter((food) => food.text),
  };
  if (typeof args.date === "string" && args.date.trim()) out.date = args.date.trim();
  if (typeof args.at === "string" && args.at.trim()) out.at = args.at.trim();
  if (!entry.unrecognizedSlot && Object.prototype.hasOwnProperty.call(args, "slot")) out.slot = normalizeMealSlot(args.slot);
  if (typeof args.iconKey === "string") out.iconKey = args.iconKey;
  if (typeof args.title === "string" && args.title.trim()) out.title = args.title.trim();
  if (typeof args.text === "string") out.text = args.text;
  if (Array.isArray(args.foods)) {
    const current = meal.recordShape === "foods"
      ? entry.foods.map(foodEntryArg)
      : (meal.items ?? []).map((text) => ({ text: text.trim() })).filter((food) => food.text);
    if (JSON.stringify(args.foods) !== JSON.stringify(current)) {
      out.foods = args.foods;
      out._metadataOnly = false;
    }
  }
  return { args: out };
}

type ToolConfirmPickers = {
  dates: Map<string, DecoupledDatePickerHandle>;
  times: Map<string, DecoupledTimePickerHandle>;
  dispose: () => void;
};

function datePickerField(label: string, name: string, value: string): string {
  return `<div class="insight-dialog-field"><label>${label}</label><div data-region="picker-date" data-name="${escHtml(name)}" data-value="${escHtml(value)}"></div></div>`;
}

function timePickerField(label: string, name: string, value: string): string {
  return `<div class="insight-dialog-field"><label>${label}</label><div data-region="picker-time" data-name="${escHtml(name)}" data-value="${escHtml(value)}"></div></div>`;
}

function mountToolConfirmPickers(form: HTMLElement): ToolConfirmPickers {
  const dates = new Map<string, DecoupledDatePickerHandle>();
  const times = new Map<string, DecoupledTimePickerHandle>();
  const disposers: Array<() => void> = [];
  form.querySelectorAll<HTMLElement>('[data-region="picker-date"]').forEach((el) => {
    const name = el.dataset.name ?? "";
    const handle = mountDecoupledDatePicker({
      defaultTrigger: { container: el },
      value: el.dataset.value ?? "",
    });
    if (name) dates.set(name, handle);
    disposers.push(() => handle.dispose());
  });
  form.querySelectorAll<HTMLElement>('[data-region="picker-time"]').forEach((el) => {
    const name = el.dataset.name ?? "";
    const handle = mountDecoupledTimePicker({
      defaultTrigger: { container: el },
      value: el.dataset.value ?? "",
    });
    if (name) times.set(name, handle);
    disposers.push(() => handle.dispose());
  });
  form.querySelectorAll<HTMLElement>('[data-region="picker-slot"]').forEach((el) => {
    const hidden = el.querySelector<HTMLInputElement>('input[name="slot"]');
    if (!hidden) return;
    const initial = normalizeMealSlot(el.dataset.value || hidden.value);
    hidden.value = initial ?? "";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "meal-property-slot-trigger";
    trigger.textContent = mealSlotLabel(initial);
    el.appendChild(trigger);
    const popover = mountFlatSelectPopover({
      anchor: trigger,
      options: mealSlotOptions(),
      selected: new Set([initial ?? ""]),
      multiple: false,
      search: false,
      onChange: (next) => {
        const value = normalizeMealSlot([...next][0]);
        hidden.value = value ?? "";
        hidden.dataset.changed = "true";
        trigger.textContent = mealSlotLabel(value);
      },
    });
    trigger.addEventListener("click", () => {
      if (popover.isOpen()) void popover.close();
      else void popover.open();
    });
    disposers.push(() => popover.dispose());
  });
  return {
    dates,
    times,
    dispose: () => {
      for (const d of disposers) d();
    },
  };
}

function foodMainField(label: string, key: string, value: string, kind: "text" | "num", extraClass = ""): string {
  const input =
    kind === "text"
      ? `<input type="text" data-f="${key}" placeholder="${escHtml(label)}" aria-label="${escHtml(label)}" value="${escHtml(value)}">`
      : `<input type="number" data-f="${key}" min="0" step="any" placeholder="${escHtml(label)}" aria-label="${escHtml(label)}" value="${escHtml(value)}">`;
  return `<label class="meal-food-field ${extraClass}">${input}</label>`;
}

function foodNutrientField(label: string, key: string, value: string, unit: string): string {
  return `<label class="meal-food-field meal-food-field-nutrient"><span class="meal-food-nutrient-name">${escHtml(label)}</span><span class="meal-food-nutrient-value"><input type="number" data-f="${key}" min="0" step="any" placeholder="-" aria-label="${escHtml(label)}" value="${escHtml(value)}"><span class="meal-food-nutrient-unit">${escHtml(unit)}</span></span></label>`;
}

function mealFormFields(args: Record<string, unknown>, withId = false): string {
  const today = beijingToday();
  const slot = normalizeMealSlot(str(args, "slot", "other"));
  return `
    <div class="meal-property-rows">
      <div class="meal-property-row">
        <span class="meal-property-label">餐名</span>
        <div class="meal-property-value">
          <input type="text" name="title" value="${escHtml(str(args, "title"))}"><input type="hidden" name="iconKey" value="${escHtml(str(args, "iconKey"))}">${withId ? `<input type="hidden" name="id" value="${escHtml(str(args, "id"))}"><input type="hidden" name="_metadataOnly" value="${escHtml(str(args, "_metadataOnly"))}"><input type="hidden" name="_originalDate" value="${escHtml(str(args, "_originalDate"))}"><input type="hidden" name="_originalAt" value="${escHtml(str(args, "_originalAt"))}">` : ""}
        </div>
      </div>
      <div class="meal-property-row">
        <span class="meal-property-label">时间</span>
        <div class="meal-property-value meal-property-when">
          <div data-region="picker-date" data-name="date" data-value="${escHtml(str(args, "date", today))}"></div>
          <div data-region="picker-slot" data-value="${escHtml(slot ?? "")}"><input type="hidden" name="slot" value="${escHtml(slot ?? "")}"><input type="hidden" name="unrecognizedSlot" value="${escHtml(str(args, "_unrecognizedSlot"))}"></div>
          <div data-region="picker-time" data-name="at" data-value="${escHtml(str(args, "at"))}"></div>
        </div>
      </div>
      <div class="meal-property-row">
        <span class="meal-property-label">备注</span>
        <div class="meal-property-value">
          <textarea name="text" rows="1">${escHtml(str(args, "text"))}</textarea>
        </div>
      </div>
      <div class="meal-property-row meal-property-row-foods">
        <span class="meal-property-label meal-foods-key">食物<span class="meal-food-add" data-action="add-food" role="button" tabindex="0" aria-label="添加食物">+</span></span>
        <div class="meal-foods-block" data-region="meal-foods"></div>
      </div>
    </div>
    <div class="meal-compose-totals" data-region="meal-totals"></div>`;
}

function deleteMealPreview(args: Record<string, unknown>): string {
  const slot = normalizeMealSlot(str(args, "slot", "other"));
  const foods = foodDraftsFromArgs(args);
  const foodHtml =
    foods.length === 0
      ? `<p class="meal-food-empty">没有食物明细</p>`
      : foods
          .map((f) => {
            const kcal = f.kcal === "" ? "热量未知" : `${f.kcal} 千卡`;
            return `<article class="meal-food-card"><p class="meal-food-name">${escHtml(f.text || "（无文字）")}</p><p>${escHtml(kcal)}</p></article>`;
          })
          .join("");
  return `
    <div class="meal-compose-field"><label>餐名</label><p>${escHtml(str(args, "title") || "（无餐名）")}</p><input type="hidden" name="id" value="${escHtml(str(args, "id"))}"></div>
    <div class="meal-compose-field"><label>日期</label><p>${escHtml(str(args, "date"))}</p></div>
    <div class="meal-compose-field"><label>时间</label><p>${escHtml(str(args, "at"))}</p></div>
    <div class="meal-compose-field"><label>餐次</label><p>${escHtml(mealSlotLabel(slot))}</p></div>
    <div class="meal-compose-field"><label>备注</label><p>${escHtml(str(args, "text") || "（无）")}</p></div>
    <div class="meal-compose-foods"><div class="meal-compose-foods-head"><span>食物</span></div>${foodHtml}</div>`;
}

function formatTotal(sum: number | null, integer: boolean): string {
  if (sum == null) return "未知";
  return integer ? String(Math.round(sum)) : String(Math.round(sum * 10) / 10);
}

function mealTotalsHtml(drafts: FoodDraft[]): string {
  const totals = computeMealNutritionTotals(
    drafts.map((f) => ({
      text: f.text,
      kcal: f.kcal.trim() === "" ? null : Number(f.kcal),
      kcalMissing: f.kcal.trim() === "" || finiteNonNeg(f.kcal) === undefined,
      carbsGrams: f.carbsGrams.trim() === "" ? null : Number(f.carbsGrams),
      proteinGrams: f.proteinGrams.trim() === "" ? null : Number(f.proteinGrams),
      fatGrams: f.fatGrams.trim() === "" ? null : Number(f.fatGrams),
      sugarGrams: f.sugarGrams.trim() === "" ? null : Number(f.sugarGrams),
      fiberGrams: f.fiberGrams.trim() === "" ? null : Number(f.fiberGrams),
      sodiumMilligrams: f.sodiumMilligrams.trim() === "" ? null : Number(f.sodiumMilligrams),
      vitaminCMilligrams: f.vitaminCMilligrams.trim() === "" ? null : Number(f.vitaminCMilligrams),
    })),
  );
  const row = (label: string, unit: string, total: { sum: number | null; incomplete: boolean }, integer = false) => {
    const badge = total.incomplete ? `<span class="meal-compose-total-warn">不完整</span>` : "";
    const val = formatTotal(total.sum, integer);
    const shown = val === "未知" ? val : `${val} ${unit}`;
    return `<div class="meal-compose-total-item"><span class="meal-compose-total-label">${label}</span><span class="meal-compose-total-value">${shown}</span>${badge}</div>`;
  };
  return `
    <div class="meal-compose-totals-head">营养合计</div>
    <div class="meal-compose-totals-grid">
      ${row("热量", "千卡", totals.kcal, true)}
      ${row("碳水", "克", totals.carbsGrams)}
      ${row("蛋白", "克", totals.proteinGrams)}
      ${row("脂肪", "克", totals.fatGrams)}
      ${row("糖", "克", totals.sugarGrams)}
      ${row("纤维", "克", totals.fiberGrams)}
      ${row("钠", "毫克", totals.sodiumMilligrams, true)}
      ${row("维生素 C", "毫克", totals.vitaminCMilligrams, true)}
    </div>`;
}

function syncMealDrafts(form: HTMLFormElement, drafts: FoodDraft[]) {
  form.querySelectorAll<HTMLElement>(".meal-food-item").forEach((card) => {
    const draft = drafts[Number(card.dataset.food)];
    if (!draft) return;
    const read = (key: string) => card.querySelector<HTMLInputElement>(`[data-f="${key}"]`)?.value ?? "";
    draft.text = read("text");
    draft.kcal = read("kcal");
    draft.servingText = read("serving");
    draft.carbsGrams = read("carbs");
    draft.proteinGrams = read("protein");
    draft.fatGrams = read("fat");
    draft.sugarGrams = read("sugar");
    draft.fiberGrams = read("fiber");
    draft.sodiumMilligrams = read("sodium");
    draft.vitaminCMilligrams = read("vitc");
  });
}

function renderMealTotals(form: HTMLElement, drafts: FoodDraft[]) {
  const el = form.querySelector<HTMLElement>('[data-region="meal-totals"]');
  if (el) el.innerHTML = mealTotalsHtml(drafts);
}

function bindMealFoodEditor(form: HTMLElement, drafts: FoodDraft[]) {
  const list = form.querySelector<HTMLElement>('[data-region="meal-foods"]');
  if (!list) return;
  const render = () => {
    list.innerHTML =
      drafts.length === 0
        ? `<p class="meal-food-empty">还没有食物记录</p>`
        : drafts
            .map(
              (f, i) => `<article class="meal-food-item" data-food="${i}">
            <div class="meal-food-row meal-food-row-main">
              ${foodMainField("名称", "text", f.text, "text", "meal-food-field-name")}
              ${foodMainField("份量", "serving", f.servingText, "text", "meal-food-field-serving")}
              ${foodMainField("热量", "kcal", f.kcal, "num", "meal-food-field-kcal")}
              <button type="button" class="meal-food-del" data-f="del" aria-label="删除">×</button>
            </div>
            <div class="meal-food-row meal-food-row-nutrients">${[
              foodNutrientField("碳水化合物", "carbs", f.carbsGrams, "g"),
              foodNutrientField("蛋白质", "protein", f.proteinGrams, "g"),
              foodNutrientField("脂肪", "fat", f.fatGrams, "g"),
              foodNutrientField("糖", "sugar", f.sugarGrams, "g"),
              foodNutrientField("纤维", "fiber", f.fiberGrams, "g"),
              foodNutrientField("钠", "sodium", f.sodiumMilligrams, "mg"),
              foodNutrientField("维生素C", "vitc", f.vitaminCMilligrams, "mg"),
            ].join("")}</div>
          </article>`,
            )
            .join("");
    list.querySelectorAll<HTMLElement>(".meal-food-item").forEach((card) => {
      card.querySelectorAll<HTMLInputElement>("input").forEach((inp) => {
        inp.addEventListener("input", () => {
          form.dataset.mealFoodEdited = "true";
          syncMealDrafts(form as HTMLFormElement, drafts);
          renderMealTotals(form, drafts);
        });
      });
      card.querySelector<HTMLButtonElement>('[data-f="del"]')?.addEventListener("click", () => {
        form.dataset.mealFoodEdited = "true";
        syncMealDrafts(form as HTMLFormElement, drafts);
        const idx = Number(card.dataset.food);
        if (!Number.isFinite(idx)) return;
        drafts.splice(idx, 1);
        render();
      });
    });
    renderMealTotals(form, drafts);
  };
  const addFood = form.querySelector<HTMLElement>('[data-action="add-food"]');
  addFood?.addEventListener("click", () => {
    form.dataset.mealFoodEdited = "true";
    drafts.push(emptyFoodDraft());
    render();
  });
  addFood?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    form.dataset.mealFoodEdited = "true";
    drafts.push(emptyFoodDraft());
    render();
  });
  render();
}

function mealFoodError(drafts: FoodDraft[]): string | null {
  for (const d of drafts) {
    if (!d.text.trim()) return "请填写食物文字";
    if (!d.kcal.trim()) return "请填写食物热量";
    if (finiteNonNeg(d.kcal) === undefined) return "热量必须是有限且 ≥0 的数字";
    for (const raw of [
      d.carbsGrams,
      d.proteinGrams,
      d.fatGrams,
      d.sugarGrams,
      d.fiberGrams,
      d.sodiumMilligrams,
      d.vitaminCMilligrams,
    ]) {
      if (raw.trim() && finiteNonNeg(raw) === undefined) return "营养素必须是有限且 ≥0 的数字";
    }
  }
  return null;
}

function markMealFoodErrors(form: HTMLFormElement, drafts: FoodDraft[]) {
  form.querySelectorAll<HTMLElement>(".meal-food-item").forEach((card) => {
    const d = drafts[Number(card.dataset.food)];
    const bad =
      !d ||
      !d.text.trim() ||
      !d.kcal.trim() ||
      finiteNonNeg(d.kcal) === undefined;
    card.classList.toggle("is-error", bad);
  });
}

function draftToFood(d: FoodDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {
    text: d.text.trim(),
    kcal: finiteNonNeg(d.kcal),
    kcalEstimated: d.kcalEstimated,
  };
  const serving = d.servingText.trim();
  if (serving) {
    out.servingText = serving;
    out.servingEstimated = d.servingEstimated ?? false;
  }
  const nutrients: Array<[string, string]> = [
    ["carbsGrams", d.carbsGrams],
    ["proteinGrams", d.proteinGrams],
    ["fatGrams", d.fatGrams],
    ["sugarGrams", d.sugarGrams],
    ["fiberGrams", d.fiberGrams],
    ["sodiumMilligrams", d.sodiumMilligrams],
    ["vitaminCMilligrams", d.vitaminCMilligrams],
  ];
  let any = false;
  for (const [key, raw] of nutrients) {
    const n = finiteNonNeg(raw);
    if (!raw.trim() || n === undefined) continue;
    out[key] = n;
    any = true;
  }
  if (any) out.nutrientsEstimated = d.nutrientsEstimated ?? false;
  return out;
}

function collectMealArgs(form: HTMLFormElement, pickers: ToolConfirmPickers, drafts: FoodDraft[]): Record<string, unknown> {
  syncMealDrafts(form, drafts);
  const out: Record<string, unknown> = {
    date: pickers.dates.get("date")?.getValue() ?? "",
    at: normalizeDecoupledHhMm(pickers.times.get("at")?.getValue() ?? "") || pickers.times.get("at")?.getValue() || "",
    slot: form.querySelector<HTMLInputElement>('input[name="slot"]')?.dataset.changed === "true"
      ? normalizeMealSlot(form.querySelector<HTMLInputElement>('input[name="slot"]')?.value)
      : (form.querySelector<HTMLInputElement>('input[name="unrecognizedSlot"]')?.value || normalizeMealSlot(form.querySelector<HTMLInputElement>('input[name="slot"]')?.value)),
    iconKey: form.querySelector<HTMLInputElement>('input[name="iconKey"]')?.value || undefined,
    title: form.querySelector<HTMLInputElement>('input[name="title"]')?.value ?? "",
    text: form.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value ?? "",
  };
  if (form.dataset.mealFoodEdited === "true" || form.querySelector<HTMLInputElement>('input[name="_metadataOnly"]')?.value !== "true") {
    out.foods = drafts.map(draftToFood);
  }
  const id = form.querySelector<HTMLInputElement>('input[name="id"]')?.value ?? "";
  if (id) {
    out.id = id;
    const originalDate = form.querySelector<HTMLInputElement>('input[name="_originalDate"]')?.value ?? "";
    const originalAt = form.querySelector<HTMLInputElement>('input[name="_originalAt"]')?.value ?? "";
    out.updateTime = out.date !== originalDate || out.at !== originalAt;
  }
  return out;
}

function formFields(name: string, args: Record<string, unknown>, blocked = ""): string {
  const today = beijingToday();
  switch (name) {
    case "journal_add_event":
      return `
        ${datePickerField("日期", "date", str(args, "date", today))}
        <div class="insight-dialog-field"><label>备注</label><input type="text" name="remark" value="${escHtml(str(args, "remark"))}"></div>`;
    case "journal_add_mood": {
      const emoji = str(args, "emoji", MOOD_EMOJI_PRESETS[0]);
      return `
        ${datePickerField("日期", "date", str(args, "date", today))}
        <div class="primary-mood-grid">
          ${MOOD_EMOJI_PRESETS.map((em) => `<button type="button" class="primary-mood-opt${emoji === em ? " is-active" : ""}" data-emoji="${em}">${em}</button>`).join("")}
        </div>
        <input type="hidden" name="emoji" value="${escHtml(emoji)}">
        <div class="insight-dialog-field"><label>简记</label><input type="text" name="note" value="${escHtml(str(args, "note"))}"></div>`;
    }
    case "journal_set_sleep":
      return `
        ${datePickerField("醒来日", "date", str(args, "date", today))}
        ${timePickerField("入睡", "sleepTime", str(args, "sleepTime"))}
        ${timePickerField("醒来", "wakeTime", str(args, "wakeTime"))}`;
    case "journal_add_nap":
      return `
        ${datePickerField("日期", "date", str(args, "date", today))}
        ${timePickerField("开始", "startTime", str(args, "startTime"))}
        ${timePickerField("结束", "endTime", str(args, "endTime"))}`;
    case "journal_add_meal":
      return mealFormFields(args, false);
    case "journal_update_meal":
      return blocked ? `<p class="insight-dialog-error">${escHtml(blocked)}</p>` : mealFormFields(args, true);
    case "journal_delete_meal":
      return blocked ? `<p class="insight-dialog-error">${escHtml(blocked)}</p>` : deleteMealPreview(args);
    case "journal_delete_entry":
      return `<div class="insight-dialog-field"><label>条目 ID</label><input type="text" name="id" value="${escHtml(str(args, "id"))}"></div>`;
    case "garmin_sync":
      return `<div class="insight-dialog-field"><label>同步天数</label><input type="number" name="days" min="1" max="30" value="${num(args, "days", 7)}"></div>`;
    case "garmin_login":
      return `<p class="insight-dialog-hint">将向佳明 SSO 发起登录；429 冷却期内请勿重复。</p>`;
    case "beancount_add_transaction":
      return `
        ${datePickerField("日期", "date", str(args, "date", today))}
        <div class="insight-dialog-field"><label>金额（元）</label><input type="number" name="amount" step="0.01" min="0" value="${num(args, "amount", 0) || ""}"></div>
        <div class="insight-dialog-field"><label>摘要</label><input type="text" name="description" value="${escHtml(str(args, "description"))}"></div>
        <div class="insight-dialog-field"><label>分类</label><input type="text" name="category" value="${escHtml(str(args, "category"))}" placeholder="餐饮"></div>`;
    default:
      return `<div class="insight-dialog-field"><label>参数 JSON</label><textarea name="_json" rows="6">${escHtml(JSON.stringify(args, null, 2))}</textarea></div>`;
  }
}

const INSIGHT_BATCH_WRITE_TOOLS = new Set(["productivity_apply_ai_batch", "journal_apply_ai_batch", "health_apply_ai_batch"]);

const BATCH_CONFIRM_TITLES: Record<string, string> = {
  productivity_apply_ai_batch: "确认 Productivity",
  journal_apply_ai_batch: "确认 Journal",
  health_apply_ai_batch: "确认 Health",
};

const BATCH_CONFIRM_HINT =
  "该领域整批全成或全不成；可改 JSON 后再确认。取消不回滚已经成功的其他领域。";

export function isInsightBatchWriteTool(name: string): boolean {
  return INSIGHT_BATCH_WRITE_TOOLS.has(name);
}

export type OpenToolConfirmResult = Record<string, unknown> | null | "defer";

export type ToolConfirmOptions = {
  presentation?: "dialog" | "inline";
  signal?: AbortSignal;
  onMount?: (element: HTMLElement) => void;
  beforeClose?: (args: Record<string, unknown>) => Promise<void>;
};

const CONFIRM_LABELS: Record<string, string> = {
  journal_add_event: "确认记录事件",
  journal_add_mood: "确认记录心情",
  journal_set_sleep: "确认记录睡眠",
  journal_add_nap: "确认记录午睡",
  journal_add_meal: "确认记录吃饭",
  journal_update_meal: "确认更新吃饭",
  journal_delete_meal: "确认删除吃饭",
  journal_delete_entry: "确认删除记录",
  garmin_sync: "确认同步佳明",
  garmin_login: "确认重新登录佳明",
  beancount_add_transaction: "确认记账",
};

function readForm(
  name: string,
  form: HTMLFormElement,
  pickers?: ToolConfirmPickers,
  mealDrafts: FoodDraft[] = [],
): Record<string, unknown> {
  if ((name === "journal_add_meal" || name === "journal_update_meal") && pickers) {
    return collectMealArgs(form, pickers, mealDrafts);
  }
  if (name === "journal_delete_meal") {
    return { id: form.querySelector<HTMLInputElement>('input[name="id"]')?.value ?? "" };
  }
  const fd = new FormData(form);
  if (!CONFIRM_LABELS[name]) {
    try {
      return JSON.parse(String(fd.get("_json") ?? "{}")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const out: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (k === "days" || k === "amount" || k === "kcal") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else out[k] = String(v);
  });
  pickers?.dates.forEach((handle, key) => {
    out[key] = handle.getValue();
  });
  pickers?.times.forEach((handle, key) => {
    const normalized = normalizeDecoupledHhMm(handle.getValue());
    out[key] = normalized || handle.getValue();
  });
  return out;
}

function parseBatchJson(form: HTMLFormElement): Record<string, unknown> | null {
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="_json"]');
  if (!textarea) return null;
  try {
    const parsed = JSON.parse(textarea.value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function showFormError(form: HTMLFormElement, message: string) {
  let err = form.querySelector<HTMLElement>('[data-region="json-error"]');
  if (!err) {
    err = document.createElement("p");
    err.className = "insight-dialog-error";
    err.dataset.region = "json-error";
    const footer = form.querySelector(".insight-dialog-footer");
    if (footer?.classList.contains("insight-dialog-footer")) footer.prepend(err);
    else footer?.before(err);
  }
  err.hidden = false;
  err.textContent = message;
}

function clearFormError(form: HTMLFormElement) {
  form.querySelector('[data-region="json-error"]')?.remove();
}

export async function openToolConfirm(
  root: HTMLElement,
  event: ToolConfirmEvent,
  options: ToolConfirmOptions = {},
): Promise<OpenToolConfirmResult> {
  const prepared = await prepareMealConfirm(event.name, event.args);
  const mealBlocked = prepared.blocked ?? "";
  const hydratedArgs = prepared.args;
  const mealDrafts =
    event.name === "journal_add_meal" || event.name === "journal_update_meal" ? foodDraftsFromArgs(hydratedArgs) : [];
  const isMealTool =
    event.name === "journal_add_meal" || event.name === "journal_update_meal" || event.name === "journal_delete_meal";
  const isBatchWrite = isInsightBatchWriteTool(event.name);
  const inline = options.presentation === "inline";
  const insightDialog = !inline && isInsightSurface();
  if (inline && (options.signal?.aborted || !root.isConnected)) return null;
  return new Promise((resolve) => {
    const title = isBatchWrite
      ? (BATCH_CONFIRM_TITLES[event.name] ?? event.label)
      : event.name === "journal_add_meal" || event.name === "journal_update_meal"
        ? "餐食记录"
        : (CONFIRM_LABELS[event.name] ?? event.label);
    const fieldsHtml = formFields(event.name, hydratedArgs, mealBlocked);
    const batchHint = isBatchWrite
      ? `<p class="insight-dialog-hint">${escHtml(BATCH_CONFIRM_HINT)}</p>`
      : "";
    const batchDeferBtn = isBatchWrite
      ? `<button type="button" class="insight-dialog-btn" data-action="defer">延后</button>`
      : "";
    const submitLabel = isMealTool ? "确定" : "确认执行";

    let backdrop: HTMLElement;
    let form: HTMLFormElement;
    let motion: ReturnType<typeof bindDialog> | null = null;
    let insightHandle: ReturnType<typeof createInsightDialog> | null = null;
    let submitting = false;

    if (insightDialog) {
      insightHandle = createInsightDialog({
        title,
        submitLabel,
        extraActionsHtml: batchDeferBtn,
        panelClass: isMealTool ? "insight-tool-confirm-dialog insight-meal-confirm-dialog" : "insight-tool-confirm-dialog",
        bodyHtml: `${batchHint}${fieldsHtml}`,
      });
      backdrop = insightHandle.backdrop;
      form = insightHandle.panel;
      motion = insightHandle.motion;
    } else {
      backdrop = document.createElement("div");
      backdrop.className = inline ? "insight-tool-confirm" : "dialog-backdrop";
      backdrop.innerHTML = inline
        ? `
      <form class="insight-tool-confirm-card insight-dialog-panel${isMealTool ? " insight-meal-confirm-dialog" : ""}">
        <div class="insight-dialog-header"><h2 class="insight-dialog-title">${escHtml(title)}</h2></div>
        <div class="insight-dialog-body">${batchHint}${fieldsHtml}</div>
        <div class="insight-dialog-footer">
          <div class="insight-dialog-actions">
            <button type="button" class="insight-dialog-btn" data-action="cancel">取消</button>
            ${batchDeferBtn}
            <button type="submit" class="insight-dialog-btn insight-dialog-btn-primary">${submitLabel}</button>
          </div>
        </div>
      </form>`
        : `
      <form class="dialog-panel">
        <div class="dialog-title">${escHtml(title)}</div>
        ${batchHint}
        ${fieldsHtml}
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" data-action="cancel">取消</button>
          ${batchDeferBtn}
          <button type="submit" class="dialog-btn dialog-btn-primary">${submitLabel}</button>
        </div>
      </form>`;
      root.appendChild(backdrop);
      form = backdrop.querySelector<HTMLFormElement>("form")!;
      motion = inline ? null : bindDialog(backdrop);
    }

    const pickers = mountToolConfirmPickers(form);
    if (isMealTool) form.classList.add("insight-meal-confirm-dialog");
    if ((event.name === "journal_add_meal" || event.name === "journal_update_meal") && !mealBlocked) {
      bindMealFoodEditor(form, mealDrafts);
    }

    const emojiInput = form.querySelector<HTMLInputElement>('input[name="emoji"]');
    if (emojiInput) {
      form.querySelectorAll<HTMLButtonElement>(".primary-mood-opt").forEach((b) => {
        b.addEventListener("click", () => {
          form.querySelectorAll(".primary-mood-opt").forEach((x) => x.classList.remove("is-active"));
          b.classList.add("is-active");
          emojiInput.value = b.dataset.emoji!;
        });
      });
    }

    let settled = false;
    const finish = async (result: OpenToolConfirmResult, stopped = false) => {
      if (settled) return;
      settled = true;
      pickers.dispose();
      options.signal?.removeEventListener("abort", onAbort);
      if (insightHandle) {
        await insightHandle.close();
      } else if (motion) {
        await motion.close();
        backdrop.remove();
      } else {
        backdrop.classList.add("is-resolved");
        backdrop.textContent = stopped
          ? "对话已停止，未执行"
          : result === null
            ? "已取消，未执行"
            : result === "defer"
              ? "已延后处理"
              : "已提交确认，等待执行结果";
      }
      resolve(result);
    };
    const onAbort = () => void finish(null, true);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const cancel = () => {
      if (submitting) return;
      void finish(null);
    };
    if (insightHandle) insightHandle.bindChrome(cancel);
    else {
      backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", cancel);
      if (!inline) {
        bindBackdropPressDismiss(backdrop, cancel);
      }
    }
    backdrop.querySelector('[data-action="defer"]')?.addEventListener("click", () => {
      if (submitting) return;
      void finish("defer");
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (submitting) return;
      if (isBatchWrite) {
        clearFormError(form);
        const args = parseBatchJson(form);
        if (!args) {
          showFormError(form, "JSON 格式无效");
          return;
        }
        void accept(args);
        return;
      }
      if (mealBlocked) {
        showFormError(form, mealBlocked);
        return;
      }
      if (event.name === "journal_add_meal" || event.name === "journal_update_meal") {
        clearFormError(form);
        syncMealDrafts(form, mealDrafts);
        const foodEdited = form.dataset.mealFoodEdited === "true" || form.querySelector<HTMLInputElement>('input[name="_metadataOnly"]')?.value !== "true";
        const foodError = foodEdited ? mealFoodError(mealDrafts) : null;
        if (foodError) {
          markMealFoodErrors(form, mealDrafts);
          showFormError(form, foodError);
          return;
        }
        if (event.name === "journal_update_meal" && !str(collectMealArgs(form, pickers, mealDrafts), "id")) {
          showFormError(form, "缺少吃饭记录 ID");
          return;
        }
      }
      if (event.name === "journal_delete_meal") {
        const id = form.querySelector<HTMLInputElement>('input[name="id"]')?.value ?? "";
        if (!id) {
          showFormError(form, "找不到该餐食");
          return;
        }
        void accept({ id });
        return;
      }
      const args = readForm(event.name, form, pickers, mealDrafts);
      void accept(args);
    });

    async function accept(args: Record<string, unknown>) {
      if (submitting) return;
      submitting = true;
      insightHandle?.setBusy(true);
      const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        if (options.beforeClose) await options.beforeClose(args);
        await finish(args);
      } catch (err) {
        submitting = false;
        insightHandle?.setBusy(false);
        if (submitBtn) submitBtn.disabled = false;
        showFormError(form, err instanceof Error ? err.message : String(err));
      }
    }

    if (motion && !insightHandle) void motion.open();
    else if (insightHandle) void insightHandle.open();
    else options.onMount?.(backdrop);
  });
}

function resolveConfirmId(event: ToolConfirmEvent): string {
  const id = event.confirmId ?? (event as { confirm_id?: string }).confirm_id;
  if (!id) throw new Error("tool confirm id missing");
  return id;
}

export async function confirmAgentTool(
  root: HTMLElement,
  event: ToolConfirmEvent,
  options: ToolConfirmOptions = {},
): Promise<boolean> {
  const confirmId = resolveConfirmId(event);
  const result = await openToolConfirm(root, event, {
    ...options,
    beforeClose: async (args) => {
      await invokeDomainWrite("agent_tool_confirm", { req: { confirmId, args } });
    },
  });
  if (result === "defer") {
    try {
      await invoke("agent_tool_reject", { req: { confirmId, reason: "已延后" } });
    } catch {
      /* backend may already be aborted */
    }
    return false;
  }
  if (!result) {
    try {
      await invoke("agent_tool_reject", { req: { confirmId } });
    } catch {
      /* backend may already be aborted */
    }
    return false;
  }
  return true;
}
