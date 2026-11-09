import { invoke } from "@tauri-apps/api/core";
import {
  mealSlotLabel,
  normalizeMealSlot,
  type MealEntry,
  type MealFoodEntry,
  type MealCategory,
} from "../../core/data/meals";
import type { HealthMealFoodSnapshot, HealthMealSnapshot } from "./client";
import { dateTimeToUnix } from "./client";

export type MealEntryWithRevision = MealEntry & { revision?: number };

function slotToApi(slot: MealCategory, unrecognizedSlot?: string): string | null {
  return slot ?? unrecognizedSlot ?? null;
}

export function defaultMealTitle(date: string, slot: MealCategory): string {
  return slot ? `${date} ${mealSlotLabel(slot)}` : `${date} 饮食记录`;
}

function foodToInput(food: MealFoodEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    text: food.text,
    kcal: food.kcal,
    kcalEstimated: food.kcalEstimated,
  };
  if (food.servingText?.trim()) {
    out.servingText = food.servingText.trim();
    out.servingEstimated = food.servingEstimated ?? false;
  }
  const nutrients = [
    ["carbsGrams", food.carbsGrams],
    ["proteinGrams", food.proteinGrams],
    ["fatGrams", food.fatGrams],
    ["sugarGrams", food.sugarGrams],
    ["fiberGrams", food.fiberGrams],
    ["sodiumMilligrams", food.sodiumMilligrams],
    ["vitaminCMilligrams", food.vitaminCMilligrams],
  ] as const;
  let anyNutrient = false;
  for (const [key, val] of nutrients) {
    if (val != null && Number.isFinite(val)) {
      out[key] = val;
      anyNutrient = true;
    }
  }
  if (anyNutrient) {
    out.nutrientsEstimated = food.nutrientsEstimated ?? false;
  }
  return out;
}

export function archiveMealToEntry(m: HealthMealSnapshot, _localDate?: string): MealEntryWithRevision {
  const at = m.atHm || undefined;
  const slot = normalizeMealSlot(m.slot);
  const unrecognizedSlot = typeof m.slot === "string" && slot === null ? m.slot : undefined;
  const foods: MealFoodEntry[] =
    m.recordShape === "foods"
      ? (m.foods ?? []).map((f) => ({
          text: f.text,
          kcal: Math.round(f.kcal),
          kcalEstimated: f.kcalEstimated,
          servingText: f.servingText ?? undefined,
          servingEstimated: f.servingEstimated,
          carbsGrams: f.carbsGrams,
          proteinGrams: f.proteinGrams,
          fatGrams: f.fatGrams,
          sugarGrams: f.sugarGrams,
          fiberGrams: f.fiberGrams,
          sodiumMilligrams: f.sodiumMilligrams,
          vitaminCMilligrams: f.vitaminCMilligrams,
          nutrientsEstimated: f.nutrientsEstimated,
        }))
      : legacyFoodsFromItems(m.items, m.kcal);
  const kcal =
    m.mealKcal != null
      ? Math.round(m.mealKcal)
      : m.kcal != null
        ? Math.round(m.kcal)
        : foods.reduce((s, f) => s + (f.kcal || 0), 0);
  return {
    id: m.id,
    title: m.title ?? undefined,
    at,
    slot,
    unrecognizedSlot,
    iconKey: m.iconKey ?? undefined,
    foods,
    items: foods.map((f) => f.text),
    text: m.text ?? "",
    kcal,
    source: m.source,
    revision: m.revision,
  };
}

function legacyFoodsFromItems(items: string[] | null | undefined, kcal: number | null | undefined): MealFoodEntry[] {
  const names = (items ?? []).map((text) => text.trim()).filter(Boolean);
  if (names.length === 0) return [];
  const foodKcal = kcal != null && Number.isFinite(kcal) ? Math.round(kcal) : Number.NaN;
  return [{ text: names.join("、"), kcal: foodKcal, kcalEstimated: false }];
}

