export type HealthTrackAxisMode = "fixed" | "dynamic";

export type HealthTrackAxisMetricKey =
  | "hr"
  | "respiration"
  | "steps_cumulative"
  | "stress"
  | "body_battery";

export type MetricAxisRange = { min: number; max: number };

export type HealthTrackAxisRanges = Record<HealthTrackAxisMetricKey, MetricAxisRange>;

export type HealthTrackAxisPrefs = {
  mode: HealthTrackAxisMode;
  ranges: HealthTrackAxisRanges;
};

export const HEALTH_TRACK_AXIS_METRICS: {
  key: HealthTrackAxisMetricKey;
  label: string;
}[] = [
  { key: "hr", label: "心率" },
  { key: "respiration", label: "呼吸" },
  { key: "steps_cumulative", label: "步数" },
  { key: "stress", label: "Stress" },
  { key: "body_battery", label: "身体电量" },
];

export const DEFAULT_HEALTH_TRACK_AXIS_RANGES: HealthTrackAxisRanges = {
  hr: { min: 40, max: 210 },
  respiration: { min: 8, max: 30 },
  steps_cumulative: { min: 0, max: 20000 },
  stress: { min: 0, max: 100 },
  body_battery: { min: 0, max: 100 },
};

export function defaultHealthTrackAxisPrefs(): HealthTrackAxisPrefs {
  return {
    mode: "fixed",
    ranges: {
      hr: { ...DEFAULT_HEALTH_TRACK_AXIS_RANGES.hr },
      respiration: { ...DEFAULT_HEALTH_TRACK_AXIS_RANGES.respiration },
      steps_cumulative: { ...DEFAULT_HEALTH_TRACK_AXIS_RANGES.steps_cumulative },
      stress: { ...DEFAULT_HEALTH_TRACK_AXIS_RANGES.stress },
      body_battery: { ...DEFAULT_HEALTH_TRACK_AXIS_RANGES.body_battery },
    },
  };
}

function clampRange(min: unknown, max: unknown, fallback: MetricAxisRange): MetricAxisRange {
  let lo = typeof min === "number" && Number.isFinite(min) ? min : fallback.min;
  let hi = typeof max === "number" && Number.isFinite(max) ? max : fallback.max;
  if (lo >= hi) return { ...fallback };
  return { min: lo, max: hi };
}

export function normalizeHealthTrackAxisPrefs(
  raw: Partial<HealthTrackAxisPrefs> | undefined,
): HealthTrackAxisPrefs {
  const base = defaultHealthTrackAxisPrefs();
  const mode = raw?.mode === "dynamic" ? "dynamic" : "fixed";
  const ranges = { ...base.ranges };
  const rawRanges = raw?.ranges;
  for (const { key } of HEALTH_TRACK_AXIS_METRICS) {
    const part = rawRanges?.[key];
    ranges[key] = clampRange(part?.min, part?.max, DEFAULT_HEALTH_TRACK_AXIS_RANGES[key]);
  }
  return { mode, ranges };
}

export function resolveMetricYRange(
  metric: HealthTrackAxisMetricKey,
  values: number[],
  prefs: HealthTrackAxisPrefs,
): MetricAxisRange {
  if (prefs.mode === "fixed") return prefs.ranges[metric];
  if (values.length === 0) return { ...DEFAULT_HEALTH_TRACK_AXIS_RANGES[metric] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

export function metricValueToY(
  v: number,
  range: MetricAxisRange,
  padTop: number,
  innerH: number,
): number {
  const span = range.max - range.min || 1;
  const clamped = Math.max(range.min, Math.min(range.max, v));
  return padTop + innerH - ((clamped - range.min) / span) * innerH;
}

export function isHealthTrackAxisMetric(metric: string): metric is HealthTrackAxisMetricKey {
  return metric in DEFAULT_HEALTH_TRACK_AXIS_RANGES;
}
