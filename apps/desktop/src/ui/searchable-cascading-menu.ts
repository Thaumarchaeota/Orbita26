/**
 * Searchable cascading menu: the opened panel is the search level. Empty query keeps
 * the tree; a query flattens hits. Deeper flyouts have no search box.
 * See docs/specs/0004-insight-ui-library-and-reuse.md.
 */
import {
  mountFlatSelectPopover,
  type FlatSelectOption,
} from "./flat-select-popover";

export type SearchableCascadingMenuItem = {
  value: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  children?: SearchableCascadingMenuItem[];
};

export type SearchableCascadingMenuHandle = {
  open: () => Promise<void>;
  close: () => Promise<void>;
  isOpen: () => boolean;
  dispose: () => void;
};

function mapItems(items: SearchableCascadingMenuItem[]): FlatSelectOption[] {
  return items.map((item) => ({
    value: item.value,
    label: item.label,
    danger: item.danger,
    disabled: item.disabled,
    children: item.children ? mapItems(item.children) : undefined,
  }));
}

export function mountSearchableCascadingMenu(options: {
  anchor: HTMLElement;
  items: SearchableCascadingMenuItem[];
  onSelect: (value: string) => void;
}): SearchableCascadingMenuHandle {
  const ac = new AbortController();
  const popover = mountFlatSelectPopover({
    anchor: options.anchor,
    options: mapItems(options.items),
    selected: new Set(),
    multiple: false,
    search: true,
    menu: true,
    submenuSearch: false,
    onChange: (selected) => {
      if (selected.size === 0) return;
      const [value] = selected;
      if (value !== undefined) options.onSelect(value);
    },
  });

  options.anchor.addEventListener(
    "click",
    () => {
      if (popover.isOpen()) void popover.close();
      else void popover.open();
    },
    { signal: ac.signal },
  );

  return {
    open: () => popover.open(),
    close: () => popover.close(),
    isOpen: () => popover.isOpen(),
    dispose: () => {
      ac.abort();
      popover.dispose();
    },
  };
}
