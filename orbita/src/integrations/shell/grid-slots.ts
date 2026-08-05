import { getSettings } from "../../core/settings";

export function topGridCapacity(): number {
  const g = getSettings().ui.topGrid;
  return g.cols * g.rows;
}

export function normalizeDenseEntries<T extends { id: string; slot?: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  return sorted.map((item, i) => ({ ...item, slot: i }));
}
