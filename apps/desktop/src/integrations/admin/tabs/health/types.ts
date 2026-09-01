export type HealthOverviewRequest = {
  selectedDate: string;
  trackFromUtc: number;
  trackToUtc: number;
  trendDays: number;
};

export type TimeSample = { t: number; v: number | null; src?: string };

export type SleepStageKey = "deep" | "light" | "rem" | "awake";

export type SleepStageSegment = {
  startUtc: number;
  endUtc: number;
  stage: SleepStageKey;
};

export type SleepStageTotals = {
  deep: number;
  light: number;
  rem: number;
  awake: number;
};

export type SleepBlock = {
  id: string;
  startUtc: number;
  endUtc: number;
  isNap: boolean;
  score: number | null;
  source: string;
  segments?: SleepStageSegment[];
  stageTotals?: SleepStageTotals;
};

export type ActivityEvent = {
  id: string;
  startUtc: number;
  endUtc: number | null;
  activityType: string | null;
  name: string | null;
  distanceM: number | null;
  durationSec: number | null;
};

export type MealEvent = {
  id: string;
  occurredAtUtc: number;
  mealType: string | null;
  description: string | null;
  kcal: number | null;
};

export type TrackSeries = {
  metric: string;
  samples: TimeSample[];
};

export type HealthTrackData = {
  sleepBlocks: SleepBlock[];
  series: TrackSeries[];
  activities: ActivityEvent[];
  meals: MealEvent[];
};

export type TrendDayPoint = { date: string; value: number | null };

export type SleepStagePoint = {
  date: string;
  deep: number | null;
  light: number | null;
  rem: number | null;
  awake: number | null;
};

export type TrendSeries = {
  metric: string;
  label: string;
  unit: string;
  chartType: "line" | "bar" | "smooth_line" | "stack_sleep" | string;
  points: TrendDayPoint[];
  windowAvg: number | null;
  prevWindowAvg: number | null;
  stages?: SleepStagePoint[];
};

export type TrendPanel = {
  id: string;
  title: string;
  series: TrendSeries[];
};

export type EnergySummary = {
  mealCount: number;
  intakeKcal: number | null;
  burnKcal: number | null;
  deltaKcal: number | null;
  daysWithMeals: number;
  daysInWindow: number;
};

export type DaySummaryCard = {
  id: string;
  label: string;
  value: string | null;
  unit: string | null;
  everSeen: boolean;
};

export type HealthDaySummary = {
  date: string;
  cards: DaySummaryCard[];
  energy: EnergySummary;
};

export type LocalDateRange = { earliest: string; latest: string };

export type HealthOverviewResponse = {
  track: HealthTrackData;
  trends: TrendPanel[];
  daySummary: HealthDaySummary;
  localDateRange: LocalDateRange | null;
};

export type HealthSyncStatus = {
  lastSuccessAt: string | null;
  syncing: boolean;
  lastError: string | null;
  earliestLocalDate: string | null;
  latestLocalDate: string | null;
};

export type TrendWindow = 7 | 30 | 90 | 365;

export type LegendKey =
  | "sleep"
  | "nap"
  | "hr"
  | "hrv"
  | "spo2"
  | "respiration"
  | "stress"
  | "body_battery"
  | "steps"
  | "activity"
  | "meal";

export const LEGEND_ITEMS: { key: LegendKey; label: string; track: 1 | 2 | 3; defaultOn: boolean }[] = [
  { key: "spo2", label: "血氧", track: 1, defaultOn: true },
  { key: "hr", label: "心率", track: 1, defaultOn: true },
  { key: "respiration", label: "呼吸", track: 1, defaultOn: false },
  { key: "sleep", label: "睡眠", track: 1, defaultOn: true },
  { key: "stress", label: "压力", track: 2, defaultOn: true },
  { key: "body_battery", label: "能量", track: 2, defaultOn: true },
  { key: "steps", label: "步数", track: 3, defaultOn: true },
  { key: "activity", label: "活动", track: 3, defaultOn: true },
  { key: "meal", label: "餐食", track: 3, defaultOn: true },
];

export const LEGEND_STORAGE_KEY = "orbita.health.legend";
