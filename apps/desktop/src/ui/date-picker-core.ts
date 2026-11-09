import { escAttr } from "../core/html";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function monthLabel(y: number, m: number): string {
  return `${y}年${m + 1}月`;
}

export function buildCalendarDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: startPad }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function formatDateValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateValue(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatDateLabelZh(value: string): string {
  const d = parseDateValue(value);
  if (!d) return "选择日期";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export type MiniCalCellFlags = {
  active?: boolean;
  inRange?: boolean;
  today?: boolean;
};

export function buildMiniCalFooterHtml(): string {
  return `<div class="orbita-mini-cal-footer">
    <button type="button" data-action="clear">清除</button>
    <button type="button" data-action="confirm">确定</button>
  </div>`;
}

function calendarHeadHtml(year: number, month: number, yearNav: boolean): string {
  const monthPrev = `<button type="button" class="orbita-mini-cal-nav" data-dir="-1" aria-label="上一月">‹</button>`;
  const monthNext = `<button type="button" class="orbita-mini-cal-nav" data-dir="1" aria-label="下一月">›</button>`;
  const yearPrev = `<button type="button" class="orbita-mini-cal-nav orbita-mini-cal-year" data-dir="-1" aria-label="上一年">‹‹</button>`;
  const yearNext = `<button type="button" class="orbita-mini-cal-nav orbita-mini-cal-year" data-dir="1" aria-label="下一年">››</button>`;
  const left = yearNav ? `<span class="orbita-mini-cal-nav-group">${monthPrev}${yearPrev}</span>` : monthPrev;
  const right = yearNav ? `<span class="orbita-mini-cal-nav-group">${yearNext}${monthNext}</span>` : monthNext;
  const title = yearNav
    ? `<button type="button" class="orbita-mini-cal-month" aria-label="跳转到今天">${monthLabel(year, month)}</button>`
    : `<span>${monthLabel(year, month)}</span>`;
  return `
      <div class="orbita-mini-cal-head">
        ${left}
        ${title}
        ${right}
      </div>`;
}

export function buildMiniCalendarHtml(
  year: number,
  month: number,
  cellFlags: (value: string, date: Date) => MiniCalCellFlags,
  calClass = "",
  yearNav = false,
  footer = true,
): string {
  const today = new Date();
  const cells = buildCalendarDays(year, month);
  return `
    <div class="orbita-mini-cal${calClass ? ` ${calClass}` : ""}">
      ${calendarHeadHtml(year, month, yearNav)}
      <div class="orbita-mini-cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="orbita-mini-cal-grid">
        ${cells
          .map((d) => {
            if (!d) return `<span class="orbita-mini-cal-cell is-empty"></span>`;
            const v = formatDateValue(d);
            const flags = cellFlags(v, d);
            const classes = ["orbita-mini-cal-cell"];
            if (flags.inRange) classes.push("is-in-range");
            if (flags.active) classes.push("is-active");
            if (flags.today ?? d.toDateString() === today.toDateString()) classes.push("is-today");
            return `<button type="button" class="${classes.join(" ")}" data-value="${escAttr(v)}">${d.getDate()}</button>`;
          })
          .join("")}
      </div>
      ${footer ? buildMiniCalFooterHtml() : ""}
    </div>`;
}

export { WEEKDAYS };
