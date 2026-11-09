import { isValidHhMm, normalizeHhMm } from "../../../../ui/time-picker";
import { dateTimeToUnix } from "../health/format";

export type PlanMode = "range" | "duration" | "none";

export type RangeParts = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

export type RangeField = keyof RangeParts;

export type RangeOk = { ok: true; startIso: string; endIso: string };
export type RangeFail = { ok: false; errors: Partial<Record<RangeField, string>>; message: string };
export type RangeResult = RangeOk | RangeFail;

export function utcToRfc3339(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

export function parseUtcInstant(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function validateActionRange(parts: RangeParts): RangeResult {
  const errors: Partial<Record<RangeField, string>> = {};
  const startDate = parts.startDate.trim();
  const startTime = normalizeHhMm(parts.startTime);
  const endDate = parts.endDate.trim();
  const endTime = normalizeHhMm(parts.endTime);
  if (!startDate) errors.startDate = "请填写开始日期";
  if (!isValidHhMm(startTime)) errors.startTime = "请填写有效开始时间";
  if (!endDate) errors.endDate = "请填写结束日期";
  if (!isValidHhMm(endTime)) errors.endTime = "请填写有效结束时间";
  if (Object.keys(errors).length) {
    return { ok: false, errors, message: "起止须填写完整且合法的日期与时间" };
  }
  const start = dateTimeToUnix(startDate, startTime);
  const end = dateTimeToUnix(endDate, endTime);
  if (!(end > start)) {
    return {
      ok: false,
      errors: { endDate: "结束须晚于开始", endTime: "结束须晚于开始" },
      message: "结束须晚于开始",
    };
  }
  return { ok: true, startIso: utcToRfc3339(start), endIso: utcToRfc3339(end) };
}
