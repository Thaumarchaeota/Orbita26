import "./date-picker.css";
import "./date-range-picker.css";
import "./decoupled-picker.css";
import { shanghaiDateParts } from "../core/shanghai-date";
import { mountPopoverPortal } from "./popover-portal";
import {
  buildMiniCalendarHtml,
  parseDateValue,
} from "./date-picker-core";
import {
  type DateRangeShortcut,
  type DateRangeValue,
  resolveDateRangeShortcut,
} from "./date-range-picker";
import { isValidMaskDisplay } from "./decoupled-picker-mask";
import {
  mountDecoupledPickerTrigger,
  type DecoupledPickerTriggerOptions,
} from "./decoupled-picker-trigger";

export type { DateRangeValue } from "./date-range-picker";

export type DecoupledDateRangePickerOptions = DecoupledPickerTriggerOptions & {
  value?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  onOpenChange?: (open: boolean) => void;
};

export type DecoupledDateRangePickerHandle = {
  getValue: () => DateRangeValue;
  setValue: (value: DateRangeValue) => void;
  open: () => void;
  close: () => Promise<void>;
  dispose: () => void;
};

const SHORTCUTS: { id: DateRangeShortcut; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "last7", label: "近7天" },
  { id: "thisMonth", label: "本月" },
  { id: "thisYear", label: "今年" },
];

function todayParts(now: Date = new Date()): { y: number; m: number; d: number } {
  return shanghaiDateParts(now);
}

type PickPhase = "idle" | "first" | "range";

function triggerLabel(value: DateRangeValue): string {
  return `${value.from}\t${value.to}`;
}

function parseRangeDisplay(display: string): DateRangeValue {
  const [from = "", to = ""] = display.split("\t");
  return {
    from: from && isValidMaskDisplay("date", from) ? from : from,
    to: to && isValidMaskDisplay("date", to) ? to : to,
  };
}

function initialRange(value?: DateRangeValue): DateRangeValue {
  const from = value?.from && isValidMaskDisplay("date", value.from) ? value.from : "";
  const to = value?.to && isValidMaskDisplay("date", value.to) ? value.to : "";
  return { from, to };
}

export function mountDecoupledDateRangePicker(
  options: DecoupledDateRangePickerOptions,
): DecoupledDateRangePickerHandle {
  let value: DateRangeValue = initialRange(options.value);
  let draft: DateRangeValue = { ...value };
  let year = todayParts().y;
  let month = todayParts().m;
  let phase: PickPhase = "idle";
  let anchorDate = "";

  const publishFromDisplay = (display: string): boolean => {
    const next = parseRangeDisplay(display);
    if (!next) return false;
    if (value.from === next.from && value.to === next.to) return true;
    value = next;
    options.onChange?.({ ...value });
    return true;
  };

  const trigger = mountDecoupledPickerTrigger(options, triggerLabel(value), {
    kind: "range",
    onCommit: publishFromDisplay,
    onEnter: () => {
      void portal.close();
    },
  });

  const menu = document.createElement("div");
  menu.className = "orbita-date-range-picker-menu orbita-standard-popover scroll-slim motion-popover";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "选择日期范围");

  let closeTimer = 0;
  const closeSoon = () => {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      void portal.close();
    }, 200);
  };

  const portal = mountPopoverPortal({
    anchor: trigger.anchor,
    popover: menu,
    onOpenChange: (open) => {
      trigger.setOpen(open);
      options.onOpenChange?.(open);
      if (open) {
        document.addEventListener("keydown", onEnter, true);
        return;
      }
      window.clearTimeout(closeTimer);
      closeTimer = 0;
      document.removeEventListener("keydown", onEnter, true);
    },
  });

  const emit = () => options.onChange?.({ ...value });

  const publish = () => {
    if (value.from === draft.from && value.to === draft.to) return;
    value = { ...draft };
    trigger.sync(triggerLabel(value));
    emit();
  };

  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !portal.isOpen()) return;
    if (event.target === trigger.anchor) return;
    event.preventDefault();
    publish();
    void portal.close();
  };

  const inRange = (v: string): boolean => {
    if (!draft.from || !draft.to) return v === draft.from || v === draft.to;
    const [a, b] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from];
    return v >= a && v <= b;
  };

  const markRangeRowEnds = () => {
    const cells = Array.from(menu.querySelectorAll<HTMLElement>(".orbita-mini-cal-cell"));
    for (let rowStart = 0; rowStart < cells.length; rowStart += 7) {
      const row = cells.slice(rowStart, rowStart + 7);
      const selected = row.filter((cell) =>
        cell.classList.contains("is-in-range") || cell.classList.contains("is-active"),
      );
      if (!selected.length) continue;
      selected[0]!.classList.add("is-range-row-start");
      selected[selected.length - 1]!.classList.add("is-range-row-end");
    }
  };

  const paint = () => {
    const calHtml = buildMiniCalendarHtml(year, month, (v) => {
      const endpoint = v === draft.from || v === draft.to;
      const ranged = inRange(v);
      return {
        active: endpoint,
        inRange: ranged,
      };
    }, "orbita-date-range-cal", true, false);
    menu.innerHTML = `
      <div class="orbita-date-range-panel">
        ${calHtml}
        <div class="orbita-date-range-shortcuts">
          ${SHORTCUTS.map((s) => `<button type="button" class="orbita-date-range-shortcut" data-shortcut="${s.id}">${s.label}</button>`).join("")}
        </div>
      </div>`;
    markRangeRowEnds();
  };

  const applyPick = (picked: string) => {
    if (phase !== "first") {
      draft = { from: picked, to: picked };
      phase = "first";
      anchorDate = picked;
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
    paint();
  };

  const requestOpen = () => {
    if (portal.isOpen()) return;
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
  };

  const open = () => {
    if (portal.isOpen()) {
      void portal.close();
      return;
    }
    requestOpen();
  };
  trigger.bindOpen(requestOpen);

  menu.addEventListener("click", (e) => {
    const shortcut = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-shortcut]");
    if (shortcut?.dataset.shortcut) {
      draft = resolveDateRangeShortcut(shortcut.dataset.shortcut as DateRangeShortcut);
      phase = "idle";
      anchorDate = "";
      const parsed = parseDateValue(draft.from || draft.to);
      if (parsed) {
        year = parsed.getFullYear();
        month = parsed.getMonth();
      }
      publish();
      paint();
      closeSoon();
      return;
    }
    const yearNav = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-mini-cal-year");
    if (yearNav) {
      year += Number(yearNav.dataset.dir);
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
    publish();
    if (phase === "idle") closeSoon();
  });

  return {
    getValue: () => ({ ...value }),
    setValue: (v) => {
      value = initialRange(v);
      trigger.sync(triggerLabel(value));
    },
    open,
    close: () => portal.close(),
    dispose: () => {
      window.clearTimeout(closeTimer);
      document.removeEventListener("keydown", onEnter, true);
      portal.dispose();
      trigger.dispose();
    },
  };
}
