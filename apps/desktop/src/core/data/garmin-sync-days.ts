export const DEFAULT_GARMIN_SYNC_DAYS = 7;
export const MAX_GARMIN_SYNC_DAYS = 365;

export function normalizeGarminSyncDays(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_GARMIN_SYNC_DAYS;
  return Math.max(1, Math.min(MAX_GARMIN_SYNC_DAYS, n));
}
