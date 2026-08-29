import { CHEVRON_SVG } from "../integrations/ai/icons";
import { mountPopoverPortal } from "./popover-portal";
import "./simple-select.css";

export type SimpleSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  separator?: boolean;
};

export type SimpleSelectOptions = {
  value?: string;
  placeholder?: string;
  options: SimpleSelectOption[];
  onChange: (value: string) => void;
  role?: string;
};

export type SimpleSelectHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  setOptions: (options: SimpleSelectOption[]) => void;
  setPlaceholder: (placeholder: string) => void;
  dispose: () => void;
  root: HTMLElement;
  button: HTMLButtonElement;
};

export function mountSimpleSelect(
  container: HTMLElement,
  options: SimpleSelectOptions,
): SimpleSelectHandle {
  let value = options.value ?? "";
  let opts = [...options.options];
  let placeholder = options.placeholder ?? "选择…";

  container.innerHTML = `
    <div class="orbita-simple-select">
      <button type="button" class="orbita-simple-select-btn">
        <span class="orbita-simple-select-label"></span>
        <span class="orbita-simple-select-chevron">${CHEVRON_SVG}</span>
      </button>
      <div class="orbita-simple-select-menu scroll-slim motion-popover"></div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-simple-select")!;
  const btn = root.querySelector<HTMLButtonElement>(".orbita-simple-select-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".orbita-simple-select-label")!;
  const menu = root.querySelector<HTMLElement>(".orbita-simple-select-menu")!;

  if (options.role) {
    btn.setAttribute("data-role", options.role);
    btn.setAttribute("aria-haspopup", "listbox");
  }

  const portal = mountPopoverPortal({
    anchor: btn,
    popover: menu,
    onOpenChange: (open) => btn.classList.toggle("is-open", open),
  });

  const syncLabel = () => {
    const match = opts.find((o) => o.value === value && !o.separator);
    labelEl.textContent = match?.label ?? placeholder;
    labelEl.classList.toggle("is-placeholder", !match);
  };

  const paint = () => {
    menu.replaceChildren();
    const list = document.createElement("div");
    list.className = "orbita-simple-select-list";
    list.setAttribute("role", "listbox");

    for (const item of opts) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "orbita-simple-select-option";
      option.dataset.value = item.value;
      option.textContent = item.label;
      option.setAttribute("role", "option");
      option.disabled = item.disabled ?? false;
      if (item.separator) option.classList.add("is-separator");
      option.classList.toggle("is-selected", item.value === value && !item.separator);
      option.setAttribute("aria-selected", String(item.value === value && !item.separator));
      if (!item.disabled && !item.separator) {
        option.addEventListener("click", () => {
          value = item.value;
          syncLabel();
          options.onChange(item.value);
          void portal.close();
        });
      }
      list.appendChild(option);
    }
    menu.appendChild(list);
  };

  btn.addEventListener("click", () => {
    if (portal.isOpen()) void portal.close();
    else {
      paint();
      void portal.open();
    }
  });

  syncLabel();

  return {
    getValue: () => value,
    setValue: (next) => {
      value = next;
      syncLabel();
      if (portal.isOpen()) paint();
    },
    setOptions: (next) => {
      opts = [...next];
      syncLabel();
      if (portal.isOpen()) paint();
    },
    setPlaceholder: (next) => {
      placeholder = next;
      syncLabel();
    },
    dispose: () => portal.dispose(),
    root,
    button: btn,
  };
}
