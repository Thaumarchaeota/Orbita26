/** Project path-map geometry. Coordinates and dimensions are in world units unless named otherwise. */
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface Camera { x: number; y: number; zoom: number }
export interface Viewport { width: number; height: number }
export type AnchorSide = "top" | "right" | "bottom" | "left";
export interface SupportPoint extends Point { side: AnchorSide }
export interface CubicBezier { start: Point; control1: Point; control2: Point; end: Point }

export const TASK_CARD_SIZE = Object.freeze({ width: 240, height: 112 });
export const TASK_GRID_SIZE = 24;
const OPEN_POSITION_CANDIDATE_LIMIT = 1024;

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function finitePoint(point: Point, label: string): void { finite(point.x, `${label}.x`); finite(point.y, `${label}.y`); }
function validBounds(bounds: Bounds, label: string): void {
  finitePoint(bounds, label); finite(bounds.width, `${label}.width`); finite(bounds.height, `${label}.height`);
  if (bounds.width <= 0 || bounds.height <= 0) throw new RangeError(`${label} dimensions must be positive`);
  finite(bounds.x + bounds.width, `${label}.right`); finite(bounds.y + bounds.height, `${label}.bottom`);
}

export function worldToScreen(point: Point, camera: Camera): Point {
  finitePoint(point, "point"); finite(camera.x, "camera.x"); finite(camera.y, "camera.y");
  finite(camera.zoom, "camera.zoom");
  if (camera.zoom <= 0) throw new RangeError("camera.zoom must be positive");
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

export function screenToWorld(point: Point, camera: Camera): Point {
  finitePoint(point, "point"); finite(camera.x, "camera.x"); finite(camera.y, "camera.y");
  finite(camera.zoom, "camera.zoom");
  if (camera.zoom <= 0) throw new RangeError("camera.zoom must be positive");
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

/** Changes zoom while keeping the world point under the screen anchor fixed. */
export function zoomAt(camera: Camera, screenAnchor: Point, nextZoom: number): Camera {
  finite(nextZoom, "nextZoom");
  if (nextZoom <= 0) throw new RangeError("nextZoom must be positive");
  const anchoredWorld = screenToWorld(screenAnchor, camera);
  return {
    x: screenAnchor.x - anchoredWorld.x * nextZoom,
    y: screenAnchor.y - anchoredWorld.y * nextZoom,
    zoom: nextZoom,
  };
}

/** Snap to the nearest 24-world-unit grid; pass false for modifier-key free placement. */
export function snapPoint(point: Point, enabled = true, gridSize = TASK_GRID_SIZE): Point {
  finite(point.x, "point.x"); finite(point.y, "point.y");
  finite(gridSize, "gridSize");
  if (gridSize <= 0) throw new RangeError("gridSize must be positive");
  if (!enabled) return { ...point };
  return { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
}

/** Initial relation layout hint; sequence direction remains independent of later card movement. */
export function preferredPositionForSequence(
  anchor: Bounds,
  relation: "before" | "after",
  cardSize: Readonly<{ width: number; height: number }> = TASK_CARD_SIZE,
  gap = TASK_GRID_SIZE,
): Point {
  validBounds(anchor, "anchor");
  finite(cardSize.width, "cardSize.width"); finite(cardSize.height, "cardSize.height"); finite(gap, "gap");
  if (cardSize.width <= 0 || cardSize.height <= 0 || gap < 0) throw new RangeError("invalid placement dimensions");
  return {
    x: relation === "before" ? anchor.x - cardSize.width - gap : anchor.x + anchor.width + gap,
    y: anchor.y + (anchor.height - cardSize.height) / 2,
  };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Deterministic square-ring search. Existing nodes are read-only; intentional user overlap remains valid. */
export function findOpenCardPosition(
  preferred: Point,
  occupied: readonly Bounds[],
  cardSize: Readonly<{ width: number; height: number }> = TASK_CARD_SIZE,
  gridSize = TASK_GRID_SIZE,
): Point {
  finite(preferred.x, "preferred.x"); finite(preferred.y, "preferred.y");
  finite(cardSize.width, "cardSize.width"); finite(cardSize.height, "cardSize.height"); finite(gridSize, "gridSize");
  if (cardSize.width <= 0 || cardSize.height <= 0 || gridSize <= 0) throw new RangeError("dimensions must be positive");
  const origin = snapPoint(preferred, true, gridSize);
  occupied.forEach((item, index) => validBounds(item, `occupied[${index}]`));
  const candidate = (gx: number, gy: number): Bounds => ({ x: origin.x + gx * gridSize, y: origin.y + gy * gridSize, ...cardSize });
  const isOpen = (bounds: Bounds): boolean => {
    validBounds(bounds, "candidate");
    return !occupied.some((item) => overlaps(bounds, item));
  };
  if (isOpen(candidate(0, 0))) return origin;
  let checked = 1;
  const tryCandidate = (gx: number, gy: number): Point | undefined => {
    if (checked >= OPEN_POSITION_CANDIDATE_LIMIT) return undefined;
    checked += 1;
    const bounds = candidate(gx, gy);
    return isOpen(bounds) ? { x: bounds.x, y: bounds.y } : undefined;
  };
  // Clockwise perimeter from the top-left of each ring; ordering is fixed for reproducible placement.
  for (let radius = 1; checked < OPEN_POSITION_CANDIDATE_LIMIT; radius += 1) {
    for (let x = -radius; x <= radius && checked < OPEN_POSITION_CANDIDATE_LIMIT; x += 1) {
      const point = tryCandidate(x, -radius); if (point) return point;
    }
    for (let y = -radius + 1; y <= radius && checked < OPEN_POSITION_CANDIDATE_LIMIT; y += 1) {
      const point = tryCandidate(radius, y); if (point) return point;
    }
    for (let x = radius - 1; x >= -radius && checked < OPEN_POSITION_CANDIDATE_LIMIT; x -= 1) {
      const point = tryCandidate(x, radius); if (point) return point;
    }
    for (let y = radius - 1; y > -radius && checked < OPEN_POSITION_CANDIDATE_LIMIT; y -= 1) {
      const point = tryCandidate(-radius, y); if (point) return point;
    }
  }
  // Expand only through obstacles that block the local escape candidates. Disconnected distant
  // cards cannot pull placement away from this target; each round adds at least one card.
  const cluster = new Set<number>();
  const originBounds = candidate(0, 0);
  occupied.forEach((item, index) => { if (overlaps(originBounds, item)) cluster.add(index); });
  while (cluster.size > 0) {
    let left = Number.POSITIVE_INFINITY; let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY; let bottom = Number.NEGATIVE_INFINITY;
    for (const index of cluster) {
      const item = occupied[index]!;
      left = Math.min(left, item.x); top = Math.min(top, item.y);
      right = Math.max(right, item.x + item.width); bottom = Math.max(bottom, item.y + item.height);
    }
    const candidates: Bounds[] = [
      { x: Math.floor((left - cardSize.width) / gridSize) * gridSize, y: origin.y, ...cardSize },
      { x: Math.ceil(right / gridSize) * gridSize, y: origin.y, ...cardSize },
      { x: origin.x, y: Math.floor((top - cardSize.height) / gridSize) * gridSize, ...cardSize },
      { x: origin.x, y: Math.ceil(bottom / gridSize) * gridSize, ...cardSize },
    ];
    const free: Bounds[] = [];
    const newlyBlocking = new Set<number>();
    for (const option of candidates) {
      validBounds(option, "fallback candidate");
      let blocked = false;
      occupied.forEach((item, index) => {
        if (overlaps(option, item)) { blocked = true; newlyBlocking.add(index); }
      });
      if (!blocked) free.push(option);
    }
    if (free.length > 0) {
      const distance = (point: Point): number => {
        const value = Math.hypot(point.x - origin.x, point.y - origin.y);
        finite(value, "fallback distance");
        return value;
      };
      free.sort((a, b) => distance(a) - distance(b));
      return { x: free[0]!.x, y: free[0]!.y };
    }
    let expanded = false;
    for (const index of newlyBlocking) if (!cluster.has(index)) { cluster.add(index); expanded = true; }
    if (!expanded) break;
  }
  throw new RangeError("Could not calculate a local non-overlapping fallback position");
}

function center(bounds: Bounds): Point { return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }; }

/** Pick facing sides by center displacement; ties (including coincident centers) choose horizontal. */
export function chooseSupportSides(source: Bounds, target: Bounds): Readonly<{ source: AnchorSide; target: AnchorSide }> {
  validBounds(source, "source"); validBounds(target, "target");
  const a = center(source); const b = center(target);
  const dx = b.x - a.x; const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
}

export function getSupportPoint(bounds: Bounds, side: AnchorSide): SupportPoint {
  validBounds(bounds, "bounds");
  switch (side) {
    case "top": return { x: bounds.x + bounds.width / 2, y: bounds.y, side };
    case "right": return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2, side };
    case "bottom": return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height, side };
    case "left": return { x: bounds.x, y: bounds.y + bounds.height / 2, side };
  }
}

/** Creates a direction-preserving cubic curve; it does not route around other cards. */
export function createDefaultBezier(source: Bounds, target: Bounds): CubicBezier {
  const sides = chooseSupportSides(source, target);
  const start = getSupportPoint(source, sides.source); const end = getSupportPoint(target, sides.target);
  const span = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const handle = Math.max(36, span * 0.45);
  const vector: Record<AnchorSide, Point> = {
    right: { x: handle, y: 0 }, left: { x: -handle, y: 0 },
    bottom: { x: 0, y: handle }, top: { x: 0, y: -handle },
  };
  const out = vector[sides.source]; const incoming = vector[sides.target];
  return {
    start: { x: start.x, y: start.y },
    control1: { x: start.x + out.x, y: start.y + out.y },
    control2: { x: end.x + incoming.x, y: end.y + incoming.y },
    end: { x: end.x, y: end.y },
  };
}

/**
 * Fits every card by default. Explicit minZoom/maxZoom bounds may prevent every card from fitting.
 */
export function fitAll(
  cards: readonly Bounds[], viewport: Viewport,
  options: Readonly<{ padding?: number; minZoom?: number; maxZoom?: number }> = {},
): Camera {
  finite(viewport.width, "viewport.width"); finite(viewport.height, "viewport.height");
  if (viewport.width <= 0 || viewport.height <= 0) throw new RangeError("viewport dimensions must be positive");
  const padding = options.padding ?? 48; const minZoom = options.minZoom; const maxZoom = options.maxZoom;
  finite(padding, "padding"); if (minZoom !== undefined) finite(minZoom, "minZoom"); if (maxZoom !== undefined) finite(maxZoom, "maxZoom");
  if (padding < 0 || (minZoom !== undefined && minZoom <= 0) || (maxZoom !== undefined && maxZoom <= 0) || (minZoom !== undefined && maxZoom !== undefined && maxZoom < minZoom)) throw new RangeError("invalid fit options");
  cards.forEach((card, index) => validBounds(card, `cards[${index}]`));
  const usableWidth = viewport.width - 2 * padding; const usableHeight = viewport.height - 2 * padding;
  if (usableWidth <= 0 || usableHeight <= 0) throw new RangeError("padding leaves no usable viewport");
  if (cards.length === 0) return { x: viewport.width / 2, y: viewport.height / 2, zoom: Math.min(maxZoom ?? 1, Math.max(minZoom ?? 0, 1)) };
  const left = Math.min(...cards.map((card) => card.x)); const top = Math.min(...cards.map((card) => card.y));
  const right = Math.max(...cards.map((card) => card.x + card.width)); const bottom = Math.max(...cards.map((card) => card.y + card.height));
  const spanX = Math.max(right - left, 1); const spanY = Math.max(bottom - top, 1);
  const requiredZoom = Math.min(usableWidth / spanX, usableHeight / spanY);
  if (!Number.isFinite(requiredZoom) || requiredZoom <= 0) throw new RangeError("card bounds cannot be fit at a finite positive zoom");
  const zoom = Math.min(maxZoom ?? Number.POSITIVE_INFINITY, Math.max(minZoom ?? 0, requiredZoom));
  return { zoom, x: viewport.width / 2 - ((left + right) / 2) * zoom, y: viewport.height / 2 - ((top + bottom) / 2) * zoom };
}
