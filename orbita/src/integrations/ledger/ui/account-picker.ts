import { escAttr, escHtml } from "../../../core/html";
import { CHEVRON_SVG } from "../../ai/icons";
import { mountPopoverPortal } from "../../../ui/popover-portal";
import { accountDisplayLabel, accountDisplaySubtitle, getAccountRecords } from "../state/accounts";
import { groupByLabelPath } from "../state/category-display";
import type { AccountGroup, AccountRecord } from "../types";

export type AccountPickerOptions = {
  groups: AccountGroup | AccountGroup[];
  value?: string;
  placeholder?: string;
  onChange?: (name: string) => void;
};

export type AccountPickerHandle = {
  getValue: () => string;
  setValue: (name: string) => void;
  setGroups: (groups: AccountGroup | AccountGroup[]) => void;
  close: () => Promise<void>;
  dispose: () => void;
  root: HTMLElement;
};

function normalizeGroups(groups: AccountGroup | AccountGroup[]): AccountGroup[] {
  return Array.isArray(groups) ? groups : [groups];
}

function collectRecords(groups: AccountGroup[]): AccountRecord[] {
  return groups.flatMap((g) => getAccountRecords(g));
}

function findRecord(records: AccountRecord[], name: string): AccountRecord | undefined {
  return records.find((r) => r.name === name);
}

export function mountAccountPicker(
  container: HTMLElement,
  options: AccountPickerOptions,
): AccountPickerHandle {
  const placeholder = options.placeholder ?? "请选择";
  let groups = normalizeGroups(options.groups);
  let value = options.value ?? "";
  let activeGroup = "";

  container.innerHTML = `
    <div class="ledger-account-picker">
      <button type="button" class="ledger-account-picker-btn">
        <span class="ledger-account-picker-text">
          <span class="ledger-account-picker-label"></span>
          <span class="ledger-account-picker-sub" hidden></span>
        </span>
        <span class="ledger-account-picker-chevron">${CHEVRON_SVG}</span>
      </button>
      <div class="ledger-account-picker-menu scroll-slim motion-popover">
        <div class="ledger-account-picker-body">
          <div class="ledger-account-picker-col">
            <div class="ledger-account-picker-col-label">分组</div>
            <div class="ledger-account-picker-groups"></div>
          </div>
          <div class="ledger-account-picker-col">
            <div class="ledger-account-picker-col-label">账户</div>
            <div class="ledger-account-picker-items"></div>
          </div>
        </div>
      </div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".ledger-account-picker")!;
  const btn = root.querySelector<HTMLButtonElement>(".ledger-account-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".ledger-account-picker-label")!;
  const subEl = root.querySelector<HTMLElement>(".ledger-account-picker-sub")!;
  const menu = root.querySelector<HTMLElement>(".ledger-account-picker-menu")!;
  const groupsEl = root.querySelector<HTMLElement>(".ledger-account-picker-groups")!;
  const itemsEl = root.querySelector<HTMLElement>(".ledger-account-picker-items")!;
  const portal = mountPopoverPortal({
    anchor: btn,
    popover: menu,
    onOpenChange: (open) => btn.classList.toggle("is-open", open),
  });

  const getGrouped = () => groupByLabelPath(collectRecords(groups));

  const syncLabel = () => {
    const records = collectRecords(groups);
    const item = findRecord(records, value);
    const label = item ? accountDisplayLabel(item) : placeholder;
    labelEl.textContent = label || placeholder;
    labelEl.classList.toggle("is-placeholder", !item);
    if (subEl) {
      const sub = item ? accountDisplaySubtitle(item) : "";
      subEl.textContent = sub;
      subEl.hidden = !sub.trim();
    }
  };

  const paintItems = (groupName: string) => {
    const grouped = getGrouped();
    const items = grouped.get(groupName) || [];
    if (!items.length) {
      itemsEl.innerHTML = '<div class="ledger-account-picker-empty">暂无账户</div>';
      return;
    }
    itemsEl.innerHTML = items
      .map(
        (item) =>
          `<button type="button" class="ledger-account-picker-item${item.name === value ? " is-active" : ""}" data-name="${escAttr(item.name)}">${escHtml(accountDisplayLabel(item))}</button>`,
      )
      .join("");
  };

  const paintGroups = () => {
    const grouped = getGrouped();
    const keys = [...grouped.keys()];
    if (!keys.length) {
      groupsEl.innerHTML = '<div class="ledger-account-picker-empty">暂无</div>';
      itemsEl.innerHTML = '<div class="ledger-account-picker-empty">暂无账户</div>';
      return;
    }
    if (!activeGroup || !grouped.has(activeGroup)) {
      const current = value ? findRecord(collectRecords(groups), value) : undefined;
      if (current) {
        const path = current.label_path?.[0] || current.name.split(":").pop() || keys[0];
        activeGroup = grouped.has(path) ? path : keys[0];
      } else {
        activeGroup = keys[0];
      }
    }
    groupsEl.innerHTML = keys
      .map(
        (key) =>
          `<button type="button" class="ledger-account-picker-group${key === activeGroup ? " is-active" : ""}" data-group="${escAttr(key)}">${escHtml(key)}</button>`,
      )
      .join("");
    paintItems(activeGroup);
  };

  const close = () => portal.close();

  btn.addEventListener("click", async (e) => {
    if (portal.isOpen()) {
      void close();
      return;
    }
    paintGroups();
    void portal.open();
  });

  groupsEl.addEventListener("click", (e) => {
    const groupBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ledger-account-picker-group");
    if (!groupBtn?.dataset.group) return;
    activeGroup = groupBtn.dataset.group;
    paintGroups();
  });

  itemsEl.addEventListener("click", async (e) => {
    const itemBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ledger-account-picker-item");
    if (!itemBtn?.dataset.name) return;
    value = itemBtn.dataset.name;
    syncLabel();
    options.onChange?.(value);
    await close();
  });

  syncLabel();

  return {
    getValue: () => value,
    setValue: (name: string) => {
      value = name;
      syncLabel();
    },
    setGroups: (next: AccountGroup | AccountGroup[]) => {
      groups = normalizeGroups(next);
      const records = collectRecords(groups);
      if (value && !findRecord(records, value)) value = "";
      syncLabel();
    },
    close,
    dispose: portal.dispose,
    root,
  };
}
