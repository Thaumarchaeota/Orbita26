import "./slider-field.css";

export type SliderFieldOptions = {
  min: number;
  max: number;
  value: number;
  /** Omitted step uses the platform default of 1. */
  step?: number;
  label?: string;
  disabled?: boolean;
  onChange?: (value: number) => void;
};

export type SliderFieldHandle = {
  element: HTMLElement;
  getValue: () => number;
  setValue: (value: number) => void;
  setBounds: (min: number, max: number) => void;
  dispose: () => void;
};

function snap(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const steps = Math.round((value - min) / step);
  const decimals = (String(step).split(".")[1] ?? "").length;
  const snapped = Number((min + steps * step).toFixed(decimals));
  return Math.min(max, Math.max(min, snapped));
}

export function mountSliderField(options: SliderFieldOptions): SliderFieldHandle {
  let min = Math.min(options.min, options.max);
  let max = Math.max(options.min, options.max);
  const step = options.step != null && options.step > 0 ? options.step : 1;
  let current = snap(options.value, min, max, step);
  const ac = new AbortController();
  const { signal } = ac;

  const element = document.createElement("div");
  element.className = "orbita-slider-field";

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(current);
  if (options.label) range.setAttribute("aria-label", options.label);
  if (options.disabled) range.disabled = true;

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.value = String(current);
  number.inputMode = "decimal";
  if (options.label) number.setAttribute("aria-label", options.label);
  if (options.disabled) number.disabled = true;

  element.append(number, range);

  const paintFill = () => {
    const span = max - min;
    const pct = span === 0 ? 0 : ((current - min) / span) * 100;
    range.style.setProperty("--orbita-slider-pct", `${pct}%`);
  };

  const write = (next: number, emit: boolean) => {
    current = snap(next, min, max, step);
    range.value = String(current);
    paintFill();
    if (document.activeElement !== number) number.value = String(current);
    if (emit) options.onChange?.(current);
  };

  paintFill();

  range.addEventListener("input", () => {
    write(range.valueAsNumber, true);
    number.value = String(current);
  }, { signal });

  number.addEventListener("input", () => {
    if (number.value.trim() === "" || !Number.isFinite(number.valueAsNumber)) return;
    write(number.valueAsNumber, true);
  }, { signal });

  number.addEventListener("blur", () => {
    number.value = String(current);
  }, { signal });

  number.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      number.blur();
    }
  }, { signal });

  return {
    element,
    getValue: () => current,
    setValue: (value) => {
      write(value, false);
      number.value = String(current);
    },
    setBounds: (nextMin, nextMax) => {
      min = Math.min(nextMin, nextMax); max = Math.max(nextMin, nextMax);
      range.min = String(min); range.max = String(max);
      number.min = String(min); number.max = String(max);
      write(current, false);
    },
    dispose: () => {
      ac.abort();
      element.remove();
    },
  };
}
