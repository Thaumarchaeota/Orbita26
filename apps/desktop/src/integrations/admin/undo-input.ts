import { hasBlockingOverlayNavigation } from "../../ui/overlay-navigation";

export type UndoDirection = "undo" | "redo";
export type ArrangementUndoInputOwner = {
  isActive: () => boolean;
  isBusy: () => boolean;
  request: (direction: UndoDirection) => void | Promise<void>;
  onError: (error: unknown) => void;
};

const textOwners = new Map<Element, number>();
const arrangementOwners = new Set<ArrangementUndoInputOwner>();
const pendingOwners = new Set<ArrangementUndoInputOwner>();
let installedCleanup: (() => void) | null = null;

/** Custom editors register their outer host, including closed Shadow DOM editors. */
export function registerInsightTextHistoryOwner(root: Element): () => void {
  textOwners.set(root, (textOwners.get(root) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (textOwners.get(root) ?? 1) - 1;
    if (remaining > 0) textOwners.set(root, remaining);
    else textOwners.delete(root);
  };
}

/** Native text undo must never fall through to a persisted plan mutation (SPEC-0015 §2). */
export function ownsTextHistory(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  if (!path.length && event.target) path.push(event.target);
  return path.some((node) => {
    if (!(node instanceof Element)) return false;
    if (textOwners.has(node)) return true;
    // Other form controls also reserve their keyboard input, including readonly fields.
    if (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) return true;
    const editable = node.getAttribute("contenteditable");
    return editable !== null && ["", "true", "false", "plaintext-only"].includes(editable.toLowerCase());
  });
}

export function registerArrangementUndoInputOwner(owner: ArrangementUndoInputOwner): () => void {
  arrangementOwners.add(owner);
  return () => { arrangementOwners.delete(owner); };
}

export function installInsightUndoInput(): () => void {
  installedCleanup?.();
  const controller = new AbortController();
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    const direction = key === "z" ? "undo" : key === "y" ? "redo" : null;
    if (!direction || ownsTextHistory(event)) return;
    if (hasBlockingOverlayNavigation()) { event.preventDefault(); return; }
    const active = [...arrangementOwners].filter((owner) => owner.isActive());
    // A stale/multiple active owner is never permission to mutate a background page.
    if (active.length !== 1) return;
    event.preventDefault();
    const owner = active[0];
    if (event.repeat || owner.isBusy() || pendingOwners.has(owner)) return;
    pendingOwners.add(owner);
    void Promise.resolve().then(() => {
      if (arrangementOwners.has(owner) && owner.isActive()) return owner.request(direction);
    }).catch((error) => owner.onError(error)).finally(() => pendingOwners.delete(owner));
  };
  // Bubble after editor handlers; native text behavior remains completely untouched.
  window.addEventListener("keydown", onKey, { signal: controller.signal });
  const cleanup = () => {
    controller.abort();
    if (installedCleanup === cleanup) installedCleanup = null;
  };
  installedCleanup = cleanup;
  window.addEventListener("beforeunload", cleanup, { once: true, signal: controller.signal });
  return cleanup;
}
