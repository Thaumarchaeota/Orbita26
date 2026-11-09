import {
  mountFlatSelectPopover,
  type FlatSelectOption,
  type FlatSelectPopoverHandle,
} from "./flat-select-popover";

export type CommandMenuItem = Pick<FlatSelectOption, "value" | "label" | "danger" | "disabled"> & {
  children?: CommandMenuItem[];
};

/** @deprecated Prefer `CommandMenuItem` with `value`. Kept for call-site migrations. */
export type MenuItemDef = {
  action: string;
  label: string;
  danger?: boolean;
  confirm?: boolean;
  disabled?: boolean;
};

export function commandMenuItemsFromLegacy(items: MenuItemDef[]): CommandMenuItem[] {
  return items.map((item) => ({
    value: item.action,
    label: item.label,
    danger: item.danger,
    disabled: item.disabled,
  }));
}

export function legacyCommandConfirmActions(items: MenuItemDef[]): ReadonlySet<string> {
  return new Set(items.filter((item) => item.confirm).map((item) => item.action));
}

export type ShowCommandMenuOpts = {
  returnFocus?: HTMLElement | null;
  /** Fires when the menu closes, including after a selection. */
  onClose?: () => void;
};

/**
 * Pointer-anchored flat command menu (`mountFlatSelectPopover` + `menu: true`).
 * Disposes itself when closed; do not retain the returned handle after `onClose`.
 */
export function showCommandMenuAt(
  x: number,
  y: number,
  items: CommandMenuItem[],
  onSelect: (value: string) => void,
  opts?: ShowCommandMenuOpts,
): FlatSelectPopoverHandle {
  const anchor = document.createElement("span");
  anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px;opacity:0;pointer-events:none`;
  document.body.appendChild(anchor);

  let menu: FlatSelectPopoverHandle | null = null;
  const cleanup = () => {
    menu?.dispose();
    menu = null;
    anchor.remove();
    opts?.onClose?.();
  };

  menu = mountFlatSelectPopover({
    anchor,
    options: items,
    selected: new Set(),
    multiple: false,
    search: false,
    menu: true,
    onOpenChange: (open) => {
      if (open) return;
      opts?.returnFocus?.focus();
      cleanup();
    },
    onChange: (values) => {
      const value = [...values][0];
      if (value) onSelect(value);
    },
  });
  void menu.open();
  return menu;
}
