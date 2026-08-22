import { escAttr } from "../core/html";
import { CHEVRON_SVG } from "../integrations/ai/icons";
import { mountPopoverPortal } from "./popover-portal";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function monthLabel(y: number, m: number): string {
  return `${y}年${m + 1}月`;
}

function buildCalendarDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: startPad }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDateValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateValue(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatDateLabelZh(value: string): string {
  const d = parseDateValue(value);
  if (!d) return "选择日期";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export type DatePickerOptions = {
  value?: string;
  placeholder?: string;
  compact?: boolean;
  onChange?: (value: string) => void;
};

export type DatePickerHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  close: () => Promise<void>;
  dispose: () => void;
  root: HTMLElement;
};

export function mountDatePicker(
  container: HTMLElement,
  options: DatePickerOptions = {},
): DatePickerHandle {
  const placeholder = options.placeholder ?? "选择日期";
  let value = options.value ?? "";
  container.innerHTML = `
    <div class="orbita-date-picker${options.compact ? " is-compact" : ""}">
      <button type="button" class="orbita-date-picker-btn">
        <span class="orbita-date-picker-label"></span>
        <span class="orbita-date-picker-chevron">${CHEVRON_SVG}</span>
      </button>
      <div class="orbita-date-picker-menu scroll-slim motion-popover"></div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-date-picker")!;
  const btn = root.querySelector<HTMLButtonElement>(".orbita-date-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".orbita-date-picker-label")!;
  const menu = root.querySelector<HTMLElement>(".orbita-date-picker-menu")!;
  const portal = mountPopoverPortal({
    anchor: btn,
    popover: menu,
    onOpenChange: (open) => btn.classList.toggle("is-open", open),
  });
  let year = parseDateValue(value)?.getFullYear() ?? new Date().getFullYear();
  let month = parseDateValue(value)?.getMonth() ?? new Date().getMonth();

  const syncLabel = () => {
    labelEl.textContent = value ? formatDateLabelZh(value) : placeholder;
    labelEl.classList.toggle("is-placeholder", !value);
  };

  const paint = () => {
    const today = new Date();
    const cells = buildCalendarDays(year, month);
    menu.innerHTML = `
      <div class="orbita-mini-cal">
        <div class="orbita-mini-cal-head">
          <button type="button" class="orbita-mini-cal-nav" data-dir="-1">‹</button>
          <span>${monthLabel(year, month)}</span>
          <button type="button" class="orbita-mini-cal-nav" data-dir="1">›</button>
        </div>
        <div class="orbita-mini-cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="orbita-mini-cal-grid">
          ${cells
            .map((d) => {
              if (!d) return `<span class="orbita-mini-cal-cell is-empty"></span>`;
              const v = formatDateValue(d);
              const active = v === value;
              const isToday = d.toDateString() === today.toDateString();
              return `<button type="button" class="orbita-mini-cal-cell${active ? " is-active" : ""}${isToday ? " is-today" : ""}" data-value="${escAttr(v)}">${d.getDate()}</button>`;
            })
            .join("")}
        </div>
      </div>`;
  };

  const close = () => portal.close();

  btn.addEventListener("click", async (e) => {
    if (portal.isOpen()) {
      void close();
      return;
    }
    const parsed = parseDateValue(value);
    if (parsed) {
      year = parsed.getFullYear();
      month = parsed.getMonth();
    }
    paint();
    void portal.open();
  });

  menu.addEventListener("click", async (e) => {
    const nav = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-mini-cal-nav");
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
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-mini-cal-cell");
    if (!cell?.dataset.value) return;
    value = cell.dataset.value;
    syncLabel();
    options.onChange?.(value);
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
    dispose: portal.dispose,
    root,
  };
}
