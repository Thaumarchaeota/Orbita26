import { observeTimelineTheme, timelineTheme } from "../../timeline/theme";
import type { ActivityEvent, HealthTrackData, MealEvent, SleepBlock, SleepStageKey, TimeSample } from "./types";
import { getSettings } from "../../../../core/settings";
import type { HealthTrackAxisMetricKey } from "../../../../core/data/health-track-axis";
import { metricValueToY, resolveMetricYRange } from "../../../../core/data/health-track-axis";
import { mealSlotLabel, normalizeMealSlot } from "../../../../core/data/meals";
import { MEAL_UTENSILS_SVG } from "./icons";
import type { LegendState } from "./legend";
import { mountTrackLegends, syncLegendGrids } from "./legend";
import { METRIC_COLORS, NAP_CAPSULE_BG, RESPIRATION_LINE_COLOR, SLEEP_CAPSULE_BG, SLEEP_STAGE_COLORS, STEPS_INTERVAL_BAR_ALPHA, bodyBatteryColorForValue, spo2ColorForValue, spo2TickHeight, stressColorForValue } from "./colors";
import { strokeSmoothLine } from "./canvas-smooth";
import { sanitizeValue } from "./sample-valid";
import {
  beijingNowUnix,
  clampViewWindow,
  formatHourLabel,
  formatMissing,
  TRACK_MIN_VIEW_SPAN_SEC,
  TRACK_VIEW_SPAN_SEC,
  unixToLocal,
  zoomViewWindow,
} from "./format";

const GAP_BREAK_SEC = 180;
const EDGE_PREFETCH_SEC = 86400;
const INERTIA_FRICTION = 0.92;
const INERTIA_MIN_V = 0.4;

const canvasSize = new WeakMap<HTMLCanvasElement, { w: number; h: number }>();

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const pxW = Math.floor(w * dpr);
  const pxH = Math.floor(h * dpr);
  const prev = canvasSize.get(canvas);
  if (!prev || prev.w !== pxW || prev.h !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
    canvasSize.set(canvas, { w: pxW, h: pxH });
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

type TrackRenderCtx = {
  canvas: HTMLCanvasElement;
  trackIndex: 1 | 2 | 3;
  fromUtc: number;
  toUtc: number;
  data: HealthTrackData;
  legend: LegendState;
};

const TRACK_AXIS_PAD_LEFT = 70;
const TRACK_AXIS_PAD_RIGHT = 4;
const PLOT_INSET = 8;
const LABEL_BAND = 16;

const TRACK1_SLEEP_BAR_H = 10;
const TRACK1_CANVAS_BOTTOM_PAD = PLOT_INSET;
const TRACK1_METRIC_PAD_TOP = PLOT_INSET;
const TRACK1_METRIC_PAD_BOTTOM = TRACK1_CANVAS_BOTTOM_PAD + 2 + TRACK1_SLEEP_BAR_H + 2;
const TRACK2_PLOT_PAD_TOP = PLOT_INSET;
const TRACK2_PLOT_PAD_BOTTOM = PLOT_INSET;
const TRACK3_PAD_BOTTOM = PLOT_INSET;

const SPORT_LABELS: Record<string, string> = {
  strength: "力量",
  running: "跑步",
  walking: "步行",
  cycling: "骑行",
  swimming: "游泳",
  hiking: "徒步",
  yoga: "瑜伽",
  activity: "活动",
};

function plotInnerWidth(w: number): number {
  return Math.max(1, w - TRACK_AXIS_PAD_LEFT - TRACK_AXIS_PAD_RIGHT);
}

function xForTime(t: number, fromUtc: number, toUtc: number, w: number): number {
  return TRACK_AXIS_PAD_LEFT + ((t - fromUtc) / (toUtc - fromUtc)) * plotInnerWidth(w);
}

function timeAtPlotX(x: number, fromUtc: number, toUtc: number, w: number): number | null {
  const innerW = plotInnerWidth(w);
  const local = x - TRACK_AXIS_PAD_LEFT;
  if (local < 0 || local > innerW) return null;
  return fromUtc + (local / innerW) * (toUtc - fromUtc);
}

const GRID_LINE_COLOR = "rgba(15, 23, 42, 0.045)";
const GRID_TIME_LABEL_COLOR = "rgba(107, 114, 128, 0.38)";
const GRID_DATE_LABEL_COLOR = "rgba(107, 114, 128, 0.48)";

const GRID_AXIS_COLOR = "rgba(15, 23, 42, 0.08)";
const TICK_MIN_PX = 56;
const TIME_TICK_STEPS_SEC = [15 * 60, 30 * 60, 3600, 2 * 3600, 3 * 3600, 6 * 3600, 12 * 3600];

function timeTickStepSec(spanSec: number, innerW: number): number {
  const span = Math.max(1, spanSec);
  for (const step of TIME_TICK_STEPS_SEC) {
    if ((step / span) * innerW >= TICK_MIN_PX) return step;
  }
  return TIME_TICK_STEPS_SEC[TIME_TICK_STEPS_SEC.length - 1];
}

export function drawSharedGrid(
  ctx: CanvasRenderingContext2D,
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
  stack?: HTMLElement | null,
  legend?: LegendState,
): void {
  ctx.clearRect(0, 0, w, h);
  const plotBottom = h - LABEL_BAND;
  const cards = stack
    ? [...stack.querySelectorAll<HTMLElement>(".health-track-card")]
    : [];
  const sr = stack?.getBoundingClientRect();
  const firstCard = cards[0];
  const lastCard = cards[cards.length - 1];
  const dateLabelY = firstCard && sr
    ? firstCard.getBoundingClientRect().top - sr.top - 6
    : LABEL_BAND / 2;
  const timeLabelY = lastCard && sr
    ? lastCard.getBoundingClientRect().bottom - sr.top + 12
    : plotBottom + 12;

  const axisY = lastCard && sr
    ? lastCard.getBoundingClientRect().bottom - sr.top
    : plotBottom;

  const theme = timelineTheme(ctx.canvas);
  ctx.strokeStyle = theme?.border ?? GRID_AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TRACK_AXIS_PAD_LEFT, axisY);
  ctx.lineTo(w - TRACK_AXIS_PAD_RIGHT, axisY);
  ctx.stroke();

  ctx.strokeStyle = theme?.border ?? GRID_LINE_COLOR;
  ctx.font = theme?.font ?? "10px system-ui, sans-serif";
  const innerW = plotInnerWidth(w);
  const step = timeTickStepSec(toUtc - fromUtc, innerW);
  let lastDate = "";
  const plotBands = stack
    ? trackPlotBands(stack)
    : [{ top: PLOT_INSET, bottom: plotBottom }];
  for (let t = Math.ceil(fromUtc / step) * step; t <= toUtc; t += step) {
    const x = xForTime(t, fromUtc, toUtc, w);
    for (const band of plotBands) {
      ctx.beginPath();
      ctx.moveTo(x, band.top);
      ctx.lineTo(x, band.bottom);
      ctx.stroke();
    }
    const { date, time } = unixToLocal(t);
    if (date !== lastDate) {
      ctx.fillStyle = theme?.secondary ?? GRID_DATE_LABEL_COLOR;
      ctx.font = theme?.strongFont ?? "600 10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(date.slice(5), x + 3, dateLabelY);
      ctx.textBaseline = "alphabetic";
      ctx.font = theme?.font ?? "10px system-ui, sans-serif";
      lastDate = date;
    }
    ctx.fillStyle = theme?.secondary ?? GRID_TIME_LABEL_COLOR;
    ctx.fillText(time, x + 3, timeLabelY);
  }

  if (stack) drawTrackYAxes(ctx, stack, w, legend);
}

