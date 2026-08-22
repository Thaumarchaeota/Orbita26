import { describe, expect, it } from "vitest";
import {
  DATE_HEADER_HEIGHT,
  ROW_HEIGHT_ESTIMATE,
  VIRTUAL_BUFFER_ABOVE_MIN,
  VIRTUAL_BUFFER_BELOW_MIN,
} from "../constants";
import type { Entry } from "../types";
import { buildFlatList } from "../views/detail/list";
import {
  computeGroupWindow,
  computeScrollAnchorDelta,
  countBufferedCards,
  countCardsInGroupRange,
  findIndexAtOffset,
  prefixOffsets,
  shouldLoadOlderOnScroll,
  totalCardCount,
} from "./virtual-list";

function makeEntry(id: string, date: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date,
    flag: "*",
    payee: "",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
  };
}

describe("virtual list anchor and partial load guard", () => {
  it("findIndexAtOffset locates correct slice for 500+ row list", () => {
    const items = Array.from({ length: 520 }, (_, i) =>
      makeEntry(`e${i}`, `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`),
    );
    const flat = buildFlatList(items);
    const rowItems = flat.filter((f) => f.kind !== "date");
    expect(rowItems.length).toBe(520);

    const heights = flat.map((f) => (f.kind === "date" ? DATE_HEADER_HEIGHT : ROW_HEIGHT_ESTIMATE));
    const offsets = prefixOffsets(heights);
    const midScroll = offsets[Math.floor(flat.length / 2)]!;
    const idx = findIndexAtOffset(offsets, midScroll);
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(flat.length);
  });

  it("computeScrollAnchorDelta preserves anchor when row height changes", () => {
    const items = Array.from({ length: 520 }, (_, i) => makeEntry(`e${i}`, "2026-01-02"));
    const flat = buildFlatList(items);
    const heights = flat.map(() => ROW_HEIGHT_ESTIMATE);
    const anchorIdx = flat.findIndex((f) => f.kind === "entry");
    const changedIdx = Math.min(anchorIdx + 5, flat.length - 1);
    const offsetsBefore = prefixOffsets(heights);
    heights[changedIdx] = ROW_HEIGHT_ESTIMATE + 48;
    const offsetsAfter = prefixOffsets(heights);
    const delta = computeScrollAnchorDelta(offsetsBefore, offsetsAfter, anchorIdx);
    expect(delta).toBe(0);
    expect(computeScrollAnchorDelta(offsetsBefore, offsetsAfter, changedIdx + 1)).toBe(48);
  });

  it("shouldLoadOlderOnScroll guards partial background load", () => {
    expect(shouldLoadOlderOnScroll(40, "partial", false)).toBe(true);
    expect(shouldLoadOlderOnScroll(40, "loading", false)).toBe(true);
    expect(shouldLoadOlderOnScroll(40, "ready", false)).toBe(false);
    expect(shouldLoadOlderOnScroll(40, "partial", true)).toBe(false);
    expect(shouldLoadOlderOnScroll(120, "partial", false)).toBe(false);
  });

  it("computeGroupWindow mounts all cards when total is below buffer minimum", () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      items: Array.from({ length: 20 }, (_, j) => ({ id: `e${i}-${j}` })),
    }));
    const offsets = prefixOffsets(groups.map(() => 200));
    const window = computeGroupWindow(groups, offsets, 400, 240, "none");
    expect(window).toEqual({ start: 0, end: groups.length });
    expect(totalCardCount(groups)).toBeLessThan(VIRTUAL_BUFFER_ABOVE_MIN + VIRTUAL_BUFFER_BELOW_MIN);
  });

  it("computeGroupWindow expands by whole date groups with directional buffer", () => {
    const groups = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      items: Array.from({ length: 12 }, (_, j) => ({ id: `e${i}-${j}` })),
    }));
    const offsets = prefixOffsets(groups.map(() => 180));
    const scrollTop = offsets[20]!;
    const down = computeGroupWindow(groups, offsets, scrollTop, 240, "down");
    const up = computeGroupWindow(groups, offsets, scrollTop, 240, "up");
    expect(down.end - down.start).toBeGreaterThanOrEqual(up.end - up.start);
    const downCounts = countBufferedCards(groups, offsets, down, scrollTop, 240);
    const upCounts = countBufferedCards(groups, offsets, up, scrollTop, 240);
    expect(downCounts.below).toBeGreaterThanOrEqual(upCounts.below);
    expect(upCounts.above).toBeGreaterThanOrEqual(downCounts.above);
    expect(downCounts.above).toBeGreaterThanOrEqual(VIRTUAL_BUFFER_ABOVE_MIN);
    expect(downCounts.below).toBeGreaterThanOrEqual(VIRTUAL_BUFFER_BELOW_MIN);
    expect(countCardsInGroupRange(groups, down.start, down.end)).toBe(
      downCounts.mounted,
    );
  });
});
