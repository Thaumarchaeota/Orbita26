import "./time-picker.css";

import { mountPopoverPortal } from "./popover-portal";

import { CHEVRON_SVG } from "../integrations/ai/icons";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE_PRESETS = ["00", "15", "30", "45"] as const;

export function isValidHhMm(value: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

export function normalizeHhMm(value: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m || !isValidHhMm(value)) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

export type TimePickerOptions = {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
};

export type TimePickerHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  close: () => Promise<void>;
  dispose: () => void;
  root: HTMLElement;
};

export function mountTimePicker(
  container: HTMLElement,
  options: TimePickerOptions = {},
): TimePickerHandle {
  let value = normalizeHhMm(options.value ?? "");
  const placeholder = options.placeholder ?? "--:--";
  let draftHour: string | null = null;
  let draftMin: string | null = null;
  let panelBuilt = false;
  let columnScrollCleanup: Array<() => void> = [];

  container.innerHTML = `
    <div class="orbita-time-picker">
      <div class="orbita-time-picker-trigger">
        <input type="text" class="orbita-time-picker-input" inputmode="numeric" maxlength="5" placeholder="${placeholder}" autocomplete="off" aria-label="时间" />
        <button type="button" class="orbita-time-picker-chevron-btn" aria-label="打开时间选择" aria-haspopup="dialog" aria-expanded="false">
          ${CHEVRON_SVG}
        </button>
      </div>
      <div class="orbita-time-picker-menu scroll-slim motion-popover" role="presentation"></div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-time-picker")!;
  const trigger = root.querySelector<HTMLElement>(".orbita-time-picker-trigger")!;
  const input = root.querySelector<HTMLInputElement>(".orbita-time-picker-input")!;
  const chevronBtn = root.querySelector<HTMLButtonElement>(".orbita-time-picker-chevron-btn")!;
  const menu = root.querySelector<HTMLElement>(".orbita-time-picker-menu")!;

  const portal = mountPopoverPortal({
    anchor: trigger,
    popover: menu,
    onOpenChange: (open) => {
      chevronBtn.classList.toggle("is-open", open);
      trigger.classList.toggle("is-open", open);
      chevronBtn.setAttribute("aria-expanded", String(open));
      if (!open) {
        draftHour = null;
        draftMin = null;
      }
    },
  });

  const syncInput = () => {
    input.value = value;
  };

  const initDraftFromValue = () => {
    const normalized = normalizeHhMm(value);
    if (!normalized) {
      draftHour = null;
      draftMin = null;
      return;
    }
    const [h, m] = normalized.split(":");
    draftHour = h;
    draftMin = MINUTE_PRESETS.includes(m as (typeof MINUTE_PRESETS)[number]) ? m : null;
  };

  const formatDraftDisplay = (): string => {
    if (draftHour && draftMin) return `${draftHour}:${draftMin}`;
    if (draftHour && !draftMin) {
      const normalized = normalizeHhMm(value);
      if (normalized?.startsWith(`${draftHour}:`)) return normalized;
      return `${draftHour}:--`;
    }
    if (!draftHour && draftMin) return `--:${draftMin}`;
    return normalizeHhMm(value) || "--:--";
  };

  const applyValue = (next: string) => {
    value = next;
    syncInput();
    options.onChange?.(value);
  };

  const commitInput = () => {
    const raw = input.value.trim();
    if (!raw) {
      applyValue("");
      return;
    }
    const normalized = normalizeHhMm(raw);
    if (normalized) {
      applyValue(normalized);
    } else {
      syncInput();
    }
  };

  const applyDraftFromText = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      draftHour = null;
      draftMin = null;
      return;
    }
    const normalized = normalizeHhMm(trimmed);
    if (!normalized) return;
    const [h, m] = normalized.split(":");
    draftHour = h;
    draftMin = MINUTE_PRESETS.includes(m as (typeof MINUTE_PRESETS)[number]) ? m : null;
  };

  const commitPanelInput = (panelInput: HTMLInputElement) => {
    const raw = panelInput.value.trim();
    if (!raw) {
      draftHour = null;
      draftMin = null;
      updatePanelUi();
      return;
    }
    applyDraftFromText(raw);
    syncScrollPositions();
    updatePanelUi();
  };

  const tryCommitDraft = () => {
    const panelInput = menu.querySelector<HTMLInputElement>(".orbita-time-panel-input");
    if (panelInput) {
      const raw = panelInput.value.trim();
      if (!raw) {
        applyValue("");
        void portal.close();
        return true;
      }
      const normalized = normalizeHhMm(raw);
      if (normalized) {
        applyValue(normalized);
        void portal.close();
        return true;
      }
    }
    if (!draftHour || !draftMin) return false;
    applyValue(`${draftHour}:${draftMin}`);
    void portal.close();
    return true;
  };

  const updatePanelUi = () => {
    const panelInput = menu.querySelector<HTMLInputElement>(".orbita-time-panel-input");
    if (panelInput && document.activeElement !== panelInput) {
      panelInput.value = formatDraftDisplay();
    }

    menu.querySelectorAll<HTMLElement>(".orbita-time-wheel-item").forEach((item) => {
      const part = item.dataset.part;
      const v = item.dataset.value!;
      const selected = part === "h" ? draftHour === v : draftMin === v;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-selected", String(selected));
    });

    const confirmBtn = menu.querySelector<HTMLButtonElement>(".orbita-time-panel-confirm");
    if (confirmBtn) confirmBtn.disabled = !(draftHour && draftMin);
  };

  const scrollItemToCenter = (scrollEl: HTMLElement, selector: string) => {
    const item = scrollEl.querySelector<HTMLElement>(selector);
    item?.scrollIntoView({ block: "center" });
  };

  const syncScrollPositions = () => {
    const hourScroll = menu.querySelector<HTMLElement>(".orbita-time-wheel-scroll[data-part='h']");
    const minScroll = menu.querySelector<HTMLElement>(".orbita-time-wheel-scroll[data-part='m']");
    if (hourScroll && draftHour) {
      scrollItemToCenter(hourScroll, `[data-part='h'][data-value='${draftHour}']`);
    }
    if (minScroll && draftMin) {
      scrollItemToCenter(minScroll, `[data-part='m'][data-value='${draftMin}']`);
    }
  };

  const getCenteredValue = (scrollEl: HTMLElement): string | null => {
    const centerY = scrollEl.getBoundingClientRect().top + scrollEl.clientHeight / 2;
    let best: { dist: number; value: string } | null = null;
    scrollEl.querySelectorAll<HTMLElement>(".orbita-time-wheel-item").forEach((item) => {
      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(mid - centerY);
      if (!best || dist < best.dist) {
        best = { dist, value: item.dataset.value! };
      }
    });
    return best?.value ?? null;
  };

  const clearColumnScrollBindings = () => {
    for (const cleanup of columnScrollCleanup) cleanup();
    columnScrollCleanup = [];
  };

  const bindColumnScroll = (scrollEl: HTMLElement, part: "h" | "m") => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const centered = getCenteredValue(scrollEl);
        if (!centered) return;
        if (part === "h") {
          draftHour = centered;
          updatePanelUi();
        } else {
          draftMin = centered;
          updatePanelUi();
        }
      }, 80);
    };
    scrollEl.addEventListener("scroll", onScroll);
    return () => {
      clearTimeout(timer);
      scrollEl.removeEventListener("scroll", onScroll);
    };
  };

  const moveSelection = (scrollEl: HTMLElement, part: "h" | "m", delta: number) => {
    const values = part === "h" ? HOURS : [...MINUTE_PRESETS];
    const current = part === "h" ? draftHour : draftMin;
    const idx = current ? values.indexOf(current) : -1;
    const next = values[Math.max(0, Math.min(values.length - 1, idx + delta))]!;
    if (part === "h") {
      draftHour = next;
      scrollItemToCenter(scrollEl, `[data-part='h'][data-value='${next}']`);
      updatePanelUi();
    } else {
      draftMin = next;
      scrollItemToCenter(scrollEl, `[data-part='m'][data-value='${next}']`);
      updatePanelUi();
    }
  };

  const buildPanel = () => {
    // Rebuilding replaces the wheel nodes. Clear their debounce timers and
    // listeners first so repeated opens cannot retain detached columns.
    clearColumnScrollBindings();
    menu.innerHTML = `
      <div class="orbita-time-panel" role="dialog" aria-label="选择时间">
        <div class="orbita-time-panel-head">
          <input type="text" class="orbita-time-panel-input" inputmode="numeric" maxlength="5" placeholder="--:--" aria-label="输入时间" />
        </div>
        <div class="orbita-time-wheel">
          <div class="orbita-time-wheel-cols">
            <div class="orbita-time-wheel-band" aria-hidden="true"></div>
            <div class="orbita-time-wheel-col">
              <div class="orbita-time-wheel-col-label" id="orbita-time-hour-label">时</div>
              <div class="orbita-time-wheel-viewport">
                <div class="orbita-time-wheel-scroll scroll-slim" data-part="h" role="listbox" aria-labelledby="orbita-time-hour-label" tabindex="0">
                  <div class="orbita-time-wheel-spacer" aria-hidden="true"></div>
                  ${HOURS.map((h) => `<button type="button" class="orbita-time-wheel-item" data-part="h" data-value="${h}" role="option" aria-selected="false">${h}</button>`).join("")}
                  <div class="orbita-time-wheel-spacer" aria-hidden="true"></div>
                </div>
              </div>
            </div>
            <div class="orbita-time-wheel-col">
              <div class="orbita-time-wheel-col-label" id="orbita-time-min-label">分</div>
              <div class="orbita-time-wheel-viewport">
                <div class="orbita-time-wheel-scroll scroll-slim" data-part="m" role="listbox" aria-labelledby="orbita-time-min-label" tabindex="0">
                  <div class="orbita-time-wheel-spacer" aria-hidden="true"></div>
                  ${MINUTE_PRESETS.map((m) => `<button type="button" class="orbita-time-wheel-item" data-part="m" data-value="${m}" role="option" aria-selected="false">${m}</button>`).join("")}
                  <div class="orbita-time-wheel-spacer" aria-hidden="true"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="orbita-time-panel-foot">
          <button type="button" class="orbita-time-panel-clear">清除</button>
          <button type="button" class="orbita-time-panel-confirm">确定</button>
        </div>
      </div>`;

    if (!panelBuilt) {
      panelBuilt = true;
      menu.addEventListener("click", (e) => {
        const clearBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-time-panel-clear");
        if (clearBtn) {
          applyValue("");
          void portal.close();
          return;
        }
        const confirmBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-time-panel-confirm");
        if (confirmBtn) {
          tryCommitDraft();
          return;
        }
        const item = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-time-wheel-item");
        if (!item) return;
        const part = item.dataset.part as "h" | "m";
        const v = item.dataset.value!;
        if (part === "h") {
          draftHour = v;
          scrollItemToCenter(
            menu.querySelector<HTMLElement>(".orbita-time-wheel-scroll[data-part='h']")!,
            `[data-part='h'][data-value='${v}']`,
          );
          updatePanelUi();
        } else {
          draftMin = v;
          scrollItemToCenter(
            menu.querySelector<HTMLElement>(".orbita-time-wheel-scroll[data-part='m']")!,
            `[data-part='m'][data-value='${v}']`,
          );
          updatePanelUi();
        }
      });

      menu.addEventListener("blur", (e) => {
        const panelInput = (e.target as HTMLElement).closest<HTMLInputElement>(".orbita-time-panel-input");
        if (panelInput) commitPanelInput(panelInput);
      }, true);

      menu.addEventListener("keydown", (e) => {
        const panelInput = (e.target as HTMLElement).closest<HTMLInputElement>(".orbita-time-panel-input");
        if (panelInput) {
          if (e.key === "Enter") {
            e.preventDefault();
            tryCommitDraft();
          }
          return;
        }
        const scrollEl = (e.target as HTMLElement).closest<HTMLElement>(".orbita-time-wheel-scroll");
        if (!scrollEl) return;
        const part = scrollEl.dataset.part as "h" | "m";
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSelection(scrollEl, part, -1);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSelection(scrollEl, part, 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          tryCommitDraft();
        }
      });
    }

    menu.querySelectorAll<HTMLElement>(".orbita-time-wheel-scroll").forEach((scrollEl) => {
      const part = scrollEl.dataset.part as "h" | "m";
      columnScrollCleanup.push(bindColumnScroll(scrollEl, part));
    });

    updatePanelUi();
    syncScrollPositions();
    const panelInput = menu.querySelector<HTMLInputElement>(".orbita-time-panel-input");
    panelInput?.focus();
    panelInput?.select();
  };

  const openPanel = () => {
    if (portal.isOpen()) {
      void portal.close();
      return;
    }
    initDraftFromValue();
    buildPanel();
    void portal.open();
  };

  chevronBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPanel();
  });

  input.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  input.addEventListener("blur", () => {
    commitInput();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInput();
      void portal.close();
    }
  });

  syncInput();
  return {
    getValue: () => value,
    setValue: (v) => {
      value = normalizeHhMm(v);
      syncInput();
    },
    close: () => portal.close(),
    dispose: () => {
      clearColumnScrollBindings();
      portal.dispose();
    },
    root,
  };
}