function canvasBandInStack(
  stack: HTMLElement,
  track: number,
): { top: number; bottom: number; h: number } | null {
  const canvas = stack.querySelector<HTMLCanvasElement>(
    `.health-track-card[data-track="${track}"] .health-track-canvas`,
  );
  if (!canvas) return null;
  const sr = stack.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  return { top: cr.top - sr.top, bottom: cr.bottom - sr.top, h: cr.height };
}

function trackPlotBands(stack: HTMLElement): { top: number; bottom: number }[] {
  const specs: { track: number; padTop: number; padBottom: number }[] = [
    { track: 1, padTop: TRACK1_METRIC_PAD_TOP, padBottom: TRACK1_METRIC_PAD_BOTTOM },
    { track: 2, padTop: PLOT_INSET, padBottom: PLOT_INSET },
    { track: 3, padTop: PLOT_INSET, padBottom: PLOT_INSET },
    { track: 4, padTop: PLOT_INSET, padBottom: PLOT_INSET },
  ];
  const bands: { top: number; bottom: number }[] = [];
  for (const s of specs) {
    const band = canvasBandInStack(stack, s.track);
    if (!band) continue;
    bands.push({ top: band.top + s.padTop, bottom: band.top + band.h - s.padBottom });
  }
  return bands;
}

function axisTicksEven(min: number, max: number, parts = 4): number[] {
  const ticks: number[] = [];
  for (let i = 0; i <= parts; i++) ticks.push(min + ((max - min) * i) / parts);
  return ticks;
}

type TrackBandAxisOpts = {
  track: number;
  padTop: number;
  padBottom: number;
  vmin: number;
  vmax: number;
  ticks: number[];
  labelColor?: string;
};

function drawTrackBandYAxis(
  ctx: CanvasRenderingContext2D,
  stack: HTMLElement,
  w: number,
  opts: TrackBandAxisOpts,
): void {
  const theme = timelineTheme(ctx.canvas);
  const band = canvasBandInStack(stack, opts.track);
  if (!band) return;
  const plotTop = band.top + opts.padTop;
  const plotBottom = band.top + band.h - opts.padBottom;
  const innerH = Math.max(1, plotBottom - plotTop);
  const span = opts.vmax - opts.vmin || 1;
  ctx.strokeStyle = theme?.border ?? GRID_LINE_COLOR;
  ctx.fillStyle = opts.labelColor ?? theme?.secondary ?? GRID_TIME_LABEL_COLOR;
  ctx.font = theme?.font ?? "9px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of opts.ticks) {
    const y = plotBottom - ((v - opts.vmin) / span) * innerH;
    ctx.beginPath();
    ctx.moveTo(TRACK_AXIS_PAD_LEFT, y);
    ctx.lineTo(w - TRACK_AXIS_PAD_RIGHT, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), TRACK_AXIS_PAD_LEFT - 5, y);
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawTrackYAxes(
  ctx: CanvasRenderingContext2D,
  stack: HTMLElement,
  w: number,
  legend?: LegendState,
): void {
  if (legend?.hr) {
    const hr = getSettings().ui.healthTrackAxis.ranges.hr;
    drawTrackBandYAxis(ctx, stack, w, {
      track: 1,
      padTop: TRACK1_METRIC_PAD_TOP,
      padBottom: TRACK1_METRIC_PAD_BOTTOM,
      vmin: hr.min,
      vmax: hr.max,
      ticks: axisTicksEven(hr.min, hr.max),
    });
  }
  drawTrackBandYAxis(ctx, stack, w, {
    track: 2,
    padTop: TRACK2_PLOT_PAD_TOP,
    padBottom: TRACK2_PLOT_PAD_BOTTOM,
    vmin: 0,
    vmax: 100,
    ticks: [0, 25, 50, 75, 100],
  });
}

function resolveSleepSegments(block: SleepBlock): { startUtc: number; endUtc: number; stage: SleepStageKey }[] {
  if (block.segments?.length) {
    return block.segments
      .filter((s) => s.endUtc > s.startUtc)
      .map((s) => ({ startUtc: s.startUtc, endUtc: s.endUtc, stage: s.stage }));
  }
  const totals = block.stageTotals;
  if (totals) {
    const order: SleepStageKey[] = ["light", "deep", "rem", "awake"];
    const entries = order
      .map((stage) => ({ stage, sec: totals[stage] || 0 }))
      .filter((e) => e.sec > 0);
    const sum = entries.reduce((a, e) => a + e.sec, 0);
    if (sum <= 0) {
      return [{ startUtc: block.startUtc, endUtc: block.endUtc, stage: "light" }];
    }
    const span = block.endUtc - block.startUtc;
    let cursor = block.startUtc;
    const out: { startUtc: number; endUtc: number; stage: SleepStageKey }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const end =
        i === entries.length - 1 ? block.endUtc : cursor + Math.round((e.sec / sum) * span);
      if (end > cursor) out.push({ startUtc: cursor, endUtc: end, stage: e.stage });
      cursor = end;
    }
    return out;
  }
  return [{ startUtc: block.startUtc, endUtc: block.endUtc, stage: "light" }];
}

