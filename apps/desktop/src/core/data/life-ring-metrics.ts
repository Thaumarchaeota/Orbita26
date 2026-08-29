export const LIFE_RING_METRICS = [
  "water",
  "steps",
  "totalCalories",
  "intensityMinutes",
  "exerciseDays",
] as const;

export type LifeRingMetricId = (typeof LIFE_RING_METRICS)[number];

export type LifeRingSlotConfig = {
  metric: LifeRingMetricId;
  goal: number;
};

export type LifeRingSlots = {
  ring2: LifeRingSlotConfig;
  ring3: LifeRingSlotConfig;
};

export const METRIC_LABELS: Record<LifeRingMetricId, string> = {
  water: "喝水",
  steps: "步数",
  totalCalories: "总消耗",
  intensityMinutes: "强度活动",
  exerciseDays: "运动天数",
};

export const DEFAULT_METRIC_GOALS: Record<LifeRingMetricId, number> = {
  water: 2000,
  steps: 10000,
  totalCalories: 2000,
  intensityMinutes: 150,
  exerciseDays: 5,
};

export function defaultLifeRingSlots(): LifeRingSlots {
  return {
    ring2: { metric: "water", goal: DEFAULT_METRIC_GOALS.water },
    ring3: { metric: "steps", goal: DEFAULT_METRIC_GOALS.steps },
  };
}

function isMetricId(v: string): v is LifeRingMetricId {
  return (LIFE_RING_METRICS as readonly string[]).includes(v);
}

export function normalizeLifeRingSlots(raw: Partial<LifeRingSlots> | undefined): LifeRingSlots {
  const base = defaultLifeRingSlots();
  if (!raw) return base;
  const normSlot = (slot: Partial<LifeRingSlotConfig> | undefined, fallback: LifeRingSlotConfig): LifeRingSlotConfig => {
    const metric = typeof slot?.metric === "string" && isMetricId(slot.metric) ? slot.metric : fallback.metric;
    const goalRaw = slot?.goal;
    const goal = typeof goalRaw === "number" && Number.isFinite(goalRaw) && goalRaw > 0
      ? Math.round(goalRaw)
      : DEFAULT_METRIC_GOALS[metric];
    return { metric, goal };
  };
  return {
    ring2: normSlot(raw.ring2, base.ring2),
    ring3: normSlot(raw.ring3, base.ring3),
  };
}

export type DailyMetricData = {
  hydrationMl?: number;
  steps?: number;
  totalCalories?: number;
  activeCalories?: number;
  intensityMinutes?: { moderate?: number; vigorous?: number };
};

export function effectiveIntensityMinutes(im?: { moderate?: number; vigorous?: number }): number {
  if (!im) return 0;
  return (im.moderate || 0) + (im.vigorous || 0) * 2;
}

export type RingMetricContext = {
  todayDaily?: DailyMetricData;
  weekDailies: DailyMetricData[];
  exerciseDayCount: number;
};

export function resolveRingMetric(metric: LifeRingMetricId, ctx: RingMetricContext): number {
  switch (metric) {
    case "water":
      return ctx.todayDaily?.hydrationMl && ctx.todayDaily.hydrationMl > 0 ? ctx.todayDaily.hydrationMl : 0;
    case "steps":
      return ctx.todayDaily?.steps && ctx.todayDaily.steps > 0 ? ctx.todayDaily.steps : 0;
    case "totalCalories":
      return ctx.todayDaily?.totalCalories && ctx.todayDaily.totalCalories > 0 ? ctx.todayDaily.totalCalories : 0;
    case "intensityMinutes":
      return ctx.weekDailies.reduce((sum, d) => sum + effectiveIntensityMinutes(d.intensityMinutes), 0);
    case "exerciseDays":
      return ctx.exerciseDayCount;
  }
}

export function formatRingValue(metric: LifeRingMetricId, value: number): string {
  if (value <= 0) return "--";
  if (metric === "steps" && value >= 10000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (metric === "totalCalories" || metric === "intensityMinutes") {
    return String(Math.round(value));
  }
  return String(Math.round(value));
}

export function formatRingTip(metric: LifeRingMetricId, value: number): string {
  const label = METRIC_LABELS[metric];
  if (value <= 0) return `${label}：--`;
  if (metric === "intensityMinutes") return `${label}（周）：${Math.round(value)}分钟`;
  if (metric === "exerciseDays") return `${label}（周）：${Math.round(value)}天`;
  if (metric === "water") return `${label}：${Math.round(value)}ml`;
  if (metric === "totalCalories") return `${label}：${Math.round(value)}kcal`;
  return `${label}：${formatRingValue(metric, value)}`;
}

export function weekStartBeijing(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, -8, 0, 0);
  const day = new Date(utc).getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(utc - diff * 86400000);
  return start.toISOString().slice(0, 10);
}

export function parseDailyData(data: unknown): DailyMetricData | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const im = d.intensityMinutes;
  let intensityMinutes: DailyMetricData["intensityMinutes"];
  if (im && typeof im === "object") {
    const o = im as Record<string, unknown>;
    intensityMinutes = {
      moderate: typeof o.moderate === "number" ? o.moderate : undefined,
      vigorous: typeof o.vigorous === "number" ? o.vigorous : undefined,
    };
  }
  return {
    hydrationMl: typeof d.hydrationMl === "number" ? d.hydrationMl : undefined,
    steps: typeof d.steps === "number" ? d.steps : undefined,
    totalCalories: typeof d.totalCalories === "number" ? d.totalCalories : undefined,
    activeCalories: typeof d.activeCalories === "number" ? d.activeCalories : undefined,
    intensityMinutes,
  };
}
