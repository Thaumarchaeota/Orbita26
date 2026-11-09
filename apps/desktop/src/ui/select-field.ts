import {
  mountFlatSelectPopover,
  type FlatSelectOption,
  type FlatSelectPopoverHandle,
} from "./flat-select-popover";
import "./select-field.css";

type SelectFieldBase = {
  label: string;
  placeholder?: string;
  options: FlatSelectOption[];
  search: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export type SingleSelectFieldOptions = SelectFieldBase & {
  multiple: false;
  value: string | null;
  onChange: (value: string | null) => void;
};

export type MultipleSelectFieldOptions = SelectFieldBase & {
  multiple: true;
  values: ReadonlySet<string>;
  onChange: (values: Set<string>) => void;
};

export type SelectFieldOptions = SingleSelectFieldOptions | MultipleSelectFieldOptions;

export type SelectFieldHandle = {
  getValue: () => string | null;
  getValues: () => ReadonlySet<string>;
  setValue: (value: string | null) => void;
  setValues: (values: ReadonlySet<string>) => void;
  setOptions: (options: FlatSelectOption[]) => void;
  setDisabled: (disabled: boolean) => void;
  dispose: () => void;
  root: HTMLElement;
  button: HTMLButtonElement;
};

let nextSelectFieldId = 0;

/** Complete labeled field over the shared FlatSelect list and portal primitive. */
export function mountSelectField(
  container: HTMLElement,
  options: SelectFieldOptions,
): SelectFieldHandle {
  let selected = options.multiple
    ? new Set(options.values)
    : new Set(options.value === null ? [] : [options.value]);
  let optionList = [...options.options];
  let disabled = options.disabled ?? false;
  let disposed = false;
  let isOpen = false;
  let replacingPopover = false;
  const listeners = new AbortController();
  let popover: FlatSelectPopoverHandle;

  const root = document.createElement("div");
  root.className = "orbita-select-field";
  const fieldLabel = document.createElement("span");
  fieldLabel.className = "orbita-select-field-sr-only";
  fieldLabel.id = `orbita-select-field-label-${++nextSelectFieldId}`;
  fieldLabel.textContent = options.label;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "orbita-select-field-trigger";
  button.id = `orbita-select-field-${nextSelectFieldId}`;
  const valueId = `orbita-select-field-value-${nextSelectFieldId}`;
  button.setAttribute("aria-labelledby", `${fieldLabel.id} ${valueId}`);
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");

  const valueLabel = document.createElement("span");
  valueLabel.className = "orbita-select-field-value";
  valueLabel.id = valueId;
  button.appendChild(valueLabel);
  root.appendChild(fieldLabel);
  root.appendChild(button);
  container.appendChild(root);

  const syncLabel = (): void => {
    const labels = optionList
      .filter((item) => selected.has(item.value))
      .map((item) => item.label);
    const text = options.multiple ? labels.join("、") : labels[0] ?? "";
    valueLabel.textContent = text || options.placeholder || "请选择…";
    valueLabel.classList.toggle("is-placeholder", !text);
  };

  const syncDisabled = (): void => {
    button.disabled = disabled;
    root.classList.toggle("is-disabled", disabled);
    if (disabled) void popover?.close();
  };

  const mountPopover = (): FlatSelectPopoverHandle => mountFlatSelectPopover({
    anchor: button,
    options: optionList,
    selected,
    multiple: options.multiple,
    search: options.search,
    onOpenChange: (open) => {
      if (isOpen === open) return;
      isOpen = open;
      button.setAttribute("aria-expanded", String(open));
      button.classList.toggle("is-open", open);
      if (!replacingPopover) options.onOpenChange?.(open);
    },
    onChange: (next) => {
      if (disposed) return;
      selected = new Set(next);
      syncLabel();
      if (options.multiple) options.onChange(new Set(selected));
      else options.onChange(selected.values().next().value ?? null);
    },
  });

  popover = mountPopover();
  syncLabel();
  syncDisabled();

  button.addEventListener("click", () => {
    if (disabled || disposed) return;
    if (popover.isOpen()) void popover.close();
    else void popover.open();
  }, { signal: listeners.signal });

  return {
    getValue: () => selected.values().next().value ?? null,
    getValues: () => new Set(selected),
    setValue: (value) => {
      if (disposed) return;
      if (options.multiple) throw new Error("setValue is only available for single select fields");
      selected = new Set(value === null ? [] : [value]);
      syncLabel();
      popover.setSelected(selected);
    },
    setValues: (values) => {
      if (disposed) return;
      if (!options.multiple) throw new Error("setValues is only available for multiple select fields");
      selected = new Set(values);
      syncLabel();
      popover.setSelected(selected);
    },
    setOptions: (next) => {
      if (disposed) return;
      optionList = [...next];
      syncLabel();
      const reopen = popover.isOpen() && !disabled;
      replacingPopover = true;
      popover.dispose();
      popover = mountPopover();
      if (reopen) void popover.open();
      replacingPopover = false;
    },
    setDisabled: (next) => {
      if (disposed) return;
      disabled = next;
      syncDisabled();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      popover.dispose();
      root.remove();
    },
    root,
    button,
  };
}
