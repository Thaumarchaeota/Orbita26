import { describe, expect, it } from "vitest";
import {
  chooseSupportSides, createDefaultBezier, findOpenCardPosition, fitAll,
  getSupportPoint, preferredPositionForSequence, screenToWorld, snapPoint, TASK_CARD_SIZE, worldToScreen, zoomAt,
  type Bounds,
} from "./geometry";

describe("Project path-map geometry", () => {
  it("round-trips negative world coordinates through pan and zoom", () => {
    const camera = { x: 83, y: -27, zoom: 1.75 };
    const world = { x: -240, y: -112 };
    expect(screenToWorld(worldToScreen(world, camera), camera)).toEqual(world);
  });

  it("keeps the world point under the pointer fixed when zooming", () => {
    const camera = { x: 120, y: 45, zoom: 0.8 };
    const pointer = { x: 310, y: 190 };
    const before = screenToWorld(pointer, camera);
    const after = zoomAt(camera, pointer, 1.6);
    expect(worldToScreen(before, after)).toEqual(pointer);
  });

  it("snaps to the 24-unit grid and allows temporary free placement", () => {
    expect(snapPoint({ x: -37, y: 13 })).toEqual({ x: -48, y: 24 });
    expect(snapPoint({ x: -37, y: 13 }, false)).toEqual({ x: -37, y: 13 });
  });

  it("permits existing overlap and finds a deterministic initial vacancy without moving cards", () => {
    const existing: Bounds[] = [{ x: 0, y: 0, width: 240, height: 112 }, { x: 0, y: 0, width: 240, height: 112 }];
    const snapshot = structuredClone(existing);
    const first = findOpenCardPosition({ x: 0, y: 0 }, existing);
    expect(first).toEqual({ x: -120, y: -120 });
    expect(findOpenCardPosition({ x: 0, y: 0 }, existing)).toEqual(first);
    expect(existing).toEqual(snapshot);
    expect(findOpenCardPosition({ x: 0, y: 0 }, [])).toEqual({ x: 0, y: 0 });
  });

  it("uses a bounded-search fallback beyond a huge occupied rectangle", () => {
    const occupied: Bounds[] = [{ x: -1_000_000_000, y: -1_000_000_000, width: 2_000_000_000, height: 2_000_000_000 }];
    const snapshot = structuredClone(occupied);
    const point = findOpenCardPosition({ x: 0, y: 0 }, occupied);
    expect(point.x % 24).toBe(0);
    expect(point.y % 24).toBe(0);
    const card = { ...point, ...TASK_CARD_SIZE };
    expect(card.x >= occupied[0]!.x + occupied[0]!.width || card.x + card.width <= occupied[0]!.x || card.y >= occupied[0]!.y + occupied[0]!.height || card.y + card.height <= occupied[0]!.y).toBe(true);
    expect(occupied).toEqual(snapshot);
  });

  it("keeps fallback near a dense target when an unrelated distant card exists", () => {
    const dense: Bounds[] = [];
    for (let x = -384; x <= 336; x += 48) {
      for (let y = -384; y <= 336; y += 48) dense.push({ x, y, width: 240, height: 240 });
    }
    const withRemote = [...dense, { x: 1_000_000_000, y: 0, width: 240, height: 112 }];
    const before = structuredClone(withRemote);
    const localPlacement = findOpenCardPosition({ x: 0, y: 0 }, dense);
    const remotePlacement = findOpenCardPosition({ x: 0, y: 0 }, withRemote);
    expect(remotePlacement).toEqual(localPlacement);
    expect(Math.abs(remotePlacement.x)).toBeLessThan(2_000);
    expect(Math.abs(remotePlacement.y)).toBeLessThan(2_000);
    expect(withRemote).toEqual(before);
  });

  it("rejects bounds whose derived edge overflows to infinity", () => {
    expect(() => findOpenCardPosition({ x: 0, y: 0 }, [{ x: 1e308, y: 0, width: 1e308, height: 112 }])).toThrow(RangeError);
  });

  it("chooses facing sides deterministically, including same-center and vertical layouts", () => {
    const center: Bounds = { x: 0, y: 0, width: 240, height: 112 };
    expect(["top", "right", "bottom", "left"].map((side) => getSupportPoint(center, side as "top" | "right" | "bottom" | "left"))).toEqual([
      { x: 120, y: 0, side: "top" }, { x: 240, y: 56, side: "right" },
      { x: 120, y: 112, side: "bottom" }, { x: 0, y: 56, side: "left" },
    ]);
    expect(chooseSupportSides(center, { ...center, x: 300 })).toEqual({ source: "right", target: "left" });
    expect(chooseSupportSides(center, { ...center, x: -300 })).toEqual({ source: "left", target: "right" });
    expect(chooseSupportSides(center, { ...center, y: 200 })).toEqual({ source: "bottom", target: "top" });
    expect(chooseSupportSides(center, center)).toEqual({ source: "right", target: "left" });
  });

  it("keeps source-to-target direction when a subsequent node sits to the left", () => {
    const source: Bounds = { x: 300, y: 0, width: 240, height: 112 };
    const target: Bounds = { x: 0, y: 0, width: 240, height: 112 };
    const curve = createDefaultBezier(source, target);
    expect(curve.start).toEqual({ x: source.x, y: 56 });
    expect(curve.end).toEqual({ x: target.x + target.width, y: 56 });
    expect(curve.control1.x).toBeLessThan(curve.start.x);
    expect(curve.control2.x).toBeGreaterThan(curve.end.x);
  });

  it("places a new predecessor left and a new successor right of its anchor", () => {
    const anchor: Bounds = { x: 100, y: 40, width: 240, height: 112 };
    expect(preferredPositionForSequence(anchor, "before")).toEqual({ x: -164, y: 40 });
    expect(preferredPositionForSequence(anchor, "after")).toEqual({ x: 364, y: 40 });
  });

  it("fits all card bounds and centers an empty canvas", () => {
    expect(fitAll([], { width: 800, height: 600 })).toEqual({ x: 400, y: 300, zoom: 1 });
    const cards: Bounds[] = [{ x: -240, y: -112, width: 240, height: 112 }, { x: 240, y: 112, width: 240, height: 112 }];
    const camera = fitAll(cards, { width: 800, height: 600 });
    const topLeft = worldToScreen({ x: -240, y: -112 }, camera);
    const bottomRight = worldToScreen({ x: 480, y: 224 }, camera);
    expect(topLeft.x).toBeGreaterThanOrEqual(48);
    expect(topLeft.y).toBeGreaterThanOrEqual(48);
    expect(bottomRight.x).toBeLessThanOrEqual(752);
    expect(bottomRight.y).toBeLessThanOrEqual(552);
  });

  it("zooms out far enough to fit sparse cards spread across a large world", () => {
    const cards: Bounds[] = [{ x: 0, y: 0, width: 240, height: 112 }, { x: 12_000, y: 0, width: 240, height: 112 }];
    const camera = fitAll(cards, { width: 800, height: 600 });
    expect(camera.zoom).toBeLessThan(0.2);
    const first = worldToScreen({ x: cards[0]!.x, y: cards[0]!.y }, camera);
    const last = worldToScreen({ x: cards[1]!.x + cards[1]!.width, y: cards[1]!.y + cards[1]!.height }, camera);
    expect(first.x).toBeGreaterThanOrEqual(48);
    expect(last.x).toBeLessThanOrEqual(752);
  });

  it("documents bounded fit as an explicit lower zoom limit", () => {
    const cards: Bounds[] = [{ x: 0, y: 0, width: 240, height: 112 }, { x: 12_000, y: 0, width: 240, height: 112 }];
    expect(fitAll(cards, { width: 800, height: 600 }, { minZoom: 0.2 }).zoom).toBe(0.2);
  });
});
