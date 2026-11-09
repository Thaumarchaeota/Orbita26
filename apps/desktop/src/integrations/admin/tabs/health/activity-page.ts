import { bindBackdropPressDismiss } from "../../../../ui/backdrop-dismiss";
import { ACTIVITY_GLYPH } from "./activity-glyph";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../../../../core/settings";
import {
  healthExportActivityFit,
  healthGetActivity,
  healthListActivities,
  healthReadActivityAsset,
  healthRetryActivityOriginal,
  type ActivityAssetSnapshot,
  type ActivityListItem,
} from "../../../health/activity-client";
import { strokeSmoothLine } from "./canvas-smooth";

const BJ = "Asia/Shanghai";
const EXCLUDED_TYPE_KEYS = new Set(["e_bike_fitness"]);
const TYPE_LABELS: Record<string, string> = {
  running: "跑步",
  track_running: "操场跑步",
  cycling: "骑行",
  road_biking: "公路骑行",
  walking: "步行",
  hiking: "徒步",
  strength_training: "力量训练",
};

type ActivityCardKind = "run" | "ride" | "hike" | "strength" | "other";

const CARD_FILTERS: { id: "all" | ActivityCardKind; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "run", label: "跑步" },
  { id: "ride", label: "骑行" },
  { id: "hike", label: "徒步" },
  { id: "strength", label: "力量训练" },
];

export type ActivityPageHost = {
  openDetail: (id: string) => void;
  closeDetail: () => void;
};

