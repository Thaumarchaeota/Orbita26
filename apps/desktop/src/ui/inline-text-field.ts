import "./inline-text-field.css";

export type InlineTextFieldOptions = {
  container: HTMLElement;
  value: string;
  placeholder?: string;
  inputPlaceholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  contentSized?: boolean;
  multiline?: boolean;
  readOnly?: boolean;
  displayClassName?: string;
  inputClassName?: string;
  onCommit: (value: string) => void;
  onCancel?: () => void;
};

export type InlineTextFieldHandle = {
  setValue: (value: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  focus: () => void;
  dispose: () => void;
};

function caretOffsetAt(display: HTMLElement, event: MouseEvent, valueLength: number): number {
  if (!display.textContent) return 0;
  const doc = display.ownerDocument;
  const isText = (node: Node | null): node is Text => node?.nodeType === Node.TEXT_NODE && display.contains(node);
  try {
    const caretPositionFromPoint = (doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    }).caretPositionFromPoint;
    const position = caretPositionFromPoint?.call(doc, event.clientX, event.clientY);
    if (position && isText(position.offsetNode)) return Math.max(0, Math.min(position.offset, valueLength));
  } catch { /* Fall through to the legacy browser API. */ }
  try {
    const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && isText(range.startContainer)) return Math.max(0, Math.min(range.startOffset, valueLength));
  } catch { /* Fall through to the nearest text edge. */ }
  const rect = display.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? 0 : valueLength;
}

function isValidCommit(_value: string): boolean {
  return true;
}

