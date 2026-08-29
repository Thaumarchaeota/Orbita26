import type { DetailItem } from "../types";

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child, seen);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreeze(child, seen);
    }
  }
  return value;
}

/** Plain-data clone; avoids structuredClone stack overflow on large ledgers. */
export function cloneFrozenDetailItems(items: readonly DetailItem[]): readonly DetailItem[] {
  const cloned = JSON.parse(JSON.stringify(items)) as DetailItem[];
  return deepFreeze(cloned) as readonly DetailItem[];
}
