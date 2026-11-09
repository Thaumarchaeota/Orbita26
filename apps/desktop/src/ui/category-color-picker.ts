import { mountPopoverPortal, type PopoverPortalHandle } from "./popover-portal";
import "./category-color-picker.css";

export type CategoryColorOption = {
  value: string;
  label: string;
  main: string;
  disabled?: boolean;
};

export type CategoryColorPickerOptions = {
  anchor: HTMLElement;
  options: readonly CategoryColorOption[];
  selected: string | null;
  inherit?: { value: string; label: string };
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
};

export type CategoryColorPickerHandle = PopoverPortalHandle & {
  setOptions: (options: readonly CategoryColorOption[]) => void;
};

export function mountCategoryColorPicker(options: CategoryColorPickerOptions): CategoryColorPickerHandle {
  let selected = options.selected;
  let disposed = false;
  const popover = document.createElement("div");
  popover.className = "orbita-category-color-picker orbita-standard-popover motion-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "分类颜色");

  const list = document.createElement("div");
  list.className = "orbita-category-color-picker-grid";
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", "分类颜色");
  const swatchGrid = document.createElement("div");
  swatchGrid.className = "orbita-category-color-picker-swatches";
  list.append(swatchGrid);
  popover.append(list);
  const inheritButton = options.inherit ? document.createElement("button") : null;
  if (inheritButton && options.inherit) {
    inheritButton.type = "button";
    inheritButton.className = "orbita-category-color-picker-inherit";
    inheritButton.textContent = options.inherit.label;
    inheritButton.dataset.value = options.inherit.value;
    inheritButton.setAttribute("role", "radio");
    list.append(inheritButton);
  }

  let colorOptions = [...options.options];
  const buttons: HTMLButtonElement[] = [];
  const allButtons = () => [ ...(inheritButton ? [inheritButton] : []), ...buttons ];
  const paint = () => {
    for (const button of allButtons()) {
      const isSelected = button.dataset.value === selected;
      button.setAttribute("aria-checked", String(isSelected));
      button.classList.toggle("is-selected", isSelected);
    }
  };
  const choose = (value: string) => {
    const button = allButtons().find((candidate) => candidate.dataset.value === value);
    if (!button || button.disabled) return;
    selected = value;
    paint();
    options.onChange(value);
    void portal.close();
  };
  const addOption = (option: CategoryColorOption) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "orbita-category-color-swatch";
    button.dataset.value = option.value;
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.style.setProperty("--category-color-main", option.main);
    if (option.disabled) button.disabled = true;
    button.addEventListener("click", () => choose(option.value));
    buttons.push(button);
    swatchGrid.append(button);
  };
  for (const option of colorOptions) addOption(option);
  if (inheritButton) inheritButton.addEventListener("click", () => choose(inheritButton.dataset.value ?? ""));
  paint();

  const focusSelected = () => {
    const target = allButtons().find((button) => button.dataset.value === selected && !button.disabled)
      ?? allButtons().find((button) => !button.disabled);
    target?.focus();
  };
  const moveFocus = (current: HTMLButtonElement, delta: number) => {
    const enabled = allButtons().filter((button) => !button.disabled);
    const index = enabled.indexOf(current);
    if (index < 0 || !enabled.length) return;
    enabled[(index + delta + enabled.length) % enabled.length]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target instanceof HTMLButtonElement ? event.target : null;
    if (!target || !allButtons().includes(target)) return;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); moveFocus(target, 1); }
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); moveFocus(target, -1); }
    else if (event.key === "Home") { event.preventDefault(); allButtons().find((button) => !button.disabled)?.focus(); }
    else if (event.key === "End") { event.preventDefault(); [...allButtons()].reverse().find((button) => !button.disabled)?.focus(); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(target.dataset.value ?? ""); }
  };
  popover.addEventListener("keydown", onKeyDown);

  const portal = mountPopoverPortal({
    anchor: options.anchor,
    popover,
    onOpenChange: (open) => { options.onOpenChange?.(open); if (open) queueMicrotask(focusSelected); },
  });
  const originalDispose = portal.dispose;
  return {
    open: portal.open,
    close: portal.close,
    isOpen: portal.isOpen,
    setOptions: (nextOptions) => {
      colorOptions = [...nextOptions];
      const focusedValue = document.activeElement instanceof HTMLButtonElement ? document.activeElement.dataset.value : null;
      const byValue = new Map(colorOptions.map((option) => [option.value, option]));
      for (const button of buttons) {
        const option = byValue.get(button.dataset.value ?? "");
        if (!option) { button.remove(); continue; }
        button.title = option.label;
        button.setAttribute("aria-label", option.label);
        button.style.setProperty("--category-color-main", option.main);
        button.disabled = Boolean(option.disabled);
      }
      paint();
      if (focusedValue) allButtons().find((button) => button.dataset.value === focusedValue)?.focus();
    },
    dispose: () => { if (disposed) return; disposed = true; popover.removeEventListener("keydown", onKeyDown); originalDispose(); },
  };
}
