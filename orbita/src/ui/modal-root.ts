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
