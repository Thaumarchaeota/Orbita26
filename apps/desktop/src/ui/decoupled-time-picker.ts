import "./decoupled-picker.css";

import { mountPopoverPortal } from "./popover-portal";
import { isValidMaskDisplay } from "./decoupled-picker-mask";
import {
  mountDecoupledPickerTrigger,
  type DecoupledPickerTriggerOptions,
} from "./decoupled-picker-trigger";
import {
  bindDecoupledTimeWheels,
  buildDecoupledTimeWheelsHtml,
  normalizeDecoupledHhMm,
} from "./decoupled-time-wheels";

export type DecoupledTimeCommitMode = "confirm" | "change";

export type DecoupledTimePickerOptions = DecoupledPickerTriggerOptions & {
  value?: string;
  /**
   * Default `confirm`: wheel 调整须点「确认」才 `onConfirm` 并关闭弹层。
   * `change`：不呈现「确认」；滚轮落定出完整有效 `HH:mm` 即 `onConfirm`（不关弹层，外侧点击/Esc 仍按标准 popover 关闭）。
   */
  commitMode?: DecoupledTimeCommitMode;
  onChange?: (value: string) => void;
  /** Fires on 确认 even when the committed time does not change. */
  onConfirm?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  preserveInvalidInput?: boolean;
  inputPlaceholder?: string;
};

export type DecoupledTimePickerHandle = {
  getValue: () => string;
  getInputDisplay: () => string;
  setValue: (value: string) => void;
  open: () => void;
  close: () => Promise<void>;
  dispose: () => void;
};

function initialTime(value?: string): string {
  const normalized = value ? normalizeDecoupledHhMm(value) : "";
  return normalized || "";
}

function shanghaiNowHhMm(now: Date = new Date()): string {
  return now
    .toLocaleTimeString("sv-SE", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .slice(0, 5);
}

export function mountDecoupledTimePicker(
  options: DecoupledTimePickerOptions,
): DecoupledTimePickerHandle {
  const commitMode = options.commitMode ?? "confirm";
  let value = initialTime(options.value);
  let draft = value;

  const publishFromDisplay = (display: string): boolean => {
    if (display !== "" && !isValidMaskDisplay("time", display)) return false;
    draft = display;
    if (value === display) return true;
    value = display;
    options.onChange?.(value);
    return true;
  };

  const trigger = mountDecoupledPickerTrigger(options, value, {
    kind: "time",
    preserveInvalidOnBlur: options.preserveInvalidInput,
    placeholder: options.inputPlaceholder,
    onCommit: publishFromDisplay,
    onEnter: () => {
      void portal.close();
    },
  });

  const menu = document.createElement("div");
  menu.className = "orbita-time-wheel-menu orbita-standard-popover scroll-slim motion-popover";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "选择时间");
  menu.innerHTML = `
    ${buildDecoupledTimeWheelsHtml()}
    <div class="orbita-time-wheel-foot">
      <button type="button" class="orbita-time-wheel-now">现在</button>
      <button type="button" class="orbita-time-wheel-confirm">确认</button>
    </div>`;
  const confirmBtn = menu.querySelector<HTMLButtonElement>(".orbita-time-wheel-confirm");
  if (commitMode === "change") confirmBtn?.setAttribute("hidden", "");

  const portal = mountPopoverPortal({
    anchor: trigger.anchor,
    popover: menu,
    onOpenChange: (open) => {
      trigger.setOpen(open);
      options.onOpenChange?.(open);
      if (open) return;
      wheels.deactivate();
      if (!options.preserveInvalidInput || isValidMaskDisplay("time", trigger.getDisplay())) trigger.sync(value);
    },
  });

  const publishDraft = (closeAfter: boolean) => {
    const next = draft;
    if (next !== "" && !isValidMaskDisplay("time", next)) return;
    draft = next;
    trigger.sync(next);
    options.onConfirm?.(next);
    if (value !== next) {
      value = next;
      options.onChange?.(value);
    }
    if (closeAfter) void portal.close();
  };

  const wheels = bindDecoupledTimeWheels(menu, (next) => {
    draft = next;
    trigger.sync(next);
    if (commitMode === "change") publishDraft(false);
  });

  const confirm = () => {
    wheels.settle();
    publishDraft(true);
  };

  const applyNow = () => {
    wheels.load(shanghaiNowHhMm());
    draft = wheels.getDraft();
    trigger.sync(draft);
    requestAnimationFrame(wheels.align);
    if (commitMode === "change") publishDraft(false);
  };

  const requestOpen = () => {
    if (portal.isOpen()) return;
    wheels.activate();
    draft = value;
    wheels.load(draft || "00:00");
    // An empty value has a visible wheel selection, but it is only committed on confirmation.
    if (!draft) draft = wheels.getDraft();
    void portal.open();
    requestAnimationFrame(wheels.align);
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
    const target = e.target as HTMLElement;
    if (target.closest(".orbita-time-wheel-now")) {
      e.preventDefault();
      applyNow();
      return;
    }
    const confirmBtn = target.closest<HTMLButtonElement>(".orbita-time-wheel-confirm");
    if (!confirmBtn) return;
    e.preventDefault();
    confirm();
  });

  menu.addEventListener("keydown", (e) => {
    if (commitMode !== "confirm" || e.key !== "Enter") return;
    if (e.target instanceof Element && e.target.closest(".orbita-time-wheel-item")) return;
    const scroll = (e.target as HTMLElement).closest<HTMLElement>(".orbita-time-wheel-scroll");
    if (!scroll) return;
    e.preventDefault();
    confirm();
  });

  return {
    getValue: () => value,
    getInputDisplay: () => options.defaultTrigger ? trigger.getDisplay() : value,
    setValue: (v) => {
      value = initialTime(v);
      trigger.sync(value);
    },
    open,
    close: () => portal.close(),
    dispose: () => {
      wheels.dispose();
      portal.dispose();
      trigger.dispose();
    },
  };
}
