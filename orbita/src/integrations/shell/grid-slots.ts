import { getSettings } from "../../core/settings";

export function topGridCapacity(): number {
  const g = getSettings().ui.topGrid;
  return g.cols * g.rows;
}

export function buildGridSlots<T extends { id: string; slot?: number }>(
  items: T[],
  capacity: number,
): (T | null)[] {
  const slots: (T | null)[] = Array.from({ length: capacity }, () => null);
  const overflow: T[] = [];
  const sorted = [...items].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  for (const item of sorted) {
    const s = item.slot;
    if (s !== undefined && s >= 0 && s < capacity && !slots[s]) {
      slots[s] = item;
    } else {
      overflow.push(item);
    }
  }
  let hole = 0;
  for (const item of overflow) {
    while (hole < capacity && slots[hole]) hole++;
    if (hole >= capacity) break;
    slots[hole] = { ...item, slot: hole };
    hole++;
  }
  return slots;
}

export function entriesFromSlots<T extends { id: string; slot?: number }>(slots: (T | null)[]): T[] {
  const out: T[] = [];
  slots.forEach((item, index) => {
    if (item) out.push({ ...item, slot: index });
  });
  return out;
}

export function normalizeGridEntries<T extends { id: string; slot?: number }>(items: T[], capacity: number): T[] {
  return entriesFromSlots(buildGridSlots(items, capacity));
}

export function migrateDenseSlots<T extends { id: string; slot?: number }>(items: T[]): T[] {
  if (items.some((e) => e.slot !== undefined)) return items;
  return items.map((e, i) => ({ ...e, slot: i }));
}

export function firstEmptySlot<T extends { id: string; slot?: number }>(
  items: T[],
  capacity: number,
): number | null {
  const slots = buildGridSlots(items, capacity);
  const i = slots.findIndex((s) => s === null);
  return i >= 0 ? i : null;
}

export function insertAtSlot<T extends { id: string; slot?: number }>(
  items: T[],
  entry: T,
  slot: number,
): T[] {
  return [...items, { ...entry, slot }];
}
