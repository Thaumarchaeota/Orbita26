import { escAttr, escHtml } from "../../core/html";
import { closePopover, isPopoverOpen, openPopover } from "../../ui/motion";
import { CHEVRON_SVG } from "../ai/icons";
import {
  WEEKDAYS,
  buildCalendarDays,
  formatDateLabel,
  formatDateValue,
  monthLabel,
  parseDateValue,
} from "./calendar";

export type PickerItem = { value: string; label: string };

export type PickerGroup = {
  register: (handle: { close: () => Promise<void>; menu: HTMLElement }) => void;
  closeOthers: (keep?: HTMLElement) => Promise<void>;
};

export function createPickerGroup(): PickerGroup {
  const members: { close: () => Promise<void>; menu: HTMLElement }[] = [];
  return {
    register(handle) {
      members.push(handle);
    },
    async closeOthers(keep) {
      await Promise.all(members.filter((m) => m.menu !== keep).map((m) => m.close()));
    },
  };
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

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

export function mountDatePicker(
  parent: HTMLElement,
  label: string,
  id: string,
  initial: string,
  group?: PickerGroup,
) {
  parent.insertAdjacentHTML("beforeend", pickerShell(label, id));
  const root = parent.querySelector<HTMLElement>(`[data-picker="${id}"]`)!;
  const btn = root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".ticktick-picker-label")!;
  const menu = root.querySelector<HTMLElement>(".ticktick-picker-menu")!;
  menu.classList.add("ticktick-date-menu");
  let value = initial;
  let year = parseDateValue(initial)?.getFullYear() ?? new Date().getFullYear();
  let month = parseDateValue(initial)?.getMonth() ?? new Date().getMonth();

  const syncLabel = () => {
    labelEl.textContent = formatDateLabel(value);
  };

  const paint = () => {
    const today = new Date();
    const cells = buildCalendarDays(year, month);
    menu.innerHTML = `
      <div class="ticktick-mini-cal">
        <div class="ticktick-mini-cal-head">
          <button type="button" class="ticktick-mini-cal-nav" data-dir="-1">‹</button>
          <span>${monthLabel(year, month)}</span>
          <button type="button" class="ticktick-mini-cal-nav" data-dir="1">›</button>
        </div>
        <div class="ticktick-mini-cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="ticktick-mini-cal-grid">
          ${cells
            .map((d) => {
              if (!d) return `<span class="ticktick-mini-cal-cell is-empty"></span>`;
              const v = formatDateValue(d);
              const active = v === value;
              const isToday = d.toDateString() === today.toDateString();
              return `<button type="button" class="ticktick-mini-cal-cell${active ? " is-active" : ""}${isToday ? " is-today" : ""}" data-value="${v}">${d.getDate()}</button>`;
            })
            .join("")}
        </div>
      </div>
    `;
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
    const parsed = parseDateValue(value);
    if (parsed) {
      year = parsed.getFullYear();
      month = parsed.getMonth();
    }
    await group?.closeOthers(menu);
    paint();
    btn.classList.add("is-open");
    void openPopover(menu, e.currentTarget as HTMLElement);
  });

  menu.addEventListener("click", async (e) => {
    const nav = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-mini-cal-nav");
    if (nav) {
      const dir = Number(nav.dataset.dir);
      month += dir;
      if (month < 0) {
        month = 11;
        year -= 1;
      } else if (month > 11) {
        month = 0;
        year += 1;
      }
      paint();
      return;
    }
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-mini-cal-cell");
    if (!cell?.dataset.value) return;
    value = cell.dataset.value;
    syncLabel();
    await close();
  });

  syncLabel();
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
      syncLabel();
    },
    close,
    root,
  };
}

export function mountTimePicker(
  parent: HTMLElement,
  label: string,
  id: string,
  initial: string,
  group?: PickerGroup,
) {
  parent.insertAdjacentHTML("beforeend", pickerShell(label, id));
  const root = parent.querySelector<HTMLElement>(`[data-picker="${id}"]`)!;
  const btn = root.querySelector<HTMLButtonElement>(".ticktick-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".ticktick-picker-label")!;
  const menu = root.querySelector<HTMLElement>(".ticktick-picker-menu")!;
  menu.classList.add("ticktick-time-menu");
  let value = initial || "09:00";

  const syncLabel = () => {
    labelEl.textContent = value;
  };

  const paint = () => {
    const [hh, mm] = value.split(":");
    menu.innerHTML = `
      <div class="ticktick-time-grid">
        <div class="ticktick-time-col scroll-slim">
          ${HOURS.map((h) => `<button type="button" class="ticktick-time-item${h === hh ? " active" : ""}" data-part="h" data-value="${h}">${h}</button>`).join("")}
        </div>
        <div class="ticktick-time-col scroll-slim">
          ${MINUTES.map((m) => `<button type="button" class="ticktick-time-item${m === mm ? " active" : ""}" data-part="m" data-value="${m}">${m}</button>`).join("")}
        </div>
      </div>
    `;
    const activeH = menu.querySelector<HTMLElement>(".ticktick-time-col .active");
    activeH?.scrollIntoView({ block: "center" });
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
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-time-item");
    if (!item) return;
    const [curH, curM] = value.split(":");
    if (item.dataset.part === "h") value = `${item.dataset.value}:${curM}`;
    else value = `${curH}:${item.dataset.value}`;
    syncLabel();
    paint();
  });

  syncLabel();
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
      syncLabel();
    },
    close,
    root,
  };
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
