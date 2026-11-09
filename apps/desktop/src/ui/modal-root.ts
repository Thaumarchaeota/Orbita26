let root: HTMLElement | null = null;
let zCounter = 200;

export function getModalRoot(): HTMLElement {
  if (!root || !root.isConnected) {
    root = document.createElement("div");
    root.id = "orbita-modal-root";
    document.body.appendChild(root);
  }
  return root;
}

export function mountModalBackdrop(backdrop: HTMLElement) {
  backdrop.setAttribute("hidden", "");
  getModalRoot().appendChild(backdrop);
}

export function raiseModalBackdrop(backdrop: HTMLElement) {
  zCounter += 1;
  backdrop.style.zIndex = String(zCounter);
}

export function hideModalBackdrop(backdrop: HTMLElement) {
  backdrop.setAttribute("hidden", "");
  backdrop.style.removeProperty("z-index");
}

/** Highest z-index among visible modal-root children, excluding `except`. */
export function topModalRootZ(except?: HTMLElement): number {
  let max = 0;
  for (const child of getModalRoot().children) {
    if (!(child instanceof HTMLElement) || child === except || child.hidden) continue;
    const raw = child.style.zIndex || getComputedStyle(child).zIndex;
    const z = Number(raw);
    if (Number.isFinite(z)) max = Math.max(max, z);
  }
  return max;
}
