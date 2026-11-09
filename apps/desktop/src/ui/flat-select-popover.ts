import "./choice-control.css";
import "./flat-select-popover.css";
import "./decoupled-picker.css";
import "./option-hint.css";
import { setTriStateMarker, type TriState } from "./choice-control";
import { mountPopoverPortal, type PopoverPortalHandle } from "./popover-portal";

export type FlatSelectOption = {
  value: string;
  label: string;
  /** Optional visual glyph. Cloned into the option so the caller retains ownership. */
  icon?: SVGElement;
  /** Caller-mounted heading immediately before this option, without a divider. */
  title?: HTMLElement;
  disabled?: boolean;
  danger?: boolean;
  children?: FlatSelectOption[];
  /** Caller-mounted control. Shown under this row's flyout commands. */
  submenu?: HTMLElement;
  /** Caller-mounted note. Shown under this row, aligned with its label. */
  hint?: HTMLElement;
};

export type FlatSelectSection = {
  options: FlatSelectOption[];
  /** Caller-mounted heading, placed under this section's divider. */
  title?: HTMLElement;
};

export type FlatSelectPopoverOptions = {
  anchor: HTMLElement;
  options: FlatSelectOption[];
  selected: ReadonlySet<string>;
  multiple: boolean;
  search: boolean;
  /** Action rows share the menu frame. No select fill and no check. */
  menu?: boolean;
  /** Render a compact glyph grid without visible labels; labels remain searchable and accessible. */
  iconOnly?: boolean;
  sections?: FlatSelectSection[];
  /** Search on the first flyout only. Empty query keeps the nested tree; a query flattens hits at every depth. */
  submenuSearch?: boolean;
  /** Optional observer for wrapper controls; default selection-only callers are unchanged. */
  onOpenChange?: (open: boolean) => void;
  onChange: (selected: Set<string>) => void;
};

export type FlatSelectPopoverHandle = {
  open: () => Promise<void>;
  close: () => Promise<void>;
  isOpen: () => boolean;
  setSelected: (selected: ReadonlySet<string>) => void;
  setOptionLabel: (value: string, label: string) => void;
  dispose: () => void;
};

function hasTree(options: FlatSelectPopoverOptions): boolean {
  if (options.sections?.length) return true;
  return options.options.some(
    (o) => (o.children?.length ?? 0) > 0 || !!o.title || !!o.submenu,
  );
}

function rootSections(options: FlatSelectPopoverOptions): FlatSelectSection[] {
  if (options.sections?.length) return options.sections;
  return [{ options: options.options }];
}

function labelMatchesQuery(item: FlatSelectOption, q: string, labelFor: (item: FlatSelectOption) => string): boolean {
  return labelFor(item).toLowerCase().includes(q);
}

type QueryHit = {
  item: FlatSelectOption;
  ancestors: string[];
};

function collectQueryHits(
  items: FlatSelectOption[],
  q: string,
  labelFor: (item: FlatSelectOption) => string,
): QueryHit[] {
  const hits: QueryHit[] = [];
  const walk = (item: FlatSelectOption, ancestors: string[]): void => {
    if (labelMatchesQuery(item, q, labelFor)) hits.push({ item, ancestors });
    const next = ancestors.concat(labelFor(item));
    item.children?.forEach((child) => walk(child, next));
  };
  items.forEach((item) => walk(item, []));
  return hits;
}

/** Same mark as the date picker's year buttons: U+203A twice, not ASCII ">". */
const PATH_MARK = "\u203A\u203A";

function ancestorHint(ancestors: string[]): HTMLDivElement | undefined {
  if (!ancestors.length) return undefined;
  const hint = document.createElement("div");
  hint.className = "orbita-option-hint";
  hint.textContent = ancestors.join(` ${PATH_MARK} `);
  return hint;
}

function isBranch(item: FlatSelectOption): boolean {
  return Boolean(item.children?.length || item.submenu);
}

type FlatSelectSubmenuLayer = {
  portal: PopoverPortalHandle;
  popover: HTMLElement;
  items: FlatSelectOption[];
  parentBtn: HTMLButtonElement;
};

function updateVisibleOptionLabel(popover: HTMLElement, value: string, label: string): void {
  popover.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option").forEach((button) => {
    if (button.dataset.value !== value) return;
    button.setAttribute("aria-label", label);
    const text = button.querySelector<HTMLElement>(".orbita-flat-select-label");
    if (text) text.textContent = label;
  });
}

