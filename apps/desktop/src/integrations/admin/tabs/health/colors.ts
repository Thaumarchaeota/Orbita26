import type { LegendKey } from "./types";

export const SLEEP_STAGE_COLORS: Record<"deep" | "light" | "rem" | "awake", string> = {
  deep: "#3949ab",
  light: "#64b5f6",
  rem: "#b388ff",
  awake: "#d8dce6",
};

export const SLEEP_CAPSULE_BG = "rgba(129, 140, 248, 0.038)";
export const NAP_CAPSULE_BG = "rgba(165, 180, 252, 0.048)";

export const SPO2_COLOR_STOPS = {
  low: "#e07070",
  orange: "#e8a050",
  yellow: "#e0c858",
  high: "#58b868",
} as const;

export const SPO2_LEGEND_STRIPE = `linear-gradient(to top, ${SPO2_COLOR_STOPS.low} 0%, ${SPO2_COLOR_STOPS.orange} 28%, ${SPO2_COLOR_STOPS.yellow} 55%, #90c878 78%, ${SPO2_COLOR_STOPS.high} 100%)`;

export function spo2ColorForValue(v: number): string {
  if (v >= 90) return SPO2_COLOR_STOPS.high;
  if (v >= 80) return SPO2_COLOR_STOPS.yellow;
  if (v >= 70) return SPO2_COLOR_STOPS.orange;
  return SPO2_COLOR_STOPS.low;
}

/** SpO2 tick length: 100 ≈ dot at top; 90 ≈ prior “full” tick height. */
export function spo2TickHeight(v: number): number {
  const x = Math.max(60, Math.min(100, v));
  if (x >= 90) return (14 - ((x - 90) / 10) * 12.5) * 0.9;
  return (22 - ((x - 60) / 30) * 8) * 0.9;
}

/** Track 2 pair: stress (warm) ↔ body battery / 能量 (hue complement). */
export const TRACK2_STRESS_COLOR = "#e89428";
export const TRACK2_ENERGY_COLOR = "#7eb8f0";

/** Body battery line: low = pale sky blue, high = medium blue (stays light vs stress). */
export function bodyBatteryColorForValue(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  const r = Math.round(214 + (90 - 214) * t);
  const g = Math.round(236 + (157 - 236) * t);
  const b = Math.round(252 + (232 - 252) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Stress bar fill: low = pale yellow, high = deep orange (whole bar). */
export function stressColorForValue(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  const r = Math.round(255 + (210 - 255) * t);
  const g = Math.round(248 + (95 - 248) * t);
  const b = Math.round(170 + (35 - 170) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export const RESPIRATION_LINE_COLOR = "#b2e8e2";

export const METRIC_COLORS: Record<LegendKey, string> = {
  sleep: "#6366f1",
  nap: "#a5b4fc",
  hr: "#ec5f5f",
  hrv: "#9b6bf0",
  spo2: SPO2_COLOR_STOPS.high,
  respiration: "#22b8a6",
  stress: TRACK2_STRESS_COLOR,
  body_battery: TRACK2_ENERGY_COLOR,
  steps: "#5a9de8",
  activity: "#3ecf6e",
  meal: "#f07838",
};

export const STEPS_INTERVAL_BAR_ALPHA = 0.62;

export const TREND_COLORS: Record<string, string> = {
  sleep: METRIC_COLORS.sleep,
  sleep_deep: "#3949ab",
  sleep_light: "#5ac8fa",
  sleep_rem: "#b388ff",
  hrv: METRIC_COLORS.hrv,
  spo2: METRIC_COLORS.spo2,
  weight: METRIC_COLORS.sleep,
  energy: METRIC_COLORS.activity,
  burn: METRIC_COLORS.stress,
  water: "#22b8d8",
  stress: METRIC_COLORS.stress,
};

export function resolveCssColor(color: string): string {
  if (!color.startsWith("var(")) return color;
  const varName = color.slice(4, -1).trim();
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || color;
}
