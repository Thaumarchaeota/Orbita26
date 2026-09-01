import type { SleepStagePoint, TrendPanel, TrendSeries } from "./types";
import { formatDelta } from "./format";
import { TREND_COLORS, resolveCssColor } from "./colors";
import { strokeSmoothLine, type PlotPoint } from "./canvas-smooth";
import { sanitizeValue } from "./sample-valid";

const PANEL_ORDER = ["recovery", "body_energy", "water", "stress"] as const;
const COMPOSITE_PANELS = new Set<string>(["recovery", "body_energy"]);

type ChartLayout = { pad: number; innerW: number; innerH: number; n: number };

type LinePlot = {
  series: TrendSeries;
  color: string;
  points: { i: number; x: number; y: number; v: number }[];
};

function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function seriesColor(metric: string): string {
  return resolveCssColor(TREND_COLORS[metric] ?? "#6366f1");
}

function sleepStageColors(): { deep: string; light: string; rem: string } {
  return {
    deep: resolveCssColor(TREND_COLORS.sleep_deep),
    light: resolveCssColor(TREND_COLORS.sleep_light),
    rem: resolveCssColor(TREND_COLORS.sleep_rem),
  };
}

function xAt(i: number, n: number, pad: number, innerW: number): number {
  return pad + (i / Math.max(1, n - 1)) * innerW;
}

function layout(w: number, h: number, n: number): ChartLayout {
  const pad = 6;
  return { pad, innerW: w - pad * 2, innerH: h - pad * 2, n };
}

function buildLinePlot(
  series: TrendSeries,
  n: number,
  pad: number,
  innerW: number,
  innerH: number,
  yTop: number,
): LinePlot | null {
  const valid = series.points
    .map((p, i) => ({ i, v: sanitizeValue(series.metric, p.value) }))
    .filter((p) => p.v !== null) as { i: number; v: number }[];
  if (valid.length < 2) return null;
  const vals = valid.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  return {
    series,
    color: seriesColor(series.metric),
    points: valid.map((p) => ({
      i: p.i,
      x: xAt(p.i, n, pad, innerW),
      y: yTop + innerH - ((p.v - min) / range) * innerH,
      v: p.v,
    })),
  };
}

function drawSleepStack(
  ctx: CanvasRenderingContext2D,
  stages: SleepStagePoint[],
  lay: ChartLayout,
  yBase: number,
  barInnerH: number,
  maxHours: number,
  hoverI: number | null,
): void {
  const colors = sleepStageColors();
  const barW = Math.max(4, (lay.innerW / Math.max(1, lay.n)) * 0.65);
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const deep = s.deep ?? 0;
    const light = s.light ?? 0;
    const rem = s.rem ?? 0;
    const total = deep + light + rem;
    if (total <= 0) continue;
    const x = xAt(i, lay.n, lay.pad, lay.innerW) - barW / 2;
    let y = yBase;
    const scale = barInnerH / maxHours;
    const alpha = hoverI === null || hoverI === i ? 0.85 : 0.35;
    for (const [h, color] of [
      [deep, colors.deep],
      [light, colors.light],
      [rem, colors.rem],
    ] as const) {
      if (h <= 0) continue;
      const bh = h * scale;
      y -= bh;
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, y, barW, bh);
    }
    ctx.globalAlpha = 1;
  }
}

