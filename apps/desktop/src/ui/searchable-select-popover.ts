import "./searchable-select-popover.css";
import { mountPopoverPortal } from "./popover-portal";

export type SearchableSelectOption = {
  value: string;
  label: string;
  sublabel?: string;
};

export type SearchableSelectPopoverOptions = {
  className?: string;
  anchor: HTMLElement;
  options: SearchableSelectOption[];
  selected: ReadonlySet<string>;
  multiple?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  maxHeight?: number;
  onChange: (selected: Set<string>) => void;
  onClose?: () => void;
};

export type SearchableSelectPopoverHandle = {
  open: () => Promise<void>;
  close: () => Promise<void>;
  isOpen: () => boolean;
  setOptions: (options: SearchableSelectOption[]) => void;
  setSelected: (selected: ReadonlySet<string>) => void;
  dispose: () => void;
};

export function mountSearchableSelectPopover(
  options: SearchableSelectPopoverOptions,
): SearchableSelectPopoverHandle {
  let opts = [...options.options];
  let selected = new Set(options.selected);
  let query = "";

  const popover = document.createElement("div");
  popover.className = ["orbita-searchable-select scroll-slim motion-popover", options.className].filter(Boolean).join(" ");

  const searchWrap = document.createElement("div");
  searchWrap.className = "orbita-searchable-select-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "orbita-searchable-select-input";
  searchInput.placeholder = options.placeholder ?? "搜索…";
  searchInput.setAttribute("autocomplete", "off");
  searchWrap.appendChild(searchInput);

  const list = document.createElement("div");
  list.className = "orbita-searchable-select-list";
  list.setAttribute("role", "listbox");
  if (options.maxHeight) list.style.maxHeight = `${options.maxHeight}px`;

  popover.append(searchWrap, list);

  const portal = mountPopoverPortal({
    anchor: options.anchor,
    popover,
    onOpenChange: (open) => {
      if (!open) options.onClose?.();
    },
  });

  function filtered(): SearchableSelectOption[] {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }

  function paint(): void {
    activeIndex = -1;
    const items = filtered();
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "orbita-searchable-select-empty";
      empty.textContent = options.emptyLabel ?? "无匹配项";
      list.appendChild(empty);
      return;
    }
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "orbita-searchable-select-option";
      btn.setAttribute("role", "option");
      btn.dataset.value = item.value;
      const isSelected = selected.has(item.value);
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-selected", String(isSelected));
      const label = document.createElement("span");
      label.className = "orbita-searchable-select-option-label";
      label.textContent = item.label;
      btn.appendChild(label);
      if (item.sublabel) {
        const sub = document.createElement("span");
        sub.className = "orbita-searchable-select-option-sub";
        sub.textContent = item.sublabel;
        btn.appendChild(sub);
      }
      btn.addEventListener("click", () => {
        if (options.multiple) {
          if (selected.has(item.value)) selected.delete(item.value);
          else selected.add(item.value);
        } else {
          selected = new Set([item.value]);
          void portal.close();
        }
        options.onChange(new Set(selected));
        paint();
      });
      list.appendChild(btn);
    }
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    paint();
  });

  let activeIndex = -1;

  const optionButtons = (): HTMLButtonElement[] =>
    [...list.querySelectorAll<HTMLButtonElement>(".orbita-searchable-select-option")];

  const focusOption = (index: number): void => {
    const buttons = optionButtons();
    if (!buttons.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[activeIndex]?.focus();
  };

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      void portal.close();
      return;
    }
    const buttons = optionButtons();
    if (!buttons.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusOption(activeIndex < 0 ? 0 : activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusOption(activeIndex < 0 ? buttons.length - 1 : activeIndex - 1);
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      buttons[activeIndex]?.click();
    }
  });

  return {
    open: async () => {
      query = "";
      searchInput.value = "";
      paint();
      await portal.open();
      searchInput.focus();
    },
    close: () => portal.close(),
    isOpen: () => portal.isOpen(),
    setOptions: (next) => {
      opts = [...next];
      paint();
    },
    setSelected: (next) => {
      selected = new Set(next);
      paint();
    },
    dispose: () => portal.dispose(),
  };
}
