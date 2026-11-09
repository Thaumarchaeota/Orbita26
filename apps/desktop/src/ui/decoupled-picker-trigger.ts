import {
  bindMaskedInput,
  DECOUPLED_MASK_CHARS,
  DECOUPLED_MASK_PLACEHOLDER,
  type DecoupledPickerMaskKind,
  type MaskedInputHandle,
} from "./decoupled-picker-mask";

export type DecoupledPickerDefaultTriggerOptions = {
  container: HTMLElement;
  className?: string;
};

export type DecoupledPickerTriggerOptions =
  | {
    anchor: HTMLElement;
    defaultTrigger?: undefined;
  }
  | {
    anchor?: undefined;
    defaultTrigger: DecoupledPickerDefaultTriggerOptions;
  };

export type DecoupledPickerTriggerHandle = {
  anchor: HTMLElement;
  sync: (label: string) => void;
  setOpen: (open: boolean) => void;
  bindOpen: (open: () => void) => void;
  getDisplay: () => string;
  dispose: () => void;
};

export type DecoupledPickerTriggerKind = DecoupledPickerMaskKind | "range" | "datetime-range";

const MASK_ARIA: Record<DecoupledPickerTriggerKind, string> = {
  date: "日期",
  range: "日期范围",
  time: "时间",
  datetime: "日期时间",
  "datetime-range": "起止时间",
};

function createField(kind: DecoupledPickerMaskKind): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.inputMode = "numeric";
  input.className = kind === "date" || kind === "time" || kind === "datetime"
    ? "orbita-decoupled-picker-trigger"
    : "orbita-decoupled-picker-field";
  return input;
}

/**
 * Decoupled pickers keep caller-owned anchors by default. Opting into this
 * helper gives the picker a disposable masked value field without changing that path.
 */