export function mountInlineTextField(options: InlineTextFieldOptions): InlineTextFieldHandle {
  const root = document.createElement("div");
  root.className = `orbita-inline-text-field${options.contentSized ? " is-content-sized" : ""}`;
  options.container.append(root);

  let committed = options.value;
  let readOnly = Boolean(options.readOnly);
  let editing = false;
  let disposed = false;
  let clearSelectionGesture = () => {};

  const display = document.createElement("button");
  display.type = "button";
  display.className = ["orbita-inline-text-field__display", options.displayClassName].filter(Boolean).join(" ");

  const paintDisplay = () => {
    const empty = !committed;
    display.classList.toggle("is-empty", empty);
    display.textContent = empty && !readOnly ? (options.placeholder ?? "") : committed;
    if (options.ariaLabel) display.setAttribute("aria-label", empty ? options.ariaLabel : `${options.ariaLabel}：${committed}`);
    display.disabled = readOnly;
  };
  paintDisplay();

  const finishEdit = (commit: boolean) => {
    clearSelectionGesture();
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(".orbita-inline-text-field__input");
    if (!input) return;
    const next = input.value;
    editing = false;
    input.remove();
    root.append(display);
    if (commit && isValidCommit(next)) {
      committed = next;
      options.onCommit(next);
    } else if (!commit) {
      options.onCancel?.();
    }
    paintDisplay();
  };

  const startEdit = (caret?: number, end = caret, direction: "forward" | "backward" | "none" = "none") => {
    if (readOnly || editing || disposed) return;
    clearSelectionGesture();
    editing = true;
    display.remove();
    const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
    input.className = ["orbita-inline-text-field__input", options.inputClassName].filter(Boolean).join(" ");
    if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
    if (!options.multiline) (input as HTMLInputElement).type = "text";
    if (!options.multiline && options.maxLength !== undefined) (input as HTMLInputElement).maxLength = options.maxLength;
    input.value = committed;
    input.placeholder = options.inputPlaceholder ?? options.placeholder ?? "";
    root.append(input);
    input.focus();
    const pos = caret ?? input.value.length;
    input.setSelectionRange(pos, end ?? pos, direction);
    if (options.multiline && input instanceof HTMLTextAreaElement) {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    }
  };

  display.addEventListener("pointerdown", (event) => {
    if (readOnly || disposed || event.button !== 0 || event.pointerType !== "mouse") return;
    // Keep the native selection gesture on the display until mouseup. Replacing
    // it on down loses the browser's anchor (docs/plans/inline-text-field-selection.md).
    // Card/map hosts must not interpret this text gesture as a card drag.
    event.stopPropagation();
    clearSelectionGesture();
    const doc = display.ownerDocument;
    const view = doc.defaultView;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: { start: number; end: number; direction: "forward" | "backward"; x: number; y: number } | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      doc.removeEventListener("mouseup", onUp, true);
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("pointercancel", cleanup, true);
      doc.removeEventListener("pointerdown", cleanup, true);
      doc.removeEventListener("click", onClick, true);
      view?.removeEventListener("blur", cleanup);
      if (clearSelectionGesture === cleanup) clearSelectionGesture = () => {};
    };
    const handoff = () => {
      const selection = pending;
      cleanup();
      if (!selection || !root.isConnected || display.parentNode !== root) return;
      startEdit(selection.start, selection.end, selection.direction);
    };
    const onClick = (click: MouseEvent) => {
      if (!pending || click.button !== 0 || click.detail === 0 || click.clientX !== pending.x || click.clientY !== pending.y) return;
      // Capture only this drag's click before host capture handlers, while the
      // original display is still mounted; never swallow a later unrelated click.
      click.preventDefault();
      click.stopImmediatePropagation();
      handoff();
    };
    const onMove = (move: MouseEvent) => {
      if (!pending && !(move.buttons & 1)) cleanup();
    };
    const onUp = (up: MouseEvent) => {
      if (up.button !== 0) return;
      const selection = doc.getSelection();
      const text = display.firstChild;
      if (!text || !selection?.rangeCount || !selection.anchorNode || !display.contains(selection.anchorNode)) { cleanup(); return; }
      const range = selection.getRangeAt(0);
      if (range.collapsed || !range.intersectsNode(text)) { cleanup(); return; }
      const offset = (node: Node, value: number, fallback: number) => {
        if (node === text) return Math.min(value, committed.length);
        if (node === display) return value === 0 ? 0 : committed.length;
        return fallback;
      };
      const start = offset(range.startContainer, range.startOffset, 0);
      const end = offset(range.endContainer, range.endOffset, committed.length);
      if (start === end) { cleanup(); return; }
      const anchor = offset(selection.anchorNode, selection.anchorOffset, start);
      pending = { start, end, direction: anchor === end ? "backward" : "forward", x: up.clientX, y: up.clientY };
      doc.removeEventListener("mouseup", onUp, true);
      // Keep the display through the matching click; external releases may not
      // produce one, so complete after the mouse event sequence in that case.
      timer = setTimeout(handoff, 0);
    };
    clearSelectionGesture = cleanup;
    doc.addEventListener("mouseup", onUp, true);
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("pointercancel", cleanup, true);
    doc.addEventListener("pointerdown", cleanup, true);
    doc.addEventListener("click", onClick, true);
    view?.addEventListener("blur", cleanup);
  });

  display.addEventListener("click", (event) => {
    const caret = event.detail > 0 ? caretOffsetAt(display, event, committed.length) : undefined;
    startEdit(caret);
  });

  root.addEventListener("keydown", (event) => {
    if (!editing) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishEdit(false);
      display.focus();
      return;
    }
    if (!options.multiline && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finishEdit(true);
      display.focus();
    }
  });

  root.addEventListener("focusout", (event) => {
    if (!editing) {
      if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) clearSelectionGesture();
      return;
    }
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(".orbita-inline-text-field__input");
    if (!input || event.relatedTarget === input) return;
    finishEdit(isValidCommit(input.value));
  });

  root.append(display);

  return {
    setValue: (value) => {
      if (disposed) return;
      clearSelectionGesture();
      committed = value;
      if (!editing) paintDisplay();
    },
    setReadOnly: (next) => {
      if (disposed) return;
      clearSelectionGesture();
      readOnly = next;
      if (readOnly && editing) finishEdit(false);
      paintDisplay();
    },
    focus: () => {
      if (disposed) return;
      if (editing) {
        root.querySelector<HTMLInputElement | HTMLTextAreaElement>(".orbita-inline-text-field__input")?.focus();
        return;
      }
      display.focus();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearSelectionGesture();
      root.remove();
    },
  };
}