export function mountFlatSelectPopover(
  options: FlatSelectPopoverOptions,
): FlatSelectPopoverHandle {
  if (hasTree(options)) {
    return mountTreeFlatSelectPopover(options);
  }
  return mountFlatFlatSelectPopover(options);
}

function mountFlatFlatSelectPopover(
  options: FlatSelectPopoverOptions,
): FlatSelectPopoverHandle {
  let opts = [...options.options];
  let selected = new Set(options.selected);
  const labelOverrides = new Map<string, string>();
  const labelFor = (item: FlatSelectOption) => labelOverrides.get(item.value) ?? item.label;
  let query = "";
  let activeIndex = -1;

  const popover = document.createElement("div");
  popover.className = "orbita-flat-select orbita-standard-popover scroll-slim motion-popover";
  if (options.iconOnly) popover.classList.add("orbita-flat-select-icon-only");

  let searchWrap: HTMLDivElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  if (options.search) {
    searchWrap = document.createElement("div");
    searchWrap.className = "orbita-flat-select-section orbita-flat-select-search";
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.size = 1;
    searchInput.className = "orbita-flat-select-input";
    searchInput.placeholder = "搜索...";
    searchInput.setAttribute("autocomplete", "off");
    searchWrap.appendChild(searchInput);
    popover.appendChild(searchWrap);
  }

  const list = document.createElement("div");
  const mode = options.menu ? "menu" : options.multiple ? "multiple" : "single";
  list.className = `orbita-flat-select-section orbita-flat-select-list orbita-flat-select-mode-${mode}`;
  list.setAttribute("role", "listbox");
  list.tabIndex = -1;
  popover.appendChild(list);

  const portal = mountPopoverPortal({
    anchor: options.anchor,
    popover,
    onOpenChange: options.onOpenChange,
  });

  function filtered(): FlatSelectOption[] {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => labelFor(o).toLowerCase().includes(q));
  }

  function optionButtons(): HTMLButtonElement[] {
    return [...list.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")];
  }

  function focusOption(index: number): void {
    const buttons = optionButtons();
    if (!buttons.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[activeIndex]?.focus();
  }

  function selectValue(value: string): void {
    if (options.menu) {
      options.onChange(new Set([value]));
      void portal.close();
      return;
    }
    if (options.multiple) {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
    } else {
      selected = new Set([value]);
      options.onChange(new Set(selected));
      paint();
      void portal.close();
      return;
    }
    options.onChange(new Set(selected));
    paint();
  }

  function paint(): void {
    activeIndex = -1;
    const items = filtered();
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "orbita-flat-select-empty";
      empty.textContent = "无匹配";
      list.appendChild(empty);
      return;
    }
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "orbita-flat-select-option";
      btn.setAttribute("role", "option");
      btn.dataset.value = item.value;
      btn.setAttribute("aria-label", labelFor(item));
      if (item.disabled) btn.disabled = true;
      if (item.danger) btn.classList.add("is-danger");

      const isSelected = !options.menu && selected.has(item.value);
      btn.setAttribute("aria-selected", String(isSelected));

      if (options.multiple) {
        const mark = document.createElement("span");
        mark.className = "orbita-choice-checkbox";
        mark.setAttribute("aria-hidden", "true");
        if (isSelected) mark.classList.add("is-checked");
        btn.appendChild(mark);
      } else if (isSelected) {
        btn.classList.add("is-selected");
      }

      if (options.iconOnly) {
        if (item.icon) {
          const icon = item.icon.cloneNode(true) as SVGElement;
          icon.classList.add("orbita-flat-select-icon");
          icon.setAttribute("aria-hidden", "true");
          btn.appendChild(icon);
        }
      } else {
        const label = document.createElement("span");
        label.className = "orbita-flat-select-label";
        label.textContent = labelFor(item);
        btn.appendChild(label);
      }

      btn.addEventListener("click", () => {
        if (item.disabled) return;
        selectValue(item.value);
      });

      list.appendChild(btn);
    }
  }

  searchInput?.addEventListener("input", () => {
    query = searchInput!.value;
    paint();
  });

  searchInput?.addEventListener("keydown", (e) => {
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

  list.addEventListener("keydown", (e) => {
    // With search enabled, the input owns its own key handling. Once an option
    // receives focus, keep the same list navigation available from that button.
    if (options.search && !(e.target as HTMLElement).closest(".orbita-flat-select-option")) return;
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
      if (searchInput) searchInput.value = "";
      paint();
      await portal.open();
      if (!portal.isOpen()) return;
      if (searchInput) searchInput.focus();
      else list.focus();
    },
    close: () => portal.close(),
    isOpen: () => portal.isOpen(),
    setSelected: (next) => {
      selected = new Set(next);
      const focusedValue = list.contains(document.activeElement)
        ? (document.activeElement as HTMLElement).dataset.value
        : undefined;
      paint();
      if (focusedValue) {
        const index = optionButtons().findIndex((button) => button.dataset.value === focusedValue);
        if (index >= 0) focusOption(index);
      }
    },
    setOptionLabel: (value, label) => {
      labelOverrides.set(value, label);
      updateVisibleOptionLabel(popover, value, label);
    },
    dispose: () => portal.dispose(),
  };
}

function mountTreeFlatSelectPopover(
  options: FlatSelectPopoverOptions,
): FlatSelectPopoverHandle {
  let selected = new Set(options.selected);
  const labelOverrides = new Map<string, string>();
  const labelFor = (item: FlatSelectOption) => labelOverrides.get(item.value) ?? item.label;
  let rootQuery = "";
  let activeIndex = -1;

  const mode = options.menu ? "menu" : options.multiple ? "multiple" : "single";

  const popover = document.createElement("div");
  popover.className = "orbita-flat-select orbita-standard-popover scroll-slim motion-popover";

  let searchWrap: HTMLDivElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  if (options.search) {
    searchWrap = document.createElement("div");
    searchWrap.className = "orbita-flat-select-section orbita-flat-select-search";
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.size = 1;
    searchInput.className = "orbita-flat-select-input";
    searchInput.placeholder = "搜索...";
    searchInput.setAttribute("autocomplete", "off");
    searchWrap.appendChild(searchInput);
    popover.appendChild(searchWrap);
  }

  const layers: FlatSelectSubmenuLayer[] = [];

  const portal = mountPopoverPortal({
    anchor: options.anchor,
    popover,
    onOpenChange: (open) => {
      if (!open) closeSubmenu();
      options.onOpenChange?.(open);
    },
  });

  function closeLayersFrom(index: number): void {
    while (layers.length > index) {
      const layer = layers.pop()!;
      layer.parentBtn.classList.remove("is-open");
      void layer.portal.close();
      layer.portal.dispose();
    }
  }

  function closeSubmenu(): void {
    closeLayersFrom(0);
  }

  async function closeAll(): Promise<void> {
    closeSubmenu();
    await portal.close();
  }

  function selectLeaf(value: string): void {
    if (options.menu) {
      options.onChange(new Set([value]));
      void closeAll();
      return;
    }
    if (options.multiple) {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      options.onChange(new Set(selected));
      paintRoot();
      paintOpenLayers();
      return;
    }
    selected = new Set([value]);
    options.onChange(new Set(selected));
    void closeAll();
  }

  function leavesOf(item: FlatSelectOption): FlatSelectOption[] {
    if (!item.children?.length) return [item];
    return item.children.flatMap(leavesOf);
  }

  function branchState(item: FlatSelectOption): TriState {
    const leaves = leavesOf(item);
    let picked = 0;
    for (const leaf of leaves) if (selected.has(leaf.value)) picked += 1;
    if (picked === 0) return "unchecked";
    if (picked === leaves.length) return "checked";
    return "indeterminate";
  }

  function appendCheckbox(btn: HTMLButtonElement, state: TriState): void {
    const mark = document.createElement("span");
    mark.className = "orbita-choice-checkbox";
    mark.setAttribute("aria-hidden", "true");
    setTriStateMarker(mark, state);
    btn.appendChild(mark);
  }

  function toggleBranch(item: FlatSelectOption): void {
    const leaves = leavesOf(item);
    const allOn = leaves.every((leaf) => selected.has(leaf.value));
    for (const leaf of leaves) {
      if (allOn) selected.delete(leaf.value);
      else selected.add(leaf.value);
    }
    options.onChange(new Set(selected));
    paintRoot();
    paintOpenLayers();
  }

  function appendArrow(btn: HTMLButtonElement): void {
    const arrow = document.createElement("span");
    arrow.className = "orbita-flat-select-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    btn.appendChild(arrow);
  }

  function renderLeaf(
    item: FlatSelectOption,
    listEl: HTMLElement,
    listDepth: number,
    pathHint?: HTMLElement,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "orbita-flat-select-option";
    btn.setAttribute("role", "option");
    btn.dataset.value = item.value;
    if (item.disabled) btn.disabled = true;
    if (item.danger) btn.classList.add("is-danger");

    const isSelected = !options.menu && selected.has(item.value);
    btn.setAttribute("aria-selected", String(isSelected));

    if (options.multiple) {
      appendCheckbox(btn, isSelected ? "checked" : "unchecked");
    } else if (isSelected) {
      btn.classList.add("is-selected");
    }

    const label = document.createElement("span");
    label.className = "orbita-flat-select-label";
    label.textContent = labelFor(item);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      if (item.disabled) return;
      selectLeaf(item.value);
    });
    btn.addEventListener("pointerenter", () => {
      closeLayersFrom(listDepth + 1);
    });

    placeOption(listEl, btn, pathHint ? { ...item, hint: pathHint } : item);
    return btn;
  }

  function placeOption(listEl: HTMLElement, btn: HTMLButtonElement, item: FlatSelectOption): void {
    if (item.title) listEl.appendChild(item.title);
    if (item.hint) {
      const main = document.createElement("span");
      main.className = "orbita-flat-select-option-main";
      while (btn.firstChild) main.appendChild(btn.firstChild);
      if (!item.hint.id) item.hint.id = `orbita-option-hint-${btn.dataset.value ?? "row"}`;
      btn.setAttribute("aria-describedby", item.hint.id);
      btn.classList.add("has-hint");
      btn.append(main, item.hint);
    }
    listEl.appendChild(btn);
  }

  function renderParent(
    item: FlatSelectOption,
    listEl: HTMLElement,
    openDepth: number,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "orbita-flat-select-option has-children";
    btn.setAttribute("role", "option");
    btn.dataset.value = item.value;
    btn.setAttribute("aria-haspopup", "true");
    if (item.disabled) btn.disabled = true;
    if (item.danger) btn.classList.add("is-danger");

    if (options.multiple) appendCheckbox(btn, branchState(item));

    const label = document.createElement("span");
    label.className = "orbita-flat-select-label";
    label.textContent = labelFor(item);
    btn.appendChild(label);
    appendArrow(btn);

    btn.addEventListener("pointerenter", () => {
      if (item.disabled) return;
      const open = layers[openDepth];
      if (open?.parentBtn.dataset.value === item.value && open.portal.isOpen()) return;
      openSubmenu(btn, item, openDepth);
    });

    btn.addEventListener("click", () => {
      if (item.disabled) return;
      if (options.multiple) toggleBranch(item);
      else openSubmenu(btn, item, openDepth, true);
    });

    placeOption(listEl, btn, item);
    return btn;
  }

  function paintLayer(layer: FlatSelectSubmenuLayer, depth: number): void {
    const subList = layer.popover.querySelector<HTMLElement>(".orbita-flat-select-list");
    const subSearchInput = layer.popover.querySelector<HTMLInputElement>(".orbita-flat-select-input");
    if (!subList) return;

    const withSearch = (options.submenuSearch ?? false) && depth === 0;
    const q = withSearch ? (subSearchInput?.value ?? "").trim().toLowerCase() : "";
    subList.replaceChildren();
    // Empty query keeps the next-level tree; a query flattens matches at every depth.
    if (q) {
      const hits = collectQueryHits(layer.items, q, labelFor);
      if (!hits.length) {
        const empty = document.createElement("div");
        empty.className = "orbita-flat-select-empty";
        empty.textContent = "无匹配";
        subList.appendChild(empty);
        return;
      }
      for (const hit of hits) {
        renderLeaf(hit.item, subList, depth, ancestorHint(hit.ancestors));
      }
      return;
    }

    if (!layer.items.length) {
      const empty = document.createElement("div");
      empty.className = "orbita-flat-select-empty";
      empty.textContent = "无匹配";
      subList.appendChild(empty);
      return;
    }

    for (const entry of layer.items) {
      if (isBranch(entry)) renderParent(entry, subList, depth + 1);
      else renderLeaf(entry, subList, depth);
    }
  }

  function paintOpenLayers(): void {
    layers.forEach((layer, depth) => paintLayer(layer, depth));
    rebindLayerParents();
  }

  function rebindLayerParents(): void {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      const scope = i === 0 ? popover : layers[i - 1]!.popover;
      const next = scope.querySelector<HTMLButtonElement>(
        `.orbita-flat-select-option[data-value="${CSS.escape(layer.parentBtn.dataset.value ?? "")}"]`,
      );
      if (!next) continue;
      next.classList.add("is-open");
      layer.parentBtn = next;
    }
  }

  function openSubmenu(
    rowBtn: HTMLButtonElement,
    item: FlatSelectOption,
    depth: number,
    focusContent = false,
  ): void {
    const existing = layers[depth];
    if (existing?.parentBtn.dataset.value === item.value && existing.portal.isOpen()) return;
    closeLayersFrom(depth);
    rowBtn.classList.add("is-open");

    const withSearch = (options.submenuSearch ?? false) && depth === 0;
    const submenuChildren = item.children ?? [];
    const submenuPopover = document.createElement("div");
    submenuPopover.className = "orbita-flat-select orbita-standard-popover scroll-slim motion-popover";

    if (withSearch) {
      const subSearchWrap = document.createElement("div");
      subSearchWrap.className = "orbita-flat-select-section orbita-flat-select-search";
      const subSearchInput = document.createElement("input");
      subSearchInput.type = "search";
      subSearchInput.size = 1;
      subSearchInput.className = "orbita-flat-select-input";
      subSearchInput.placeholder = "搜索...";
      subSearchInput.setAttribute("autocomplete", "off");
      subSearchWrap.appendChild(subSearchInput);
      submenuPopover.appendChild(subSearchWrap);
      subSearchInput.addEventListener("input", () => {
        closeLayersFrom(depth + 1);
        const current = layers[depth];
        if (current) paintLayer(current, depth);
      });
      subSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          const parent = layers[depth]?.parentBtn;
          closeLayersFrom(depth);
          parent?.focus();
        }
      });
    }

    if (submenuChildren.length || !item.submenu) {
      const subList = document.createElement("div");
      subList.className = `orbita-flat-select-section orbita-flat-select-list orbita-flat-select-mode-${mode}`;
      subList.setAttribute("role", "listbox");
      submenuPopover.appendChild(subList);
    }
    if (item.submenu) {
      const slot = document.createElement("div");
      slot.className = "orbita-flat-select-section orbita-flat-select-slot";
      slot.appendChild(item.submenu);
      submenuPopover.appendChild(slot);
    }

    const submenuPortal = mountPopoverPortal({
      anchor: rowBtn,
      popover: submenuPopover,
      placement: "right",
    });

    const layer: FlatSelectSubmenuLayer = {
      portal: submenuPortal,
      popover: submenuPopover,
      items: submenuChildren,
      parentBtn: rowBtn,
    };
    layers.push(layer);
    paintLayer(layer, depth);
    submenuPopover.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const parent = layer.parentBtn;
        closeLayersFrom(depth);
        parent.focus();
        return;
      }
      if (target.closest(".orbita-flat-select-slot")) return;
      const buttons = [...submenuPopover.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option:not(:disabled)")];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const parent = layer.parentBtn;
        closeLayersFrom(depth);
        parent.focus();
      } else if (e.key === "ArrowRight" && current >= 0 && buttons[current]?.classList.contains("has-children")) {
        e.preventDefault();
        buttons[current]?.click();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!buttons.length) return;
        e.preventDefault();
        const next = current < 0 ? (e.key === "ArrowDown" ? 0 : buttons.length - 1)
          : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        const nextBtn = buttons[next];
        nextBtn?.focus();
        if (!nextBtn?.classList.contains("has-children") || layers[depth + 1]?.parentBtn !== nextBtn) {
          closeLayersFrom(depth + 1);
        }
      } else if (e.key === "Enter" && current >= 0) {
        e.preventDefault();
        buttons[current]?.click();
      }
    });
    void submenuPortal.open().then(() => {
      if (layers[depth] !== layer) return;
      const input = submenuPopover.querySelector<HTMLInputElement>(".orbita-flat-select-input");
      if (input && (focusContent || withSearch)) input.focus();
      else if (focusContent) {
        (submenuPopover.querySelector<HTMLElement>(".orbita-flat-select-option:not(:disabled), .orbita-flat-select-slot input") ?? submenuPopover)?.focus();
      }
    });
  }

  function paintRoot(): void {
    activeIndex = -1;
    for (const child of [...popover.children]) {
      if (child !== searchWrap) child.remove();
    }

    const q = rootQuery.trim().toLowerCase();
    // Root search is the searchable cascading menu's first level. Empty query keeps
    // the tree; a query flattens hits and shows the ancestor path under each row.
    // Deeper flyouts stay search-free unless submenuSearch.
    const sections = rootSections(options);

    for (const section of sections) {
      const list = document.createElement("div");
      list.className = `orbita-flat-select-list orbita-flat-select-mode-${mode}`;
      list.setAttribute("role", "listbox");
      list.tabIndex = -1;

      if (q) {
        const hits = collectQueryHits(section.options, q, labelFor);
        if (!hits.length) {
          const empty = document.createElement("div");
          empty.className = "orbita-flat-select-empty";
          empty.textContent = "无匹配";
          list.appendChild(empty);
        } else {
          for (const hit of hits) {
            renderLeaf(hit.item, list, -1, ancestorHint(hit.ancestors));
          }
        }
      } else if (!section.options.length) {
        const empty = document.createElement("div");
        empty.className = "orbita-flat-select-empty";
        empty.textContent = "无匹配";
        list.appendChild(empty);
      } else {
        for (const item of section.options) {
          if (isBranch(item)) renderParent(item, list, 0);
          else renderLeaf(item, list, -1);
        }
      }

      const block = document.createElement("div");
      block.className = "orbita-flat-select-section";
      if (section.title) block.appendChild(section.title);
      block.appendChild(list);
      popover.appendChild(block);
    }

    rebindLayerParents();
  }

  function rootOptionButtons(): HTMLButtonElement[] {
    return [...popover.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option:not(:disabled)")];
  }

  function focusRootOption(index: number): void {
    const buttons = rootOptionButtons();
    if (!buttons.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[activeIndex]?.focus();
  }

  searchInput?.addEventListener("input", () => {
    rootQuery = searchInput!.value;
    closeSubmenu();
    paintRoot();
  });

  popover.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void closeAll();
      return;
    }
    const buttons = rootOptionButtons();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      closeSubmenu();
      focusRootOption(current < 0 ? 0 : (current + 1) % buttons.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      closeSubmenu();
      focusRootOption(current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length);
      return;
    }
    if (e.key === "ArrowRight" && current >= 0 && buttons[current]?.classList.contains("has-children")) {
      e.preventDefault();
      buttons[current]?.click();
      return;
    }
    if (e.key === "Enter" && current >= 0) {
      e.preventDefault();
      buttons[current]?.click();
    }
  });

  return {
    open: async () => {
      rootQuery = "";
      if (searchInput) searchInput.value = "";
      closeSubmenu();
      paintRoot();
      await portal.open();
      if (!portal.isOpen()) return;
      if (searchInput) searchInput.focus();
      else popover.querySelector<HTMLElement>(".orbita-flat-select-list")?.focus();
    },
    close: async () => {
      closeSubmenu();
      await portal.close();
    },
    isOpen: () => portal.isOpen(),
    setSelected: (next) => {
      selected = new Set(next);
      const active = document.activeElement as HTMLElement | null;
      const focusedRoot = active ? popover.contains(active) : false;
      const focusedLayer = active ? layers.findIndex((layer) => layer.popover.contains(active)) : -1;
      const focusedValue = active?.dataset.value;
      const focusedSearchDepth = active?.matches(".orbita-flat-select-input") ? focusedLayer : -1;
      paintRoot();
      paintOpenLayers();
      if (focusedSearchDepth >= 0) {
        layers[focusedSearchDepth]?.popover.querySelector<HTMLInputElement>(".orbita-flat-select-input")?.focus();
      } else if (focusedValue && (focusedRoot || focusedLayer >= 0)) {
        const scope = focusedLayer >= 0 ? layers[focusedLayer]?.popover : popover;
        const button = [...(scope?.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option") ?? [])]
          .find((candidate) => candidate.dataset.value === focusedValue);
        button?.focus();
      }
    },
    setOptionLabel: (value, label) => {
      labelOverrides.set(value, label);
      updateVisibleOptionLabel(popover, value, label);
      for (const layer of layers) updateVisibleOptionLabel(layer.popover, value, label);
    },
    dispose: () => {
      closeSubmenu();
      portal.dispose();
    },
  };
}