function drawLinePlot(ctx: CanvasRenderingContext2D, plot: LinePlot, hoverI: number | null): void {
  const pts: PlotPoint[] = plot.points.map((p) => ({ x: p.x, y: p.y }));
  ctx.strokeStyle = plot.color;
  ctx.lineWidth = 1.75;
  ctx.globalAlpha = hoverI === null ? 1 : 0.35;
  strokeSmoothLine(ctx, pts);
  ctx.globalAlpha = 1;
  for (const p of plot.points) {
    const active = hoverI === null || hoverI === p.i;
    if (!active) continue;
    ctx.fillStyle = plot.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hoverI === p.i ? 4.5 : 2, 0, Math.PI * 2);
    ctx.fill();
    if (hoverI === p.i) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawCompositeChart(
  ctx: CanvasRenderingContext2D,
  panel: TrendPanel,
  w: number,
  h: number,
  hoverI: number | null,
): LinePlot[] {
  const lay = layout(w, h, panel.series[0]?.points.length ?? 0);
  const plots: LinePlot[] = [];
  if (lay.n < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("暂无足够数据", 8, h / 2 + 4);
    return plots;
  }

  if (hoverI !== null) {
    const x = xAt(hoverI, lay.n, lay.pad, lay.innerW);
    ctx.strokeStyle = "rgba(107, 114, 128, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, lay.pad);
    ctx.lineTo(x, lay.pad + lay.innerH);
    ctx.stroke();
  }

  if (panel.id === "recovery") {
    const sleep = panel.series.find((s) => s.metric === "sleep");
    const stages = sleep?.stages ?? [];
    const totals = stages.map((s) => (s.deep ?? 0) + (s.light ?? 0) + (s.rem ?? 0));
    const maxHours = Math.max(8, ...totals, 1);
    const barH = lay.innerH * 0.55;
    const yBase = lay.pad + lay.innerH;
    drawSleepStack(ctx, stages, lay, yBase, barH, maxHours, hoverI);
    const lineH = lay.innerH * 0.9;
    for (const s of panel.series) {
      if (s.metric === "sleep") continue;
      const plot = buildLinePlot(s, lay.n, lay.pad, lay.innerW, lineH, lay.pad);
      if (plot) {
        drawLinePlot(ctx, plot, hoverI);
        plots.push(plot);
      }
    }
    return plots;
  }

  if (panel.id === "body_energy") {
    for (const s of panel.series) {
      const plot = buildLinePlot(s, lay.n, lay.pad, lay.innerW, lay.innerH, lay.pad);
      if (plot) {
        drawLinePlot(ctx, plot, hoverI);
        plots.push(plot);
      }
    }
  }
  return plots;
}

function drawSimpleChart(
  ctx: CanvasRenderingContext2D,
  series: TrendSeries,
  w: number,
  h: number,
  hoverI: number | null,
): LinePlot | null {
  const lay = layout(w, h, series.points.length);
  if (lay.n < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("暂无足够数据", 8, h / 2 + 4);
    return null;
  }
  const color = seriesColor(series.metric);
  if (series.chartType === "bar") {
    const valid = series.points.map((p) => sanitizeValue(series.metric, p.value)).filter((v) => v !== null);
    if (valid.length === 0) return null;
    const max = Math.max(...valid, 1);
    const barW = (lay.innerW / lay.n) * 0.7;
    for (let i = 0; i < series.points.length; i++) {
      const v = sanitizeValue(series.metric, series.points[i].value);
      if (v === null) continue;
      const x = xAt(i, lay.n, lay.pad, lay.innerW);
      const bh = (v / max) * lay.innerH;
      ctx.fillStyle = color;
      ctx.globalAlpha = hoverI === null || hoverI === i ? 0.75 : 0.3;
      ctx.fillRect(x - barW / 2, lay.pad + lay.innerH - bh, barW, bh);
    }
    ctx.globalAlpha = 1;
    if (hoverI !== null) {
      const v = sanitizeValue(series.metric, series.points[hoverI]?.value ?? null);
      if (v !== null) {
        const x = xAt(hoverI, lay.n, lay.pad, lay.innerW);
        const y = lay.pad + lay.innerH - (v / max) * lay.innerH;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    return null;
  }
  const plot = buildLinePlot(series, lay.n, lay.pad, lay.innerW, lay.innerH, lay.pad);
  if (!plot) return null;
  if (hoverI !== null) {
    const x = xAt(hoverI, lay.n, lay.pad, lay.innerW);
    ctx.strokeStyle = "rgba(107, 114, 128, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, lay.pad);
    ctx.lineTo(x, lay.pad + lay.innerH);
    ctx.stroke();
  }
  drawLinePlot(ctx, plot, hoverI);
  return plot;
}

function formatTrendValue(series: TrendSeries, v: number): string {
  const d = series.unit === "%" ? 0 : series.unit === "h" ? 1 : 1;
  return `${v.toFixed(d)}${series.unit}`;
}

function tooltipHtml(panel: TrendPanel, hoverI: number): string {
  const date = panel.series[0]?.points[hoverI]?.date ?? "";
  const lines = [`<strong>${date.slice(5)}</strong>`];
  for (const s of panel.series) {
    if (s.metric === "sleep" && s.stages?.[hoverI]) {
      const st = s.stages[hoverI];
      const total = (st.deep ?? 0) + (st.light ?? 0) + (st.rem ?? 0);
      if (total > 0) lines.push(`睡眠 ${total.toFixed(1)}h`);
      continue;
    }
    const v = sanitizeValue(s.metric, s.points[hoverI]?.value ?? null);
    if (v !== null) lines.push(`${s.label} ${formatTrendValue(s, v)}`);
  }
  return lines.join("<br>");
}

function nearestIndex(clientX: number, canvas: HTMLCanvasElement, n: number): number | null {
  if (n < 1) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const pad = 6;
  const innerW = rect.width - pad * 2;
  if (innerW <= 0) return null;
  const ratio = (x - pad) / innerW;
  const i = Math.round(ratio * Math.max(0, n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

function mountChartInteraction(
  wrap: HTMLElement,
  canvas: HTMLCanvasElement,
  panel: TrendPanel,
  paint: (hoverI: number | null) => void,
): void {
  const tooltip = document.createElement("div");
  tooltip.className = "health-trend-tooltip";
  tooltip.hidden = true;
  wrap.appendChild(tooltip);
  let hoverI: number | null = null;

  const update = (i: number | null, clientX: number, clientY: number) => {
    hoverI = i;
    paint(hoverI);
    if (i === null) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = false;
    tooltip.innerHTML = tooltipHtml(panel, i);
    const rect = wrap.getBoundingClientRect();
    tooltip.style.left = `${clientX - rect.left}px`;
    tooltip.style.top = `${clientY - rect.top}px`;
  };

  canvas.addEventListener("pointermove", (e) => {
    const n = panel.series[0]?.points.length ?? 0;
    update(nearestIndex(e.clientX, canvas, n), e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => update(null, 0, 0));
}

function metricHead(s: TrendSeries): string {
  const delta = formatDelta(s.windowAvg, s.prevWindowAvg, s.unit);
  const avg = s.windowAvg !== null ? `${s.windowAvg.toFixed(s.unit === "%" ? 0 : 1)}${s.unit}` : "—";
  const color = seriesColor(s.metric === "sleep" ? "sleep_deep" : s.metric);
  return `<div class="health-trend-metric-head">
    <span class="health-trend-metric-label"><span class="health-trend-dot" style="background:${color}"></span>${s.label}</span>
    <span class="health-trend-metric-avg">${avg}${delta ? ` <em>${delta}</em>` : ""}</span>
  </div>`;
}

export function renderTrends(root: HTMLElement, panels: TrendPanel[]): void {
  const byId = new Map(panels.map((p) => [p.id, p]));
  root.innerHTML = `<div class="health-trends-rail"><div class="health-trends-grid"></div></div>`;
  const grid = root.querySelector<HTMLElement>(".health-trends-grid")!;

  for (const id of PANEL_ORDER) {
    const panel = byId.get(id) ?? { id, title: id, series: [] };
    const el = document.createElement("article");
    el.className = "health-trend-panel";
    const composite = COMPOSITE_PANELS.has(panel.id) && panel.series.length > 0;
    const heads = panel.series.length
      ? panel.series.map((s) => metricHead(s)).join("")
      : `<p class="health-trends-empty">暂无足够数据</p>`;
    el.innerHTML = `
      <h3 class="health-trend-title">${panel.title}</h3>
      <div class="health-trend-heads">${heads}</div>
      ${composite ? `<div class="health-trend-chart-wrap"><canvas class="health-trend-composite-canvas" height="96"></canvas></div>` : ""}
      ${composite ? "" : panel.series.map((s, i) => `<div class="health-trend-chart-wrap" data-series="${i}"><canvas class="health-trend-canvas" height="48"></canvas></div>`).join("")}
    `;
    grid.appendChild(el);

    if (composite) {
      const wrap = el.querySelector<HTMLElement>(".health-trend-chart-wrap")!;
      const canvas = wrap.querySelector<HTMLCanvasElement>(".health-trend-composite-canvas")!;
      const paint = (hoverI: number | null) => {
        const { ctx, w, h } = setupCanvas(canvas);
        ctx.clearRect(0, 0, w, h);
        drawCompositeChart(ctx, panel, w, h, hoverI);
      };
      paint(null);
      mountChartInteraction(wrap, canvas, panel, paint);
      new ResizeObserver(() => paint(null)).observe(canvas);
    } else {
      panel.series.forEach((s, i) => {
        const wrap = el.querySelector<HTMLElement>(`[data-series="${i}"]`)!;
        const canvas = wrap.querySelector<HTMLCanvasElement>(".health-trend-canvas")!;
        const paint = (hoverI: number | null) => {
          const { ctx, w, h } = setupCanvas(canvas);
          ctx.clearRect(0, 0, w, h);
          drawSimpleChart(ctx, s, w, h, hoverI);
        };
        paint(null);
        mountChartInteraction(wrap, canvas, { ...panel, series: [s] }, paint);
        new ResizeObserver(() => paint(null)).observe(canvas);
      });
    }
  }
}
