import type { DetailItem } from "../types";
import { itemContentKey, itemVisualKey, type RenderCardContext } from "./render-cards";

export type ItemChangeSet = {
  structural: boolean;
  append: boolean;
  visualOnly: Set<string>;
  contentChanged: Set<string>;
  removed: Set<string>;
};

export function diffItems(
  prev: readonly DetailItem[],
  next: readonly DetailItem[],
): ItemChangeSet {
  const prevById = new Map(prev.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const visualOnly = new Set<string>();
  const contentChanged = new Set<string>();
  const removed = new Set<string>();
  let structural = prev.length !== next.length;

  for (const [id, item] of prevById) {
    if (!nextById.has(id)) {
      removed.add(id);
      structural = true;
    }
  }

  for (const item of next) {
    const old = prevById.get(item.id);
    if (!old) {
      structural = true;
      continue;
    }
    if (old.date !== item.date) {
      structural = true;
      continue;
    }
    const prevContent = itemContentKey(old);
    const nextContent = itemContentKey(item);
    if (prevContent !== nextContent) {
      contentChanged.add(item.id);
      continue;
    }
    if (itemVisualKey(old, {}) !== itemVisualKey(item, {})) {
      visualOnly.add(item.id);
    }
  }

  if (!structural && prev.length === next.length) {
    for (let i = 0; i < prev.length; i++) {
      if (prev[i]!.id !== next[i]!.id) {
        structural = true;
        break;
      }
    }
  }

  const append =
    !structural &&
    removed.size === 0 &&
    contentChanged.size === 0 &&
    visualOnly.size === 0 &&
    next.length > prev.length;

  return { structural, append, visualOnly, contentChanged, removed };
}

export function collectVisualChangedIds(
  items: readonly DetailItem[],
  ctx: RenderCardContext,
  prevVisual: Map<string, string>,
): Set<string> {
  const changed = new Set<string>();
  for (const item of items) {
    const key = itemVisualKey(item, ctx);
    if (prevVisual.get(item.id) !== key) changed.add(item.id);
    prevVisual.set(item.id, key);
  }
  for (const id of prevVisual.keys()) {
    if (!items.some((item) => item.id === id)) prevVisual.delete(id);
  }
  return changed;
}

export function syncContentKeyCache(
  items: readonly DetailItem[],
  cache: Map<string, string>,
): void {
  const live = new Set<string>();
  for (const item of items) {
    live.add(item.id);
    cache.set(item.id, itemContentKey(item));
  }
  for (const id of cache.keys()) {
    if (!live.has(id)) cache.delete(id);
  }
}
