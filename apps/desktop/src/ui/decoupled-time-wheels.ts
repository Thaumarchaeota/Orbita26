const HOUR_COUNT = 24;
const MINUTE_STEP = 5;

const pad = (n: number): string => String(n).padStart(2, "0");

export const DECOUPLED_TIME_HOURS = Array.from({ length: HOUR_COUNT }, (_, i) => pad(i));
export const DECOUPLED_TIME_MINUTES = Array.from(
  { length: 60 / MINUTE_STEP },
  (_, i) => pad(i * MINUTE_STEP),
);

export function normalizeDecoupledHhMm(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > HOUR_COUNT - 1 || minute > 59) return "";
  return `${pad(hour)}:${pad(minute)}`;
}

export function snapDecoupledMinute(minute: number): string {
  const snapped = Math.round(minute / MINUTE_STEP) * MINUTE_STEP;
  return pad(Math.min(60 - MINUTE_STEP, Math.max(0, snapped)));
}

function columnHtml(part: "h" | "m", label: string, values: string[]): string {
  return `
    <div class="orbita-time-wheel-col">
      <div class="orbita-time-wheel-scroll scroll-slim" data-part="${part}" role="listbox" aria-label="${label}" tabindex="0">
        <div class="orbita-time-wheel-pad" aria-hidden="true"></div>
        ${values.map((v) => `<button type="button" class="orbita-time-wheel-item" data-part="${part}" data-value="${v}" role="option">${v}</button>`).join("")}
        <div class="orbita-time-wheel-pad" aria-hidden="true"></div>
      </div>
    </div>`;
}

export function buildDecoupledTimeWheelsHtml(): string {
  return `
    <div class="orbita-time-wheels">
      <div class="orbita-time-wheel-band" aria-hidden="true"></div>
      ${columnHtml("h", "时", DECOUPLED_TIME_HOURS)}
      ${columnHtml("m", "分", DECOUPLED_TIME_MINUTES)}
    </div>`;
}

export type DecoupledTimeWheelsHandle = {
  load: (raw: string) => void;
  align: () => void;
  getDraft: () => string;
  activate: () => void;
  deactivate: () => void;
  settle: () => void;
  dispose: () => void;
};

