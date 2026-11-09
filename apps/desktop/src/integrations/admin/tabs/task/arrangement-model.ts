import type { ActionSnapshot, ItemSnapshot, ItemTypeSnapshot, ProjectSnapshot, SessionSnapshot } from "../../../productivity/types";

export type BusinessZone = { baseOffset: string; replacements: { startUtc: string; endUtc: string; offset: string }[] };
export type DayWindow = { date: string; start: number; end: number };
export type PlanFragment = {
  kind: "action" | "session";
  id: string;
  /** A temporary preview uses the eventual Action identity for stable packing. */
  sortId?: string;
  date: string;
  start: number;
  end: number;
  realStart: boolean;
  realEnd: boolean;
  sessionId: string | null;
};
export type Target = { kind: "item" | "task"; id: string; title: string; path: string; color: string; actionColor?: string; available: boolean; archived: boolean };

const DAY = 86_400_000;
const parseOffset = (value: string): number => {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("业务时区偏移无效");
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
};
const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const dateAt = (instant: number, zone: BusinessZone): string =>
  new Date(instant + offsetAt(instant, zone) * 60_000).toISOString().slice(0, 10);
export const minuteAt = (instant: number, zone: BusinessZone): number => {
  const local = new Date(instant + offsetAt(instant, zone) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};
export function offsetAt(instant: number, zone: BusinessZone): number {
  const replacement = zone.replacements.find((r) => Date.parse(r.startUtc) <= instant && instant < Date.parse(r.endUtc));
  return parseOffset(replacement?.offset ?? zone.baseOffset);
}
export function crossesRepeatedWallTime(start: number, end: number, zone: BusinessZone): boolean {
  const boundaries = zone.replacements.flatMap((replacement) => [Date.parse(replacement.startUtc), Date.parse(replacement.endUtc)]);
  return boundaries.some((instant) => Number.isFinite(instant) && start < instant && instant < end
    && offsetAt(instant, zone) < offsetAt(instant - 1, zone));
}

// ADR 0020: resolve each wall time against the replacement timeline, never the browser zone.
export function instantForWall(date: string, minute: number, zone: BusinessZone): number {
  const wall = dayNumber(date) + minute * 60_000;
  const offsets = new Set([zone.baseOffset, ...zone.replacements.map((r) => r.offset)].map(parseOffset));
  const matches = [...offsets].map((offset) => wall - offset * 60_000)
    .filter((instant) => offsetAt(instant, zone) * 60_000 + instant === wall);
  if (matches.length !== 1) throw new Error("该业务时间在时区调整处不存在或不唯一");
  return matches[0];
}
export const addDays = (date: string, count: number): string => new Date(dayNumber(date) + count * DAY).toISOString().slice(0, 10);
export function mondayOf(date: string): string {
  const weekday = new Date(dayNumber(date)).getUTCDay();
  return addDays(date, -(weekday + 6) % 7);
}
export function windows(firstDate: string, count: number, zone: BusinessZone): DayWindow[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(firstDate, index);
    return { date, start: instantForWall(date, 0, zone), end: instantForWall(addDays(date, 1), 0, zone) };
  });
}
export function actualIntervals(action: ActionSnapshot): { start: number; end: number }[] {
  if (!action.ended || (action.targetKind !== "item" && action.targetKind !== "task")) return [];
  return action.intervals.filter((interval) => !interval.deletedAtUtc && interval.endedAt).map((interval) => ({
    start: Date.parse(interval.startedAt), end: Date.parse(interval.endedAt!),
  })).filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a.start - b.start);
}

