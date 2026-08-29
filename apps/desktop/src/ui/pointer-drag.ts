export const DRAG_THRESHOLD = 4;

export function capturePositions(
  root: HTMLElement,
  selector: string,
  idAttr = "data-id",
): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    if (el.classList.contains("is-drag-source")) return;
    const id = el.getAttribute(idAttr);
    if (id) map.set(id, el.getBoundingClientRect());
  });
  return map;
}

export function flipElements(
  root: HTMLElement,
  before: Map<string, DOMRect>,
  selector: string,
  idAttr = "data-id",
  durationSec = 0.28,
  easing = "var(--spring)",
) {
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    if (el.classList.contains("is-drag-source")) return;
    const id = el.getAttribute(idAttr);
    if (!id) return;
    const prev = before.get(id);
    if (!prev) return;
    const next = el.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${durationSec}s ${easing}`;
      el.style.transform = "";
      const done = () => {
        el.style.transition = "";
        el.removeEventListener("transitionend", done);
      };
      el.addEventListener("transitionend", done);
    });
  });
}

function applyGhostBaseStyles(ghost: HTMLElement, rect: DOMRect, scale: number) {
  ghost.style.position = "fixed";
  ghost.style.left = "0";
  ghost.style.top = "0";
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.pointerEvents = "none";
  ghost.style.willChange = "transform";
  ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(${scale})`;
  ghost.style.transition = "none";
}

export function createPointerGhost(
  source: HTMLElement,
  className: string,
  extraClasses: string[] = [],
  scale = 1,
): { ghost: HTMLElement; offsetX: number; offsetY: number } {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add(className);
  extraClasses.forEach((c) => ghost.classList.add(c));
  applyGhostBaseStyles(ghost, rect, scale);
  document.body.appendChild(ghost);
  return { ghost, offsetX: 0, offsetY: 0 };
}

export function movePointerGhost(
  ghost: HTMLElement,
  x: number,
  y: number,
  offsetX: number,
  offsetY: number,
  scale = 1,
) {
  ghost.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0) scale(${scale})`;
}

const MERGE_POP_SEC = 0.36;
const MORPH_SEC = 0.38;

function runAppearTransition(el: HTMLElement, from: { dx: number; dy: number; scale: number }, durationSec: number) {
  el.style.transition = "none";
  el.style.transform = `translate(${from.dx}px, ${from.dy}px) scale(${from.scale})`;
  el.style.opacity = "0.55";
  requestAnimationFrame(() => {
    el.style.transition = `transform ${durationSec}s var(--spring), opacity ${durationSec * 0.9}s var(--ease)`;
    el.style.transform = "";
    el.style.opacity = "";
    const done = () => {
      el.style.transition = "";
      el.style.opacity = "";
      el.removeEventListener("transitionend", done);
    };
    el.addEventListener("transitionend", done);
  });
}

export function animatePopIn(el: HTMLElement, fromRect: DOMRect, durationSec = MERGE_POP_SEC) {
  const to = el.getBoundingClientRect();
  const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
  runAppearTransition(el, { dx, dy, scale: 0.58 }, durationSec);
}

export function animateFromRect(el: HTMLElement, fromRect: DOMRect, durationSec = MORPH_SEC) {
  const to = el.getBoundingClientRect();
  const sx = fromRect.width / Math.max(to.width, 1);
  const sy = fromRect.height / Math.max(to.height, 1);
  const scale = Math.min(sx, sy, 1.12);
  const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
  runAppearTransition(el, { dx, dy, scale }, durationSec);
}
