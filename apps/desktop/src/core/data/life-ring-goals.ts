export type LifeRingGoals = {
  goalIntake: number;
  goalExp: number;
  goalHydration: number;
};

export const DEFAULT_LIFE_RING_GOALS: LifeRingGoals = {
  goalIntake: 2000,
  goalExp: 2000,
  goalHydration: 2000,
};

export function normalizeLifeRingGoals(raw: Partial<LifeRingGoals> | undefined): LifeRingGoals {
  const base = DEFAULT_LIFE_RING_GOALS;
  const n = (v: unknown, fallback: number) => {
    const x = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
    return Math.max(1, x);
  };
  if (!raw) return { ...base };
  return {
    goalIntake: n(raw.goalIntake, base.goalIntake),
    goalExp: n(raw.goalExp, base.goalExp),
    goalHydration: n(raw.goalHydration, base.goalHydration),
  };
}

export function migrateLifeRingGoalsFromSlots(
  slots: { ring2?: { metric?: string; goal?: number }; ring3?: { metric?: string; goal?: number } } | undefined,
): LifeRingGoals {
  const base = { ...DEFAULT_LIFE_RING_GOALS };
  if (!slots) return base;
  const r2 = slots.ring2;
  const r3 = slots.ring3;
  if (r2?.metric === "water" && r2.goal) base.goalHydration = Math.max(1, Math.round(r2.goal));
  if (r2?.metric === "totalCalories" && r2.goal) base.goalExp = Math.max(1, Math.round(r2.goal));
  if (r3?.metric === "totalCalories" && r3.goal) base.goalExp = Math.max(1, Math.round(r3.goal));
  if (r3?.metric === "water" && r3.goal) base.goalHydration = Math.max(1, Math.round(r3.goal));
  return base;
}
