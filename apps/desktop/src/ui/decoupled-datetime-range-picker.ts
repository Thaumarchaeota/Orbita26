import "./decoupled-picker.css";
import "./theme-action-motion.css";
import { runButtonAction } from "./action-motion";
import { createButton } from "./button";
import { isValidMaskDisplay } from "./decoupled-picker-mask";
import { mountDecoupledDatePicker } from "./decoupled-date-picker";
import { mountDecoupledTimePicker } from "./decoupled-time-picker";
import { mountDecoupledPickerTrigger, type DecoupledPickerTriggerOptions } from "./decoupled-picker-trigger";
import { mountPopoverPortal } from "./popover-portal";
import {
  emptyDateTimeRange,
  formatDateTimeRangeLabel,
  isDateTimeRangeComplete,
  shanghaiYmd,
  type DateTimeRangeValue,
} from "./datetime-range-display";

export type { DateTimeRangeValue };

export type DecoupledDateTimeRangePickerOptions = DecoupledPickerTriggerOptions & {
  value?: DateTimeRangeValue;
  defaultValue?: DateTimeRangeValue;
  wrapAtSeparator?: boolean;
  isEndAfterStart?: (value: DateTimeRangeValue) => boolean;
  validateConfirm?: (value: DateTimeRangeValue) => boolean;
  onChange?: (value: DateTimeRangeValue) => void;
  onOpenChange?: (open: boolean) => void;
};

export type DecoupledDateTimeRangePickerHandle = {
  getValue: () => DateTimeRangeValue;
  setValue: (value: DateTimeRangeValue) => void;
  open: () => void;
  close: () => Promise<void>;
  dispose: () => void;
};

function cloneRange(value?: DateTimeRangeValue): DateTimeRangeValue {
  return { ...(value ?? emptyDateTimeRange()) };
}

function paintTrigger(button: HTMLButtonElement, value: DateTimeRangeValue, wrapAtSeparator = false): void {
  const label = formatDateTimeRangeLabel(value, shanghaiYmd());
  button.textContent = label || "选择时间";
  if (!label || !wrapAtSeparator) return;
  const separator = value.startDate === value.endDate ? "-" : " - ";
  const split = value.startDate === value.endDate ? label.lastIndexOf(separator) : label.indexOf(separator);
  if (split < 0) return;
  const start = document.createElement("span");
  start.className = "orbita-datetime-range-trigger-part";
  start.textContent = label.slice(0, split) + separator;
  const end = document.createElement("span");
  end.className = "orbita-datetime-range-trigger-part";
  end.textContent = label.slice(split + separator.length);
  button.replaceChildren(start, document.createElement("wbr"), end);
}

