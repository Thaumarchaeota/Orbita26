import { escAttr, escHtml } from "../../core/html";
import { mountDecoupledDatePicker } from "../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../ui/decoupled-time-picker";
import { closePopover, isPopoverOpen, openPopover } from "../../ui/motion";
import { CHEVRON_SVG } from "../ai/icons";
import { formatDateLabel } from "./calendar";

export type PickerItem = { value: string; label: string };

export type PickerGroup = {
  register: (handle: { close: () => Promise<void>; menu: HTMLElement }) => () => void;
  closeOthers: (keep?: HTMLElement) => Promise<void>;
};

export function createPickerGroup(): PickerGroup {
  const members: { close: () => Promise<void>; menu: HTMLElement }[] = [];
  return {
    register(handle) {
      members.push(handle);
      return () => {
        const index = members.indexOf(handle);
        if (index >= 0) members.splice(index, 1);
      };
    },
    async closeOthers(keep) {
      await Promise.all(members.filter((m) => m.menu !== keep).map((m) => m.close()));
    },
  };
}

function pickerShell(label: string, id: string) {
  return `
    <div class="ticktick-field-picker" data-picker="${id}">
      <span class="ticktick-field-picker-label">${escHtml(label)}</span>
      <div class="ticktick-picker">
        <button type="button" class="ticktick-picker-btn">
          <span class="ticktick-picker-label"></span>
          <span class="ticktick-picker-chevron">${CHEVRON_SVG}</span>
        </button>
        <div class="ticktick-picker-menu scroll-slim motion-popover"></div>
      </div>
    </div>
  `;
}

export function mountListPicker(
  parent: HTMLElement,
  label: string,
  id: string,
  items: PickerItem[],
  initial: string,
  group?: PickerGroup,
) {
  parent.insertAdjacentHTML("beforeend", pickerShell(label, id));
  const root = parent.querySelector<HTMLElement>(`[data-picker="${id}"]`)!;
  const btn = root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".ticktick-picker-label")!;
  const menu = root.querySelector<HTMLElement>(".ticktick-picker-menu")!;
  let value = initial;
  let list = items;

  const syncLabel = () => {
    labelEl.textContent = list.find((i) => i.value === value)?.label ?? value;
  };

  const paint = () => {
    menu.innerHTML = list
      .map(
        (item) =>
          `<button type="button" class="ticktick-picker-item${item.value === value ? " active" : ""}" data-value="${escAttr(item.value)}">${escHtml(item.label)}</button>`,
      )
      .join("");
  };

  const close = async () => {
    if (isPopoverOpen(menu)) {
      await closePopover(menu);
      btn.classList.remove("is-open");
    }
  };
  group?.register({ close, menu });

  btn.addEventListener("click", async (e) => {
    if (isPopoverOpen(menu)) {
      void close();
      return;
    }
    await group?.closeOthers(menu);
    paint();
    btn.classList.add("is-open");
    void openPopover(menu, e.currentTarget as HTMLElement);
  });

  menu.addEventListener("click", async (e) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-picker-item");
    if (!item) return;
    value = item.dataset.value ?? value;
    syncLabel();
    paint();
    await close();
  });

  syncLabel();
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
      syncLabel();
    },
    setItems: (next: PickerItem[]) => {
      list = next;
      syncLabel();
    },
    close,
    root,
  };
}

export function mountTaskDateField(
  parent: HTMLElement,
  label: string,
  id: string,
  initial: string,
  group?: PickerGroup,
) {
  parent.insertAdjacentHTML("beforeend", pickerShell(label, id));
  const root = parent.querySelector<HTMLElement>(`[data-picker="${id}"]`)!;
  const trigger = root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".ticktick-picker-label")!;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", label);
  const controller = new AbortController();
  const sync = () => { labelEl.textContent = formatDateLabel(picker.getValue()); };
  const picker = mountDecoupledDatePicker({ anchor: trigger, value: initial, onChange: sync, onOpenChange: (open) => { trigger.setAttribute("aria-expanded", String(open)); trigger.classList.toggle("is-open", open); } });
  const close = () => picker.close();
  const unregister = group?.register({ close, menu: root });
  sync();
  trigger.addEventListener("click", async () => { await group?.closeOthers(root); picker.open(); }, { signal: controller.signal });
  const dispose = () => { controller.abort(); unregister?.(); picker.dispose(); };
  return { getValue: picker.getValue, setValue: (v: string) => { picker.setValue(v); sync(); }, close, dispose, root };
}

export function mountTaskTimeField(
  parent: HTMLElement,
  label: string,
  id: string,
  initial: string,
  group?: PickerGroup,
) {
  parent.insertAdjacentHTML("beforeend", pickerShell(label, id));
  const root = parent.querySelector<HTMLElement>(`[data-picker="${id}"]`)!;
  const trigger = root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".ticktick-picker-label")!;
  const controller = new AbortController();
  const sync = () => { labelEl.textContent = picker.getValue(); };
  const picker = mountDecoupledTimePicker({ anchor: trigger, value: initial || "09:00", onChange: sync, onOpenChange: (open) => { trigger.setAttribute("aria-expanded", String(open)); trigger.classList.toggle("is-open", open); } });
  const close = () => picker.close();
  const unregister = group?.register({ close, menu: root });
  sync();
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", label);
  trigger.addEventListener("click", async () => { await group?.closeOthers(root); picker.open(); }, { signal: controller.signal });
  const dispose = () => { controller.abort(); unregister?.(); picker.dispose(); };
  return { getValue: picker.getValue, setValue: (v: string) => { picker.setValue(v); sync(); }, close, dispose, root };
}
export function mountToggle(parent: HTMLElement, label: string, id: string, initial = false) {
  parent.insertAdjacentHTML(
    "beforeend",
    `
    <div class="ticktick-field-toggle" data-picker="${id}">
      <span class="ticktick-field-picker-label">${escHtml(label)}</span>
      <button type="button" class="ticktick-switch${initial ? " is-on" : ""}" aria-pressed="${initial}">
        <span class="ticktick-switch-track"><span class="ticktick-switch-thumb"></span></span>
      </button>
    </div>
  `,
  );
  const root = parent.querySelector<HTMLElement>(`[data-picker="${id}"]`)!;
  const btn = root.querySelector<HTMLButtonElement>(".ticktick-switch")!;
  let on = initial;

  btn.addEventListener("click", () => {
    on = !on;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });

  return {
    getValue: () => on,
    setValue: (v: boolean) => {
      on = v;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
    },
    root,
  };
}

export async function closeAllPickers(pickers: { close?: () => Promise<void> }[]) {
  await Promise.all(pickers.map((p) => p.close?.() ?? Promise.resolve()));
}
