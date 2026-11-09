import "./cascading-menu-popover.css";
import { mountPopoverPortal } from "./popover-portal";

export type CascadingSubmenuPanel = {
  kind: "search-list";
  options: Array<{ value: string; label: string; sublabel?: string }>;
  selected: string;
  placeholder?: string;
  emptyLabel?: string;
  maxHeight?: number;
  onSelect: (value: string) => void;
};

export type CascadingMenuRow =
  | {
      kind: "submenu";
      id: string;
      label: string;
      value?: string;
      disabled?: boolean;
      panel: CascadingSubmenuPanel;
    }
  | { kind: "action"; id: string; label: string; value?: string; disabled?: boolean };

export type CascadingMenuPopoverHandle = {
  open: () => Promise<void>;
  close: () => Promise<void>;
  isOpen: () => boolean;
  setItems: (items: CascadingMenuRow[], footerItems?: CascadingMenuRow[]) => void;
  dispose: () => void;
};

export function mountCascadingMenuPopover(options: {
  anchor: HTMLElement;
  items: CascadingMenuRow[];
  footerItems?: CascadingMenuRow[];
  onAction?: (id: string) => void;
  onClose?: () => void;
  className?: string;
}): CascadingMenuPopoverHandle {
  let items = [...options.items];
  let footerItems = options.footerItems ? [...options.footerItems] : [];
  let openSubmenuId: string | null = null;
  let rootActiveIndex = -1;

  const popover = document.createElement("div");
  popover.className = `orbita-cascading-menu scroll-slim motion-popover${options.className ? ` ${options.className}` : ""}`;

  const rootList = document.createElement("div");
  rootList.className = "orbita-cascading-menu-root";
  rootList.setAttribute("role", "menu");

  const footerEl = document.createElement("div");
  footerEl.className = "orbita-cascading-menu-footer";

  const submenuPanel = document.createElement("div");
  submenuPanel.className = "orbita-cascading-menu-submenu scroll-slim motion-popover";
  submenuPanel.hidden = true;

  const submenuSearchWrap = document.createElement("div");
  submenuSearchWrap.className = "orbita-cascading-menu-search";
  const submenuSearch = document.createElement("input");
  submenuSearch.type = "search";
  submenuSearch.className = "orbita-cascading-menu-search-input";
  submenuSearch.setAttribute("autocomplete", "off");
  submenuSearchWrap.appendChild(submenuSearch);

  const submenuList = document.createElement("div");
  submenuList.className = "orbita-cascading-menu-submenu-list";
  submenuList.setAttribute("role", "listbox");

  submenuPanel.append(submenuSearchWrap, submenuList);
  popover.append(rootList, footerEl);

  let submenuQuery = "";
  let submenuActiveIndex = -1;
  let currentSubmenuPanel: CascadingSubmenuPanel | null = null;

  const portal = mountPopoverPortal({
    anchor: options.anchor,
    popover,
    onOpenChange: (open) => {
      if (!open) {
        closeSubmenu();
        options.onClose?.();
      }
    },
  });

  let submenuPortal = mountPopoverPortal({
    anchor: popover,
    popover: submenuPanel,
  });

  function allRows(): CascadingMenuRow[] {
    return [...items, ...footerItems];
  }

  function rowButtons(scope: ParentNode): HTMLButtonElement[] {
    return [...scope.querySelectorAll<HTMLButtonElement>(".orbita-cascading-menu-row")];
  }

  function closeSubmenu(): void {
    openSubmenuId = null;
    currentSubmenuPanel = null;
    submenuQuery = "";
    submenuActiveIndex = -1;
    submenuSearch.value = "";
    submenuPanel.hidden = true;
    void submenuPortal.close();
    submenuPortal.dispose();
    submenuPortal = mountPopoverPortal({ anchor: popover, popover: submenuPanel });
  }

  function filteredSubmenuOptions(): Array<{ value: string; label: string; sublabel?: string }> {
    if (!currentSubmenuPanel) return [];
    const q = submenuQuery.trim().toLowerCase();
    if (!q) return currentSubmenuPanel.options;
    return currentSubmenuPanel.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }

  function paintSubmenu(): void {
    submenuActiveIndex = -1;
    submenuList.replaceChildren();
    const panel = currentSubmenuPanel;
    if (!panel) return;
    if (panel.maxHeight) submenuList.style.maxHeight = `${panel.maxHeight}px`;
    const opts = filteredSubmenuOptions();
    if (!opts.length) {
      const empty = document.createElement("div");
      empty.className = "orbita-cascading-menu-empty";
      empty.textContent = panel.emptyLabel ?? "无匹配项";
      submenuList.appendChild(empty);
      return;
    }
    for (const item of opts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "orbita-cascading-menu-submenu-option";
      btn.setAttribute("role", "option");
      btn.dataset.value = item.value;
      const isSelected = item.value === panel.selected;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-selected", String(isSelected));
      const label = document.createElement("span");
      label.className = "orbita-cascading-menu-submenu-label";
      label.textContent = item.label;
      btn.appendChild(label);
      if (item.sublabel) {
        const sub = document.createElement("span");
        sub.className = "orbita-cascading-menu-submenu-sub";
        sub.textContent = item.sublabel;
        btn.appendChild(sub);
      }
      btn.addEventListener("click", () => {
        panel.onSelect(item.value);
        void handle.close();
      });
      submenuList.appendChild(btn);
    }
  }

  function openSubmenu(row: CascadingMenuRow & { kind: "submenu" }, rowEl: HTMLElement): void {
    if (row.disabled) return;
    openSubmenuId = row.id;
    currentSubmenuPanel = row.panel;
    submenuSearch.placeholder = row.panel.placeholder ?? "搜索…";
    submenuQuery = "";
    submenuSearch.value = "";
    paintSubmenu();
    submenuPanel.hidden = false;
    submenuPortal.dispose();
    submenuPortal = mountPopoverPortal({
      anchor: rowEl,
      popover: submenuPanel,
      onOpenChange: (open) => {
        if (!open && openSubmenuId === row.id) closeSubmenu();
      },
    });
    void submenuPortal.open().then(() => submenuSearch.focus());
  }

  function paintRow(row: CascadingMenuRow, isFooter = false): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "orbita-cascading-menu-row";
    btn.dataset.id = row.id;
    btn.setAttribute("role", "menuitem");
    if (row.disabled) btn.disabled = true;
    if (row.kind === "submenu") {
      btn.classList.add("has-submenu");
      btn.setAttribute("aria-haspopup", "true");
      if (openSubmenuId === row.id) btn.classList.add("is-open");
    }
    const label = document.createElement("span");
    label.className = "orbita-cascading-menu-row-label";
    label.textContent = row.label;
    btn.appendChild(label);
    if (row.value) {
      const value = document.createElement("span");
      value.className = "orbita-cascading-menu-row-value";
      value.textContent = row.value;
      btn.appendChild(value);
    }
    if (row.kind === "submenu") {
      const chevron = document.createElement("span");
      chevron.className = "orbita-cascading-menu-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";
      btn.appendChild(chevron);
      btn.addEventListener("click", () => {
        if (openSubmenuId === row.id) {
          closeSubmenu();
          return;
        }
        closeSubmenu();
        openSubmenu(row, btn);
      });
    } else {
      btn.addEventListener("click", () => {
        if (row.disabled) return;
        options.onAction?.(row.id);
        void handle.close();
      });
    }
    if (isFooter) btn.classList.add("is-footer");
    return btn;
  }

  function paint(): void {
    rootActiveIndex = -1;
    rootList.replaceChildren();
    for (const row of items) {
      rootList.appendChild(paintRow(row));
    }
    footerEl.replaceChildren();
    for (const row of footerItems) {
      footerEl.appendChild(paintRow(row, true));
    }
  }

  submenuSearch.addEventListener("input", () => {
    submenuQuery = submenuSearch.value;
    paintSubmenu();
  });

  const submenuOptionButtons = (): HTMLButtonElement[] =>
    [...submenuList.querySelectorAll<HTMLButtonElement>(".orbita-cascading-menu-submenu-option")];

  const focusSubmenuOption = (index: number): void => {
    const buttons = submenuOptionButtons();
    if (!buttons.length) {
      submenuActiveIndex = -1;
      return;
    }
    submenuActiveIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[submenuActiveIndex]?.focus();
  };

  submenuSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      const parentId = openSubmenuId;
      closeSubmenu();
      const rowBtn = parentId
        ? rootList.querySelector<HTMLButtonElement>(`[data-id="${parentId}"]`)
        : null;
      rowBtn?.focus();
      return;
    }
    const buttons = submenuOptionButtons();
    if (!buttons.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusSubmenuOption(submenuActiveIndex < 0 ? 0 : submenuActiveIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusSubmenuOption(submenuActiveIndex < 0 ? buttons.length - 1 : submenuActiveIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const idx = submenuActiveIndex >= 0 ? submenuActiveIndex : 0;
      buttons[idx]?.click();
    }
  });

  const focusRootRow = (index: number): void => {
    const buttons = rowButtons(rootList);
    if (!buttons.length) {
      rootActiveIndex = -1;
      return;
    }
    rootActiveIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[rootActiveIndex]?.focus();
  };

  popover.addEventListener("keydown", (e) => {
    if (currentSubmenuPanel && submenuPanel.contains(e.target as Node)) return;
    if (e.key === "Escape") {
      if (openSubmenuId) {
        e.stopPropagation();
        e.preventDefault();
        const parentId = openSubmenuId;
        closeSubmenu();
        rootList.querySelector<HTMLButtonElement>(`[data-id="${parentId}"]`)?.focus();
        return;
      }
      return;
    }
    const buttons = rowButtons(rootList);
    if (!buttons.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRootRow(rootActiveIndex < 0 ? 0 : rootActiveIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRootRow(rootActiveIndex < 0 ? buttons.length - 1 : rootActiveIndex - 1);
      return;
    }
    if (e.key === "ArrowRight") {
      const btn = buttons[rootActiveIndex >= 0 ? rootActiveIndex : 0];
      if (btn?.classList.contains("has-submenu")) {
        e.preventDefault();
        btn.click();
      }
      return;
    }
    if (e.key === "Enter" && rootActiveIndex >= 0) {
      e.preventDefault();
      buttons[rootActiveIndex]?.click();
    }
  });

  const handle: CascadingMenuPopoverHandle = {
    open: async () => {
      closeSubmenu();
      paint();
      await portal.open();
      const first = rowButtons(rootList)[0];
      if (first) {
        rootActiveIndex = 0;
        first.focus();
      }
    },
    close: async () => {
      closeSubmenu();
      await portal.close();
    },
    isOpen: () => portal.isOpen(),
    setItems: (next, footer) => {
      items = [...next];
      footerItems = footer ? [...footer] : [];
      paint();
    },
    dispose: () => {
      closeSubmenu();
      submenuPortal.dispose();
      portal.dispose();
    },
  };

  return handle;
}
