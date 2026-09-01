import type { LegendKey } from "./types";
import { SPO2_COLOR_STOPS } from "./colors";

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const SPO2_GRAD_PREFIX = "health-spo2-legend-grad";
const BODY_BATTERY_GRAD_PREFIX = "health-body-battery-legend-grad";
let legendGradSeq = 0;

function nextGradId(prefix: string): string {
  legendGradSeq += 1;
  return `${prefix}-${legendGradSeq}`;
}

function bodyBatteryLegendSvg(): string {
  const gradId = nextGradId(BODY_BATTERY_GRAD_PREFIX);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="url(#${gradId})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><defs><linearGradient id="${gradId}" x1="12" y1="22" x2="12" y2="2" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#d6ecfc"/><stop offset="55%" stop-color="#7eb8f0"/><stop offset="100%" stop-color="#5a9de8"/></linearGradient></defs><rect width="16" height="10" x="2" y="7" rx="2" ry="2"/><line x1="22" x2="22" y1="11" y2="13"/><line x1="6" x2="6" y1="11" y2="13"/><line x1="10" x2="10" y1="11" y2="13"/></svg>`;
}

function spo2LegendSvg(): string {
  const gradId = nextGradId(SPO2_GRAD_PREFIX);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="url(#${gradId})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><defs><linearGradient id="${gradId}" x1="12" y1="22" x2="12" y2="2" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${SPO2_COLOR_STOPS.low}"/><stop offset="28%" stop-color="${SPO2_COLOR_STOPS.orange}"/><stop offset="55%" stop-color="${SPO2_COLOR_STOPS.yellow}"/><stop offset="78%" stop-color="#90c878"/><stop offset="100%" stop-color="${SPO2_COLOR_STOPS.high}"/></linearGradient></defs><path d="M12 10v4"/><path d="M12 2v2"/><path d="M12 22v-2"/><path d="M12 12h2.5"/><path d="M12 12H9.5"/><path d="M12 12a4 4 0 0 0 4-4V4a2 2 0 0 0-4 0"/><path d="M12 12a4 4 0 0 1-4-4V4a2 2 0 0 1 4 0"/></svg>`;
}

function lucide(paths: string): string {
  return `<svg ${SVG_ATTRS}>${paths}</svg>`;
}

export const MEAL_UTENSILS_SVG = lucide(
  '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
);

export const LEGEND_ICON_SVG: Partial<Record<LegendKey, string>> = {
  hr: lucide(
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>',
  ),
  respiration: lucide(
    '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  ),
  sleep: lucide('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  stress: lucide('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
  steps: lucide(
    '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.75-.03-2.72-1.49-6-4.5-6-.87 0-1.5 1.8-1.5 3.5 0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
  ),
  activity: lucide(
    '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
  ),
  meal: MEAL_UTENSILS_SVG,
};

export function legendIconSvg(key: LegendKey): string | undefined {
  if (key === "spo2") return spo2LegendSvg();
  if (key === "body_battery") return bodyBatteryLegendSvg();
  return LEGEND_ICON_SVG[key];
}
