import "./date-picker.css";
import "./date-range-picker.css";
import { shanghaiDateParts, shanghaiIsoDateOffset } from "../core/shanghai-date";
import { CHEVRON_SVG } from "../integrations/ai/icons";
import { mountPopoverPortal } from "./popover-portal";
import {
  buildMiniCalendarHtml,
  formatDateLabelZh,
  parseDateValue,
} from "./date-picker-core";

export type DateRangeShortcut =
  | "today"
  | "last7"
  | "thisMonth"
  | "thisYear"
  | "all";

export type DateRangeValue = {
  from: string;
  to: string;
};

export type DateRangePickerOptions = {
  value?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
};

export type DateRangePickerHandle = {
  getValue: () => DateRangeValue;
  setValue: (value: DateRangeValue) => void;
  close: () => Promise<void>;
  dispose: () => void;
  root: HTMLElement;
};

const SHORTCUTS: { id: DateRangeShortcut; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "last7", label: "近7天" },
  { id: "thisMonth", label: "本月" },
  { id: "thisYear", label: "今年" },
  { id: "all", label: "全部时间" },
];

function todayParts(now: Date = new Date()): { y: number; m: number; d: number } {
  return shanghaiDateParts(now);
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function resolveDateRangeShortcut(id: DateRangeShortcut, now: Date = new Date()): DateRangeValue {
  const { y, m, d } = todayParts(now);
  const today = isoDate(y, m, d);
  if (id === "today") return { from: today, to: today };
  if (id === "last7") return { from: shanghaiIsoDateOffset(now, -6), to: today };
  if (id === "thisMonth") return { from: isoDate(y, m, 1), to: today };
  if (id === "thisYear") return { from: isoDate(y, 0, 1), to: today };
  return { from: "", to: "" };
}

function formatRangeLabel(value: DateRangeValue): string {
  if (!value.from && !value.to) return "全部时间";
  if (value.from && value.to) {
    if (value.from === value.to) return formatDateLabelZh(value.from);
    return `${formatDateLabelZh(value.from)} — ${formatDateLabelZh(value.to)}`;
  }
  if (value.from) return `${formatDateLabelZh(value.from)} 起`;
  return `至 ${formatDateLabelZh(value.to)}`;
}

type PickPhase = "idle" | "first" | "range";

export function mountDateRangePicker(
  container: HTMLElement,
  options: DateRangePickerOptions = {},
): DateRangePickerHandle {
  let value: DateRangeValue = { from: options.value?.from ?? "", to: options.value?.to ?? "" };
  let draft: DateRangeValue = { ...value };
  let year = todayParts().y;
  let month = todayParts().m;
  let phase: PickPhase = "idle";
  let anchorDate = "";

  container.innerHTML = `
    <div class="orbita-date-range-picker">
      <button type="button" class="orbita-date-range-picker-btn">
        <span class="orbita-date-range-picker-label"></span>
        <span class="orbita-date-range-picker-chevron">${CHEVRON_SVG}</span>
      </button>
      <div class="orbita-date-range-picker-menu scroll-slim motion-popover"></div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-date-range-picker")!;
  const btn = root.querySelector<HTMLButtonElement>(".orbita-date-range-picker-btn")!;
  const labelEl = root.querySelector<HTMLElement>(".orbita-date-range-picker-label")!;
  const menu = root.querySelector<HTMLElement>(".orbita-date-range-picker-menu")!;
  const portal = mountPopoverPortal({
    anchor: btn,
    popover: menu,
    onOpenChange: (open) => btn.classList.toggle("is-open", open),
  });

  const syncLabel = () => {
    labelEl.textContent = formatRangeLabel(value);
    labelEl.classList.toggle("is-placeholder", !value.from && !value.to);
  };

  const emit = () => options.onChange?.({ ...value });

  const inRange = (v: string): boolean => {
    if (!draft.from || !draft.to) return v === draft.from || v === draft.to;
    const [a, b] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from];
    return v >= a && v <= b;
  };

  const paint = () => {
    const calHtml = buildMiniCalendarHtml(year, month, (v) => {
      const endpoint = v === draft.from || v === draft.to;
      const ranged = inRange(v);
      return {
        active: endpoint,
        inRange: ranged && !endpoint,
      };
    }, "orbita-date-range-cal");
    menu.innerHTML = `
      <div class="orbita-date-range-panel">
        <div class="orbita-date-range-shortcuts">
          ${SHORTCUTS.map((s) => `<button type="button" class="orbita-date-range-shortcut" data-shortcut="${s.id}">${s.label}</button>`).join("")}
        </div>
        ${calHtml}
      </div>`;
    // A range selection is an immediate filter input.  The shared mini-calendar
    // footer also serves draft-based editors, but this picker has no deferred
    // confirmation: leaving that control visible would falsely imply a second step.
    menu.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.remove();
  };

  const publishDraft = () => {
    value = { ...draft };
    syncLabel();
    emit();
  };

  const applyPick = (picked: string) => {
    if (phase !== "first") {
      draft = { from: picked, to: picked };
      phase = "first";
      anchorDate = picked;
      publishDraft();
      paint();
      return;
    }
    if (picked < anchorDate) {
      draft = { from: picked, to: picked };
      anchorDate = picked;
    } else {
      draft = { from: anchorDate, to: picked };
      phase = "idle";
      anchorDate = "";
    }
    publishDraft();
    paint();
  };

  btn.addEventListener("click", () => {
    if (portal.isOpen()) {
      void portal.close();
      return;
    }
    draft = { ...value };
    phase = "idle";
    anchorDate = "";
    const parsed = parseDateValue(draft.from || draft.to);
    if (parsed) {
      year = parsed.getFullYear();
      month = parsed.getMonth();
    }
    paint();
    void portal.open();
  });

  menu.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]")?.dataset.action;
    if (action === "clear") {
      draft = { from: "", to: "" };
      phase = "idle";
      anchorDate = "";
      publishDraft();
      paint();
      return;
    }
    const shortcut = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-shortcut]");
    if (shortcut?.dataset.shortcut) {
      draft = resolveDateRangeShortcut(shortcut.dataset.shortcut as DateRangeShortcut);
      phase = "idle";
      anchorDate = "";
      publishDraft();
      paint();
      return;
    }
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
    applyPick(cell.dataset.value);
  });

  syncLabel();
  return {
    getValue: () => ({ ...value }),
    setValue: (v) => {
      value = { ...v };
      syncLabel();
    },
    close: () => portal.close(),
    dispose: portal.dispose,
    root,
  };
}
