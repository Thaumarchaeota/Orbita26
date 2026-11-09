import type { BusinessTimeZoneResponse } from "../../../../productivity/types";
import { dateAt, minuteAt, offsetAt } from "../arrangement-model";

/** Mapped Variflight keys that travel persist. Extra API keys stay in raw only. */

export type FlightDiffRow = {
  field: string;
  label: string;
  current: string;
  source: string;
};

export const FLIGHT_FIELD_LABELS: Record<string, string> = {
  serviceNumber: "航班号",
  operator: "航空公司",
  vehicleModel: "机型",
  aircraftRegistration: "飞机注册号",
  departureName: "出发机场",
  arrivalName: "到达机场",
  departureCode: "出发三字码",
  arrivalCode: "到达三字码",
  departureTerminal: "出发航站楼",
  arrivalTerminal: "到达航站楼",
  departureGate: "登机口",
  arrivalGate: "到达口",
  transportationType: "交通方式",
  plannedStartAt: "计划起飞",
  plannedEndAt: "计划降落",
  actualStart: "实际起飞",
  actualEnd: "实际降落",
  "start.location": "出发地点",
  "end.location": "到达地点",
  "start.actionLabel": "出发动作",
  "end.actionLabel": "到达动作",
};

export function normalizeIata(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

export function candidateIata(candidate: Record<string, unknown>, side: "dep" | "arr"): string | null {
  if (side === "dep") return normalizeIata(candidate.FlightDepcode ?? candidate.depCode);
  return normalizeIata(candidate.FlightArrcode ?? candidate.arrCode);
}

export function matchCandidatesByIata(
  candidates: Record<string, unknown>[],
  departureCode: string,
  arrivalCode: string,
): Record<string, unknown>[] {
  const dep = normalizeIata(departureCode);
  const arr = normalizeIata(arrivalCode);
  if (!dep || !arr) return [];
  return candidates.filter((candidate) => candidateIata(candidate, "dep") === dep && candidateIata(candidate, "arr") === arr);
}

export function sourceOffsetSeconds(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (Number.isFinite(raw) && raw >= -86400 && raw <= 86400) return raw;
  return 8 * 3600;
}

export function sourceFlightInstant(value: unknown, offsetSeconds: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const source = value.trim();
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] ? Number(match[6]) : 0;
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetSeconds * 1000;
    return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

function text(candidate: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function mappedSourceValues(candidate: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (field: string, value: string | null) => {
    if (value) out[field] = value;
  };
  put("serviceNumber", text(candidate, "FlightNo", "flightNo"));
  put("operator", text(candidate, "FlightCompany"));
  put("vehicleModel", text(candidate, "generic", "ftype"));
  put("aircraftRegistration", text(candidate, "AircraftNumber"));
  put("departureName", text(candidate, "FlightDepAirport"));
  put("arrivalName", text(candidate, "FlightArrAirport"));
  put("departureCode", normalizeIata(text(candidate, "FlightDepcode", "depCode")));
  put("arrivalCode", normalizeIata(text(candidate, "FlightArrcode", "arrCode")));
  put("departureTerminal", text(candidate, "FlightHTerminal"));
  put("arrivalTerminal", text(candidate, "FlightTerminal"));
  put("departureGate", text(candidate, "BoardGate"));
  put("arrivalGate", text(candidate, "ArrStandGate"));
  put("plannedStartAt", sourceFlightInstant(candidate.FlightDeptimePlanDate, sourceOffsetSeconds(candidate.org_timezone)));
  put("plannedEndAt", sourceFlightInstant(candidate.FlightArrtimePlanDate, sourceOffsetSeconds(candidate.dst_timezone)));
  put("actualStart", sourceFlightInstant(candidate.FlightDeptimeDate, sourceOffsetSeconds(candidate.org_timezone)));
  put("actualEnd", sourceFlightInstant(candidate.FlightArrtimeDate, sourceOffsetSeconds(candidate.dst_timezone)));
  put("start.location", text(candidate, "FlightDepAirport"));
  put("end.location", text(candidate, "FlightArrAirport"));
  put("start.actionLabel", "起飞");
  put("end.actionLabel", "降落");
  return out;
}

export function diffFlightValues(
  current: Record<string, string | null | undefined>,
  source: Record<string, string>,
): FlightDiffRow[] {
  const rows: FlightDiffRow[] = [];
  for (const [field, sourceValue] of Object.entries(source)) {
    const currentValue = current[field] ?? "";
    const timeField = /^(planned|actual)(Start|End)(?:At)?$/.test(field);
    const currentInstant = timeField ? Date.parse(currentValue) : Number.NaN;
    const sourceInstant = timeField ? Date.parse(sourceValue) : Number.NaN;
    if ((currentValue || "") === sourceValue
      || (Number.isFinite(currentInstant) && currentInstant === sourceInstant)) continue;
    rows.push({
      field,
      label: FLIGHT_FIELD_LABELS[field] ?? field,
      current: currentValue || "（空）",
      source: sourceValue,
    });
  }
  return rows;
}

export function formatFlightDiffValue(field: string, value: string, zone: BusinessTimeZoneResponse | null): string {
  if (!zone || !/^(planned|actual)(Start|End)(?:At)?$/.test(field)) return value;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return value;
  const local = new Date(instant + offsetAt(instant, zone) * 60_000);
  const minute = minuteAt(instant, zone);
  const hour = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutePart = String(minute % 60).padStart(2, "0");
  const seconds = local.getUTCSeconds();
  const milliseconds = local.getUTCMilliseconds();
  const secondPart = seconds || milliseconds
    ? `:${String(seconds).padStart(2, "0")}${milliseconds ? `.${String(milliseconds).padStart(3, "0").replace(/0+$/, "")}` : ""}`
    : "";
  return `${dateAt(instant, zone)} ${hour}:${minutePart}${secondPart}`;
}
