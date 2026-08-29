import { CHEVRON_SVG } from "../../ai/icons";

import { mountPopoverPortal } from "../../../ui/popover-portal";

import {

  createTriStateMarker,

  readTriStateMarker,

  setTriStateMarker,

  type TriState,

} from "../../../ui/choice-control";

import {

  buildAccountForest,

  collectTreeCheckState,

  type AccountTreeNode,

} from "../domain/account-tree";

import type { AccountGroup } from "../types";

import "./account-tree-multi-picker.css";



export type AccountTreeMultiPickerOptions = {

  groups?: AccountGroup[];

  selected: ReadonlySet<string>;

  onChange: (selected: Set<string>) => void;

  placeholder?: string;

};



export type AccountTreeMultiPickerHandle = {

  setSelected: (selected: ReadonlySet<string>) => void;

  open: () => Promise<void>;

  close: () => Promise<void>;

  dispose: () => void;

  root: HTMLElement;

};



function toggleSubtree(node: AccountTreeNode, selected: Set<string>, checked: boolean): void {

  if (node.isLeaf) {

    if (checked) selected.add(node.name);

    else selected.delete(node.name);

  }

  for (const child of node.children) toggleSubtree(child, selected, checked);

}



function filterNode(node: AccountTreeNode, q: string): AccountTreeNode | null {

  if (!q) return node;

  const selfMatch = node.label.toLowerCase().includes(q) || node.name.toLowerCase().includes(q);

  const filteredChildren = node.children

    .map((c) => filterNode(c, q))

    .filter((c): c is AccountTreeNode => c !== null);

  if (selfMatch) return node;

  if (filteredChildren.length > 0) return { ...node, children: filteredChildren };

  return null;

}



function filterForest(forest: AccountTreeNode[], q: string): AccountTreeNode[] {

  if (!q) return forest;

  return forest

    .map((n) => filterNode(n, q))

    .filter((n): n is AccountTreeNode => n !== null);

}



function appendNode(

  parent: HTMLElement,

  node: AccountTreeNode,

  selected: ReadonlySet<string>,

  depth: number,

): void {

  const state = collectTreeCheckState(node, selected);

  const row = document.createElement("div");

  row.className = "orbita-account-tree-row";

  row.style.paddingLeft = `${depth * 12}px`;

  row.tabIndex = -1;

  if (node.isLeaf || node.children.length) {

    const marker = createTriStateMarker({ name: node.name, state });

    marker.classList.add("orbita-account-tree-check");

    row.appendChild(marker);

  }

  const label = document.createElement("span");

  label.className = "orbita-account-tree-label";

  label.textContent = node.label;

  row.appendChild(label);

  parent.appendChild(row);

  for (const child of node.children) appendNode(parent, child, selected, depth + 1);

}



function nextTriState(state: TriState): TriState {

  return state === "checked" ? "unchecked" : "checked";

}



