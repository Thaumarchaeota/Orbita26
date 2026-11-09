import type { TaskSequenceAnchor } from "../../../productivity/types";
import { chooseSupportSides, type AnchorSide, type Bounds, type CubicBezier, type Point } from "./geometry";

const SIDES: readonly AnchorSide[] = ["top", "right", "bottom", "left"];

export function anchorPoint(bounds: Bounds, anchor: TaskSequenceAnchor): Point {
  const { side, offset } = anchor;
  if (side === "top" || side === "bottom") return { x: bounds.x + bounds.width * offset, y: bounds.y + (side === "bottom" ? bounds.height : 0) };
  return { x: bounds.x + (side === "right" ? bounds.width : 0), y: bounds.y + bounds.height * offset };
}

/** Even segments near 24 world pixels, with a midpoint and clearance for the standard card corners. */
export function cardAnchors(bounds: Bounds): TaskSequenceAnchor[] {
  return SIDES.flatMap((side) => {
    const length = side === "top" || side === "bottom" ? bounds.width : bounds.height;
    const inset = Math.min(18, length / 4);
    const usable = length - 2 * inset;
    const segments = Math.max(2, Math.round(usable / 48) * 2);
    return Array.from({ length: segments + 1 }, (_, index) => ({ side, offset: (inset + usable * index / segments) / length }));
  });
}

export function snapCardAnchor(bounds: Bounds, point: Point, maxDistance: number): TaskSequenceAnchor | null {
  let result: TaskSequenceAnchor | null = null;
  let best = maxDistance;
  for (const anchor of cardAnchors(bounds)) {
    const candidate = anchorPoint(bounds, anchor);
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= best) { result = anchor; best = distance; }
  }
  return result;
}

export function edgeCurve(source: Bounds, target: Bounds, sourceAnchor?: TaskSequenceAnchor | null, targetAnchor?: TaskSequenceAnchor | null): CubicBezier {
  const automatic = chooseSupportSides(source, target);
  const from = sourceAnchor ?? { side: automatic.source, offset: .5 };
  const to = targetAnchor ?? { side: automatic.target, offset: .5 };
  const start = anchorPoint(source, from);
  const end = anchorPoint(target, to);
  return curveBetween(start, end, from.side, to.side);
}

/** A loose drag endpoint is a point, not a zero-sized card (which card geometry rejects). */
export function edgeCurveToPoint(source: Bounds, sourceAnchor: TaskSequenceAnchor, end: Point): CubicBezier {
  const start = anchorPoint(source, sourceAnchor);
  const dx = end.x - start.x, dy = end.y - start.y;
  const targetSide: AnchorSide = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "left" : "right") : (dy >= 0 ? "top" : "bottom");
  return curveBetween(start, end, sourceAnchor.side, targetSide);
}

function curveBetween(start: Point, end: Point, sourceSide: AnchorSide, targetSide: AnchorSide): CubicBezier {
  const length = Math.max(36, Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * .45);
  const direction: Record<AnchorSide, Point> = { top: { x: 0, y: -length }, right: { x: length, y: 0 }, bottom: { x: 0, y: length }, left: { x: -length, y: 0 } };
  return { start, end, control1: { x: start.x + direction[sourceSide].x, y: start.y + direction[sourceSide].y }, control2: { x: end.x + direction[targetSide].x, y: end.y + direction[targetSide].y } };
}
