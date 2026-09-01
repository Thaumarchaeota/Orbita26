import { mountSwatchToggleGrid } from "../../../../ui/swatch-toggle-grid";
import { METRIC_COLORS } from "./colors";
import { legendIconSvg } from "./icons";
import { LEGEND_ITEMS, LEGEND_STORAGE_KEY, type LegendKey } from "./types";

export type LegendState = Record<LegendKey, boolean>;

function defaultState(): LegendState {
  const s = {} as LegendState;
  for (const item of LEGEND_ITEMS) s[item.key] = item.defaultOn;
  s.nap = s.sleep;
  s.hrv = s.sleep;
  return s;
}

export function loadLegendState(): LegendState {
  try {
    const raw = localStorage.getItem(LEGEND_STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<LegendState>;
    const s = defaultState();
    for (const item of LEGEND_ITEMS) {
      if (typeof parsed[item.key] === "boolean") s[item.key] = parsed[item.key]!;
    }
    if (typeof parsed.sleep === "boolean") {
      s.sleep = parsed.sleep;
    } else if (typeof parsed.nap === "boolean") {
      s.sleep = s.sleep || parsed.nap;
    }
    s.nap = s.sleep;
    s.hrv = s.sleep;
    return s;
  } catch {
    return defaultState();
  }
}

export function saveLegendState(state: LegendState): void {
  const snapshot = { ...state, nap: state.sleep, hrv: state.sleep };
  localStorage.setItem(LEGEND_STORAGE_KEY, JSON.stringify(snapshot));
}

function legendOption(item: (typeof LEGEND_ITEMS)[number]) {
  return {
    value: item.key,
    label: item.label,
    iconHtml: legendIconSvg(item.key),
    iconColor: item.key === "spo2" || item.key === "body_battery" ? undefined : METRIC_COLORS[item.key],
  };
}

export function mountTrackLegends(
  stackRoot: HTMLElement,
  state: LegendState,
  onChange: () => void,
  signal: AbortSignal,
): void {
  for (const track of [1, 2, 3] as const) {
    const col = stackRoot.querySelector<HTMLElement>(
      `.health-track-card[data-track="${track}"] .health-track-card-legend`,
    );
    if (!col) continue;
    col.innerHTML = "";
    col.classList.add("health-track-legend-col");
    col.dataset.track = String(track);

    const items = LEGEND_ITEMS.filter((item) => item.track === track);
    const grid = mountSwatchToggleGrid(col, {
      columns: 1,
      ariaLabel: `轨道 ${track}`,
      values: Object.fromEntries(items.map((item) => [item.key, state[item.key]])),
      options: items.map(legendOption),
      onChange: (key, on) => {
        state[key as LegendKey] = on;
        if (key === "sleep") {
          state.nap = on;
          state.hrv = on;
        }
        saveLegendState(state);
        onChange();
      },
    });
    signal.addEventListener("abort", () => grid.dispose(), { once: true });
  }
}

export function syncLegendGrids(stackRoot: HTMLElement, state: LegendState): void {
  for (const track of [1, 2, 3] as const) {
    const col = stackRoot.querySelector<HTMLElement>(
      `.health-track-card[data-track="${track}"] .health-track-card-legend`,
    );
    const grid = col?.querySelector(".orbita-swatch-toggle-grid");
    if (!grid) continue;
    const items = LEGEND_ITEMS.filter((item) => item.track === track);
    for (const item of items) {
      const cell = grid.querySelector<HTMLButtonElement>(`[data-value="${item.key}"]`);
      if (!cell) continue;
      const on = state[item.key];
      cell.classList.toggle("is-on", on);
      cell.classList.toggle("is-off", !on);
      cell.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
}