function drawSleepStackedBar(
  ctx: CanvasRenderingContext2D,
  segments: { startUtc: number; endUtc: number; stage: SleepStageKey }[],
  fromUtc: number,
  toUtc: number,
  w: number,
  x0: number,
  x1: number,
  barY: number,
  barH: number,
): void {
  const barW = x1 - x0;
  if (barW < 2) return;
  const radius = Math.min(barH / 2, 6);
  const visible: { x0: number; x1: number; stage: SleepStageKey }[] = [];
  for (const seg of segments) {
    const sx0 = xForTime(Math.max(seg.startUtc, fromUtc), fromUtc, toUtc, w);
    const sx1 = xForTime(Math.min(seg.endUtc, toUtc), fromUtc, toUtc, w);
    if (sx1 > sx0) visible.push({ x0: sx0, x1: sx1, stage: seg.stage });
  }
  if (visible.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, barY, barW, barH, radius);
  ctx.clip();

  const blendPx = 3;
  for (let i = 0; i < visible.length; i++) {
    const seg = visible[i];
    const segW = seg.x1 - seg.x0;
    if (segW <= 0) continue;
    const color = SLEEP_STAGE_COLORS[seg.stage];
    const prev = visible[i - 1];
    let drawX = seg.x0;
    let drawW = segW;
    if (prev && prev.stage !== seg.stage && segW > blendPx) {
      const grad = ctx.createLinearGradient(seg.x0, 0, seg.x0 + blendPx, 0);
      grad.addColorStop(0, SLEEP_STAGE_COLORS[prev.stage]);
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.fillRect(seg.x0, barY, blendPx, barH);
      drawX = seg.x0 + blendPx - 0.5;
      drawW = segW - blendPx + 0.5;
    }
    if (drawW > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(drawX, barY, drawW + (i < visible.length - 1 ? 0.5 : 0), barH);
    }
  }
  ctx.restore();
}

function track1MetricBaselineY(h: number): number {
  return h - TRACK1_METRIC_PAD_BOTTOM;
}

function drawSleepBlocks(
  ctx: CanvasRenderingContext2D,
  data: HealthTrackData,
  legend: LegendState,
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
): void {
  const metricBaselineY = track1MetricBaselineY(h);
  const capsuleY = TRACK1_METRIC_PAD_TOP + 2;
  const capsuleBottom = h - TRACK1_CANVAS_BOTTOM_PAD - 2;
  const capsuleH = capsuleBottom - capsuleY;
  const barH = TRACK1_SLEEP_BAR_H;
  const barY = capsuleBottom - barH;
  const topR = Math.min(8, capsuleH * 0.08);
  const bottomR = barH / 2;

  for (const block of data.sleepBlocks) {
    if (!legend.sleep) continue;
    const x0 = xForTime(Math.max(block.startUtc, fromUtc), fromUtc, toUtc, w);
    const x1 = xForTime(Math.min(block.endUtc, toUtc), fromUtc, toUtc, w);
    const capW = x1 - x0;
    if (capW < 4) continue;

    ctx.fillStyle = block.isNap ? NAP_CAPSULE_BG : SLEEP_CAPSULE_BG;
    ctx.beginPath();
    ctx.roundRect(x0, capsuleY, capW, capsuleH, [topR, topR, bottomR, bottomR]);
    ctx.fill();

    if (barY <= metricBaselineY) continue;
    const segments = resolveSleepSegments(block);
    drawSleepStackedBar(ctx, segments, fromUtc, toUtc, w, x0, x1, barY, barH);
  }
}

function seriesByMetric(data: HealthTrackData, metric: string): TimeSample[] {
  return data.series.find((s) => s.metric === metric)?.samples ?? [];
}

function validSamples(
  samples: TimeSample[],
  metric: string,
  fromUtc: number,
  toUtc: number,
): TimeSample[] {
  return samples
    .filter((s) => s.t >= fromUtc && s.t < toUtc)
    .map((s) => ({ t: s.t, v: sanitizeValue(metric, s.v) }))
    .filter((s) => s.v !== null) as TimeSample[];
}

type Track3Zone = { top: number; bottom: number };

type Track3Zones = {
  dividerY: number;
  activity: Track3Zone;
  steps: Track3Zone;
  meal: Track3Zone;
};

function track3Zones(h: number): Track3Zones {
  const plotH = Math.max(1, h - TRACK3_PAD_BOTTOM);
  const third = plotH / 3;
  return {
    dividerY: third * 2,
    activity: { top: 0, bottom: third },
    steps: { top: third, bottom: third * 2 },
    meal: { top: third * 2, bottom: plotH },
  };
}

