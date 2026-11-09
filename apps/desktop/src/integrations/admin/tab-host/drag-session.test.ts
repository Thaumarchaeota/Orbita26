import { describe, expect, it } from "vitest";
import { computeEdgeBandWidth, hitContentEdge } from "./drag-session";

describe("computeEdgeBandWidth", () => {
  it("clamps to min and max", () => {
    expect(computeEdgeBandWidth(100)).toBe(72);
    expect(computeEdgeBandWidth(500)).toBe(100);
    expect(computeEdgeBandWidth(2000)).toBe(180);
  });
});

describe("hitContentEdge", () => {
  const rect = { left: 100, top: 0, width: 1000, height: 600, right: 1100, bottom: 600, x: 100, y: 0, toJSON: () => "" };

  it("detects left and right bands without overlap", () => {
    expect(hitContentEdge(150, rect as DOMRect)).toEqual({ side: "left", pane: "left" });
    expect(hitContentEdge(1050, rect as DOMRect)).toEqual({ side: "right", pane: "right" });
    expect(hitContentEdge(500, rect as DOMRect)).toBeNull();
  });

  it("shrinks bands when content is narrow", () => {
    const narrow = { ...rect, width: 120, right: 220 };
    expect(hitContentEdge(110, narrow as DOMRect)?.side).toBe("left");
    expect(hitContentEdge(210, narrow as DOMRect)?.side).toBe("right");
    expect(hitContentEdge(160, narrow as DOMRect)).toBeNull();
  });
});
