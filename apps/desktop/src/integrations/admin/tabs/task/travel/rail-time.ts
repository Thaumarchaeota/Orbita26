import type { BusinessTimeZoneResponse } from "../../../../productivity/types";
import { dateAt, minuteAt } from "../arrangement-model";

export function utcToLocalParts(atUtc: string, zone: BusinessTimeZoneResponse): { date: string; time: string } {
  const instant = Date.parse(atUtc);
  if (!Number.isFinite(instant)) return { date: "", time: "" };
  const minute = minuteAt(instant, zone);
  const date = dateAt(instant, zone);
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return { date, time: `${hh}:${mm}` };
}

export function formatGapDuration(fromUtc: string, toUtc: string): string {
  const delta = Date.parse(toUtc) - Date.parse(fromUtc);
  if (!Number.isFinite(delta) || delta < 0) return "";
  const totalMinutes = Math.round(delta / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (!mins) return `${hours} 小时`;
  return `${hours} 小时 ${mins} 分钟`;
}

export function formatPointLine(atUtc: string, location: string | null, actionLabel: string | null, zone: BusinessTimeZoneResponse): string {
  const { date, time } = utcToLocalParts(atUtc, zone);
  const when = time ? (date ? `${date.slice(5)} ${time}` : time) : "";
  const place = (location ?? "").trim();
  const action = (actionLabel ?? "").trim();
  const head = [when, place].filter(Boolean).join(" ");
  if (!head && !action) return "未填写";
  if (!action) return head;
  if (!head) return action;
  return `${head} · ${action}`;
}
