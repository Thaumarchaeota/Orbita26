type Direction = -1 | 1;

/** Insight owns side-button navigation; never delegate an empty stack to browser history. */
export function bindMouseHistoryInput(
  navigate: (direction: Direction) => void,
  options: { signal: AbortSignal; target?: Window; isFocused?: () => boolean },
): void {
  const target = options.target ?? window;
  const isFocused = options.isFocused ?? (() => target.document.hasFocus());
  const armed = new Set<number>();
  const direction = (button: number): Direction | null => button === 3 ? -1 : button === 4 ? 1 : null;
  const consume = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: MouseEvent) => {
    if (direction(event.button) === null || !isFocused()) return;
    consume(event);
    armed.add(event.button);
  };
  const up = (event: MouseEvent) => {
    const step = direction(event.button);
    if (step === null) return;
    const pressed = armed.delete(event.button);
    if (!isFocused()) return;
    consume(event);
    // Only mouseup dispatches. The following auxclick must not move a second frame.
    if (pressed) navigate(step);
  };
  const auxiliary = (event: MouseEvent) => {
    if (direction(event.button) !== null && isFocused()) consume(event);
  };
  const clear = () => armed.clear();
  const listeners = { capture: true, passive: false, signal: options.signal };
  target.addEventListener("mousedown", down, listeners);
  target.addEventListener("mouseup", up, listeners);
  target.addEventListener("auxclick", auxiliary, listeners);
  target.addEventListener("blur", clear, { signal: options.signal });
  options.signal.addEventListener("abort", clear, { once: true });
}
