export function isValidSample(metric: string, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  switch (metric) {
    case "stress":
      return v >= 0 && v <= 100;
    case "respiration":
      return v > 0 && v < 80;
    case "spo2":
      return v >= 50 && v <= 100;
    case "hr":
      return v > 20 && v < 250;
    case "hrv":
      return v > 0 && v < 300;
    case "body_battery":
      return v >= 0 && v <= 100;
    case "steps_cumulative":
      return v >= 0;
    default:
      return true;
  }
}

export function sanitizeValue(metric: string, v: number | null): number | null {
  if (v === null) return null;
  return isValidSample(metric, v) ? v : null;
}
