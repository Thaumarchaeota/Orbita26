import "./date-picker.css";
import "./decoupled-picker.css";
import { mountPopoverPortal } from "./popover-portal";
import {
  buildMiniCalendarHtml,
  parseDateValue,
} from "./date-picker-core";
import { shanghaiYmd } from "./datetime-range-display";
import { isValidMaskDisplay } from "./decoupled-picker-mask";
import {
  mountDecoupledPickerTrigger,
  type DecoupledPickerTriggerOptions,
} from "./decoupled-picker-trigger";

export type DecoupledDatePickerOptions = DecoupledPickerTriggerOptions & {
  value?: string;
  onChange?: (value: string) => void;
  /** Fires for a day or today choice even when the committed value does not change. */
  onSelect?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  preserveInvalidInput?: boolean;
  inputPlaceholder?: string;
};

export type DecoupledDatePickerHandle = {
  getValue: () => string;
  getInputDisplay: () => string;
  setValue: (value: string) => void;
  open: () => void;
  close: () => Promise<void>;
  dispose: () => void;
};

function initialDate(value?: string): string {
  return value && isValidMaskDisplay("date", value) ? value : "";
}

export function mountDecoupledDatePicker(
  options: DecoupledDatePickerOptions,
): DecoupledDatePickerHandle {
  let value = initialDate(options.value);
  let draft = value;
  let year = parseDateValue(value)?.getFullYear() ?? new Date().getFullYear();
  let month = parseDateValue(value)?.getMonth() ?? new Date().getMonth();

  const publishFromDisplay = (display: string): boolean => {
    if (display !== "" && !isValidMaskDisplay("date", display)) return false;
    draft = display;
    if (value === display) return true;
    value = display;
    options.onChange?.(value);
    return true;
  };

  const trigger = mountDecoupledPickerTrigger(options, value, {
    kind: "date",
    preserveInvalidOnBlur: options.preserveInvalidInput,
    placeholder: options.inputPlaceholder,
    onCommit: publishFromDisplay,
    onEnter: () => {
      void portal.close();
    },
  });

  const menu = document.createElement("div");
  menu.className = "orbita-date-picker-menu orbita-standard-popover scroll-slim motion-popover";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "选择日期");

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

  const paint = () => {
    menu.innerHTML = buildMiniCalendarHtml(year, month, (v) => ({
      active: v === draft,
    }), "", true, false);
  };

  const publish = () => {
    trigger.sync(draft);
    if (value === draft) return;
    value = draft;
    options.onChange?.(value);
  };

  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !portal.isOpen()) return;
    if (!(event.target instanceof Node) || !menu.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    publish();
    void portal.close();
  };

  const requestOpen = () => {
    if (portal.isOpen()) return;
    draft = value;
    const parsed = parseDateValue(draft);
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
    const todayBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-mini-cal-month");
    // Same publish + closeSoon path as picking a day cell.
    if (todayBtn) {
      const today = shanghaiYmd();
      const parsed = parseDateValue(today);
      if (parsed) {
        year = parsed.getFullYear();
        month = parsed.getMonth();
      }
      draft = today;
      publish();
      options.onSelect?.(draft);
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
    draft = cell.dataset.value;
    publish();
    options.onSelect?.(draft);
    paint();
    closeSoon();
  });

  return {
    getValue: () => value,
    getInputDisplay: () => options.defaultTrigger ? trigger.getDisplay() : value,
    setValue: (v: string) => {
      value = initialDate(v);
      trigger.sync(value);
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
