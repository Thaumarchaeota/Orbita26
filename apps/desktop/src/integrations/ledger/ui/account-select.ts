import { CHEVRON_SVG } from "../../ai/icons";
import { mountPopoverPortal } from "../../../ui/popover-portal";
import { accountDisplayLabel, accountDisplaySubtitle, getAccountRecords } from "../state/accounts";
import type { AccountGroup, AccountRecord } from "../types";
import { buildAccountForest, type AccountTreeNode } from "../domain/account-tree";
import "./account-select.css";

export type AccountSelectDisplayMode = "default" | "admin";
export type AccountSelectSearchPlacement = "trigger" | "menu";
export type AccountSelectCascadeAlign = "anchor-row" | "top";

export type AccountSelectOptions = {
  groups: AccountGroup[];
  value?: string;
  placeholder?: string;
  displayMode?: AccountSelectDisplayMode;
  searchPlacement?: AccountSelectSearchPlacement;
  cascadeAlign?: AccountSelectCascadeAlign;
  onChange?: (name: string) => void;
  onDismiss?: () => void;
};

export type AccountSelectHandle = {
  getValue: () => string;
  setValue: (name: string) => void;
  setGroups: (groups: AccountGroup[]) => void;
  close: () => Promise<void>;
  dispose: () => void;
  containsTarget: (target: Node | null) => boolean;
  hasPendingQuery: () => boolean;
  isOpen: () => boolean;
  root: HTMLElement;
};

function recordsFor(groups: AccountGroup[]): AccountRecord[] {
  return groups.flatMap((group) => getAccountRecords(group));
}

function selectableRecords(records: AccountRecord[]): AccountRecord[] {
  return records.filter((record) => !records.some((other) => other.name.startsWith(`${record.name}:`)));
}

function friendlyPath(record: AccountRecord): string {
  const path = record.label_path?.filter((part) => part.trim()) ?? [];
  return path.length ? path.join(" › ") : record.name;
}

function hasFriendlyPath(record: AccountRecord): boolean {
  return Boolean(record.label_path?.some((part) => part.trim()));
}

function nodeRecord(node: AccountTreeNode, records: AccountRecord[]): AccountRecord | undefined {
  return records.find((record) => record.name === node.name);
}

const VIEWPORT_MARGIN = 8;
const FLYOUT_GAP = 4;

function positionAnchorFlyout(
  host: HTMLElement,
  parentColumn: HTMLElement,
  anchorNav: HTMLElement,
  flyout: HTMLElement,
): void {
  const hostRect = host.getBoundingClientRect();
  const parentRect = parentColumn.getBoundingClientRect();
  const anchorRect = anchorNav.getBoundingClientRect();
  flyout.style.left = `${Math.round(parentRect.right - hostRect.left + FLYOUT_GAP)}px`;
  let top = anchorRect.top - hostRect.top;
  flyout.style.top = `${Math.round(top)}px`;
  const flyoutRect = flyout.getBoundingClientRect();
  if (flyoutRect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
    top = Math.max(0, top - (flyoutRect.bottom - window.innerHeight + VIEWPORT_MARGIN));
    flyout.style.top = `${Math.round(top)}px`;
  }
  const nextRect = flyout.getBoundingClientRect();
  if (nextRect.right > window.innerWidth - VIEWPORT_MARGIN) {
    const left = parentRect.left - hostRect.left - nextRect.width - FLYOUT_GAP;
    flyout.style.left = `${Math.round(Math.max(0, left))}px`;
  }
}

function layoutAnchorFlyouts(host: HTMLElement, navStack: AccountTreeNode[]): void {
  const root = host.querySelector<HTMLElement>(".orbita-account-select-column-root");
  if (!root) return;
  let parentColumn = root;
  for (let index = 0; index < navStack.length; index++) {
    const flyout = host.children[index + 1] as HTMLElement | undefined;
    const anchorNav = parentColumn.querySelector<HTMLElement>(`[data-nav-id="${navStack[index]!.id}"]`);
    if (!flyout?.classList.contains("orbita-account-select-column-flyout") || !anchorNav) break;
    positionAnchorFlyout(host, parentColumn, anchorNav, flyout);
    parentColumn = flyout;
  }
}

