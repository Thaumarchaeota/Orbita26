const ZONE_IN = 0.35;
const ZONE_OUT = 0.30;

export function tileEl(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement).closest<HTMLElement>(".launcher-tile");
}

export function tileAtPoint(x: number, y: number, grid: HTMLElement, skip?: HTMLElement | null): HTMLElement | null {
  const direct = tileEl(document.elementFromPoint(x, y));
  if (direct && grid.contains(direct) && direct !== skip) return direct;
  for (const tile of grid.querySelectorAll<HTMLElement>(".launcher-tile")) {
    if (tile === skip) continue;
    const r = tile.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return tile;
  }
  return null;
}

export function pointerInGrid(x: number, y: number, grid: HTMLElement): boolean {
  const r = grid.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function isAppendZone(x: number, y: number, grid: HTMLElement, skip?: HTMLElement | null): boolean {
  if (!pointerInGrid(x, y, grid)) return false;
  const tiles = Array.from(grid.querySelectorAll<HTMLElement>(".launcher-tile")).filter(
    (t) => t !== skip && !t.classList.contains("is-empty") && t.dataset.id,
  );
  if (!tiles.length) return true;
  const last = tiles[tiles.length - 1]!;
  const r = last.getBoundingClientRect();
  if (y >= r.top && y <= r.bottom && x > r.left + r.width * 0.5) return true;
  if (y > r.bottom) return true;
  return false;
}

export function outsidePanel(panel: HTMLElement, x: number, y: number): boolean {
  const r = panel.getBoundingClientRect();
  return x < r.left || x > r.right || y < r.top || y > r.bottom;
}

export function inAbsorbZone(tile: HTMLElement, x: number, y: number, latched: boolean): boolean {
  const r = tile.getBoundingClientRect();
  const lo = latched ? ZONE_OUT : ZONE_IN;
  const hi = latched ? 1 - ZONE_OUT : 1 - ZONE_IN;
  const relX = (x - r.left) / r.width;
  const relY = (y - r.top) / r.height;
  return relX > lo && relX < hi && relY > lo && relY < hi;
}
