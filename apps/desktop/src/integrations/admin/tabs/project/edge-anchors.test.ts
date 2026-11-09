import { describe, expect, it } from "vitest";
import { anchorPoint, cardAnchors, edgeCurve, snapCardAnchor } from "./edge-anchors";

const card = { x: 10, y: 20, width: 240, height: 80 };

describe("Project edge anchors", () => {
  it("distributes more snaps on longer sides while retaining each midpoint and corner clearance", () => {
    const anchors = cardAnchors(card);
    expect(anchors.filter((anchor) => anchor.side === "top")).toHaveLength(9);
    expect(anchors.filter((anchor) => anchor.side === "left")).toHaveLength(3);
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const sideAnchors = anchors.filter((anchor) => anchor.side === side);
      expect(sideAnchors.some((anchor) => anchor.offset === .5)).toBe(true);
      expect(sideAnchors.every((anchor) => anchor.offset > 0 && anchor.offset < 1)).toBe(true);
    }
  });

  it("only accepts drops close to a snap and stores a relative position", () => {
    const snapped = snapCardAnchor(card, { x: 130, y: 18 }, 18);
    expect(snapped).toEqual({ side: "top", offset: .5 });
    expect(snapCardAnchor(card, { x: 1000, y: 1000 }, 18)).toBeNull();
    expect(anchorPoint({ ...card, x: 50, width: 480 }, snapped!)).toEqual({ x: 290, y: 20 });
  });

  it("keeps each explicit endpoint when the cards move and leaves unspecified endpoints automatic", () => {
    const target = { x: 400, y: 20, width: 240, height: 80 };
    const sourceAnchor = { side: "bottom", offset: .25 } as const;
    const targetAnchor = { side: "top", offset: .75 } as const;
    const curve = edgeCurve(card, target, sourceAnchor, targetAnchor);
    expect(curve.start).toEqual({ x: 70, y: 100 });
    expect(curve.end).toEqual({ x: 580, y: 20 });
    expect(curve.control1.y).toBeGreaterThan(curve.start.y);
    expect(curve.control2.y).toBeLessThan(curve.end.y);
    expect(edgeCurve(card, target).start).toEqual({ x: 250, y: 60 });
    expect(edgeCurve({ ...card, y: 80 }, target, sourceAnchor, targetAnchor).start).toEqual({ x: 70, y: 160 });
  });
});
