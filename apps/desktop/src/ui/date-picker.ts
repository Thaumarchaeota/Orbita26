import "./date-picker.css";
import { escAttr } from "../core/html";
import { CHEVRON_SVG } from "../integrations/ai/icons";
import { mountPopoverPortal } from "./popover-portal";
import {
  buildMiniCalendarHtml,
  formatDateValue,
  parseDateValue,
} from "./date-picker-core";

export { formatDateLabelZh } from "./date-picker-core";

export type DatePickerOptions = {
  value?: string;
  placeholder?: string;
  compact?: boolean;
  showChevron?: boolean;
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
  const placeholder = options.placeholder ?? "yyyy-mm-dd";
  const showChevron = options.showChevron !== false;
  let value = options.value ?? "";
  let draft = value;
  container.innerHTML = `
    <div class="orbita-date-picker${options.compact ? " is-compact" : ""}${showChevron ? "" : " is-no-chevron"}">
      <div class="orbita-date-picker-trigger">
        <input type="text" class="orbita-date-picker-input" placeholder="${escAttr(placeholder)}" autocomplete="off" />
        ${showChevron ? `<button type="button" class="orbita-date-picker-chevron-btn" aria-label="打开日历">${CHEVRON_SVG}</button>` : ""}
      </div>
      <div class="orbita-date-picker-menu scroll-slim motion-popover"></div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-date-picker")!;
  const trigger = root.querySelector<HTMLElement>(".orbita-date-picker-trigger")!;
  const input = root.querySelector<HTMLInputElement>(".orbita-date-picker-input")!;
  const chevronBtn = root.querySelector<HTMLButtonElement>(".orbita-date-picker-chevron-btn");
  const menu = root.querySelector<HTMLElement>(".orbita-date-picker-menu")!;
  input.readOnly = true;
  const portal = mountPopoverPortal({
    anchor: trigger,
    popover: menu,
    onOpenChange: (open) => {
      chevronBtn?.classList.toggle("is-open", open);
      trigger.classList.toggle("is-open", open);
    },
  });
  let year = parseDateValue(value)?.getFullYear() ?? new Date().getFullYear();
  let month = parseDateValue(value)?.getMonth() ?? new Date().getMonth();

  const syncInput = () => {
    input.value = value;
  };

  const paint = () => {
    menu.innerHTML = buildMiniCalendarHtml(year, month, (v) => ({
      active: v === draft,
    }));
  };

  const close = () => portal.close();

  const openPicker = () => {
    if (portal.isOpen()) {
      void close();
      return;
    }
    draft = value;
    const parsed = parseDateValue(draft);
    if (parsed) {
      year = parsed.getFullYear();
      month = parsed.getMonth();
    }
    paint();
    void portal.open();
  };

  const commitDraft = () => {
    value = draft;
    syncInput();
    options.onChange?.(value);
    void close();
  };

  chevronBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker();
  });

  trigger.addEventListener("click", (e) => {
    if (chevronBtn && e.target === chevronBtn) return;
    openPicker();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openPicker();
    }
  });

  menu.addEventListener("click", async (e) => {
    const action = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]")?.dataset.action;
    if (action === "clear") {
      draft = "";
      paint();
      return;
    }
    if (action === "confirm") {
      commitDraft();
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
    paint();
  });

  syncInput();
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
      syncInput();
    },
    close,
    dispose: portal.dispose,
    root,
  };
}
