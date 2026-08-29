import type { DetailItem } from "../types";

export type DateGroup = {
  date: string;
  items: DetailItem[];
};

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDatePinLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${date} ${WEEKDAY_EN[d.getDay()]}`;
}

export function groupItemsByDate(items: readonly DetailItem[]): DateGroup[] {
  const map = new Map<string, DetailItem[]>();
  for (const item of items) {
    const bucket = map.get(item.date);
    if (bucket) bucket.push(item);
    else map.set(item.date, [item]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, groupItems]) => ({ date, items: groupItems }));
}