export function mealEntryToCreateReq(date: string, entry: MealEntry) {
  // Legacy startedAt is required. A date anchor is never promoted to an exact
  // meal time: projections and hour grids must use the optional atHm only.
  const at = entry.at ?? "00:00";
  const startedAt = new Date(dateTimeToUnix(date, at) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = entry.title?.trim() || defaultMealTitle(date, entry.slot);
  return {
    title,
    startedAt,
    slot: slotToApi(entry.slot, entry.unrecognizedSlot),
    iconKey: entry.iconKey,
    text: entry.text.trim() || undefined,
    source: "manual",
    foods: entry.foods.map(foodToInput),
    atHm: entry.at,
  };
}

export function mealEntryToUpdateReq(date: string, entry: MealEntry) {
  // Keep the same date-only storage anchor when no explicit time was supplied.
  const at = entry.at ?? "00:00";
  const startedAt = new Date(dateTimeToUnix(date, at) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = entry.title?.trim() || defaultMealTitle(date, entry.slot);
  return {
    title,
    startedAt,
    slot: slotToApi(entry.slot, entry.unrecognizedSlot),
    iconKey: entry.iconKey,
    text: entry.text.trim() || undefined,
    foods: entry.foods.map(foodToInput),
    atHm: entry.at ?? null,
  };
}

export async function searchMealFoods(req: {
  text: string;
  localDateFrom?: string;
  localDateTo?: string;
  slot?: string;
}) {
  return invoke<{ meals: HealthMealSnapshot[] }>("health_search_meal_foods", { req });
}

export async function getMeal(id: string) {
  return invoke<{ meal: HealthMealSnapshot }>("health_get_meal", { req: { id } });
}

export type MealFoodDraftLike = {
  text?: string;
  kcal?: string | number | null;
  kcalMissing?: boolean;
  carbsGrams?: string | number | null;
  proteinGrams?: string | number | null;
  fatGrams?: string | number | null;
  sugarGrams?: string | number | null;
  fiberGrams?: string | number | null;
  sodiumMilligrams?: string | number | null;
  vitaminCMilligrams?: string | number | null;
};

export type NutrientTotal = {
  sum: number | null;
  incomplete: boolean;
};

export type MealNutritionTotals = {
  kcal: NutrientTotal;
  carbsGrams: NutrientTotal;
  proteinGrams: NutrientTotal;
  fatGrams: NutrientTotal;
  sugarGrams: NutrientTotal;
  fiberGrams: NutrientTotal;
  sodiumMilligrams: NutrientTotal;
  vitaminCMilligrams: NutrientTotal;
};

function draftNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const raw = v.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function activeFoods(foods: MealFoodDraftLike[]): MealFoodDraftLike[] {
  return foods.filter((f) => (f.text ?? "").trim().length > 0 || draftNum(f.kcal) != null);
}

function computeNutrient(
  foods: MealFoodDraftLike[],
  read: (f: MealFoodDraftLike) => number | null,
  emptySum: number | null,
): NutrientTotal {
  const rows = activeFoods(foods);
  if (rows.length === 0) return { sum: emptySum, incomplete: false };
  let sum = 0;
  let hasAny = false;
  let hasMissing = false;
  for (const row of rows) {
    const v = read(row);
    if (v == null) {
      hasMissing = true;
      continue;
    }
    sum += v;
    hasAny = true;
  }
  if (!hasAny) return { sum: null, incomplete: false };
  return { sum, incomplete: hasMissing };
}

export function computeMealNutritionTotals(foods: MealFoodDraftLike[]): MealNutritionTotals {
  return {
    kcal: computeNutrient(
      foods,
      (f) => (f.kcalMissing ? null : draftNum(f.kcal)),
      0,
    ),
    carbsGrams: computeNutrient(foods, (f) => draftNum(f.carbsGrams), null),
    proteinGrams: computeNutrient(foods, (f) => draftNum(f.proteinGrams), null),
    fatGrams: computeNutrient(foods, (f) => draftNum(f.fatGrams), null),
    sugarGrams: computeNutrient(foods, (f) => draftNum(f.sugarGrams), null),
    fiberGrams: computeNutrient(foods, (f) => draftNum(f.fiberGrams), null),
    sodiumMilligrams: computeNutrient(foods, (f) => draftNum(f.sodiumMilligrams), null),
    vitaminCMilligrams: computeNutrient(foods, (f) => draftNum(f.vitaminCMilligrams), null),
  };
}

export type MealFoodSearchHit = {
  mealId: string;
  mealTitle: string | null;
  mealStartedAt: string;
  food: HealthMealFoodSnapshot;
};

export function mealFoodSearchHits(meals: HealthMealSnapshot[], query: string): MealFoodSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: MealFoodSearchHit[] = [];
  for (const meal of meals) {
    if (meal.deletedAt) continue;
    const foods =
      meal.recordShape === "foods"
        ? meal.foods ?? []
        : (meal.items ?? [])
            .filter((t) => t.trim())
            .map((text, i) => ({
              id: `${meal.id}-legacy-${i}`,
              position: i,
              text,
              kcal: meal.kcal ?? meal.mealKcal ?? 0,
              kcalEstimated: false,
              servingText: null,
              servingEstimated: null,
              carbsGrams: null,
              proteinGrams: null,
              fatGrams: null,
              sugarGrams: null,
              fiberGrams: null,
              sodiumMilligrams: null,
              vitaminCMilligrams: null,
              nutrientsEstimated: null,
            }));
    for (const food of foods) {
      if (food.text.toLowerCase().includes(needle)) {
        out.push({
          mealId: meal.id,
          mealTitle: meal.title,
          mealStartedAt: meal.startedAt,
          food,
        });
      }
    }
  }
  return out;
}

export function mealFoodEntryFromSnapshot(f: HealthMealFoodSnapshot): MealFoodEntry {
  return {
    text: f.text,
    kcal: Math.round(f.kcal),
    kcalEstimated: f.kcalEstimated,
    servingText: f.servingText ?? undefined,
    servingEstimated: f.servingEstimated,
    carbsGrams: f.carbsGrams,
    proteinGrams: f.proteinGrams,
    fatGrams: f.fatGrams,
    sugarGrams: f.sugarGrams,
    fiberGrams: f.fiberGrams,
    sodiumMilligrams: f.sodiumMilligrams,
    vitaminCMilligrams: f.vitaminCMilligrams,
    nutrientsEstimated: f.nutrientsEstimated,
  };
}

export const MEAL_AI_SYSTEM = `你是餐食表单助手。根据用户指令改写当前餐食草稿，只输出一个 JSON 对象，不要 markdown，不要解释。

输出格式：
{"title":"","text":"","date":"YYYY-MM-DD","time":"HH:mm","slot":"breakfast|lunch|dinner|late_night|coffee|beverage|snack|other|null","iconKey":null,"foods":[{"text":"","kcal":0,"kcalEstimated":true,"servingText":null,"carbsGrams":null,"proteinGrams":null,"fatGrams":null,"sugarGrams":null,"fiberGrams":null,"sodiumMilligrams":null,"vitaminCMilligrams":null,"nutrientsEstimated":null}]}

规则：
- 直接改写并填入当前草稿。user 消息含当前表单 JSON。可以修改 title、text、date、time、slot、iconKey 以及每条食物字段；输出必须带上这些键，未要求更改的字段保持草稿原值，不要漏掉或改成 null。
- slot 可为 breakfast、lunch、dinner、late_night、coffee、beverage、snack、other 或 null，分别表示早餐、午餐、晚餐、夜宵、咖啡、饮料、零食、其他或未分类。未说明类型时保留当前 slot；用户明确要求取消分类时设为 null。不要把其他类别映射为 other。
- 每餐一个时间点，不要结束时间。未给时间则保留表单当前 date/time。
- 标题与整餐备注 text 分开。食物文字不写入备注，除非用户明确是整餐备注。
- 多种食物默认拆成多条。用户明确说总共多少千卡、不要拆开时，合成一条，文字合并，热量用这个总数，不要把总热量分摊到多条。
- 每条食物必须有文字和热量。用户没给热量就估算，kcalEstimated=true。用户明确给了数字则 kcalEstimated=false，不得改成别的数。
- 不知道热量时不要填 0。0 只在用户明确零热量（如水）时使用。无法估算则该条 kcal 用 null。
- 没给份量不要猜克数，servingText 保持 null。
- 默认可估算碳水、蛋白质、脂肪；没依据就 null，不要填 0。糖、纤维、钠、维生素 C 在用户给出或明确要求时必须写入对应字段，不要忽略。
- 用户要求按新份量重算时，覆盖该条热量和已填写的营养素，并标估算。
- 写入的热量和营养素必须是这一次实际吃下的总量。用户说的是每 100 克或每 100 毫升时，先按实际份量换算再写入，禁止把每 100g/ml 的数字直接填进字段。例如每 100 克 200 千卡、吃了 150 克，kcal 写 300，营养素同样按 1.5 倍换算。份量不足以换算时，不要用每百克/百毫升数值冒充总量。
- 不要调用任何工具，不要声称已保存。`;