export function mountAccountTreeMultiPicker(

  container: HTMLElement,

  options: AccountTreeMultiPickerOptions,

): AccountTreeMultiPickerHandle {

  let selected = new Set(options.selected);

  const groups = options.groups ?? ["assets", "liabilities", "expenses", "income"];

  let query = "";

  let activeIndex = -1;



  container.innerHTML = `

    <div class="orbita-account-tree-picker">

      <button type="button" class="orbita-account-tree-picker-btn">

        <span class="orbita-account-tree-picker-label"></span>

        <span class="orbita-account-tree-picker-chevron">${CHEVRON_SVG}</span>

      </button>

      <div class="orbita-account-tree-picker-menu scroll-slim motion-popover"></div>

    </div>`;



  const root = container.querySelector<HTMLElement>(".orbita-account-tree-picker")!;

  const btn = root.querySelector<HTMLButtonElement>(".orbita-account-tree-picker-btn")!;

  const labelEl = root.querySelector<HTMLElement>(".orbita-account-tree-picker-label")!;

  const menu = root.querySelector<HTMLElement>(".orbita-account-tree-picker-menu")!;

  const portal = mountPopoverPortal({

    anchor: btn,

    popover: menu,

    onOpenChange: (open) => btn.classList.toggle("is-open", open),

  });



  const syncLabel = () => {

    const n = selected.size;

    labelEl.textContent = n ? `已选 ${n} 个账户` : (options.placeholder ?? "选择账户");

    labelEl.classList.toggle("is-placeholder", !n);

  };



  const focusableRows = (): HTMLElement[] =>

    [...menu.querySelectorAll<HTMLElement>(".orbita-account-tree-row")];



  const focusRow = (index: number): void => {

    const rows = focusableRows();

    if (!rows.length) {

      activeIndex = -1;

      return;

    }

    activeIndex = Math.max(0, Math.min(index, rows.length - 1));

    rows[activeIndex]?.focus();

  };



  const syncCheckStates = () => {

    const forest = buildAccountForest(groups);

    const findState = (nodes: AccountTreeNode[], name: string): TriState | null => {

      for (const n of nodes) {

        if (n.name === name) return collectTreeCheckState(n, selected);

        const child = findState(n.children, name);

        if (child) return child;

      }

      return null;

    };

    for (const marker of menu.querySelectorAll<HTMLElement>(".orbita-account-tree-check")) {

      const name = marker.dataset.name;

      if (!name) continue;

      const state = findState(forest, name);

      if (state) setTriStateMarker(marker, state);

    }

  };



  const paint = () => {

    activeIndex = -1;

    const forest = buildAccountForest(groups);

    const q = query.trim().toLowerCase();

    const filtered = filterForest(forest, q);



    menu.replaceChildren();

    const searchWrap = document.createElement("div");

    searchWrap.className = "orbita-account-tree-search-wrap";

    const search = document.createElement("input");

    search.type = "search";

    search.className = "orbita-account-tree-search";

    search.placeholder = "搜索账户";

    search.autocomplete = "off";

    search.value = query;

    searchWrap.appendChild(search);

    menu.appendChild(searchWrap);



    const list = document.createElement("div");

    list.className = "orbita-account-tree-list";

    for (const node of filtered) appendNode(list, node, selected, 0);

    menu.appendChild(list);



    search.addEventListener("input", () => {

      query = search.value;

      paint();

      menu.querySelector<HTMLInputElement>(".orbita-account-tree-search")?.focus();

    });



    search.addEventListener("keydown", (e) => {

      if (e.key === "Escape") {

        e.stopPropagation();

        void portal.close();

        return;

      }

      const rows = focusableRows();

      if (!rows.length) return;

      if (e.key === "ArrowDown") {

        e.preventDefault();

        focusRow(activeIndex < 0 ? 0 : activeIndex + 1);

        return;

      }

      if (e.key === "ArrowUp") {

        e.preventDefault();

        focusRow(activeIndex < 0 ? rows.length - 1 : activeIndex - 1);

        return;

      }

      if (e.key === "Enter" && activeIndex >= 0) {

        e.preventDefault();

        const marker = rows[activeIndex]?.querySelector<HTMLElement>(".orbita-account-tree-check");

        if (marker) marker.click();

      }

    });

  };



  const onMarkerActivate = (marker: HTMLElement) => {

    const name = marker.dataset.name;

    if (!name) return;

    const forest = buildAccountForest(groups);

    const find = (nodes: AccountTreeNode[]): AccountTreeNode | null => {

      for (const n of nodes) {

        if (n.name === name) return n;

        const child = find(n.children);

        if (child) return child;

      }

      return null;

    };

    const node = find(forest);

    if (!node) return;

    const next = nextTriState(readTriStateMarker(marker));
    setTriStateMarker(marker, next);
    toggleSubtree(node, selected, next === "checked");
    syncLabel();
    syncCheckStates();
    options.onChange(new Set(selected));

  };



  menu.addEventListener("click", (e) => {

    const marker = (e.target as HTMLElement).closest<HTMLElement>(".orbita-account-tree-check");

    if (!marker || !menu.contains(marker)) return;

    e.preventDefault();

    onMarkerActivate(marker);

  });



  btn.addEventListener("click", () => {

    if (portal.isOpen()) void portal.close();

    else {

      query = "";

      paint();

      menu.style.width = `${btn.offsetWidth}px`;

      void portal.open();

      menu.querySelector<HTMLInputElement>(".orbita-account-tree-search")?.focus();

    }

  });



  syncLabel();

  return {

    setSelected: (next) => {

      selected = new Set(next);

      syncLabel();

      if (portal.isOpen()) syncCheckStates();

    },

    open: async () => {

      paint();

      await portal.open();

      menu.querySelector<HTMLInputElement>(".orbita-account-tree-search")?.focus();

    },

    close: () => portal.close(),

    dispose: portal.dispose,

    root,

  };

}


