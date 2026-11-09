import "./decoupled-picker.css";

import { mountDecoupledDatePicker } from "./decoupled-date-picker";
import { mountDecoupledTimePicker } from "./decoupled-time-picker";
import { isValidMaskDisplay } from "./decoupled-picker-mask";
import { type DecoupledPickerTriggerOptions } from "./decoupled-picker-trigger";
import { normalizeDecoupledHhMm } from "./decoupled-time-wheels";
import { shanghaiYmd } from "./datetime-range-display";

// Date, then the shared time picker. The chosen date is kept only until 确认.
// Closing either step without 确认 does not call onChange. See docs/UI-PRIMITIVES.md.

export type DateTimeValue = {
  date: string;
  time: string;
};

export type DecoupledDateTimeCommitMode = "confirm" | "change";

export type DecoupledDateTimePickerOptions = DecoupledPickerTriggerOptions & {
  value?: DateTimeValue;
  /** Default `confirm`: 时间层点「确认」才写入。`change`：完整有效时间由标准时间控件滚轮落定即写入（无「确认」），须日期、时间均完整。 */
  commitMode?: DecoupledDateTimeCommitMode;
  onChange?: (value: DateTimeValue) => void;
  onOpenChange?: (open: boolean) => void;
};

export type DecoupledDateTimePickerHandle = {
  getValue: () => DateTimeValue;
  setValue: (value: DateTimeValue) => void;
  open: () => void;
  close: () => Promise<void>;
  dispose: () => void;
};

function clonePoint(value?: DateTimeValue): DateTimeValue {
  const date = value?.date && isValidMaskDisplay("date", value.date) ? value.date : "";
  const time = value?.time ? normalizeDecoupledHhMm(value.time) : "";
  return { date, time };
}

function isComplete(value: DateTimeValue): boolean {
  return Boolean(value.date && value.time);
}

function formatPointLabel(value: DateTimeValue, todayYmd: string): string {
  if (!isComplete(value)) return "";
  if (value.date === todayYmd) return value.time;
  if (value.date.slice(0, 4) === todayYmd.slice(0, 4)) return `${value.date.slice(5)} ${value.time}`;
  return `${value.date} ${value.time}`;
}

export function mountDecoupledDateTimePicker(
  options: DecoupledDateTimePickerOptions,
): DecoupledDateTimePickerHandle {
  const commitMode = options.commitMode ?? "confirm";
  let value = clonePoint(options.value);
  let pendingDate: string | null = null;
  let stage: "closed" | "date" | "time" = "closed";
  let confirmed = false;
  let openNotified = false;
  let disposed = false;

  const button = options.defaultTrigger ? document.createElement("button") : null;
  if (button && options.defaultTrigger) {
    button.type = "button";
    button.className = [
      "orbita-decoupled-picker-trigger",
      "orbita-decoupled-picker-trigger--datetime-point",
      options.defaultTrigger.className,
    ].filter(Boolean).join(" ");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "日期时间");
    options.defaultTrigger.container.appendChild(button);
  }
  const anchor = button ?? options.anchor!;

  const paintTrigger = () => {
    if (!button) return;
    button.textContent = formatPointLabel(value, shanghaiYmd()) || "选择日期时间";
  };
  paintTrigger();

  const setExpanded = (open: boolean) => {
    button?.setAttribute("aria-expanded", String(open));
    if (open === openNotified) return;
    openNotified = open;
    options.onOpenChange?.(open);
  };

  let timePicker!: ReturnType<typeof mountDecoupledTimePicker>;
  const openTime = (date: string) => {
    pendingDate = date;
    confirmed = false;
    stage = "time";
    timePicker.setValue(value.time);
    timePicker.open();
  };

  const datePicker = mountDecoupledDatePicker({
    anchor,
    value: value.date,
    onSelect: (next) => {
      pendingDate = next;
    },
    onOpenChange: (open) => {
      if (disposed) return;
      if (open) {
        stage = "date";
        setExpanded(true);
        return;
      }
      if (stage !== "date") return;
      const chosen = pendingDate;
      stage = "closed";
      if (!chosen) {
        setExpanded(false);
        return;
      }
      openTime(chosen);
    },
  });

  const timePickerHandle = mountDecoupledTimePicker({
    anchor,
    value: value.time,
    commitMode,
    onConfirm: (time) => {
      if (!pendingDate) return;
      confirmed = true;
      const next = clonePoint({ date: pendingDate, time });
      pendingDate = null;
      const changed = next.date !== value.date || next.time !== value.time;
      value = next;
      paintTrigger();
      datePicker.setValue(value.date);
      timePicker.setValue(value.time);
      if (commitMode === "change" || changed) {
        options.onChange?.(clonePoint(value));
      }
    },
    onOpenChange: (open) => {
      if (disposed) return;
      if (open) {
        stage = "time";
        setExpanded(true);
        return;
      }
      if (stage !== "time") return;
      stage = "closed";
      if (!confirmed) pendingDate = null;
      confirmed = false;
      setExpanded(false);
    },
  });
  timePicker = timePickerHandle;

  const openDate = () => {
    if (stage !== "closed") return;
    pendingDate = null;
    confirmed = false;
    datePicker.setValue(value.date);
    datePicker.open();
  };

  button?.addEventListener("click", () => {
    if (stage === "date") {
      pendingDate = null;
      void datePicker.close();
      return;
    }
    if (stage === "time") {
      pendingDate = null;
      confirmed = false;
      void timePicker.close();
      return;
    }
    openDate();
  });

  return {
    getValue: () => clonePoint(value),
    setValue: (next) => {
      value = clonePoint(next);
      paintTrigger();
      if (stage !== "closed") return;
      datePicker.setValue(value.date);
      timePicker.setValue(value.time);
    },
    open: openDate,
    close: () => {
      pendingDate = null;
      confirmed = false;
      if (stage === "time") return timePicker.close();
      return datePicker.close();
    },
    dispose: () => {
      disposed = true;
      pendingDate = null;
      timePicker.dispose();
      datePicker.dispose();
      button?.remove();
    },
  };
}
