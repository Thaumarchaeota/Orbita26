export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type MealEntry = {
  id: string;
  at?: string;
  slot: MealSlot;
  items: string[];
  text: string;
  kcal: number;
  source?: string;
  confidence?: string;
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "其他",
};

const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export function normalizeMealSlot(raw: unknown): MealSlot {
  if (raw === "breakfast" || raw === "lunch" || raw === "dinner" || raw === "snack") return raw;
  return "snack";
}

export function parseMeals(data: unknown): MealEntry[] {
  if (!data || typeof data !== "object") return [];
  const meals = (data as Record<string, unknown>).meals;
  if (!Array.isArray(meals)) return [];
  return meals
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const o = m as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      if (!id) return null;
      const kcal = typeof o.kcal === "number" && Number.isFinite(o.kcal) ? Math.round(o.kcal) : 0;
      const items = Array.isArray(o.items)
        ? o.items.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];
      return {
        id,
        at: typeof o.at === "string" ? o.at : undefined,
        slot: normalizeMealSlot(o.slot),
        items,
        text: typeof o.text === "string" ? o.text : "",
        kcal,
        source: typeof o.source === "string" ? o.source : undefined,
        confidence: typeof o.confidence === "string" ? o.confidence : undefined,
      };
    })
    .filter((m): m is MealEntry => !!m);
}

export function inferMealSlotFromTime(time?: string): MealSlot {
  if (!time) return inferMealSlotFromNow();
  const [hh] = time.split(":").map(Number);
  if (hh >= 5 && hh < 11) return "breakfast";
  if (hh >= 11 && hh < 15) return "lunch";
  if (hh >= 17 && hh < 22) return "dinner";
  return "snack";
}

export function inferMealSlotFromNow(): MealSlot {
  const hh = Number(
    new Date().toLocaleTimeString("sv-SE", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }),
  );
  if (hh >= 5 && hh < 11) return "breakfast";
  if (hh >= 11 && hh < 15) return "lunch";
  if (hh >= 17 && hh < 22) return "dinner";
  return "snack";
}

export function sumMealsBySlot(meals: MealEntry[]): Record<MealSlot, number> {
  const out: Record<MealSlot, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  for (const m of meals) out[m.slot] += m.kcal || 0;
  return out;
}

export function totalMealKcal(meals: MealEntry[]): number {
  return meals.reduce((s, m) => s + (m.kcal || 0), 0);
}

export function newMealId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function mealSlotLabel(slot: MealSlot): string {
  return MEAL_SLOT_LABELS[slot];
}

export function mealSortSlots(): MealSlot[] {
  return [...SLOT_ORDER];
}