function drawTrack3Divider(ctx: CanvasRenderingContext2D, zones: Track3Zones, w: number): void {
  ctx.strokeStyle = timelineTheme(ctx.canvas)?.border ?? "#e5e7eb";
  ctx.lineWidth = 1;
  for (const y of [zones.steps.top, zones.dividerY]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

export function activityEndUtc(a: ActivityEvent): number | null {
  if (a.endUtc != null && a.endUtc > a.startUtc) return a.endUtc;
  return null;
}

function formatDurationSec(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function activityDurationSec(a: ActivityEvent): number | null {
  const sec = a.durationSec;
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  return sec;
}

function activityElapsedDurationSec(a: ActivityEvent): number | null {
  const raw = a as ActivityEvent & {
    elapsedDurationSec?: number | null;
    elapsedDuration?: number | null;
    elapsed_duration_sec?: number | null;
  };
  const sec = raw.elapsedDurationSec ?? raw.elapsedDuration ?? raw.elapsed_duration_sec ?? null;
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  return sec;
}

function activityBarLabel(a: ActivityEvent): string {
  const elapsed = activityElapsedDurationSec(a);
  if (elapsed != null) return formatDurationSec(elapsed);
  return activityLabel(a);
}

function activityTooltipDetail(a: ActivityEvent, end: number): string {
  const parts = [`${formatHourLabel(a.startUtc)}–${formatHourLabel(end)}`];
  const duration = activityDurationSec(a);
  if (duration != null) parts.push(formatDurationSec(duration));
  return parts.join(" · ");
}

function activityIntersectsView(a: ActivityEvent, fromUtc: number, toUtc: number): boolean {
  const end = activityEndUtc(a);
  return end != null && end > fromUtc && a.startUtc < toUtc;
}

function stepsIntervalMax(intervals: TimeSample[]): number {
  const vals = intervals.map((s) => s.v!).filter((v) => v > 0);
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  const peak = vals[vals.length - 1];
  const p85 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.85))];
  return Math.max(p85 * 1.2, peak * 0.4, 1);
}

function stepsIntervalSamples(samples: TimeSample[], fromUtc: number, toUtc: number): TimeSample[] {
  const valid = validSamples(samples, "steps_cumulative", fromUtc, toUtc);
  if (valid.length === 0) return [];
  valid.sort((a, b) => a.t - b.t);
  const out: TimeSample[] = [];
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    const day = unixToLocal(s.t).date;
    const delta =
      i === 0 || unixToLocal(valid[i - 1].t).date !== day
        ? s.v!
        : Math.max(0, s.v! - valid[i - 1].v!);
    if (delta > 0) out.push({ t: s.t, v: delta });
  }
  return out;
}

function drawStepsIntervalBars(
  ctx: CanvasRenderingContext2D,
  samples: TimeSample[],
  fromUtc: number,
  toUtc: number,
  w: number,
  zones: Track3Zones,
): void {
  const intervals = stepsIntervalSamples(samples, fromUtc, toUtc);
  if (intervals.length === 0) return;
  const maxDelta = stepsIntervalMax(intervals);
  const bandH = zones.steps.bottom - zones.steps.top - 10;
  const baseline = zones.steps.bottom - 5;
  const span = toUtc - fromUtc || 1;
  ctx.fillStyle = METRIC_COLORS.steps;
  ctx.globalAlpha = STEPS_INTERVAL_BAR_ALPHA;
  for (let i = 0; i < intervals.length; i++) {
    const s = intervals[i];
    const x = xForTime(s.t, fromUtc, toUtc, w);
    if (!Number.isFinite(x)) continue;
    const day = unixToLocal(s.t).date;
    let dtSec = 900;
    if (i + 1 < intervals.length && unixToLocal(intervals[i + 1].t).date === day) {
      dtSec = intervals[i + 1].t - s.t;
    } else if (i > 0 && unixToLocal(intervals[i - 1].t).date === day) {
      dtSec = s.t - intervals[i - 1].t;
    }
    const pxInterval = (dtSec / span) * w;
    const barW = Math.max(1.5, Math.min(12, pxInterval * 0.55));
    const bh = Math.min(bandH, (s.v! / maxDelta) * bandH);
    ctx.fillRect(x - barW / 2, baseline - bh, barW, bh);
  }
  ctx.globalAlpha = 1;
}

function drawLineSeries(
  ctx: CanvasRenderingContext2D,
  samples: TimeSample[],
  metric: string,
  color: string,
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
  padTop = 8,
  padBottom = 16,
  axisMetric?: HealthTrackAxisMetricKey,
  alpha = 1,
): void {
  const gapSec = GAP_BREAK_SEC;
  const valid = validSamples(samples, metric, fromUtc, toUtc);
  if (valid.length === 0) return;
  const vals = valid.map((s) => s.v!);
  const range = axisMetric
    ? resolveMetricYRange(axisMetric, vals, getSettings().ui.healthTrackAxis)
    : (() => {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        return { min, max: max === min ? min + 1 : max };
      })();
  const innerH = h - padTop - padBottom;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = alpha;
  let segment: TimeSample[] = [];
  const flush = () => {
    if (segment.length === 0) return;
    const pts = segment.map((s) => ({
      x: xForTime(s.t, fromUtc, toUtc, w),
      y: metricValueToY(s.v!, range, padTop, innerH),
    }));
    strokeSmoothLine(ctx, pts);
    segment = [];
  };
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    if (segment.length > 0 && s.t - segment[segment.length - 1].t > gapSec) flush();
    segment.push(s);
  }
  flush();
  ctx.globalAlpha = 1;
}