export function fragments(actions: ActionSnapshot[], sessions: SessionSnapshot[], days: DayWindow[]): PlanFragment[] {
  const out: PlanFragment[] = [];
  const push = (kind: PlanFragment["kind"], id: string, startAt: string, endAt: string, sessionId: string | null) => {
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    for (const day of days) {
      if (start >= day.end || end <= day.start) continue;
      out.push({ kind, id, date: day.date, start: Math.max(start, day.start), end: Math.min(end, day.end),
        realStart: start >= day.start, realEnd: end <= day.end, sessionId });
    }
  };
  for (const action of actions) {
    if (action.deletedAtUtc) continue;
    const intervals = actualIntervals(action);
    if (intervals.length) {
      push("action", action.id, new Date(intervals[0].start).toISOString(),
        new Date(Math.max(...intervals.map((interval) => interval.end))).toISOString(), action.sessionId ?? null);
    } else if (action.plannedStartAt && action.plannedEndAt) {
      push("action", action.id, action.plannedStartAt, action.plannedEndAt, action.sessionId ?? null);
    }
  }
  for (const session of sessions) if (!session.deletedAtUtc)
    push("session", session.id, session.plannedStartAt, session.plannedEndAt, null);
  return out;
}
export type LayoutFragment = PlanFragment & { left: number; width: number; column: number; columns: number; dense: boolean };
export function layoutDay(parts: PlanFragment[]): LayoutFragment[] {
  const actions = parts.filter((part) => part.kind === "action").sort((a, b) => a.start - b.start || a.end - b.end || (a.sortId ?? a.id).localeCompare(b.sortId ?? b.id));
  const result: LayoutFragment[] = [];
  let group: PlanFragment[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    if (!group.length) return;
    const categories = [...new Set(group.map((part) => part.sessionId ?? ""))].sort((a, b) => a === "" ? 1 : b === "" ? -1 : a.localeCompare(b));
    const placement: { part: PlanFragment; column: number }[] = [];
    let count = 0;
    for (const category of categories) {
      const columnEnds: number[] = [];
      for (const part of group.filter((value) => (value.sessionId ?? "") === category)) {
        let column = columnEnds.findIndex((end) => end <= part.start);
        if (column < 0) column = columnEnds.length;
        columnEnds[column] = part.end;
        placement.push({ part, column: count + column });
      }
      count += columnEnds.length;
    }
    const usable = count <= 2 ? 0.91 : 1;
    for (const { part, column } of placement) result.push({ ...part, column, columns: count, dense: count >= 3,
      left: column / count * usable, width: usable / count });
    group = [];
  };
  for (const part of actions) {
    if (part.start >= groupEnd) flush();
    group.push(part);
    groupEnd = Math.max(groupEnd, part.end);
  }
  flush();
  for (const part of parts.filter((value) => value.kind === "session")) {
    const members = result.filter((value) => value.sessionId === part.id && value.start < part.end && value.end > part.start);
    const left = members.length ? Math.min(...members.map((value) => value.left)) : 0;
    const width = members.length ? Math.max(...members.map((value) => value.left + value.width)) - left : 0.91;
    result.push({ ...part, left, width, column: 0, columns: 1, dense: false });
  }
  return result;
}
export function targets(items: ItemSnapshot[], projects: ProjectSnapshot[], itemTypes: ItemTypeSnapshot[]): Map<string, Target> {
  const out = new Map<string, Target>();
  const colors = new Map(itemTypes.map((type) => [type.id, type.effectiveColor]));
  const workColor = itemTypes.find((type) => type.name.trim().toLocaleLowerCase() === "work" && !type.effectiveInactive)?.effectiveColor ?? "#87909a";
  for (const item of items) {
    if (item.deletedAtUtc) continue;
    out.set(`item:${item.id}`, { kind: "item", id: item.id, title: item.title, path: item.title,
      color: item.itemTypeId ? colors.get(item.itemTypeId) ?? "#87909a" : "#87909a",
      available: item.status !== "完成" && item.status !== "取消", archived: false });
  }
  for (const project of projects) for (const task of project.tasks) {
    if (project.deletedAtUtc || task.deletedAtUtc) continue;
    const path = [task.title];
    const visited = new Set([task.id]);
    let blockedParent = false;
    let parentId = task.parentTaskId;
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = project.tasks.find((entry) => entry.id === parentId);
      if (!parent) break;
      if (parent.status === "完成" || parent.status === "取消" || parent.deletedAtUtc) blockedParent = true;
      path.unshift(parent.title);
      parentId = parent.parentTaskId;
    }
    out.set(`task:${task.id}`, { kind: "task", id: task.id, title: task.title,
      path: `${project.title} / ${path.join(" / ")}`, color: workColor, actionColor: task.itemTypeId ? colors.get(task.itemTypeId) ?? workColor : workColor,
      available: !blockedParent && project.status !== "完成" && project.status !== "取消" && task.status !== "完成" && task.status !== "取消", archived: false });
  }
  return out;
}
export function unscheduled(actions: ActionSnapshot[], index: Map<string, Target>): ActionSnapshot[] {
  return actions.filter((action) => !action.deletedAtUtc && !action.ended && !(action.plannedStartAt && action.plannedEndAt)
    && !!index.get(`${action.targetKind}:${action.targetId}`)?.available);
}
export function clampIntoSession(start: number, durationMs: number, session: SessionSnapshot): { start: number; end: number } {
  const min = Date.parse(session.plannedStartAt);
  const max = Date.parse(session.plannedEndAt);
  const length = Math.min(durationMs, max - min);
  const clamped = Math.max(min, Math.min(start, max - length));
  return { start: clamped, end: clamped + length };
}
export const snapFive = (instant: number): number => Math.round(instant / 300_000) * 300_000;
export function defaultSessionTitle(start: number, end: number, zone: BusinessZone): string {
  const periods = [
    { name: "午夜", start: 0, end: 300, wrap: false },
    { name: "晨间", start: 300, end: 600, wrap: false },
    { name: "上午", start: 420, end: 780, wrap: false },
    { name: "午间", start: 660, end: 840, wrap: false },
    { name: "下午", start: 780, end: 1200, wrap: false },
    { name: "晚间", start: 1140, end: 60, wrap: true },
  ];
  const startMinute = minuteAt(start, zone);
  const endMinute = minuteAt(end, zone);
  const chosen = periods.filter((period) => period.wrap ? startMinute >= period.start || startMinute < period.end
    : startMinute >= period.start && startMinute < period.end).sort((a, b) => {
    const age = (period: typeof a) => period.wrap && startMinute < period.start ? startMinute + 1440 - period.start : startMinute - period.start;
    return age(a) - age(b);
  })[0];
  const same = chosen && (chosen.wrap ? endMinute > chosen.start || endMinute <= chosen.end : endMinute > chosen.start && endMinute <= chosen.end);
  return `${dateAt(start, zone).slice(5)} ${same ? chosen.name : ""}工作时间`;
}
