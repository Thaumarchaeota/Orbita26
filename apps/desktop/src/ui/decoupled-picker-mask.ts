import { formatDateValue, parseDateValue } from "./date-picker-core";

export type DecoupledPickerMaskKind = "date" | "time" | "datetime";

export const DECOUPLED_MASK_TEMPLATE: Record<DecoupledPickerMaskKind, string> = {
  date: "####-##-##",
  time: "##:##",
  datetime: "####-##-## ##:##",
};

export const DECOUPLED_MASK_CHARS: Record<DecoupledPickerMaskKind, number> = {
  date: 10,
  time: 5,
  datetime: 16,
};

export const DECOUPLED_MASK_PLACEHOLDER: Record<DecoupledPickerMaskKind | "rangeFrom" | "rangeTo", string> = {
  date: "选择日期",
  time: "选择时间",
  datetime: "选择日期时间",
  rangeFrom: "开始",
  rangeTo: "结束",
};

export function maskDigitSlots(template: string): number[] {
  const slots: number[] = [];
  for (let i = 0; i < template.length; i++) {
    if (template[i] === "#") slots.push(i);
  }
  return slots;
}

export function digitsFromDisplay(display: string): string {
  return display.replace(/\D/g, "");
}

export function emptyDigitBuffer(slotCount: number): string {
  return "".padEnd(slotCount, " ");
}

export function normalizeDigitBuffer(display: string, slotCount: number): string {
  return digitsFromDisplay(display).slice(0, slotCount).padEnd(slotCount, " ");
}

export function isEmptyDigitBuffer(digits: string): boolean {
  return !digits.replace(/ /g, "");
}

export function formatMaskDigits(template: string, digits: string): string {
  let di = 0;
  let out = "";
  for (let i = 0; i < template.length; i++) {
    if (template[i] === "#") {
      const ch = digits[di++] ?? " ";
      out += ch === " " ? " " : ch;
    } else {
      out += template[i];
    }
  }
  return out;
}

export function caretToDigitIndex(template: string, caret: number): number {
  const slots = maskDigitSlots(template);
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]! >= caret) return i;
  }
  return slots.length;
}

export function digitIndexToCaret(template: string, digitIndex: number): number {
  const slots = maskDigitSlots(template);
  if (digitIndex <= 0) return slots[0] ?? 0;
  if (digitIndex >= slots.length) return template.length;
  return slots[digitIndex]!;
}

function overwriteDigits(digits: string, start: number, incoming: string, slotCount: number): string {
  const next = digits.padEnd(slotCount, " ").slice(0, slotCount).split("");
  let i = start;
  for (const ch of incoming) {
    if (i >= slotCount) break;
    next[i] = ch === " " ? " " : ch;
    i += 1;
  }
  return next.join("");
}

function isValidIsoDate(value: string): boolean {
  const parsed = parseDateValue(value);
  return Boolean(parsed && formatDateValue(parsed) === value);
}

function isValidHhMm(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59;
}

export function isValidMaskDisplay(kind: DecoupledPickerMaskKind, display: string): boolean {
  if (!display.trim()) return true;
  if (kind === "date") return isValidIsoDate(display);
  if (kind === "time") return isValidHhMm(display);
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(display);
  return Boolean(match && isValidIsoDate(match[1]!) && isValidHhMm(match[2]!));
}

export type MaskedInputHandle = {
  setDisplay: (display: string) => void;
  getDisplay: () => string;
  dispose: () => void;
};

