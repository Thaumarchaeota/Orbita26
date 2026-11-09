/** Dismiss only when the press and the release both land on the backdrop.
 * A click's target is their common ancestor, so dragging from inside the
 * panel and releasing outside would otherwise look like a backdrop click. */
export function bindBackdropPressDismiss(
  backdrop: HTMLElement,
  dismiss: () => void,
  options?: { signal?: AbortSignal },
): () => void {
  if (options?.signal?.aborted) return () => {};
  let pressedOnBackdrop = false;
  const onPointerDown = (event: PointerEvent) => {
    pressedOnBackdrop = event.button === 0 && event.target === backdrop;
  };
  const onClick = (event: MouseEvent) => {
    const startedOnBackdrop = pressedOnBackdrop;
    pressedOnBackdrop = false;
    if (event.target === backdrop && startedOnBackdrop) dismiss();
  };
  const listen = options?.signal ? { signal: options.signal } : undefined;
  backdrop.addEventListener("pointerdown", onPointerDown, listen);
  backdrop.addEventListener("click", onClick, listen);
  return () => {
    backdrop.removeEventListener("pointerdown", onPointerDown);
    backdrop.removeEventListener("click", onClick);
  };
}
