import type { DetailFilterState, SetMatchMode, TypeFilterMode } from "./filter-apply";
import { defaultDetailFilter } from "./filter-apply";
import type { FilterableStripeKind } from "../surface/filter-kinds";
import { isFilterableStripeKind } from "../surface/filter-kinds";
import { shanghaiDateParts, shanghaiIsoDate, shanghaiIsoDateOffset } from "../../../core/shanghai-date";

export type RelativeDatePreset = "today" | "last7" | "thisMonth" | "thisYear" | "all";

export type FilterPresetDate =
  | { mode: "all" }
  | { mode: "relative"; preset: RelativeDatePreset }
  | { mode: "absolute"; from: string; to: string };

export type FilterPreset = {
  id: string;
  name: string;
  date: FilterPresetDate;
  typeMode: TypeFilterMode;
  types: string[];
  accounts: string[];
  accountMode: SetMatchMode;
  tags: string[];
  tagMode: SetMatchMode;
};

export type FilterPresetDiagnostic = {
  code: string;
  message: string;
  path: string;
  index?: number;
  preset_id?: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function validateAbsoluteDateRange(from: string, to: string): string | null {
  const start = from.trim();
  const end = to.trim();
  if (!start || !end) return "绝对日期不能为空";
  if (!isIsoDate(start)) return "date.from 必须是 YYYY-MM-DD 格式";
  if (!isIsoDate(end)) return "date.to 必须是 YYYY-MM-DD 格式";
  if (start > end) return "date.from 不能晚于 date.to";
  return null;
}

export function diagnoseFilterPreset(raw: unknown, index: number): FilterPresetDiagnostic[] {
  const path = `filter_presets[${index}]`;
  if (!raw || typeof raw !== "object") {
    return [{ code: "filter_preset_invalid", message: "预设必须是对象", path, index }];
  }
  const preset = raw as Record<string, unknown>;
  const diags: FilterPresetDiagnostic[] = [];
  const presetId = typeof preset.id === "string" && preset.id.trim() ? preset.id.trim() : undefined;
  if (typeof preset.id !== "string" || !preset.id.trim()) {
    diags.push({
      code: "filter_preset_invalid",
      message: "id 不能为空",
      path: `${path}.id`,
      index,
      preset_id: presetId,
    });
  }
  if (typeof preset.name !== "string" || !preset.name.trim()) {
    diags.push({
      code: "filter_preset_invalid",
      message: "name 不能为空",
      path: `${path}.name`,
      index,
      preset_id: presetId,
    });
  }
  const date = preset.date;
  if (!date || typeof date !== "object") {
    diags.push({
      code: "filter_preset_invalid",
      message: "date 必须是对象",
      path: `${path}.date`,
      index,
      preset_id: presetId,
    });
  } else {
    const dateObj = date as Record<string, unknown>;
    const mode = dateObj.mode;
    if (mode === "absolute") {
      const from = typeof dateObj.from === "string" ? dateObj.from : "";
      const to = typeof dateObj.to === "string" ? dateObj.to : "";
      const err = validateAbsoluteDateRange(from, to);
      if (err) {
        diags.push({
          code: "filter_preset_invalid",
          message: err,
          path: err.includes("from") ? `${path}.date.from` : `${path}.date`,
          index,
          preset_id: presetId,
        });
      }
    }
  }
  return diags;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function shanghaiTodayIso(now: Date): string {
  return shanghaiIsoDate(now);
}

export function resolveRelativeDatePreset(
  preset: RelativeDatePreset,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const today = shanghaiTodayIso(now);
  const { y, m } = shanghaiDateParts(now);
  switch (preset) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "last7":
      return { dateFrom: shanghaiIsoDateOffset(now, -6), dateTo: today };
    case "thisMonth":
      return { dateFrom: `${y}-${pad2(m + 1)}-01`, dateTo: today };
    case "thisYear":
      return { dateFrom: `${y}-01-01`, dateTo: today };
    case "all":
    default:
      return { dateFrom: "", dateTo: "" };
  }
}

export function resolvePresetDate(
  date: FilterPresetDate,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  if (date.mode === "all") return { dateFrom: "", dateTo: "" };
  if (date.mode === "relative") return resolveRelativeDatePreset(date.preset, now);
  return { dateFrom: date.from, dateTo: date.to };
}

const RELATIVE_DATE_PRESETS: RelativeDatePreset[] = [
  "today",
  "last7",
  "thisMonth",
  "thisYear",
];

export function inferDatePresetFromFilter(
  filter: DetailFilterState,
  now: Date = new Date(),
): FilterPresetDate {
  if (!filter.dateFrom && !filter.dateTo) return { mode: "all" };
  for (const preset of RELATIVE_DATE_PRESETS) {
    const resolved = resolveRelativeDatePreset(preset, now);
    if (resolved.dateFrom === filter.dateFrom && resolved.dateTo === filter.dateTo) {
      return { mode: "relative", preset };
    }
  }
  return {
    mode: "absolute",
    from: filter.dateFrom,
    to: filter.dateTo || filter.dateFrom,
  };
}

function inferPresetDate(filter: DetailFilterState): FilterPresetDate {
  return inferDatePresetFromFilter(filter);
}

export function serializeFilterState(
  filter: DetailFilterState,
  id: string,
  name: string,
  date?: FilterPresetDate,
): FilterPreset {
  return {
    id,
    name,
    date: date ?? inferPresetDate(filter),
    typeMode: filter.typeMode,
    types: [...filter.types],
    accounts: [...filter.accounts],
    accountMode: filter.accountMode,
    tags: [...filter.tags],
    tagMode: filter.tagMode,
  };
}

export function deserializePresetToFilterState(
  preset: FilterPreset,
  now: Date = new Date(),
): DetailFilterState {
  const defaults = defaultDetailFilter();
  const { dateFrom, dateTo } = resolvePresetDate(preset.date, now);
  const types = new Set<FilterableStripeKind>();
  for (const value of preset.types) {
    if (isFilterableStripeKind(value)) types.add(value);
  }
  return {
    dateFrom,
    dateTo,
    typeMode: preset.typeMode,
    types,
    accounts: new Set(preset.accounts),
    accountMode: preset.accountMode,
    tags: new Set(preset.tags),
    tagMode: preset.tagMode,
  };
}