export function mountAccountSelect(
  container: HTMLElement,
  options: AccountSelectOptions,
): AccountSelectHandle {
  const placeholder = options.placeholder ?? "选择账户";
  const displayMode = options.displayMode ?? "default";
  const searchPlacement = options.searchPlacement ?? "menu";
  const cascadeAlign = options.cascadeAlign ?? (searchPlacement === "trigger" ? "anchor-row" : "top");
  let value = options.value ?? "";
  let groups = [...options.groups];
  let records = recordsFor(groups);
  let selectable = selectableRecords(records);
  let forest = buildAccountForest(groups);
  let query = "";
  let navStack: AccountTreeNode[] = [];
  let activeIndex = -1;
  let committedThisOpen = false;

  container.innerHTML = `
    <div class="orbita-account-select orbita-account-select--${displayMode} orbita-account-select--search-${searchPlacement}">
      <div class="orbita-account-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false">
        <span class="orbita-account-select-text">
          <span class="orbita-account-select-label"></span>
          <span class="orbita-account-select-sub" hidden></span>
        </span>
        <input type="search" class="orbita-account-select-trigger-search" placeholder="搜索账户" autocomplete="off" hidden />
        <button type="button" class="orbita-account-select-toggle" tabindex="-1" aria-label="展开账户菜单">
          <span class="orbita-account-select-chevron">${CHEVRON_SVG}</span>
        </button>
      </div>
      <div class="orbita-account-select-menu motion-popover"></div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-account-select")!;
  const trigger = root.querySelector<HTMLElement>(".orbita-account-select-trigger")!;
  const labelEl = root.querySelector<HTMLElement>(".orbita-account-select-label")!;
  const subEl = root.querySelector<HTMLElement>(".orbita-account-select-sub")!;
  const triggerSearch = root.querySelector<HTMLInputElement>(".orbita-account-select-trigger-search")!;
  const toggleBtn = root.querySelector<HTMLButtonElement>(".orbita-account-select-toggle")!;
  const menu = root.querySelector<HTMLElement>(".orbita-account-select-menu")!;

  const syncTriggerOpenUi = (open: boolean) => {
    trigger.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    if (searchPlacement !== "trigger") return;
    labelEl.hidden = open;
    subEl.hidden = open || !subEl.textContent;
    triggerSearch.hidden = !open;
    if (open) {
      triggerSearch.value = query;
      triggerSearch.focus();
    }
  };

  const portal = mountPopoverPortal({
    anchor: trigger,
    popover: menu,
    onOpenChange: (open) => {
      syncTriggerOpenUi(open);
      if (!open) {
        if (!committedThisOpen) options.onDismiss?.();
        query = "";
        if (searchPlacement === "trigger") triggerSearch.value = "";
        navStack = [];
        committedThisOpen = false;
      }
    },
  });

  const syncLabel = () => {
    const record = records.find((item) => item.name === value);
    const hasValue = Boolean(record || value);
    labelEl.textContent = displayMode === "admin"
      ? (value || placeholder)
      : (record ? friendlyPath(record) : (value || placeholder));
    subEl.textContent = displayMode === "admin" || !record || !hasFriendlyPath(record)
      ? ""
      : accountDisplaySubtitle(record);
    subEl.hidden = !subEl.textContent;
    labelEl.classList.toggle("is-placeholder", !hasValue);
  };

  const rebuild = () => {
    records = recordsFor(groups);
    selectable = selectableRecords(records);
    forest = buildAccountForest(groups);
    navStack = [];
    const current = records.find((item) => item.name === value);
    if (value && !current) value = "";
    syncLabel();
  };

  const initialNodes = (): AccountTreeNode[] => {
    if (groups.length === 1) {
      const rootNode = forest[0];
      return rootNode?.children.length ? rootNode.children : (rootNode ? [rootNode] : []);
    }
    return forest;
  };

  const focusableRows = (): HTMLButtonElement[] =>
    [...menu.querySelectorAll<HTMLButtonElement>(".orbita-account-select-option, .orbita-account-select-nav")];
  const focusRow = (index: number) => {
    const rows = focusableRows();
    if (!rows.length) return;
    activeIndex = Math.max(0, Math.min(index, rows.length - 1));
    rows[activeIndex]?.focus();
  };

  const appendOption = (column: HTMLElement, record: AccountRecord) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "orbita-account-select-option";
    option.dataset.name = record.name;
    if (record.name === value) option.classList.add("is-active");
    const label = document.createElement("span");
    label.className = "orbita-account-select-option-label";
    label.textContent = friendlyPath(record);
    const sub = document.createElement("span");
    sub.className = "orbita-account-select-option-sub";
    sub.textContent = hasFriendlyPath(record) ? accountDisplaySubtitle(record) : "";
    sub.hidden = !sub.textContent;
    option.append(label, sub);
    column.appendChild(option);
  };

  const appendNav = (column: HTMLElement, node: AccountTreeNode, depth: number) => {
    const nav = document.createElement("button");
    nav.type = "button";
    nav.className = "orbita-account-select-nav";
    nav.dataset.navId = node.id;
    nav.dataset.depth = String(depth);
    if (navStack[depth]?.id === node.id) nav.classList.add("is-branch-open");
    const known = nodeRecord(node, records);
    const text = document.createElement("span");
    text.className = "orbita-account-select-nav-text";
    const label = document.createElement("span");
    label.className = "orbita-account-select-nav-label";
    label.textContent = known ? accountDisplayLabel(known) : node.label;
    const sub = document.createElement("span");
    sub.className = "orbita-account-select-nav-sub";
    sub.textContent = node.id;
    text.append(label, sub);
    const chevron = document.createElement("span");
    chevron.className = "orbita-account-select-nav-chevron";
    chevron.textContent = "›";
    nav.append(text, chevron);
    column.appendChild(nav);
  };

  const renderColumn = (nodes: AccountTreeNode[], depth: number, branchId = ""): HTMLElement => {
    const column = document.createElement("div");
    column.className = "orbita-account-select-column orbita-account-select-scroll-hidden";
    if (branchId) column.dataset.branchId = branchId;
    for (const node of nodes) {
      const record = nodeRecord(node, selectable);
      if (node.children.length) appendNav(column, node, depth);
      else if (record) appendOption(column, record);
    }
    if (!column.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "orbita-account-select-empty";
      empty.textContent = "暂无可选账户";
      column.appendChild(empty);
    }
    return column;
  };

  const renderSearchColumn = (): HTMLElement => {
    const column = document.createElement("div");
    column.className = "orbita-account-select-column orbita-account-select-scroll-hidden";
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = selectable.filter((record) =>
      record.name.toLocaleLowerCase().includes(normalizedQuery)
      || friendlyPath(record).toLocaleLowerCase().includes(normalizedQuery),
    );
    for (const record of matches) appendOption(column, record);
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "orbita-account-select-empty";
      empty.textContent = "未找到可选账户";
      column.appendChild(empty);
    }
    return column;
  };

  const renderCascadeHost = (): HTMLElement => {
    const host = document.createElement("div");
    host.className = `orbita-account-select-cascade-host${cascadeAlign === "anchor-row" ? " is-anchor-row" : ""}`;
    const rootColumn = renderColumn(initialNodes(), 0);
    rootColumn.classList.add("orbita-account-select-column-root");
    host.appendChild(rootColumn);
    for (let index = 0; index < navStack.length; index++) {
      const flyout = renderColumn(navStack[index]!.children, index + 1, navStack[index]!.id);
      if (cascadeAlign === "anchor-row") flyout.classList.add("orbita-account-select-column-flyout");
      host.appendChild(flyout);
    }
    if (cascadeAlign === "anchor-row") layoutAnchorFlyouts(host, navStack);
    return host;
  };

  const paintMenuBody = () => {
    activeIndex = -1;
    let body = menu.querySelector<HTMLElement>(".orbita-account-select-body");
    if (!body) {
      body = document.createElement("div");
      body.className = "orbita-account-select-body";
      menu.appendChild(body);
    }
    body.replaceChildren();
    body.classList.toggle("is-searching", Boolean(query.trim()));
    if (query.trim()) {
      body.appendChild(renderSearchColumn());
      return;
    }
    body.appendChild(renderCascadeHost());
  };

  const syncCascadeColumns = (): void => {
    const host = menu.querySelector<HTMLElement>(".orbita-account-select-cascade-host");
    if (!host || query.trim()) return;

    const scrollTops = [...host.querySelectorAll<HTMLElement>(".orbita-account-select-column")].map(
      (column) => column.scrollTop,
    );

    host.querySelectorAll<HTMLElement>(".orbita-account-select-nav").forEach((nav) => {
      const depth = Number(nav.dataset.depth);
      nav.classList.toggle("is-branch-open", navStack[depth]?.id === nav.dataset.navId);
    });

    const targetCount = 1 + navStack.length;
    while (host.children.length > targetCount) {
      host.lastElementChild?.remove();
      scrollTops.pop();
    }

    for (let index = 1; index <= navStack.length; index++) {
      const branchId = navStack[index - 1]!.id;
      const existing = host.children[index] as HTMLElement | undefined;
      if (existing?.classList.contains("orbita-account-select-column") && existing.dataset.branchId === branchId) {
        continue;
      }
      while (host.children.length > index) {
        host.lastElementChild?.remove();
        scrollTops.length = index;
      }
      const column = renderColumn(navStack[index - 1]!.children, index, branchId);
      if (cascadeAlign === "anchor-row") column.classList.add("orbita-account-select-column-flyout");
      if (host.children.length > index) {
        host.children[index]!.replaceWith(column);
        scrollTops[index] = 0;
      } else {
        host.appendChild(column);
        scrollTops.push(0);
      }
    }

    host.querySelectorAll<HTMLElement>(".orbita-account-select-column").forEach((column, index) => {
      column.scrollTop = scrollTops[index] ?? 0;
    });
    if (cascadeAlign === "anchor-row") layoutAnchorFlyouts(host, navStack);
  };

  const bindMenuSearch = (search: HTMLInputElement) => {
    search.addEventListener("input", () => {
      query = search.value;
      if (query.trim()) navStack = [];
      paintMenuBody();
      search.focus();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRow(activeIndex < 0 ? 0 : activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const rows = focusableRows();
        focusRow(activeIndex < 0 ? rows.length - 1 : activeIndex - 1);
      }
    });
  };

  const paintMenu = () => {
    menu.replaceChildren();
    if (searchPlacement === "menu") {
      const searchWrap = document.createElement("div");
      searchWrap.className = "orbita-account-select-search-wrap";
      const search = document.createElement("input");
      search.type = "search";
      search.className = "orbita-account-select-search";
      search.placeholder = "搜索账户";
      search.autocomplete = "off";
      search.value = query;
      searchWrap.appendChild(search);
      menu.appendChild(searchWrap);
      bindMenuSearch(search);
    }
    paintMenuBody();
  };

  const applyQuery = (next: string) => {
    query = next;
    if (query.trim()) navStack = [];
    paintMenuBody();
  };

  const setNav = (node: AccountTreeNode, depth: number) => {
    if (query.trim()) return;
    if (navStack[depth]?.id === node.id) return;
    navStack = [...navStack.slice(0, depth), node];
    syncCascadeColumns();
  };

  const findNode = (id: string): AccountTreeNode | undefined => {
    const visit = (nodes: AccountTreeNode[]): AccountTreeNode | undefined => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const child = visit(node.children);
        if (child) return child;
      }
      return undefined;
    };
    return visit(forest);
  };

  const openMenu = () => {
    query = "";
    navStack = [];
    committedThisOpen = false;
    paintMenu();
    menu.style.minWidth = `${trigger.offsetWidth}px`;
    void portal.open();
    if (searchPlacement === "menu") {
      menu.querySelector<HTMLInputElement>(".orbita-account-select-search")?.focus();
    } else {
      triggerSearch.value = "";
      triggerSearch.focus();
    }
  };

  const commitSelection = (name: string) => {
    value = name;
    committedThisOpen = true;
    syncLabel();
    options.onChange?.(value);
    void portal.close();
  };

  trigger.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".orbita-account-select-toggle")) return;
    if (portal.isOpen()) return;
    openMenu();
  });
  toggleBtn.addEventListener("click", () => {
    if (portal.isOpen()) {
      void portal.close();
      return;
    }
    openMenu();
  });

  triggerSearch.addEventListener("input", () => applyQuery(triggerSearch.value));
  triggerSearch.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const rows = focusableRows();
      focusRow(activeIndex < 0 ? rows.length - 1 : activeIndex - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void portal.close();
    }
  });

  menu.addEventListener("scroll", () => {
    const host = menu.querySelector<HTMLElement>(".orbita-account-select-cascade-host.is-anchor-row");
    if (host && !query.trim()) layoutAnchorFlyouts(host, navStack);
  }, true);

  menu.addEventListener("pointerover", (event) => {
    if (query.trim()) return;
    const nav = (event.target as HTMLElement).closest<HTMLButtonElement>(".orbita-account-select-nav");
    if (!nav?.dataset.navId || nav.dataset.depth === undefined) return;
    const node = findNode(nav.dataset.navId);
    if (node) setNav(node, Number(nav.dataset.depth));
  });

  menu.addEventListener("click", (event) => {
    const nav = (event.target as HTMLElement).closest<HTMLButtonElement>(".orbita-account-select-nav");
    if (nav?.dataset.navId && nav.dataset.depth !== undefined) {
      const node = findNode(nav.dataset.navId);
      if (node) setNav(node, Number(nav.dataset.depth));
      return;
    }
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>(".orbita-account-select-option");
    if (!option?.dataset.name) return;
    commitSelection(option.dataset.name);
  });

  menu.addEventListener("keydown", (event) => {
    const nav = (event.target as HTMLElement).closest<HTMLButtonElement>(".orbita-account-select-nav");
    if (!nav || (event.key !== "ArrowRight" && event.key !== "Enter")) return;
    event.preventDefault();
    nav.click();
  });

  const containsTarget = (target: Node | null): boolean => {
    if (!target) return false;
    return container.contains(target) || menu.contains(target);
  };

  syncLabel();
  return {
    getValue: () => value,
    setValue: (next) => { value = next; syncLabel(); },
    setGroups: (next) => { groups = [...next]; rebuild(); if (portal.isOpen()) paintMenu(); },
    close: () => portal.close(),
    dispose: portal.dispose,
    containsTarget,
    hasPendingQuery: () => Boolean(query.trim()),
    isOpen: () => portal.isOpen(),
    root,
  };
}
