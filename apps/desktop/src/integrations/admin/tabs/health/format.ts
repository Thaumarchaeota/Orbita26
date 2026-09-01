const BJ = "Asia/Shanghai";

export function beijingToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: BJ });
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function dateTimeToUnix(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, hh - 8, mm, 0) / 1000);
}

export function unixToLocal(ts: number): { date: string; time: string } {
  const dt = new Date(ts * 1000 + 8 * 3600 * 1000);
  return {
    date: dt.toISOString().slice(0, 10),
    time: `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`,
  };
}

const TRACK_SPAN_SEC = 26 * 3600;
export const TRACK_DATA_PAD_DAYS = 4;
export const TRACK_VIEW_SPAN_SEC = TRACK_SPAN_SEC;

export function beijingNowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function dayEndUtc(date: string): number {
  return dateTimeToUnix(addDays(date, 1), "00:00");
}

export function trackBufferWindow(viewFromUtc: number, viewToUtc: number): { fromUtc: number; toUtc: number } {
  const pad = TRACK_DATA_PAD_DAYS * 86400;
  const fromUtc = viewFromUtc - pad;
  const toUtc = Math.min(viewToUtc + pad, beijingNowUnix());
  return { fromUtc, toUtc };
}

export function trackDataWindow(focusDate: string): { fromUtc: number; toUtc: number } {
  const center = dateTimeToUnix(focusDate, "12:00");
  return trackBufferWindow(center - TRACK_SPAN_SEC / 2, center + TRACK_SPAN_SEC / 2);
}

export function earliestTrackUtc(earliestDate: string | null): number {
  if (!earliestDate) return 0;
  return dateTimeToUnix(earliestDate, "00:00");
}

export function defaultTrackWindow(date: string): { fromUtc: number; toUtc: number } {
  const today = beijingToday();
  if (date === today) {
    const now = beijingNowUnix();
    return { fromUtc: now - TRACK_SPAN_SEC, toUtc: now };
  }
  const prev = addDays(date, -1);
  return {
    fromUtc: dateTimeToUnix(prev, "22:00"),
    toUtc: dayEndUtc(date),
  };
}

export function clampViewWindow(
  fromUtc: number,
  toUtc: number,
  minFromUtc: number,
  maxToUtc: number,
): { fromUtc: number; toUtc: number } {
  const span = toUtc - fromUtc;
  const maxTo = Math.min(maxToUtc, beijingNowUnix());
  let nextTo = Math.min(toUtc, maxTo);
  let nextFrom = nextTo - span;
  if (nextFrom < minFromUtc) {
    nextFrom = minFromUtc;
    nextTo = Math.min(minFromUtc + span, maxTo);
  }
  return { fromUtc: Math.floor(nextFrom), toUtc: Math.ceil(nextTo) };
}

export function centerDateOfWindow(fromUtc: number, toUtc: number): string {
  const mid = Math.floor((fromUtc + toUtc) / 2);
  return unixToLocal(mid).date;
}

export function formatMissing(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export function formatSyncTime(iso: string | null): string {
  if (!iso) return "尚未同步";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = d.toLocaleString("zh-CN", { timeZone: BJ, hour: "2-digit", hour12: false });
  const mm = d.toLocaleString("zh-CN", { timeZone: BJ, minute: "2-digit", hour12: false });
  return `已同步 ${hh}:${mm}`;
}

export function formatDelta(current: number | null, prev: number | null, unit: string): string {
  if (current === null || prev === null) return "";
  const d = current - prev;
  const sign = d > 0 ? "+" : "";
  const rounded = Math.abs(d) < 10 ? d.toFixed(1) : Math.round(d).toString();
  return `${sign}${rounded}${unit}`;
}

export function formatHourLabel(ts: number): string {
  const { date, time } = unixToLocal(ts);
  return `${date.slice(5)} ${time}`;
}