export function mountDecoupledDateTimeRangePicker(
  options: DecoupledDateTimeRangePickerOptions,
): DecoupledDateTimeRangePickerHandle {
  let value = cloneRange(options.value);
  let draft = cloneRange(value);
  let defaultEligible = true;

  const trigger = mountDecoupledPickerTrigger(options, "", {
    kind: "datetime-range",
    onCommit: () => true,
  });
  const triggerElement = trigger.anchor;
  const syncTrigger = () => {
    if (options.defaultTrigger && triggerElement instanceof HTMLButtonElement) paintTrigger(triggerElement, value, options.wrapAtSeparator);
  };
  syncTrigger();

  const menu = document.createElement("div");
  menu.className = "orbita-datetime-range-popover orbita-standard-popover scroll-slim motion-popover";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "选择起止时间");
  menu.innerHTML = `
    <div class="orbita-datetime-range-row">
      <span class="orbita-datetime-range-label">开始时间</span>
      <div class="orbita-decoupled-picker-trigger orbita-decoupled-picker-trigger--range orbita-datetime-range-fields" role="group" aria-label="开始时间">
        <div class="orbita-datetime-range-date" data-role="start-date"></div>
        <span class="orbita-decoupled-range-sep" aria-hidden="true"></span>
        <div class="orbita-datetime-range-time" data-role="start-time"></div>
      </div>
    </div>
    <div class="orbita-datetime-range-row">
      <span class="orbita-datetime-range-label">结束时间</span>
      <div class="orbita-decoupled-picker-trigger orbita-decoupled-picker-trigger--range orbita-datetime-range-fields" role="group" aria-label="结束时间">
        <div class="orbita-datetime-range-date" data-role="end-date"></div>
        <span class="orbita-decoupled-range-sep" aria-hidden="true"></span>
        <div class="orbita-datetime-range-time" data-role="end-time"></div>
      </div>
    </div>
    <div class="orbita-datetime-range-foot">
      <button type="button" class="orbita-datetime-range-clear">清空</button>
      <span data-role="confirm-host"></span>
    </div>`;

  const confirmButton = createButton("确认", { width: 56, height: 32 });
  confirmButton.classList.add("orbita-datetime-range-confirm");
  confirmButton.dataset.action = "confirm";
  menu.querySelector('[data-role="confirm-host"]')!.replaceWith(confirmButton);

  const startDateMount = menu.querySelector<HTMLElement>('[data-role="start-date"]')!;
  const startTimeMount = menu.querySelector<HTMLElement>('[data-role="start-time"]')!;
  const endDateMount = menu.querySelector<HTMLElement>('[data-role="end-date"]')!;
  const endTimeMount = menu.querySelector<HTMLElement>('[data-role="end-time"]')!;
  let disposed = false;
  let childGeneration = 0;
  let openChild: number | null = null;
  const childOpenChange = (index: number, open: boolean) => {
    if (open) openChild = index;
    else if (openChild === index) openChild = null;
  };

  const startDate = mountDecoupledDatePicker({
    preserveInvalidInput: true,
    inputPlaceholder: "日期",
    onOpenChange: (open) => childOpenChange(0, open),
    defaultTrigger: { container: startDateMount },
    value: draft.startDate,
    onChange: (next) => {
      draft.startDate = next;
    },
  });
  const startTime = mountDecoupledTimePicker({
    preserveInvalidInput: true,
    inputPlaceholder: "时间",
    onOpenChange: (open) => childOpenChange(1, open),
    defaultTrigger: { container: startTimeMount },
    value: draft.startTime,
    onChange: (next) => {
      draft.startTime = next;
    },
  });
  const endDate = mountDecoupledDatePicker({
    preserveInvalidInput: true,
    inputPlaceholder: "日期",
    onOpenChange: (open) => childOpenChange(2, open),
    defaultTrigger: { container: endDateMount },
    value: draft.endDate,
    onChange: (next) => {
      draft.endDate = next;
    },
  });
  const endTime = mountDecoupledTimePicker({
    preserveInvalidInput: true,
    inputPlaceholder: "时间",
    onOpenChange: (open) => childOpenChange(3, open),
    defaultTrigger: { container: endTimeMount },
    value: draft.endTime,
    onChange: (next) => {
      draft.endTime = next;
    },
  });

  const children = [startDate, startTime, endDate, endTime];
  const childMounts = [startDateMount, startTimeMount, endDateMount, endTimeMount];
  const closeChildren = () => Promise.all(children.map((child) => child.close())).then(() => {});
  const childIndex = (target: EventTarget | null) => target instanceof HTMLInputElement
    ? childMounts.findIndex((mount) => mount.contains(target)) : -1;
  for (const mount of childMounts) mount.querySelector("input")?.setAttribute("aria-keyshortcuts", "Alt+ArrowDown");
  const requestChildOpen = (index: number, focusedInput?: HTMLInputElement) => {
    if (openChild === index) return;
    const generation = ++childGeneration;
    void closeChildren().then(() => {
      if (!disposed && generation === childGeneration && portal.isOpen()
        && (!focusedInput || document.activeElement === focusedInput)) children[index]!.open();
    }).catch(() => {});
  };
  const onChildPointerDown = (event: PointerEvent) => {
    const index = childIndex(event.target);
    if (index < 0) return;
    // Own opening here so the next picker cannot enter before the previous exit completes.
    event.stopPropagation();
    requestChildOpen(index);
  };
  const onChildKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== "ArrowDown") return;
    const index = childIndex(event.target);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    requestChildOpen(index, event.target as HTMLInputElement);
  };
  menu.addEventListener("pointerdown", onChildPointerDown, true);
  menu.addEventListener("keydown", onChildKeyDown, true);

  const syncDraftIntoPickers = () => {
    startDate.setValue(draft.startDate);
    startTime.setValue(draft.startTime);
    endDate.setValue(draft.endDate);
    endTime.setValue(draft.endTime);
  };

  const portal = mountPopoverPortal({
    anchor: triggerElement,
    popover: menu,
    onOpenChange: (open) => {
      if (!open) {
        childGeneration += 1;
        void closeChildren().catch(() => {});
      }
      trigger.setOpen(open);
      options.onOpenChange?.(open);
    },
  });

  const commit = (next: DateTimeRangeValue) => {
    defaultEligible = false;
    value = cloneRange(next);
    syncTrigger();
    options.onChange?.(cloneRange(value));
  };

  const requestOpen = () => {
    if (portal.isOpen()) return;
    const hasValue = Boolean(value.startDate || value.startTime || value.endDate || value.endTime);
    draft = cloneRange(!hasValue && defaultEligible && options.defaultValue ? options.defaultValue : value);
    syncDraftIntoPickers();
    void portal.open();
  };

  trigger.bindOpen(() => {
    if (portal.isOpen()) void portal.close();
    else requestOpen();
  });

  const reject = () => {
    void runButtonAction(confirmButton, { task: () => { throw new Error("Invalid range"); }, error: true }).catch(() => {});
  };

  menu.querySelector(".orbita-datetime-range-clear")!.addEventListener("click", () => {
    if (options.validateConfirm?.(emptyDateTimeRange()) === false) { reject(); return; }
    draft = emptyDateTimeRange();
    commit(draft);
    void portal.close();
  });

  confirmButton.addEventListener("click", () => {
    const displays = [startDate.getInputDisplay(), startTime.getInputDisplay(), endDate.getInputDisplay(), endTime.getInputDisplay()];
    if (!displays.every((display, index) => isValidMaskDisplay(index % 2 === 0 ? "date" : "time", display))) {
      reject();
      return;
    }
    const complete = isDateTimeRangeComplete(draft);
    const empty = !draft.startDate && !draft.startTime && !draft.endDate && !draft.endTime;
    const afterStart = complete && (options.isEndAfterStart
      ? options.isEndAfterStart(cloneRange(draft))
      : `${draft.endDate}T${draft.endTime}` > `${draft.startDate}T${draft.startTime}`);
    if ((!empty && !afterStart) || options.validateConfirm?.(cloneRange(draft)) === false) {
      reject();
      return;
    }
    commit(complete ? draft : emptyDateTimeRange());
    void portal.close();
  });

  return {
    getValue: () => cloneRange(value),
    setValue: (next) => {
      defaultEligible = false;
      value = cloneRange(next);
      draft = cloneRange(next);
      syncTrigger();
      if (portal.isOpen()) syncDraftIntoPickers();
    },
    open: requestOpen,
    close: () => portal.close(),
    dispose: () => {
      disposed = true;
      childGeneration += 1;
      menu.removeEventListener("pointerdown", onChildPointerDown, true);
      menu.removeEventListener("keydown", onChildKeyDown, true);
      startDate.dispose();
      startTime.dispose();
      endDate.dispose();
      endTime.dispose();
      portal.dispose();
      trigger.dispose();
    },
  };
}
