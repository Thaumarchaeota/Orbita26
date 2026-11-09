export type MealSlot = "breakfast" | "lunch" | "dinner" | "late_night" | "coffee" | "beverage" | "snack" | "other";
export type MealCategory = MealSlot | null;

export type MealFoodEntry = {
  text: string;
  kcal: number;
  kcalEstimated: boolean;
  servingText?: string;
  servingEstimated?: boolean | null;
  carbsGrams?: number | null;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  sugarGrams?: number | null;
  fiberGrams?: number | null;
  sodiumMilligrams?: number | null;
  vitaminCMilligrams?: number | null;
  nutrientsEstimated?: boolean | null;
};

export type MealEntry = {
  id: string;
  title?: string;
  at?: string;
  slot: MealCategory;
  unrecognizedSlot?: string;
  iconKey?: string;
  foods: MealFoodEntry[];
  items: string[];
  text: string;
  kcal: number;
  source?: string;
  confidence?: string;
  revision?: number;
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  late_night: "夜宵",
  coffee: "咖啡",
  beverage: "饮料",
  snack: "零食",
  other: "其他",
};

const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "late_night", "coffee", "beverage", "snack", "other"];
const SLOT_SET = new Set<string>(SLOT_ORDER);

export function normalizeMealSlot(raw: unknown): MealCategory {
  return typeof raw === "string" && SLOT_SET.has(raw) ? raw as MealSlot : null;
}

export function parseMeals(data: unknown): MealEntry[] {
  if (!data || typeof data !== "object") return [];
  const meals = (data as Record<string, unknown>).meals;
  if (!Array.isArray(meals)) return [];
  return meals.map((m): MealEntry | null => {
    if (!m || typeof m !== "object") return null;
    const o = m as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id) return null;
    const kcal = typeof o.kcal === "number" && Number.isFinite(o.kcal) ? Math.round(o.kcal) : 0;
    const items = Array.isArray(o.items) ? o.items.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    return {
      id, at: typeof o.at === "string" ? o.at : undefined, slot: normalizeMealSlot(o.slot),
      unrecognizedSlot: typeof o.slot === "string" && normalizeMealSlot(o.slot) === null ? o.slot : undefined,
      iconKey: typeof o.iconKey === "string" ? o.iconKey : undefined,
      foods: [], items, text: typeof o.text === "string" ? o.text : "", kcal,
      source: typeof o.source === "string" ? o.source : undefined,
      confidence: typeof o.confidence === "string" ? o.confidence : undefined,
    };
  }).filter((m): m is MealEntry => m !== null);
}

export function inferMealSlotFromTime(time?: string): MealSlot {
  if (!time) return inferMealSlotFromNow();
  const [hh] = time.split(":").map(Number);
  if (hh >= 5 && hh < 11) return "breakfast";
  if (hh >= 11 && hh < 15) return "lunch";
  if (hh >= 15 && hh < 17) return "snack";
  if (hh >= 17 && hh < 22) return "dinner";
  return "late_night";
}

export function inferMealSlotFromNow(): MealSlot {
  const hh = Number(new Date().toLocaleTimeString("sv-SE", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }));
  if (hh >= 5 && hh < 11) return "breakfast";
  if (hh >= 11 && hh < 15) return "lunch";
  if (hh >= 15 && hh < 17) return "snack";
  if (hh >= 17 && hh < 22) return "dinner";
  return "late_night";
}

export function sumMealsBySlot(meals: MealEntry[]): Record<MealSlot, number> {
  const out: Record<MealSlot, number> = { breakfast: 0, lunch: 0, dinner: 0, late_night: 0, coffee: 0, beverage: 0, snack: 0, other: 0 };
  for (const m of meals) if (m.slot) out[m.slot] += m.kcal || 0;
  return out;
}

export function totalMealKcal(meals: MealEntry[]): number {
  return meals.reduce((s, m) => s + (m.kcal || 0), 0);
}

export function newMealId(): string { return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
export function mealSlotLabel(slot: MealCategory): string { return slot ? MEAL_SLOT_LABELS[slot] : "未分类"; }
export function mealSortSlots(): MealSlot[] { return [...SLOT_ORDER]; }

export function mealEntryToArgs(entry: MealEntry, date: string): Record<string, unknown> {
  return { date, id: entry.id, slot: entry.slot ?? entry.unrecognizedSlot ?? null, iconKey: entry.iconKey, items: [...entry.items], text: entry.text, kcal: entry.kcal, at: entry.at ?? "" };
}

export function mealSlotRowHtml(selected: MealCategory): string {
  const options: Array<MealCategory> = [null, ...SLOT_ORDER];
  return `<div class="meal-slot-row" role="group" aria-label="餐次">
    ${options.map((s) => `<button type="button" class="meal-slot-btn${s === selected ? " is-active" : ""}" data-slot="${s ?? ""}">${mealSlotLabel(s)}</button>`).join("")}
    <input type="hidden" name="slot" value="${selected ?? ""}">
  </div>`;
}

export function bindMealSlotRow(root: HTMLElement): HTMLInputElement {
  const row = root.querySelector<HTMLElement>(".meal-slot-row")!;
  const hidden = row.querySelector<HTMLInputElement>('input[name="slot"]')!;
  row.querySelectorAll<HTMLButtonElement>(".meal-slot-btn").forEach((btn) => btn.addEventListener("click", () => {
    root.dataset.mealSlotEdited = "true";
    const slot = normalizeMealSlot(btn.dataset.slot);
    hidden.value = slot ?? "";
    row.querySelectorAll(".meal-slot-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  }));
  return hidden;
}