export function activityTypeLabel(typeKey: string | null | undefined): string {
  if (!typeKey) return "其他活动";
  return TYPE_LABELS[typeKey] ?? "其他活动";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function isKnownTypeKey(typeKey: string | null | undefined): boolean {
  return Boolean(typeKey && TYPE_LABELS[typeKey]);
}

function formatDurationSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "未记录";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatIsoLocal(iso: string | null | undefined): string {
  if (!iso) return "未记录";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未记录";
  return d.toLocaleString("zh-CN", {
    timeZone: BJ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "未记录";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "未记录";
  const s = Math.round(secPerKm);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}'${String(r).padStart(2, "0")}"/km`;
}

function formatSpeedMps(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps)) return "未记录";
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function formatNumber(v: number | null | undefined, unit = "", digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "未记录";
  const n = digits > 0 ? v.toFixed(digits) : String(Math.round(v));
  return unit ? `${n} ${unit}` : n;
}

function isEndInvalid(a: ActivityListItem): boolean {
  if (!a.endedAt) return true;
  const start = Date.parse(a.startedAt);
  const end = Date.parse(a.endedAt);
  return !Number.isFinite(end) || end <= start;
}

function filterExcluded(activities: ActivityListItem[]): ActivityListItem[] {
  return activities.filter((a) => !EXCLUDED_TYPE_KEYS.has(a.typeKey ?? ""));
}

function cardKind(typeKey: string | null | undefined): ActivityCardKind {
  if (typeKey === "running" || typeKey === "track_running") return "run";
  if (typeKey === "cycling" || typeKey === "road_biking") return "ride";
  if (typeKey === "walking" || typeKey === "hiking") return "hike";
  if (typeKey === "strength_training") return "strength";
  return "other";
}

function glyph(paths: string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const GLYPH = {
  search: glyph('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  filter: glyph('<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>'),
  chevron: glyph('<path d="m6 9 6 6 6-6"/>', 14),
  pin: glyph('<path d="M20 10c0 4.4-3.6 8-8 11-4.4-3-8-6.6-8-11a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 14),
  open: glyph('<path d="m9 18 6-6-6-6"/>', 16),
  gauge: glyph('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>', 14),
  flame: glyph('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.5-1-2-1-3.5 0 0 4 2 4 6a4 4 0 1 1-8 0c0-1 .5-2 1.5-2.5"/>', 14),
  clock: glyph('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 14),
  bolt: glyph('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', 14),
  mountain: glyph('<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>', 14),
  run: ACTIVITY_GLYPH.run,
  ride: ACTIVITY_GLYPH.ride,
  walk: ACTIVITY_GLYPH.walk,
  climb: ACTIVITY_GLYPH.climb,
  strength: ACTIVITY_GLYPH.strength,
  bench: glyph('<path d="M4 14h16"/><path d="M6 14v4"/><path d="M18 14v4"/><path d="M8 10h5"/><path d="M14 8v6"/>', 28),
};

function formatCardWhen(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BJ,
    month: "numeric",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = pick("hour").padStart(2, "0");
  const minute = pick("minute").padStart(2, "0");
  return `${pick("month")}月${pick("day")}日 ${pick("weekday")} ${hour}:${minute}`;
}

function shownMetric(value: number | null | undefined, format: (n: number) => string): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return format(value);
}

function formatKmParts(meters: number | null | undefined): { num: string; unit: string } {
  if (meters == null || !Number.isFinite(meters)) return { num: "--", unit: "公里" };
  return { num: (meters / 1000).toFixed(2), unit: "公里" };
}

function formatPaceCard(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "--";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}'' /公里`;
}

function formatDurationWords(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "--";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

function formatKcalCard(value: number | null | undefined): string {
  return shownMetric(value, (n) => `${Math.round(n).toLocaleString("zh-CN")} 千卡`);
}

function formatSpeedCard(mps: number | null | undefined): string {
  return shownMetric(mps, (n) => `${(n * 3.6).toFixed(1)} 公里/小时`);
}

function formatPowerCard(watts: number | null | undefined): string {
  return shownMetric(watts, (n) => `${Math.round(n)} 瓦`);
}

function formatClimbCard(meters: number | null | undefined): string {
  return shownMetric(meters, (n) => `${Math.round(n).toLocaleString("zh-CN")} 米`);
}

function decodeBase64Json(b64: string): unknown {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function assetReady(assets: ActivityAssetSnapshot[], kind: string): boolean {
  return assets.some((a) => a.kind === kind && a.status === "ready");
}

function assetStatus(assets: ActivityAssetSnapshot[], kind: string): string | null {
  return assets.find((a) => a.kind === kind)?.status ?? null;
}

type AssetReadResult =
  | { kind: "absent" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: unknown };

async function readAssetJson(
  activityId: string,
  kind: string,
  assets: ActivityAssetSnapshot[],
): Promise<AssetReadResult> {
  if (!assetReady(assets, kind)) return { kind: "absent" };
  try {
    const res = await healthReadActivityAsset(activityId, kind);
    return { kind: "ok", data: decodeBase64Json(res.bytesBase64) };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "读取失败",
    };
  }
}

async function tryReadAssetJson(
  activityId: string,
  kind: string,
  assets: ActivityAssetSnapshot[],
): Promise<unknown | null> {
  const result = await readAssetJson(activityId, kind, assets);
  return result.kind === "ok" ? result.data : null;
}

async function readActivityGpsPoints(activityId: string): Promise<GpsPoint[]> {
  try {
    const detail = await healthGetActivity(activityId);
    const detailsJson = await tryReadAssetJson(activityId, "details", detail.assets);
    return detailsJson ? extractGpsPoints(detailsJson) : [];
  } catch {
    return [];
  }
}

type GpsPoint = { lat: number; lon: number };

const MIN_MAP_ZOOM = 4;
const MAX_MAP_ZOOM = 19;
const MAX_MERCATOR_LATITUDE = 85.05112878;

function extractGpsPoints(details: unknown): GpsPoint[] {
  const root = details as Record<string, unknown> | null;
  const poly = root?.geoPolylineDTO as Record<string, unknown> | undefined;
  const line = poly?.polyline;
  if (!Array.isArray(line)) return [];
  const out: GpsPoint[] = [];
  for (const p of line) {
    if (p == null || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    const lat = row.lat;
    const lon = row.lon;
    if (
      typeof lat === "number" &&
      typeof lon === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= MAX_MERCATOR_LATITUDE &&
      Math.abs(lon) <= 180 &&
      row.valid !== false
    ) {
      out.push({ lat, lon });
    }
  }
  return out;
}

type SeriesPoint = { t: number; v: number };

function extractMetricSeries(details: unknown, metricKey: string): SeriesPoint[] {
  const root = details as Record<string, unknown> | null;
  const blocks = root?.activityDetailMetrics;
  if (!Array.isArray(blocks)) return [];
  const out: SeriesPoint[] = [];
  for (const block of blocks) {
    if (block == null || typeof block !== "object") continue;
    const metrics = (block as Record<string, unknown>).metrics;
    if (!Array.isArray(metrics)) continue;
    for (const m of metrics) {
      if (m == null || typeof m !== "object") continue;
      const row = m as Record<string, unknown>;
      const v = row[metricKey];
      const t =
        (typeof row.directTimestamp === "number" ? row.directTimestamp : null) ??
        (typeof row.sumDuration === "number" ? row.sumDuration : null) ??
        (typeof row.sumElapsedDuration === "number" ? row.sumElapsedDuration : null);
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && typeof t === "number") {
        out.push({ t, v });
      }
    }
  }
  return out;
}

function speedToPaceSeries(points: SeriesPoint[]): SeriesPoint[] {
  return points
    .map((p) => ({ t: p.t, v: p.v > 0 ? 1000 / p.v : 0 }))
    .filter((p) => p.v > 0 && p.v < 3600);
}

type ChartDef = { id: string; label: string; unit: string; points: SeriesPoint[] };

function chartsForType(typeKey: string | null, details: unknown): ChartDef[] {
  const key = typeKey ?? "";
  const defs: { id: string; label: string; unit: string; metric: string; pace?: boolean }[] = [];
  if (key === "running" || key === "track_running") {
    defs.push(
      { id: "hr", label: "心率", unit: "bpm", metric: "directHeartRate" },
      { id: "pace", label: "配速", unit: "s/km", metric: "directSpeed", pace: true },
      { id: "elev", label: "海拔", unit: "m", metric: "directElevation" },
      { id: "cadence", label: "步频", unit: "spm", metric: "directRunCadence" },
      { id: "power", label: "功率", unit: "W", metric: "directPower" },
    );
  } else if (key === "cycling" || key === "road_biking") {
    defs.push(
      { id: "speed", label: "速度", unit: "m/s", metric: "directSpeed" },
      { id: "elev", label: "海拔", unit: "m", metric: "directElevation" },
      { id: "hr", label: "心率", unit: "bpm", metric: "directHeartRate" },
      { id: "power", label: "功率", unit: "W", metric: "directPower" },
      { id: "cadence", label: "踏频", unit: "rpm", metric: "directDoubleCadence" },
    );
  } else if (key === "walking" || key === "hiking") {
    defs.push(
      { id: "pace", label: "配速", unit: "s/km", metric: "directSpeed", pace: true },
      { id: "elev", label: "海拔", unit: "m", metric: "directElevation" },
      { id: "hr", label: "心率", unit: "bpm", metric: "directHeartRate" },
    );
  } else if (key === "strength_training") {
    defs.push({ id: "hr", label: "心率", unit: "bpm", metric: "directHeartRate" });
  }
  const out: ChartDef[] = [];
  for (const d of defs) {
    let points = extractMetricSeries(details, d.metric);
    if (d.pace) points = speedToPaceSeries(points);
    if (points.length > 1) out.push({ id: d.id, label: d.label, unit: d.unit, points });
  }
  return out;
}

function lonToPixel(lon: number, z: number): number {
  return ((lon + 180) / 360) * 256 * Math.pow(2, z);
}

function latToPixel(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * Math.pow(2, z);
}

function createRouteThumbnail(points: GpsPoint[]): SVGSVGElement {
  const width = 336;
  const height = 192;
  const padding = 20;
  let zoom = 17;
  let projected = points.map((point) => ({ x: lonToPixel(point.lon, zoom), y: latToPixel(point.lat, zoom) }));
  while (zoom > 1) {
    const minX = Math.min(...projected.map((point) => point.x));
    const maxX = Math.max(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const maxY = Math.max(...projected.map((point) => point.y));
    if (maxX - minX <= width - padding * 2 && maxY - minY <= height - padding * 2) break;
    zoom -= 1;
    projected = points.map((point) => ({ x: lonToPixel(point.lon, zoom), y: latToPixel(point.lat, zoom) }));
  }
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const left = (minX + maxX) / 2 - width / 2;
  const top = (minY + maxY) / 2 - height / 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("health-activity-route-thumbnail");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "活动路线缩略图");
  const tilesAcross = Math.pow(2, zoom);
  for (let tileY = Math.floor(top / 256); tileY <= Math.floor((top + height) / 256); tileY += 1) {
    if (tileY < 0 || tileY >= tilesAcross) continue;
    for (let tileX = Math.floor(left / 256); tileX <= Math.floor((left + width) / 256); tileX += 1) {
      const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
      const wrappedX = ((tileX % tilesAcross) + tilesAcross) % tilesAcross;
      image.setAttribute("x", String(tileX * 256 - left));
      image.setAttribute("y", String(tileY * 256 - top));
      image.setAttribute("width", "256");
      image.setAttribute("height", "256");
      image.setAttribute("href", `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`);
      svg.append(image);
    }
  }
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", projected.map((point) => `${point.x - left},${point.y - top}`).join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#f97316");
  line.setAttribute("stroke-width", "4");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(line);
  const start = projected[0];
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  marker.setAttribute("cx", String(start.x - left));
  marker.setAttribute("cy", String(start.y - top));
  marker.setAttribute("r", "5");
  marker.setAttribute("fill", "#f97316");
  marker.setAttribute("stroke", "#ffffff");
  marker.setAttribute("stroke-width", "2");
  svg.append(marker);
  return svg;
}

function mountMap(container: HTMLElement, points: GpsPoint[]): void {
  const wrap = document.createElement("section");
  wrap.className = "health-activity-map-wrap";
  wrap.setAttribute("aria-label", "活动路线地图");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("health-activity-map-canvas");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "活动路线与地图底图");
  const controls = document.createElement("div");
  controls.className = "health-activity-map-controls";
  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "health-activity-map-zoom";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "缩小地图");
  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "health-activity-map-zoom";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "放大地图");
  controls.append(zoomOut, zoomIn);
  const notice = document.createElement("div");
  notice.className = "health-activity-map-notice";
  notice.setAttribute("aria-live", "polite");
  wrap.append(svg, controls, notice);
  container.append(wrap);

  if (points.length === 0) {
    controls.hidden = true;
    notice.textContent = "此活动没有可用的 GPS 轨迹";
    return;
  }

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pad = 0.0008;
  const bMinLat = Math.max(-MAX_MERCATOR_LATITUDE, minLat - pad);
  const bMaxLat = Math.min(MAX_MERCATOR_LATITUDE, maxLat + pad);
  const bMinLon = minLon - pad;
  const bMaxLon = maxLon + pad;

  let zoom = MAX_MAP_ZOOM;
  for (; zoom >= MIN_MAP_ZOOM; zoom--) {
    const w = lonToPixel(bMaxLon, zoom) - lonToPixel(bMinLon, zoom);
    const h = latToPixel(bMaxLat, zoom) - latToPixel(bMinLat, zoom);
    if (w <= 640 && h <= 220) break;
  }

  zoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom));
  const centerLon = (bMinLon + bMaxLon) / 2;
  const centerLat = (bMinLat + bMaxLat) / 2;
  let renderGeneration = 0;

  function updateZoomControls(): void {
    zoomOut.disabled = zoom <= MIN_MAP_ZOOM;
    zoomIn.disabled = zoom >= MAX_MAP_ZOOM;
  }

  function render(): void {
    const generation = ++renderGeneration;
    const width = Math.max(1, wrap.clientWidth || 640);
    const height = Math.max(1, wrap.clientHeight || 240);
    const centerX = lonToPixel(centerLon, zoom);
    const centerY = latToPixel(centerLat, zoom);
    const viewLeft = centerX - width / 2;
    const viewTop = centerY - height / 2;
    const x0 = Math.floor(viewLeft / 256);
    const x1 = Math.floor((viewLeft + width) / 256);
    const y0 = Math.floor(viewTop / 256);
    const y1 = Math.floor((viewTop + height) / 256);
    const tilesAcross = Math.pow(2, zoom);
    let remainingTiles = 0;
    let mapFailed = false;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    notice.textContent = "正在加载地图";
    updateZoomControls();

    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= tilesAcross) continue;
        const wrappedX = ((tx % tilesAcross) + tilesAcross) % tilesAcross;
        const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
        image.setAttribute("x", String(tx * 256 - viewLeft));
        image.setAttribute("y", String(ty * 256 - viewTop));
        image.setAttribute("width", "256");
        image.setAttribute("height", "256");
        image.setAttribute("preserveAspectRatio", "none");
        image.setAttribute("href", `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`);
        remainingTiles += 1;
        image.addEventListener("load", () => {
          if (generation !== renderGeneration) return;
          remainingTiles -= 1;
          if (remainingTiles === 0 && !mapFailed) notice.textContent = "";
        });
        image.addEventListener("error", () => {
          if (generation !== renderGeneration) return;
          if (!mapFailed) notice.textContent = "地图底图未能加载，轨迹仍可查看";
          mapFailed = true;
        });
        svg.append(image);
      }
    }

    const pathPts = points.map((p) => {
      const px = lonToPixel(p.lon, zoom) - viewLeft;
      const py = latToPixel(p.lat, zoom) - viewTop;
      return `${px},${py}`;
    });
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", pathPts.join(" "));
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "#2563eb");
    poly.setAttribute("stroke-width", "3");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    svg.append(poly);
  }

  function changeZoom(delta: number): void {
    const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom + delta));
    if (nextZoom === zoom) return;
    zoom = nextZoom;
    render();
  }

  zoomOut.addEventListener("click", () => changeZoom(-1));
  zoomIn.addEventListener("click", () => changeZoom(1));
  requestAnimationFrame(render);
}

function drawChart(canvas: HTMLCanvasElement, points: SeriesPoint[], label: string): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = 8;
  const vals = points.map((p) => p.v);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = Math.max(1e-6, maxV - minV);
  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const tSpan = Math.max(1, maxT - minT);
  const plot: { x: number; y: number }[] = points.map((p) => ({
    x: pad + ((p.t - minT) / tSpan) * (w - pad * 2),
    y: h - pad - ((p.v - minV) / span) * (h - pad * 2),
  }));
  ctx.strokeStyle = "#5b96d1";
  ctx.lineWidth = 1.5;
  strokeSmoothLine(ctx, plot);
  ctx.fillStyle = "#6b7280";
  ctx.font = "10px system-ui,sans-serif";
  ctx.fillText(label, pad, 12);
}

type TableColumn = { key: string; label: string; fmt?: (v: unknown) => string };

function cellText(v: unknown, fmt?: (v: unknown) => string): string {
  if (fmt) return fmt(v);
  if (v == null) return "未记录";
  return String(v);
}

function setModuleTitle(mod: HTMLElement, title: string): void {
  const heading = document.createElement("h4");
  heading.className = "health-activity-module-title";
  heading.textContent = title;
  mod.append(heading);
}

function renderModuleMessage(
  container: HTMLElement,
  title: string,
  message: string,
  tone: "error" | "empty",
): void {
  const mod = document.createElement("section");
  mod.className = "health-activity-module";
  setModuleTitle(mod, title);
  const note = document.createElement("div");
  note.className = tone === "error" ? "health-activity-load-error" : "health-activity-empty";
  note.textContent = message;
  mod.append(note);
  container.append(mod);
}

function renderJsonTable(
  container: HTMLElement,
  title: string,
  rows: Record<string, unknown>[],
  columns: TableColumn[],
): void {
  if (rows.length === 0) return;
  const mod = document.createElement("section");
  mod.className = "health-activity-module";
  setModuleTitle(mod, title);
  const table = document.createElement("table");
  table.className = "health-activity-table";
  const head = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c.label;
    head.append(th);
  }
  table.append(head);
  for (const row of rows.slice(0, 80)) {
    const tr = document.createElement("tr");
    for (const c of columns) {
      const td = document.createElement("td");
      td.textContent = cellText(row[c.key], c.fmt);
      tr.append(td);
    }
    table.append(tr);
  }
  mod.append(table);
  container.append(mod);
}

function renderAssetTableModule(
  container: HTMLElement,
  title: string,
  result: AssetReadResult,
  rowKey: string,
  columns: TableColumn[],
  emptyMessage: string,
): void {
  if (result.kind === "absent") return;
  if (result.kind === "error") {
    renderModuleMessage(container, title, result.message, "error");
    return;
  }
  const rows = asRows(result.data, rowKey);
  if (rows.length === 0) {
    renderModuleMessage(container, title, emptyMessage, "empty");
    return;
  }
  renderJsonTable(container, title, rows, columns);
}

const SPLIT_DISTANCE_FMT = (v: unknown) =>
  formatDistance(typeof v === "number" ? v : null);
const SPLIT_DURATION_FMT = (v: unknown) =>
  formatDurationSec(typeof v === "number" ? v : null);
const SPLIT_SPEED_FMT = (v: unknown) =>
  formatSpeedMps(typeof v === "number" ? v : null);
const SPLIT_HR_FMT = (v: unknown) => formatNumber(typeof v === "number" ? v : null, "bpm");
const SPLIT_ELEV_FMT = (v: unknown) => formatNumber(typeof v === "number" ? v : null, "m");
const SPLIT_COUNT_FMT = (v: unknown) => formatNumber(typeof v === "number" ? v : null);
const SPLIT_TYPE_FMT = (v: unknown) => (v == null ? "未记录" : String(v));

function asRows(data: unknown, key: string): Record<string, unknown>[] {
  const root = data as Record<string, unknown> | null;
  const v = root?.[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

export function createActivityPageHost(root: HTMLElement, signal: AbortSignal): ActivityPageHost {
  let backdrop: HTMLElement | null = null;

  function closeDetail(): void {
    backdrop?.remove();
    backdrop = null;
  }

  async function openDetail(id: string): Promise<void> {
    closeDetail();
    backdrop = document.createElement("div");
    backdrop.className = "health-activity-detail-backdrop";
    backdrop.innerHTML = `<div class="health-activity-detail-panel" role="dialog" aria-modal="true">
      <div class="health-activity-detail-head">
        <div class="health-activity-detail-title-block">
          <h2 class="health-activity-detail-title">加载中…</h2>
        </div>
        <div class="health-activity-detail-actions">
          <button type="button" class="health-btn" data-action="close">关闭</button>
        </div>
      </div>
      <div class="health-activity-detail-body"></div>
    </div>`;
    const panel = backdrop.querySelector<HTMLElement>(".health-activity-detail-panel")!;
    const body = backdrop.querySelector<HTMLElement>(".health-activity-detail-body")!;
    const titleEl = backdrop.querySelector<HTMLElement>(".health-activity-detail-title")!;
    const actions = backdrop.querySelector<HTMLElement>(".health-activity-detail-actions")!;

    bindBackdropPressDismiss(backdrop, closeDetail, { signal });
    backdrop.addEventListener(
      "click",
      (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
        if (!btn) return;
        if (btn.dataset.action === "close") closeDetail();
        if (btn.dataset.action === "export-fit") void exportFit(id, btn);
        if (btn.dataset.action === "retry-original") void retryOriginal(id, btn);
      },
      { signal },
    );

    root.append(backdrop);

    try {
      const detail = await healthGetActivity(id);
      const a = detail.activity;
      const assets = detail.assets;
      titleEl.textContent = a.title || activityTypeLabel(a.typeKey);

      const badges: string[] = [];
      if (a.detailStatus === "unsynced") badges.push('<span class="health-activity-badge is-warn">未同步</span>');
      if (a.detailStatus === "stale") badges.push('<span class="health-activity-badge is-warn">数据待更新</span>');
      if (isEndInvalid(a)) badges.push('<span class="health-activity-badge is-error">结束时间无效</span>');
      const zipStatus = assetStatus(assets, "original_zip");
      if (zipStatus === "pending") badges.push('<span class="health-activity-badge">备份中</span>');

      const exportBtn =
        zipStatus === "ready"
          ? '<button type="button" class="health-btn health-btn-primary" data-action="export-fit">导出 FIT</button>'
          : "";
      const retryBtn =
        zipStatus === "failed"
          ? '<button type="button" class="health-btn" data-action="retry-original">重试下载</button>'
          : "";
      actions.innerHTML = `${retryBtn}${exportBtn}<button type="button" class="health-btn" data-action="close">关闭</button>`;

      const cards: { label: string; value: string }[] = [
        { label: "距离", value: formatDistance(a.distanceMeters) },
        { label: "爬升", value: formatNumber(a.elevationGainMeters, "m") },
        { label: "平均心率", value: formatNumber(a.avgHeartRateBpm, "bpm") },
        { label: "平均速度", value: formatSpeedMps(a.avgSpeedMps) },
        { label: "平均配速", value: formatPace(a.avgPaceSecondsPerKm) },
        { label: "平均功率", value: formatNumber(a.avgPowerWatts, "W") },
        {
          label: "总消耗（未与 Garmin 页面核对）",
          value: formatNumber(a.calories, "kcal"),
        },
      ].filter((c) => c.label.includes("总消耗") || c.value !== "未记录");

      const times: string[] = [
        `<div><strong>开始</strong> ${formatIsoLocal(a.startedAt)}</div>`,
        `<div><strong>结束</strong> ${isEndInvalid(a) ? "结束时间无效" : formatIsoLocal(a.endedAt)}</div>`,
        `<div><strong>duration</strong> ${formatDurationSec(a.durationSeconds)}</div>`,
        `<div><strong>elapsedDuration</strong> ${formatDurationSec(a.elapsedDurationSeconds)}</div>`,
      ];
      if (typeof a.movingDurationSeconds === "number" && Number.isFinite(a.movingDurationSeconds)) {
        times.push(
          `<div><strong>移动时间</strong> ${formatDurationSec(a.movingDurationSeconds)}</div>`,
        );
      }

      body.innerHTML = `
        <div class="health-activity-badges">${badges.join("")}</div>
        <div class="health-activity-detail-sub">${activityTypeLabel(a.typeKey)}${a.typeKey && !isKnownTypeKey(a.typeKey) ? ` · ${escapeHtml(a.typeKey)}` : ""}</div>
        <div class="health-activity-times">${times.join("")}</div>
        <div class="health-activity-cards">${cards
          .map(
            (c) =>
              `<div class="health-activity-card"><div class="health-activity-card-label">${c.label}</div><div class="health-activity-card-value">${c.value}</div></div>`,
          )
          .join("")}</div>
        <div data-region="map"></div>
        <div data-region="charts" class="health-activity-charts"></div>
        <div data-region="modules"></div>`;

      const detailsJson = await tryReadAssetJson(id, "details", assets);
      const gps = detailsJson ? extractGpsPoints(detailsJson) : [];
      mountMap(body.querySelector<HTMLElement>("[data-region=map]")!, gps);

      const chartsRegion = body.querySelector<HTMLElement>("[data-region=charts]")!;
      if (detailsJson) {
        for (const chart of chartsForType(a.typeKey, detailsJson)) {
          const block = document.createElement("div");
          block.className = "health-activity-chart";
          block.innerHTML = `<div class="health-activity-chart-title">${chart.label}</div>`;
          const canvas = document.createElement("canvas");
          canvas.className = "health-activity-chart-canvas";
          block.append(canvas);
          chartsRegion.append(block);
          requestAnimationFrame(() => drawChart(canvas, chart.points, chart.label));
        }
      }

      const modules = body.querySelector<HTMLElement>("[data-region=modules]")!;
      renderAssetTableModule(
        modules,
        "分段",
        await readAssetJson(id, "splits", assets),
        "lapDTOs",
        [
          { key: "lapIndex", label: "圈", fmt: SPLIT_COUNT_FMT },
          { key: "distance", label: "距离", fmt: SPLIT_DISTANCE_FMT },
          { key: "duration", label: "时长", fmt: SPLIT_DURATION_FMT },
          { key: "averageSpeed", label: "平均速度", fmt: SPLIT_SPEED_FMT },
          { key: "averageHR", label: "平均心率", fmt: SPLIT_HR_FMT },
          { key: "elevationGain", label: "爬升", fmt: SPLIT_ELEV_FMT },
        ],
        "无分段记录",
      );
      renderAssetTableModule(
        modules,
        "分段汇总",
        await readAssetJson(id, "split_summaries", assets),
        "splitSummaries",
        [
          { key: "splitType", label: "类型", fmt: SPLIT_TYPE_FMT },
          { key: "noOfSplits", label: "段数", fmt: SPLIT_COUNT_FMT },
          { key: "distance", label: "距离", fmt: SPLIT_DISTANCE_FMT },
          { key: "duration", label: "时长", fmt: SPLIT_DURATION_FMT },
          { key: "averageSpeed", label: "平均速度", fmt: SPLIT_SPEED_FMT },
          { key: "averageHR", label: "平均心率", fmt: SPLIT_HR_FMT },
          { key: "elevationGain", label: "爬升", fmt: SPLIT_ELEV_FMT },
        ],
        "无分段汇总",
      );
      renderAssetTableModule(
        modules,
        "类型分段",
        await readAssetJson(id, "typed_splits", assets),
        "splits",
        [
          { key: "type", label: "类型", fmt: SPLIT_TYPE_FMT },
          { key: "distance", label: "距离", fmt: SPLIT_DISTANCE_FMT },
          { key: "duration", label: "时长", fmt: SPLIT_DURATION_FMT },
          { key: "averageSpeed", label: "平均速度", fmt: SPLIT_SPEED_FMT },
          { key: "averageHR", label: "平均心率", fmt: SPLIT_HR_FMT },
          { key: "elevationGain", label: "爬升", fmt: SPLIT_ELEV_FMT },
        ],
        "无类型分段",
      );
      const hrZones = await tryReadAssetJson(id, "heart_rate_zones", assets);
      renderJsonTable(modules, "心率区间", asRows(hrZones, "heartRateZones"), [
        { key: "zoneNumber", label: "区间" },
        { key: "secsInZone", label: "秒", fmt: SPLIT_DURATION_FMT },
      ]);
      const powerZones = await tryReadAssetJson(id, "power_zones", assets);
      renderJsonTable(modules, "功率区间", asRows(powerZones, "powerZones"), [
        { key: "zoneNumber", label: "区间" },
        { key: "secsInZone", label: "秒", fmt: SPLIT_DURATION_FMT },
      ]);
      const exerciseSets = await tryReadAssetJson(id, "exercise_sets", assets);
      renderJsonTable(modules, "力量组", asRows(exerciseSets, "exerciseSets"), [
        { key: "exerciseName", label: "动作" },
        { key: "reps", label: "次数" },
        { key: "weight", label: "重量" },
      ]);
      const weather = await tryReadAssetJson(id, "weather", assets);
      if (weather && typeof weather === "object") {
        const w = weather as Record<string, unknown>;
        const rows = Object.keys(w).length ? [w] : [];
        renderJsonTable(modules, "天气", rows, [
          { key: "temp", label: "温度" },
          { key: "windSpeed", label: "风速" },
          { key: "humidity", label: "湿度" },
        ]);
      }
    } catch (err) {
      const error = document.createElement("div");
      error.className = "health-activity-load-error";
      error.textContent = err instanceof Error ? err.message : "加载失败";
      body.replaceChildren(error);
      titleEl.textContent = "活动详情";
    }
  }

  async function exportFit(activityId: string, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      const dataDir = getSettings().dataDir;
      if (!dataDir) throw new Error("未配置数据目录");
      const detail = await healthGetActivity(activityId);
      const name = `${detail.activity.garminActivityId || activityId}.fit`;
      const outputPath = `${dataDir.replace(/[/\\]+$/, "")}/exports/${name}`;
      await healthExportActivityFit(activityId, outputPath);
      await invoke("reveal_path_in_explorer", { path: outputPath });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "导出失败");
    } finally {
      btn.disabled = false;
    }
  }

  async function retryOriginal(activityId: string, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      await healthRetryActivityOriginal(activityId);
      await openDetail(activityId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "重试失败");
    } finally {
      btn.disabled = false;
    }
  }

  return { openDetail: (id) => void openDetail(id), closeDetail };
}

function activityErrorText(err: unknown): string {
  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* not json */
  }
  return raw || "未知错误";
}

export function mountActivityListSection(
  root: HTMLElement,
  host: ActivityPageHost,
  signal: AbortSignal,
): { reload: () => Promise<void> } {
  let activities: ActivityListItem[] = [];
  let loadError: string | null = null;
  let search = "";
  let kindFilter: "all" | ActivityCardKind = "all";
  const routeCache = new Map<string, Promise<GpsPoint[]>>();
  let thumbnailObserver: IntersectionObserver | null = null;
  let paintVersion = 0;

  root.innerHTML = `
    <section class="health-activity-board">
      <div class="health-activity-board-head">
        <div class="health-activity-board-lead">
          <h3 class="health-activity-board-title">活动列表</h3>
          <div class="health-activity-pills" role="tablist">
            ${CARD_FILTERS.map(
              (f) =>
                `<button type="button" class="health-activity-pill${f.id === "all" ? " is-active" : ""}" data-kind="${f.id}" role="tab" aria-selected="${f.id === "all" ? "true" : "false"}">${f.label}</button>`,
            ).join("")}
          </div>
        </div>
        <div class="health-activity-board-tools">
          <label class="health-activity-searchbox">
            ${GLYPH.search}
            <input type="search" placeholder="搜索活动、地点或备注" data-field="search" />
          </label>
          <button type="button" class="health-activity-filter-btn" data-field="more-filter" aria-expanded="false">
            ${GLYPH.filter}<span>筛选</span>${GLYPH.chevron}
          </button>
        </div>
      </div>
      <div class="health-activity-list" data-region="list"></div>
    </section>`;

  const listRegion = root.querySelector<HTMLElement>('[data-region="list"]')!;
  const searchEl = root.querySelector<HTMLInputElement>('[data-field="search"]')!;
  const filterBtn = root.querySelector<HTMLButtonElement>('[data-field="more-filter"]')!;

  function filtered(): ActivityListItem[] {
    const q = search.trim().toLowerCase();
    return filterExcluded(activities)
      .filter((a) => kindFilter === "all" || cardKind(a.typeKey) === kindFilter)
      .filter((a) => {
        if (!q) return true;
        const title = (a.title ?? "").toLowerCase();
        const typeLabel = activityTypeLabel(a.typeKey).toLowerCase();
        return title.includes(q) || typeLabel.includes(q);
      })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  function metricCell(iconHtml: string, label: string, value: string): string {
    return `<div class="health-activity-card-metric"><div class="health-activity-card-metric-label">${iconHtml}<span>${label}</span></div><div class="health-activity-card-metric-value">${escapeHtml(value)}</div></div>`;
  }

  function secondaryMetrics(a: ActivityListItem, kind: ActivityCardKind): string {
    if (kind === "ride") {
      return [
        metricCell(GLYPH.gauge, "平均速度", formatSpeedCard(a.avgSpeedMps)),
        metricCell(GLYPH.bolt, "平均功率", formatPowerCard(a.avgPowerWatts)),
        metricCell(GLYPH.mountain, "累计爬升", formatClimbCard(a.elevationGainMeters)),
        metricCell(GLYPH.flame, "消耗热量", formatKcalCard(a.calories)),
      ].join("");
    }
    if (kind === "hike") {
      return [
        metricCell(GLYPH.gauge, "平均速度", formatSpeedCard(a.avgSpeedMps)),
        metricCell(GLYPH.mountain, "累计爬升", formatClimbCard(a.elevationGainMeters)),
        metricCell(GLYPH.flame, "消耗热量", formatKcalCard(a.calories)),
        metricCell(GLYPH.clock, "运动时长", formatDurationWords(a.durationSeconds)),
      ].join("");
    }
    if (kind === "strength") {
      return [
        metricCell(GLYPH.flame, "消耗热量", formatKcalCard(a.calories)),
        metricCell(glyph('<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>', 14), "动作数量", "-- 个"),
        metricCell(GLYPH.bench, "组数", "-- 组"),
      ].join("");
    }
    return [
      metricCell(GLYPH.gauge, "平均配速", formatPaceCard(a.avgPaceSecondsPerKm)),
      metricCell(GLYPH.flame, "消耗热量", formatKcalCard(a.calories)),
      metricCell(GLYPH.clock, "运动时长", formatDurationWords(a.durationSeconds)),
    ].join("");
  }

  function routeForActivity(activityId: string): Promise<GpsPoint[]> {
    const cached = routeCache.get(activityId);
    if (cached) return cached;
    const pending = readActivityGpsPoints(activityId);
    routeCache.set(activityId, pending);
    return pending;
  }

  function observeRouteThumbnails(visuals: HTMLElement[], version: number): void {
    thumbnailObserver?.disconnect();
    const hydrate = (visual: HTMLElement) => {
      if (!visual.isConnected || version !== paintVersion || visual.dataset.routeLoading === "true") return;
      visual.dataset.routeLoading = "true";
      visual.classList.remove("is-empty");
      visual.classList.add("is-loading");
      visual.textContent = "加载路线…";
      const activityId = visual.dataset.activityId!;
      void routeForActivity(activityId).then(async (points) => {
        if (!visual.isConnected || version !== paintVersion) return;
        if (points.length === 0) {
          visual.dataset.routeLoading = "false";
          visual.classList.remove("is-loading");
          visual.classList.add("is-empty");
          visual.textContent = "暂无路线";
          return;
        }
        visual.dataset.routeLoading = "false";
        visual.classList.remove("is-loading");
        visual.classList.add("is-route");
        const thumbnail = createRouteThumbnail(points);
        const attribution = document.createElement("span");
        attribution.className = "health-activity-route-attribution";
        attribution.textContent = "© OpenStreetMap";
        visual.replaceChildren(thumbnail, attribution);
      });
    };
    if (!("IntersectionObserver" in window)) {
      visuals.forEach(hydrate);
      return;
    }
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          thumbnailObserver?.unobserve(entry.target);
          hydrate(entry.target as HTMLElement);
        }
      },
      { rootMargin: "180px 0px" },
    );
    visuals.forEach((visual) => thumbnailObserver?.observe(visual));
  }

  signal.addEventListener("abort", () => thumbnailObserver?.disconnect(), { once: true });

  function paint(): void {
    const version = ++paintVersion;
    root.querySelectorAll<HTMLButtonElement>(".health-activity-pill").forEach((btn) => {
      const on = btn.dataset.kind === kindFilter;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (loadError) {
      const error = document.createElement("div");
      error.className = "health-activity-load-error";
      error.textContent = `活动读取失败：${loadError}`;
      listRegion.replaceChildren(error);
      return;
    }
    const rows = filtered();
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "health-activity-empty";
      empty.textContent = "暂无活动";
      listRegion.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    const routeVisuals: HTMLElement[] = [];
    for (const a of rows) {
      const kind = cardKind(a.typeKey);
      const typeLabel = activityTypeLabel(a.typeKey);
      const title = a.title || typeLabel;
      const km = kind === "strength" ? null : formatKmParts(a.distanceMeters);
      const primaryLabel = kind === "strength" ? "运动时长" : "距离";
      const primaryValue =
        kind === "strength"
          ? `<span class="num">${escapeHtml(formatDurationWords(a.durationSeconds))}</span>`
          : `<span class="num">${escapeHtml(km!.num)}</span><span class="unit">${escapeHtml(km!.unit)}</span>`;
      const icon =
        a.typeKey === "walking"
          ? GLYPH.walk
          : a.typeKey === "hiking"
            ? GLYPH.climb
            : kind === "ride"
              ? GLYPH.ride
              : kind === "strength"
                ? GLYPH.strength
                : GLYPH.run;
      const card = document.createElement("article");
      card.className = `health-activity-card is-${kind}`;
      card.dataset.id = a.id;
      card.innerHTML = `
        <div class="health-activity-card-identity">
          <span class="health-activity-card-badge">${icon}</span>
          <div class="health-activity-card-copy">
            <div class="health-activity-card-when">${escapeHtml(formatCardWhen(a.startedAt))}</div>
            <div class="health-activity-card-title">${escapeHtml(title)}</div>
            <div class="health-activity-card-place">${GLYPH.pin}<span>--</span></div>
            ${a.typeKey && !isKnownTypeKey(a.typeKey) ? `<div class="health-activity-row-typekey">${escapeHtml(a.typeKey)}</div>` : ""}
          </div>
        </div>
        <div class="health-activity-card-stats">
          <div class="health-activity-card-primary">
            <div class="health-activity-card-metric-label">${primaryLabel}</div>
            <div class="health-activity-card-metric-value">${primaryValue}</div>
          </div>
          <div class="health-activity-card-secondary">${secondaryMetrics(a, kind)}</div>
        </div>
        ${kind === "strength" ? `<div class="health-activity-card-visual is-illustration" aria-hidden="true">${GLYPH.bench}</div>` : `<div class="health-activity-card-visual is-map is-empty" data-route-visual="true" data-activity-id="${escapeHtml(a.id)}" aria-hidden="true"><span>暂无路线</span></div>`}
        <button type="button" class="health-activity-card-open" aria-label="打开详情">${GLYPH.open}</button>`;
      const routeVisual = card.querySelector<HTMLElement>("[data-route-visual]");
      if (routeVisual) routeVisuals.push(routeVisual);
      fragment.append(card);
    }
    listRegion.replaceChildren(fragment);
    observeRouteThumbnails(routeVisuals, version);
  }

  listRegion.addEventListener(
    "click",
    (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (!row?.dataset.id) return;
      host.openDetail(row.dataset.id);
    },
    { signal },
  );

  searchEl.addEventListener(
    "input",
    () => {
      search = searchEl.value;
      paint();
    },
    { signal },
  );

  root.addEventListener(
    "click",
    (e) => {
      const pill = (e.target as HTMLElement).closest<HTMLButtonElement>(".health-activity-pill");
      if (!pill?.dataset.kind) return;
      kindFilter = pill.dataset.kind as "all" | ActivityCardKind;
      paint();
    },
    { signal },
  );

  filterBtn.addEventListener(
    "click",
    () => {
      const open = filterBtn.getAttribute("aria-expanded") === "true";
      filterBtn.setAttribute("aria-expanded", open ? "false" : "true");
    },
    { signal },
  );

  async function reload(): Promise<void> {
    try {
      const res = await healthListActivities({ limit: 500 });
      activities = res.activities;
      loadError = null;
    } catch (err) {
      loadError = activityErrorText(err);
    }
    paint();
  }

  return { reload };
}
