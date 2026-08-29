import type { LoadState } from "../state/ledger-store";
import {
  VIRTUAL_BUFFER_ABOVE_MAX,
  VIRTUAL_BUFFER_ABOVE_MIN,
  VIRTUAL_BUFFER_BELOW_MAX,
  VIRTUAL_BUFFER_BELOW_MIN,
} from "../constants";

export type ScrollDirection = "up" | "down" | "none";

export type DateGroupLike = {
  items: readonly unknown[];
};

export function prefixOffsets(heights: number[]): number[] {
  const offsets = [0];
  let sum = 0;
  for (const h of heights) {
    sum += h;
    offsets.push(sum);
  }
  return offsets;
}

export function findIndexAtOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function computeScrollAnchorDelta(
  offsetsBefore: number[],
  offsetsAfter: number[],
  anchorIndex: number,
): number {
  return offsetsAfter[anchorIndex]! - offsetsBefore[anchorIndex]!;
}

export function shouldLoadOlderOnScroll(
  scrollTop: number,
  loadState: LoadState,
  loadingOlder: boolean,
): boolean {
  return scrollTop < 80 && loadState !== "ready" && !loadingOlder;
}

export function totalCardCount(groups: readonly DateGroupLike[]): number {
  let count = 0;
  for (const group of groups) count += group.items.length;
  return count;
}

export function countCardsInGroupRange(
  groups: readonly DateGroupLike[],
  start: number,
  end: number,
): number {
  let count = 0;
  for (let i = start; i < end; i++) count += groups[i]!.items.length;
  return count;
}

/**
 * Expand a virtual window by whole date groups. See docs/specs/orbita-finance.md.
 */
export function computeGroupWindow(
  groups: readonly DateGroupLike[],
  offsets: number[],
  scrollTop: number,
  clientHeight: number,
  direction: ScrollDirection = "none",
): { start: number; end: number } {
  if (!groups.length) return { start: 0, end: 0 };

  const totalCards = totalCardCount(groups);
  if (totalCards <= VIRTUAL_BUFFER_ABOVE_MIN + VIRTUAL_BUFFER_BELOW_MIN) {
    return { start: 0, end: groups.length };
  }

  const aboveTarget = direction === "up" ? VIRTUAL_BUFFER_ABOVE_MAX : VIRTUAL_BUFFER_ABOVE_MIN;
  const belowTarget = direction === "down" ? VIRTUAL_BUFFER_BELOW_MAX : VIRTUAL_BUFFER_BELOW_MIN;
  const viewportBottom = scrollTop + clientHeight;

  const viewportTopGroup = findIndexAtOffset(offsets, scrollTop);
  const viewportBottomGroup = findIndexAtOffset(
    offsets,
    Math.max(scrollTop, viewportBottom - 1),
  );

  let start = viewportTopGroup;
  let cardsAbove = 0;
  while (start > 0 && cardsAbove < aboveTarget) {
    start -= 1;
    cardsAbove += groups[start]!.items.length;
  }

  let end = viewportBottomGroup + 1;
  while (end < groups.length && offsets[end]! < viewportBottom) end += 1;

  let cardsBelow = 0;
  while (end < groups.length && cardsBelow < belowTarget) {
    cardsBelow += groups[end]!.items.length;
    end += 1;
  }

  return { start, end: Math.min(groups.length, end) };
}

export function countBufferedCards(
  groups: readonly DateGroupLike[],
  offsets: number[],
  window: { start: number; end: number },
  scrollTop: number,
  clientHeight: number,
): { above: number; below: number; mounted: number } {
  const viewportTopGroup = findIndexAtOffset(offsets, scrollTop);
  const viewportBottomGroup = findIndexAtOffset(
    offsets,
    Math.max(scrollTop, scrollTop + clientHeight - 1),
  );
  const above = countCardsInGroupRange(groups, window.start, viewportTopGroup);
  const below = countCardsInGroupRange(groups, viewportBottomGroup + 1, window.end);
  const mounted = countCardsInGroupRange(groups, window.start, window.end);
  return { above, below, mounted };
}