function drawBodyBatteryLine(
  ctx: CanvasRenderingContext2D,
  samples: TimeSample[],
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
  padTop: number,
  padBottom: number,
): void {
  const valid = validSamples(samples, "body_battery", fromUtc, toUtc);
  if (valid.length === 0) return;
  const vals = valid.map((s) => s.v!);
  const range = resolveMetricYRange("body_battery", vals, getSettings().ui.healthTrackAxis);
  const innerH = h - padTop - padBottom;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let segment: TimeSample[] = [];
  const drawSegment = (pts: TimeSample[]) => {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      const s = pts[0];
      const x = xForTime(s.t, fromUtc, toUtc, w);
      const y = metricValueToY(s.v!, range, padTop, innerH);
      ctx.fillStyle = bodyBatteryColorForValue(s.v!);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const x1 = xForTime(a.t, fromUtc, toUtc, w);
      const y1 = metricValueToY(a.v!, range, padTop, innerH);
      const x2 = xForTime(b.t, fromUtc, toUtc, w);
      const y2 = metricValueToY(b.v!, range, padTop, innerH);
      ctx.strokeStyle = bodyBatteryColorForValue((a.v! + b.v!) / 2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    if (segment.length > 0 && s.t - segment[segment.length - 1].t > GAP_BREAK_SEC) {
      drawSegment(segment);
      segment = [];
    }
    segment.push(s);
  }
  drawSegment(segment);
}

const SPO2_SPARSE_GAP_SEC = 20 * 60;

function spo2UsesLollipop(s: TimeSample, index: number, valid: TimeSample[]): boolean {
  if (s.src === "hourly" || s.src === "daily_offset") return true;
  if (s.src === "sleep_epoch" || s.src === "sleep_offset") return false;
  const prev = valid[index - 1];
  const next = valid[index + 1];
  const prevGap = prev ? s.t - prev.t : Number.POSITIVE_INFINITY;
  const nextGap = next ? next.t - s.t : Number.POSITIVE_INFINITY;
  return Math.min(prevGap, nextGap) > SPO2_SPARSE_GAP_SEC;
}

function spo2TickGeom(v: number, y0: number, maxTick: number): { top: number; tip: number; tickH: number } {
  const tickH = Math.min(maxTick, spo2TickHeight(v));
  const top = y0 + 1;
  return { top, tip: top + tickH, tickH };
}

function drawSpo2Ticks(
  ctx: CanvasRenderingContext2D,
  samples: TimeSample[],
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
): void {
  const valid = validSamples(samples, "spo2", fromUtc, toUtc);
  if (valid.length === 0) return;
  const y0 = TRACK1_METRIC_PAD_TOP;
  const padBottom = TRACK1_METRIC_PAD_BOTTOM;
  const maxTick = Math.min(20, h - y0 - padBottom - 2);
  const lollipopIdx: number[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (spo2UsesLollipop(valid[i], i, valid)) lollipopIdx.push(i);
  }
  const lollipopSet = new Set(lollipopIdx);

  for (let k = 0; k < lollipopIdx.length - 1; k++) {
    const a = valid[lollipopIdx[k]];
    const b = valid[lollipopIdx[k + 1]];
    const x1 = xForTime(a.t, fromUtc, toUtc, w);
    const x2 = xForTime(b.t, fromUtc, toUtc, w);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
    const { tip } = spo2TickGeom(a.v!, y0, maxTick);
    ctx.strokeStyle = spo2ColorForValue(a.v!);
    ctx.globalAlpha = 0.17;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, tip);
    ctx.lineTo(x2, tip);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    const x = xForTime(s.t, fromUtc, toUtc, w);
    if (!Number.isFinite(x)) continue;
    const color = spo2ColorForValue(s.v!);
    const { top, tip, tickH } = spo2TickGeom(s.v!, y0, maxTick);
    if (lollipopSet.has(i)) {
      if (tickH <= 3) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.82;
        ctx.beginPath();
        ctx.arc(x, y0 + 2.5, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.76;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, tip);
      ctx.stroke();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, tip, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (tickH <= 3) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      ctx.arc(x, y0 + 2.5, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, tip);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawStressBars(
  ctx: CanvasRenderingContext2D,
  samples: TimeSample[],
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
): void {
  const valid = validSamples(samples, "stress", fromUtc, toUtc);
  if (valid.length === 0) return;
  const vals = valid.map((s) => s.v!);
  const range = resolveMetricYRange("stress", vals, getSettings().ui.healthTrackAxis);
  const span = range.max - range.min || 1;
  const plotH = h - TRACK2_PLOT_PAD_TOP - TRACK2_PLOT_PAD_BOTTOM;
  const yBase = h - TRACK2_PLOT_PAD_BOTTOM;
  const barW = Math.max(1, (w / valid.length) * 0.6);
  for (const s of valid) {
    const x = xForTime(s.t, fromUtc, toUtc, w);
    const clamped = Math.max(range.min, Math.min(range.max, s.v!));
    const bh = ((clamped - range.min) / span) * plotH;
    ctx.fillStyle = stressColorForValue(s.v!);
    ctx.globalAlpha = 0.72;
    ctx.fillRect(x - barW / 2, yBase - bh, barW, bh);
  }
  ctx.globalAlpha = 1;
}

function activityLabel(a: ActivityEvent): string {
  if (a.name) return a.name;
  const key = (a.activityType ?? "").toLowerCase();
  return SPORT_LABELS[key] ?? (a.activityType || "活动");
}

function drawTrack3Activities(
  ctx: CanvasRenderingContext2D,
  data: HealthTrackData,
  legend: LegendState,
  fromUtc: number,
  toUtc: number,
  w: number,
  zones: Track3Zones,
): void {
  if (!legend.activity) return;
  const plotLeft = TRACK_AXIS_PAD_LEFT;
  const plotRight = w - TRACK_AXIS_PAD_RIGHT;
  const zoneH = zones.activity.bottom - zones.activity.top;
  const barH = Math.max(8, Math.min(16, zoneH * 0.55));
  const yMid = (zones.activity.top + zones.activity.bottom) / 2;
  ctx.font = timelineTheme(ctx.canvas)?.strongFont ?? "600 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const a of data.activities) {
    const end = activityEndUtc(a);
    if (!activityIntersectsView(a, fromUtc, toUtc) || end == null) continue;
    const visStart = Math.max(a.startUtc, fromUtc);
    const visEnd = Math.min(end, toUtc);
    let x0 = xForTime(visStart, fromUtc, toUtc, w);
    let x1 = xForTime(visEnd, fromUtc, toUtc, w);
    x0 = Math.max(plotLeft, x0);
    x1 = Math.min(plotRight, x1);
    const barW = x1 - x0;
    if (barW < 3) {
      const x = xForTime(visStart, fromUtc, toUtc, w);
      if (x >= plotLeft && x <= plotRight) {
        ctx.fillStyle = METRIC_COLORS.activity;
        ctx.globalAlpha = 0.72;
        ctx.fillRect(x - 2, yMid - barH / 2, 4, barH);
        ctx.globalAlpha = 1;
      }
      continue;
    }
    ctx.fillStyle = METRIC_COLORS.activity;
    ctx.strokeStyle = METRIC_COLORS.activity;
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0, yMid - barH / 2, barW, barH, 3);
    ctx.fill();
    ctx.globalAlpha = 0.88;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (barW >= 24) {
      ctx.fillStyle = "#166534";
      ctx.fillText(activityBarLabel(a), x0 + barW / 2, yMid);
    }
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function mealTagLabel(m: MealEvent): string {
  if (m.mealType) return mealSlotLabel(normalizeMealSlot(m.mealType));
  if (m.kcal) return `${Math.round(m.kcal)}千卡`;
  return "餐食";
}

function syncMealMarkers(
  layer: HTMLElement,
  canvas: HTMLCanvasElement,
  data: HealthTrackData,
  legend: LegendState,
  fromUtc: number,
  toUtc: number,
): void {
  layer.replaceChildren();
  if (!legend.meal) return;
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  if (w <= 0 || h <= 0) return;
  const zones = track3Zones(h);
  const zoneH = zones.meal.bottom - zones.meal.top;
  const yMid = zones.meal.top + zoneH * 0.36;
  const topPct = (yMid / h) * 100;
  const plotLeft = TRACK_AXIS_PAD_LEFT;
  const plotRight = w - TRACK_AXIS_PAD_RIGHT;

  for (const m of data.meals) {
    const x = xForTime(m.occurredAtUtc, fromUtc, toUtc, w);
    if (!Number.isFinite(x) || x < plotLeft || x > plotRight) continue;

    const marker = document.createElement("div");
    marker.className = "health-meal-marker";
    marker.style.left = `${(x / w) * 100}%`;
    marker.style.top = `${topPct}%`;

    const icon = document.createElement("span");
    icon.className = "health-meal-marker-icon";
    icon.innerHTML = MEAL_UTENSILS_SVG;

    const label = document.createElement("span");
    label.className = "health-meal-marker-label";
    label.textContent = mealTagLabel(m);

    marker.append(icon, label);
    layer.appendChild(marker);
  }
}

function drawTrack3(
  ctx: CanvasRenderingContext2D,
  data: HealthTrackData,
  legend: LegendState,
  fromUtc: number,
  toUtc: number,
  w: number,
  h: number,
): void {
  const zones = track3Zones(h);
  drawTrack3Divider(ctx, zones, w);
  if (legend.steps) {
    drawStepsIntervalBars(ctx, seriesByMetric(data, "steps_cumulative"), fromUtc, toUtc, w, zones);
  }
  drawTrack3Activities(ctx, data, legend, fromUtc, toUtc, w, zones);
}

export function renderTrack({ canvas, trackIndex, fromUtc, toUtc, data, legend }: TrackRenderCtx): void {
  const ctx = setupCanvas(canvas);
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, w, h);

  if (trackIndex === 1) {
    drawSleepBlocks(ctx, data, legend, fromUtc, toUtc, w, h);
    if (legend.respiration) {
      drawLineSeries(
        ctx,
        seriesByMetric(data, "respiration"),
        "respiration",
        RESPIRATION_LINE_COLOR,
        fromUtc,
        toUtc,
        w,
        h,
        TRACK1_METRIC_PAD_TOP,
        TRACK1_METRIC_PAD_BOTTOM,
        "respiration",
        0.78,
      );
    }
    if (legend.hrv) {
      drawLineSeries(
        ctx,
        seriesByMetric(data, "hrv"),
        "hrv",
        METRIC_COLORS.hrv,
        fromUtc,
        toUtc,
        w,
        h,
        TRACK1_METRIC_PAD_TOP,
        TRACK1_METRIC_PAD_BOTTOM,
      );
    }
    if (legend.hr) {
      drawLineSeries(
        ctx,
        seriesByMetric(data, "hr"),
        "hr",
        METRIC_COLORS.hr,
        fromUtc,
        toUtc,
        w,
        h,
        TRACK1_METRIC_PAD_TOP,
        TRACK1_METRIC_PAD_BOTTOM,
        "hr",
      );
    }
    if (legend.spo2) drawSpo2Ticks(ctx, seriesByMetric(data, "spo2"), fromUtc, toUtc, w, h);
  } else if (trackIndex === 2) {
    if (legend.stress) drawStressBars(ctx, seriesByMetric(data, "stress"), fromUtc, toUtc, w, h);
    if (legend.body_battery) {
      drawBodyBatteryLine(
        ctx,
        seriesByMetric(data, "body_battery"),
        fromUtc,
        toUtc,
        w,
        h,
        TRACK2_PLOT_PAD_TOP,
        TRACK2_PLOT_PAD_BOTTOM,
      );
    }
  } else {
    drawTrack3(ctx, data, legend, fromUtc, toUtc, w, h);
  }
}

export type TracksHandle = {
  setWindow: (fromUtc: number, toUtc: number) => void;
  setLoadedBounds: (fromUtc: number, toUtc: number) => void;
  setLimits: (minFromUtc: number, maxToUtc: number) => void;
  panByPx: (dx: number) => void;
  setData: (data: HealthTrackData) => void;
  setLegend: (legend: LegendState) => void;
  resize: () => void;
};

export function mountTracks(
  container: HTMLElement,
  initial: {
    fromUtc: number;
    toUtc: number;
    loadedFromUtc: number;
    loadedToUtc: number;
    minFromUtc: number;
    maxToUtc: number;
    data: HealthTrackData;
    legend: LegendState;
  },
  onHover: (ts: number | null) => void,
  onViewChange: (fromUtc: number, toUtc: number) => void,
  onNearEdge: () => void,
  signal: AbortSignal,
): TracksHandle {
  container.innerHTML = `
    <div class="health-tracks-shell">
      <div class="health-tracks-stack">
        <div class="health-tracks-overlay" aria-hidden="true">
          <canvas class="health-tracks-grid-canvas"></canvas>
          <div class="health-track-now" hidden></div>
          <div class="health-track-cursor" hidden></div>
        </div>
        <article class="health-track-card" data-track="1">
          <div class="health-track-card-legend"></div>
          <div class="health-track-card-plot">
            <canvas class="health-track-canvas" data-track="1"></canvas>
          </div>
        </article>
        <article class="health-track-card" data-track="2">
          <div class="health-track-card-legend"></div>
          <div class="health-track-card-plot">
            <canvas class="health-track-canvas" data-track="2"></canvas>
          </div>
        </article>
        <article class="health-track-card" data-track="3">
          <div class="health-track-card-legend"></div>
          <div class="health-track-card-plot">
            <canvas class="health-track-canvas" data-track="3"></canvas>
            <div class="health-track-meal-layer" aria-hidden="true"></div>
          </div>
        </article>
      </div>
      <div class="health-track-tooltip" hidden></div>
    </div>`;

  const shell = container.querySelector<HTMLElement>(".health-tracks-shell")!;
  const stack = shell.querySelector<HTMLElement>(".health-tracks-stack")!;
  stack.style.setProperty("--health-track-plot-pad-left", `${TRACK_AXIS_PAD_LEFT}px`);
  const plotPane = stack.querySelector<HTMLElement>(".health-track-card-plot")!;
  const overlay = stack.querySelector<HTMLElement>(".health-tracks-overlay")!;
  const gridCanvas = stack.querySelector<HTMLCanvasElement>(".health-tracks-grid-canvas")!;
  const nowLine = stack.querySelector<HTMLElement>(".health-track-now")!;
  const cursor = stack.querySelector<HTMLElement>(".health-track-cursor")!;
  const tooltip = shell.querySelector<HTMLElement>(".health-track-tooltip")!;
  const canvases = [...stack.querySelectorAll<HTMLCanvasElement>(".health-track-canvas")];
  const mealLayer = stack.querySelector<HTMLElement>(".health-track-meal-layer")!;

  let fromUtc = initial.fromUtc;
  let toUtc = initial.toUtc;
  let loadedFromUtc = initial.loadedFromUtc;
  let loadedToUtc = initial.loadedToUtc;
  let minFromUtc = initial.minFromUtc;
  let maxToUtc = initial.maxToUtc;
  let data = initial.data;
  let legend = initial.legend;

  let touchActive = false;
  let touchLastX = 0;
  let touchVelocity = 0;
  let inertiaId = 0;

  let legendsMounted = false;
  const mountLegendsOnce = () => {
    if (legendsMounted) return;
    mountTrackLegends(stack, legend, () => redraw(), signal);
    legendsMounted = true;
  };
  mountLegendsOnce();

  const onSettingsChanged = () => redraw();
  window.addEventListener("orbita:settings-changed", onSettingsChanged);
  signal.addEventListener("abort", () => {
    window.removeEventListener("orbita:settings-changed", onSettingsChanged);
  });

  function updateNowLine(): void {
    const now = beijingNowUnix();
    if (now < fromUtc || now > toUtc) {
      nowLine.hidden = true;
      return;
    }
    const overlayRect = overlay.getBoundingClientRect();
    const plotRect = plotPane.getBoundingClientRect();
    const innerX = xForTime(now, fromUtc, toUtc, plotRect.width) + (plotRect.left - overlayRect.left);
    nowLine.hidden = false;
    nowLine.style.left = `${innerX}px`;
  }

  function updateFade(): void {
    const now = beijingNowUnix();
    const atNow = toUtc >= now - 120 && toUtc <= now + 180;
    stack.classList.toggle("is-at-now", atNow);
    updateNowLine();
  }

  function checkEdge(): void {
    if (fromUtc - loadedFromUtc < EDGE_PREFETCH_SEC || loadedToUtc - toUtc < EDGE_PREFETCH_SEC) {
      onNearEdge();
    }
  }

  function shiftByPx(dx: number): void {
    const span = toUtc - fromUtc;
    const deltaSec = (dx / plotInnerWidth(plotPane.clientWidth)) * span;
    const next = clampViewWindow(fromUtc - deltaSec, toUtc - deltaSec, minFromUtc, maxToUtc);
    fromUtc = next.fromUtc;
    toUtc = next.toUtc;
    updateFade();
    redrawTracks();
    onViewChange(fromUtc, toUtc);
    checkEdge();
  }

  function zoomAtClientX(clientX: number, factor: number): void {
    const ts = tsAtClientX(clientX) ?? (fromUtc + toUtc) / 2;
    const next = zoomViewWindow(
      fromUtc,
      toUtc,
      ts,
      factor,
      minFromUtc,
      maxToUtc,
      TRACK_MIN_VIEW_SPAN_SEC,
      TRACK_VIEW_SPAN_SEC,
    );
    if (next.fromUtc === fromUtc && next.toUtc === toUtc) return;
    fromUtc = next.fromUtc;
    toUtc = next.toUtc;
    updateFade();
    redrawTracks();
    onViewChange(fromUtc, toUtc);
    checkEdge();
  }

  function stopInertia(): void {
    if (inertiaId) cancelAnimationFrame(inertiaId);
    inertiaId = 0;
  }

  function runInertia(): void {
    if (Math.abs(touchVelocity) < INERTIA_MIN_V) {
      touchVelocity = 0;
      inertiaId = 0;
      return;
    }
    shiftByPx(touchVelocity);
    touchVelocity *= INERTIA_FRICTION;
    inertiaId = requestAnimationFrame(runInertia);
  }

  function redrawGrid(): void {
    const ctx = setupCanvas(gridCanvas);
    const w = gridCanvas.getBoundingClientRect().width;
    drawSharedGrid(ctx, fromUtc, toUtc, w, stack.clientHeight, stack, legend);
  }

  function redrawTracks(): void {
    redrawGrid();
    renderTrack({ canvas: canvases[0], trackIndex: 1, fromUtc, toUtc, data, legend });
    renderTrack({ canvas: canvases[1], trackIndex: 2, fromUtc, toUtc, data, legend });
    renderTrack({ canvas: canvases[2], trackIndex: 3, fromUtc, toUtc, data, legend });
    syncMealMarkers(mealLayer, canvases[2], data, legend, fromUtc, toUtc);
    updateNowLine();
  }

  const redraw = redrawTracks;

  function tsAtClientX(clientX: number): number | null {
    const rect = plotPane.getBoundingClientRect();
    const x = clientX - rect.left;
    return timeAtPlotX(x, fromUtc, toUtc, rect.width);
  }

  function stepsAt(ts: number): number | null {
    const samples = seriesByMetric(data, "steps_cumulative");
    const day = unixToLocal(ts).date;
    const daySamples = samples
      .filter((s) => unixToLocal(s.t).date === day && s.v !== null)
      .sort((a, b) => a.t - b.t);
    if (daySamples.length === 0) return null;
    const base = daySamples[0].v!;
    let best: TimeSample | null = null;
    let bestDist = GAP_BREAK_SEC;
    for (const s of daySamples) {
      const v = sanitizeValue("steps_cumulative", s.v);
      if (v === null) continue;
      const d = Math.abs(s.t - ts);
      if (d < bestDist) {
        bestDist = d;
        best = { t: s.t, v: Math.max(0, v - base) };
      }
    }
    return best?.v ?? null;
  }

  function nearestSample(metric: string, ts: number): number | null {
    if (metric === "steps_cumulative") return stepsAt(ts);
    const samples = seriesByMetric(data, metric);
    let best: TimeSample | null = null;
    let bestDist = GAP_BREAK_SEC;
    for (const s of samples) {
      const v = sanitizeValue(metric, s.v);
      if (v === null) continue;
      const d = Math.abs(s.t - ts);
      if (d < bestDist) {
        bestDist = d;
        best = { t: s.t, v };
      }
    }
    return best?.v ?? null;
  }

  function buildTooltip(ts: number): string {
    const lines: string[] = [formatHourLabel(ts)];
    const add = (label: string, v: string) => lines.push(`${label}: ${v}`);

    for (const block of data.sleepBlocks) {
      if (ts >= block.startUtc && ts < block.endUtc) {
        if (legend.sleep) {
          add(block.isNap ? "午睡" : "睡眠", `${formatHourLabel(block.startUtc)}–${formatHourLabel(block.endUtc)}`);
        }
      }
    }
    for (const a of data.activities) {
      const end = activityEndUtc(a);
      if (end != null && ts >= a.startUtc && ts < end && legend.activity) {
        add(activityLabel(a), activityTooltipDetail(a, end));
      }
    }
    for (const m of data.meals) {
      if (Math.abs(m.occurredAtUtc - ts) < 300 && legend.meal) {
        add(mealTagLabel(m), m.kcal ? `${Math.round(m.kcal)} 千卡` : m.description || "—");
      }
    }
    if (legend.hr) add("心率", formatMissing(nearestSample("hr", ts)));
    if (legend.hrv) add("HRV", formatMissing(nearestSample("hrv", ts)));
    if (legend.spo2) add("血氧", formatMissing(nearestSample("spo2", ts)));
    if (legend.respiration) add("呼吸", formatMissing(nearestSample("respiration", ts)));
    if (legend.stress) add("Stress", formatMissing(nearestSample("stress", ts)));
    if (legend.body_battery) add("Body Battery", formatMissing(nearestSample("body_battery", ts)));
    if (legend.steps) add("步数", formatMissing(nearestSample("steps_cumulative", ts)));
    return lines.join("<br>");
  }

  function showTooltip(clientX: number, clientY: number): void {
    const ts = tsAtClientX(clientX);
    if (ts === null) {
      cursor.hidden = true;
      tooltip.hidden = true;
      onHover(null);
      return;
    }
    const overlayRect = overlay.getBoundingClientRect();
    const plotRect = plotPane.getBoundingClientRect();
    const innerX = xForTime(ts, fromUtc, toUtc, plotRect.width) + (plotRect.left - overlayRect.left);
    cursor.hidden = false;
    cursor.style.left = `${innerX}px`;
    tooltip.hidden = true;
    onHover(ts);
  }

  stack.addEventListener(
    "mousemove",
    (e) => {
      if (touchActive) return;
      showTooltip(e.clientX, e.clientY);
    },
    { signal },
  );

  stack.addEventListener(
    "mouseleave",
    () => {
      cursor.hidden = true;
      tooltip.hidden = true;
      onHover(null);
    },
    { signal },
  );

  stack.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stopInertia();
      if (e.ctrlKey) {
        const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        zoomAtClientX(e.clientX, factor);
        return;
      }
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      shiftByPx(-dx);
    },
    { passive: false, signal },
  );

  stack.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      stopInertia();
      touchActive = true;
      touchLastX = e.clientX;
      touchVelocity = 0;
      stack.setPointerCapture(e.pointerId);
    },
    { signal },
  );

  stack.addEventListener(
    "pointermove",
    (e) => {
      if (!touchActive || e.pointerType !== "touch") return;
      const dx = e.clientX - touchLastX;
      touchLastX = e.clientX;
      touchVelocity = dx;
      if (dx !== 0) shiftByPx(dx);
    },
    { signal },
  );

  const endTouch = () => {
    if (!touchActive) return;
    touchActive = false;
    if (Math.abs(touchVelocity) >= INERTIA_MIN_V) runInertia();
  };

  stack.addEventListener("pointerup", endTouch, { signal });
  stack.addEventListener("pointercancel", endTouch, { signal });

  const unbindTheme = observeTimelineTheme(container, redraw);
  const ro = new ResizeObserver(() => redraw());
  ro.observe(stack);
  const nowTick = window.setInterval(() => updateNowLine(), 1000);
  signal.addEventListener("abort", () => {
    ro.disconnect();
    unbindTheme();
    stopInertia();
    window.clearInterval(nowTick);
  });

  updateFade();
  redraw();

  return {
    setWindow(f, t) {
      const next = clampViewWindow(f, t, minFromUtc, maxToUtc);
      fromUtc = next.fromUtc;
      toUtc = next.toUtc;
      updateFade();
      redrawTracks();
    },
    setLoadedBounds(f, t) {
      loadedFromUtc = f;
      loadedToUtc = t;
    },
    setLimits(minFrom, maxTo) {
      minFromUtc = minFrom;
      maxToUtc = maxTo;
      const next = clampViewWindow(fromUtc, toUtc, minFromUtc, maxToUtc);
      fromUtc = next.fromUtc;
      toUtc = next.toUtc;
      updateFade();
      redrawTracks();
    },
    panByPx: shiftByPx,
    setData(d) {
      data = d;
      redrawTracks();
    },
    setLegend(l) {
      legend = l;
      mountLegendsOnce();
      syncLegendGrids(stack, legend);
      redrawTracks();
    },
    resize: redrawTracks,
  };
}