export function bindMaskedInput(
  input: HTMLInputElement,
  options: {
    kind: DecoupledPickerMaskKind;
    value: string;
    placeholder: string;
    onCommit: (display: string) => boolean;
    onEnter?: () => void;
    onComplete?: () => void;
    preserveInvalidOnBlur?: boolean;
  },
): MaskedInputHandle {
  const template = DECOUPLED_MASK_TEMPLATE[options.kind];
  const slotCount = maskDigitSlots(template).length;
  let digits = normalizeDigitBuffer(options.value, slotCount);
  let lastGood = isValidMaskDisplay(options.kind, options.value) ? options.value : "";
  input.placeholder = options.placeholder;

  const paint = (digitCaret: number | null) => {
    if (isEmptyDigitBuffer(digits)) {
      input.value = "";
      return;
    }
    const display = formatMaskDigits(template, digits);
    input.value = display;
    if (digitCaret === null) return;
    const caret = digitIndexToCaret(template, digitCaret);
    input.setSelectionRange(caret, caret);
  };

  paint(null);
  if (!isEmptyDigitBuffer(digits) && lastGood) input.value = lastGood;
  else if (isEmptyDigitBuffer(digits)) input.value = "";

  const currentDisplay = (): string => {
    if (isEmptyDigitBuffer(digits)) return "";
    return formatMaskDigits(template, digits);
  };

  const commitIfValid = (): boolean => {
    const display = currentDisplay();
    if (!isValidMaskDisplay(options.kind, display)) {
      if (options.preserveInvalidOnBlur) return false;
      digits = normalizeDigitBuffer(lastGood, slotCount);
      paint(null);
      if (isEmptyDigitBuffer(digits)) input.value = "";
      else input.value = lastGood;
      return false;
    }
    lastGood = display;
    return options.onCommit(display);
  };

  const insertAtCaret = (incoming: string) => {
    const start = Math.min(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    const digitStart = isEmptyDigitBuffer(digits)
      ? 0
      : Math.min(slotCount, caretToDigitIndex(template, start));
    digits = overwriteDigits(digits, digitStart, incoming, slotCount);
    paint(digitStart + incoming.length);
    const display = currentDisplay();
    if (isValidMaskDisplay(options.kind, display)) {
      lastGood = display;
      options.onCommit(display);
      if (display) options.onComplete?.();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (commitIfValid()) options.onEnter?.();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && (input.selectionEnd ?? 0) > (input.selectionStart ?? 0)) {
      event.preventDefault();
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? start;
      const first = caretToDigitIndex(template, start);
      const last = caretToDigitIndex(template, end);
      digits = overwriteDigits(digits, first, " ".repeat(last - first), slotCount);
      paint(first);
      if (isEmptyDigitBuffer(digits)) {
        lastGood = "";
        options.onCommit("");
      }
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      if (isEmptyDigitBuffer(digits)) return;
      const start = input.selectionStart ?? 0;
      const digitIndex = caretToDigitIndex(template, start) - 1;
      if (digitIndex < 0) return;
      digits = overwriteDigits(digits, digitIndex, " ", slotCount);
      paint(digitIndex);
      if (isEmptyDigitBuffer(digits)) {
        lastGood = "";
        options.onCommit("");
      }
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      if (isEmptyDigitBuffer(digits)) return;
      const start = input.selectionStart ?? 0;
      const digitIndex = Math.min(slotCount - 1, caretToDigitIndex(template, start));
      digits = overwriteDigits(digits, digitIndex, " ", slotCount);
      paint(digitIndex + 1);
      if (isEmptyDigitBuffer(digits)) {
        lastGood = "";
        options.onCommit("");
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (isEmptyDigitBuffer(digits)) return;
      const digitIndex = Math.max(0, caretToDigitIndex(template, input.selectionStart ?? 0) - 1);
      paint(digitIndex);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (isEmptyDigitBuffer(digits)) return;
      const digitIndex = Math.min(slotCount, caretToDigitIndex(template, input.selectionStart ?? 0) + 1);
      paint(digitIndex);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      paint(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      paint(slotCount);
      return;
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      insertAtCaret(event.key);
    } else if (event.key.length === 1) {
      event.preventDefault();
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const incoming = digitsFromDisplay(event.clipboardData?.getData("text") ?? "");
    if (incoming) insertAtCaret(incoming);
  };

  const onBlur = () => {
    commitIfValid();
  };

  const onClick = () => {
    if (isEmptyDigitBuffer(digits)) return;
    const start = input.selectionStart ?? 0;
    paint(caretToDigitIndex(template, start));
  };

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("paste", onPaste);
  input.addEventListener("blur", onBlur);
  input.addEventListener("click", onClick);

  return {
    setDisplay: (display) => {
      digits = normalizeDigitBuffer(display, slotCount);
      lastGood = isValidMaskDisplay(options.kind, display) ? display : lastGood;
      paint(null);
      if (!isEmptyDigitBuffer(digits) && isValidMaskDisplay(options.kind, display)) {
        input.value = display;
      }
    },
    getDisplay: () => (isEmptyDigitBuffer(digits) ? "" : input.value),
    dispose: () => {
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("paste", onPaste);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("click", onClick);
    },
  };
}
