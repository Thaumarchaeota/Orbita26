import { describe, expect, it } from "vitest";
import { computeInsertIndex, reorderKeys, siblingTranslateX } from "./reorder";

describe("computeInsertIndex", () => {
  it("returns index before first center greater than x", () => {
    expect(computeInsertIndex([10, 30, 50], 5)).toBe(0);
    expect(computeInsertIndex([10, 30, 50], 10)).toBe(1);
    expect(computeInsertIndex([10, 30, 50], 29)).toBe(1);
    expect(computeInsertIndex([10, 30, 50], 30)).toBe(2);
    expect(computeInsertIndex([10, 30, 50], 100)).toBe(3);
  });

  it("handles empty centers", () => {
    expect(computeInsertIndex([], 12)).toBe(0);
  });
});

describe("reorderKeys", () => {
  it("moves a key to the insert index", () => {
    expect(reorderKeys(["a", "b", "c", "d"], 1, 0)).toEqual(["b", "a", "c", "d"]);
    expect(reorderKeys(["a", "b", "c", "d"], 1, 2)).toEqual(["a", "c", "b", "d"]);
    expect(reorderKeys(["a", "b", "c", "d"], 1, 3)).toEqual(["a", "c", "d", "b"]);
  });

  it("returns a copy when from index is invalid", () => {
    expect(reorderKeys(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
});

describe("siblingTranslateX", () => {
  it("shifts siblings when dragging right", () => {
    expect(siblingTranslateX(2, 1, 3, 40)).toBe(-40);
    expect(siblingTranslateX(0, 1, 3, 40)).toBe(0);
  });

  it("shifts siblings when dragging left", () => {
    expect(siblingTranslateX(1, 3, 1, 40)).toBe(40);
    expect(siblingTranslateX(3, 3, 1, 40)).toBe(0);
  });
});