export function mountDecoupledPickerTrigger(
  options: DecoupledPickerTriggerOptions,
  initialLabel: string,
  mask?: {
    kind: DecoupledPickerTriggerKind;
    onCommit: (display: string) => boolean;
    onEnter?: () => void;
    preserveInvalidOnBlur?: boolean;
    placeholder?: string;
  },
): DecoupledPickerTriggerHandle {
  if (!options.defaultTrigger) {
    return {
      anchor: options.anchor,
      sync: () => {},
      setOpen: () => {},
      bindOpen: () => {},
      getDisplay: () => "",
      dispose: () => {},
    };
  }

  let openPicker: (() => void) | null = null;
  const onPointerDown = () => openPicker?.();

  if (mask?.kind === "range") {
    const wrap = document.createElement("div");
    wrap.className = [
      "orbita-decoupled-picker-trigger",
      "orbita-decoupled-picker-trigger--range",
      options.defaultTrigger.className,
    ].filter(Boolean).join(" ");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-haspopup", "dialog");
    wrap.setAttribute("aria-expanded", "false");
    wrap.setAttribute("aria-label", MASK_ARIA.range);
    wrap.tabIndex = -1;

    const fromInput = document.createElement("input");
    const toInput = document.createElement("input");
    for (const input of [fromInput, toInput]) {
      input.type = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.inputMode = "numeric";
      input.className = "orbita-decoupled-picker-field";
    }
    fromInput.setAttribute("aria-label", DECOUPLED_MASK_PLACEHOLDER.rangeFrom);
    toInput.setAttribute("aria-label", DECOUPLED_MASK_PLACEHOLDER.rangeTo);

    const sep = document.createElement("span");
    sep.className = "orbita-decoupled-range-sep";
    sep.setAttribute("aria-hidden", "true");

    wrap.append(fromInput, sep, toInput);
    options.defaultTrigger.container.appendChild(wrap);

    const [fromValue, toValue] = initialLabel.split("\t");
    let fromMask: MaskedInputHandle;
    let toMask: MaskedInputHandle;
    const commitRange = () => {
      mask.onCommit(`${fromMask.getDisplay()}\t${toMask.getDisplay()}`);
      return true;
    };
    fromMask = bindMaskedInput(fromInput, {
      kind: "date",
      value: fromValue ?? "",
      placeholder: DECOUPLED_MASK_PLACEHOLDER.rangeFrom,
      onCommit: () => commitRange(),
      onEnter: mask.onEnter,
      onComplete: () => toInput.focus(),
    });
    toMask = bindMaskedInput(toInput, {
      kind: "date",
      value: toValue ?? "",
      placeholder: DECOUPLED_MASK_PLACEHOLDER.rangeTo,
      onCommit: () => commitRange(),
      onEnter: mask.onEnter,
    });

    wrap.addEventListener("pointerdown", onPointerDown);

    return {
      anchor: wrap,
      sync: (label) => {
        const [from, to] = label.split("\t");
        fromMask.setDisplay(from ?? "");
        toMask.setDisplay(to ?? "");
      },
      setOpen: (open) => {
        wrap.setAttribute("aria-expanded", String(open));
      },
      bindOpen: (open) => {
        openPicker = open;
      },
      getDisplay: () => `${fromMask.getDisplay()}\t${toMask.getDisplay()}`,
      dispose: () => {
        wrap.removeEventListener("pointerdown", onPointerDown);
        fromMask.dispose();
        toMask.dispose();
        wrap.remove();
      },
    };
  }

  if (mask?.kind === "datetime-range") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ["orbita-decoupled-picker-trigger", "orbita-decoupled-picker-trigger--datetime-range", options.defaultTrigger.className].filter(Boolean).join(" ");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "起止时间");
    button.textContent = initialLabel;
    options.defaultTrigger.container.appendChild(button);
    button.addEventListener("click", onPointerDown);
    return {
      anchor: button,
      sync: (label) => { button.textContent = label; },
      setOpen: (open) => { button.setAttribute("aria-expanded", String(open)); },
      bindOpen: (open) => { openPicker = open; },
      getDisplay: () => button.textContent ?? "",
      dispose: () => { button.removeEventListener("click", onPointerDown); button.remove(); },
    };
  }
  const input = createField(mask?.kind ?? "date");
  if (mask) {
    input.className = [
      "orbita-decoupled-picker-trigger",
      `orbita-decoupled-picker-trigger--${mask.kind}`,
      options.defaultTrigger.className,
    ].filter(Boolean).join(" ");
  } else if (options.defaultTrigger.className) {
    input.classList.add(options.defaultTrigger.className);
  }
  input.setAttribute("aria-haspopup", "dialog");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", mask ? MASK_ARIA[mask.kind] : "选择");
  if (mask && mask.kind !== "range") {
    input.setAttribute("size", String(DECOUPLED_MASK_CHARS[mask.kind]));
  }
  options.defaultTrigger.container.appendChild(input);

  let masked: MaskedInputHandle | null = null;
  if (mask && mask.kind !== "range") {
    masked = bindMaskedInput(input, {
      kind: mask.kind,
      value: initialLabel,
      placeholder: mask.placeholder ?? DECOUPLED_MASK_PLACEHOLDER[mask.kind],
      onCommit: mask.onCommit,
      onEnter: mask.onEnter,
      preserveInvalidOnBlur: mask.preserveInvalidOnBlur,
    });
  } else {
    input.value = initialLabel;
  }

  input.addEventListener("pointerdown", onPointerDown);

  return {
    anchor: input,
    sync: (label) => {
      if (masked) masked.setDisplay(label);
      else input.value = label;
    },
    setOpen: (open) => {
      input.setAttribute("aria-expanded", String(open));
    },
    bindOpen: (open) => {
      openPicker = open;
    },
    getDisplay: () => masked?.getDisplay() ?? input.value,
    dispose: () => {
      input.removeEventListener("pointerdown", onPointerDown);
      masked?.dispose();
      input.remove();
    },
  };
}