export function bindDecoupledTimeWheels(
  menu: HTMLElement,
  onChange: (value: string) => void,
): DecoupledTimeWheelsHandle {
  let draftHour = DECOUPLED_TIME_HOURS[0]!;
  let draftMin = DECOUPLED_TIME_MINUTES[0]!;
  let programmatic = false;
  let active = false;
  const scrollTimers = new Set<number>();
  const clearScrollTimers: Array<() => void> = [];
  const cleanups: Array<() => void> = [];

  const scrollOf = (part: "h" | "m"): HTMLElement =>
    menu.querySelector<HTMLElement>(`.orbita-time-wheel-scroll[data-part="${part}"]`)!;

  const paint = () => {
    menu.querySelectorAll<HTMLElement>(".orbita-time-wheel-item").forEach((item) => {
      const selected = item.dataset.part === "h"
        ? item.dataset.value === draftHour
        : item.dataset.value === draftMin;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-selected", String(selected));
    });
  };

  const centeredValue = (scroll: HTMLElement): string | null => {
    const centerY = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
    let best: { dist: number; value: string } | null = null;
    scroll.querySelectorAll<HTMLElement>(".orbita-time-wheel-item").forEach((item) => {
      const rect = item.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - centerY);
      if (!best || dist < best.dist) best = { dist, value: item.dataset.value! };
    });
    return best?.value ?? null;
  };

  const scrollToValue = (part: "h" | "m", next: string) => {
    const scroll = scrollOf(part);
    const item = scroll.querySelector<HTMLElement>(`[data-value="${next}"]`);
    if (!item) return;
    scroll.scrollTop = item.offsetTop - (scroll.clientHeight - item.offsetHeight) / 2;
  };

  const withProgrammaticScroll = (move: () => void) => {
    programmatic = true;
    move();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      programmatic = false;
    }));
  };

  const applyDraft = () => onChange(`${draftHour}:${draftMin}`);

  const includeMinute = (minute: string) => {
    const scroll = scrollOf("m");
    scroll.querySelector('[data-extra-minute]')?.remove();
    if (DECOUPLED_TIME_MINUTES.includes(minute)) return;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "orbita-time-wheel-item";
    item.dataset.part = "m";
    item.dataset.value = minute;
    item.dataset.extraMinute = "";
    item.setAttribute("role", "option");
    item.textContent = minute;
    const following = [...scroll.querySelectorAll<HTMLElement>(".orbita-time-wheel-item")]
      .find((candidate) => (candidate.dataset.value ?? "") > minute);
    scroll.insertBefore(item, following ?? scroll.lastElementChild);
  };

  const readCentered = () => {
    const hour = centeredValue(scrollOf("h"));
    const minute = centeredValue(scrollOf("m"));
    if (hour) draftHour = hour;
    if (minute) draftMin = minute;
    paint();
    applyDraft();
  };

  const load = (raw: string) => {
    const normalized = normalizeDecoupledHhMm(raw);
    if (!normalized) {
      draftHour = DECOUPLED_TIME_HOURS[0]!;
      draftMin = DECOUPLED_TIME_MINUTES[0]!;
      includeMinute(draftMin);
      paint();
      return;
    }
    const [hour, minute] = normalized.split(":");
    draftHour = hour!;
    draftMin = minute!;
    includeMinute(draftMin);
    paint();
  };

  const align = () => {
    withProgrammaticScroll(() => {
      scrollToValue("h", draftHour);
      scrollToValue("m", draftMin);
    });
    paint();
  };

  const bindScroll = (part: "h" | "m") => {
    const scroll = scrollOf(part);
    let timer = 0;
    const clearTimer = () => {
      window.clearTimeout(timer);
      scrollTimers.delete(timer);
      timer = 0;
    };
    const onScroll = () => {
      if (!active || programmatic) return;
      clearTimer();
      timer = window.setTimeout(() => {
        clearTimer();
        if (active) readCentered();
      }, 80);
      scrollTimers.add(timer);
    };
    const onScrollEnd = () => {
      if (!active || programmatic) return;
      clearTimer();
      readCentered();
    };
    clearScrollTimers.push(clearTimer);
    scroll.addEventListener("scroll", onScroll);
    scroll.addEventListener("scrollend", onScrollEnd);
    cleanups.push(() => {
      clearTimer();
      scroll.removeEventListener("scroll", onScroll);
      scroll.removeEventListener("scrollend", onScrollEnd);
    });
  };

  bindScroll("h");
  bindScroll("m");

  const onClick = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>(".orbita-time-wheel-item");
    if (!item?.dataset.value || !item.dataset.part) return;
    const part = item.dataset.part as "h" | "m";
    if (part === "h") draftHour = item.dataset.value;
    else draftMin = item.dataset.value;
    withProgrammaticScroll(() => scrollToValue(part, item.dataset.value!));
    paint();
    applyDraft();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const scroll = (e.target as HTMLElement).closest<HTMLElement>(".orbita-time-wheel-scroll");
    if (!scroll) return;
    const part = scroll.dataset.part as "h" | "m";
    const values = part === "h" ? DECOUPLED_TIME_HOURS
      : [...scroll.querySelectorAll<HTMLElement>(".orbita-time-wheel-item")].map((item) => item.dataset.value!);
    const current = part === "h" ? draftHour : draftMin;
    const index = values.indexOf(current);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? -1 : 1;
      const next = values[Math.max(0, Math.min(values.length - 1, index + delta))]!;
      if (part === "h") draftHour = next;
      else draftMin = next;
      withProgrammaticScroll(() => scrollToValue(part, next));
      paint();
      applyDraft();
    }
  };

  menu.addEventListener("click", onClick);
  menu.addEventListener("keydown", onKeyDown);
  cleanups.push(() => {
    menu.removeEventListener("click", onClick);
    menu.removeEventListener("keydown", onKeyDown);
  });

  return {
    load,
    align,
    getDraft: () => `${draftHour}:${draftMin}`,
    activate: () => { active = true; },
    deactivate: () => {
      active = false;
      for (const clear of clearScrollTimers) clear();
    },
    settle: () => {
      if (!active || scrollTimers.size === 0) return;
      for (const clear of clearScrollTimers) clear();
      readCentered();
    },
    dispose: () => {
      active = false;
      for (const cleanup of cleanups) cleanup();
    },
  };
}
