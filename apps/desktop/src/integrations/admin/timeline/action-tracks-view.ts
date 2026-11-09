import { bindBackdropPressDismiss } from "../../../ui/backdrop-dismiss";
import { bindDialog } from "../../../ui/motion";
import { showCommandMenuAt } from "../../../ui/command-menu-popover";
import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { isValidHhMm, normalizeHhMm } from "../../../ui/time-picker";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { observeTimelineTheme, timelinePrimaryHex, timelineTheme } from "./theme";
import { mountSearchableSelectPopover } from "../../../ui/searchable-select-popover";
import {
  productivityAssignActionToSession,
  productivityClearActionTarget,
  productivityCreateAction,
  productivityCreateSession,
  productivityCommitActionArrangement,
  productivityCommitItemWithActions,
  productivityCommitSessionBoundary,
  productivityCommitThingLifecycle,
  productivityDeleteAction,
  productivityDeleteSessionOnly,
  productivityListActions,
  productivityListItems,
  productivityListLists,
  productivityListTags,
  productivityListProjects,
  productivityListSessions,
  productivityGetBusinessTimeZone,
  productivityGetItemTypeCatalog,
  productivityStartAction,
  productivityPauseAction,
  productivityResumeAction,
  productivityEndAction,
  productivityReopenAction,
  productivityUpdateItem,
  productivityUpdateTask,
  productivitySetActionTarget,
  productivityUpdateAction,
  productivityUpdateSession,
  productivitySetTaskStatus,
  productivitySetItemStatus,
  productivityAssignItemToList,
  productivityMoveItemToList,
  productivityRemoveItemFromList,
} from "../../productivity/client";
import type {
  ActionAppearance,
  ActionPatch,
  ActionSnapshot,
  ActionStroke,
  ItemSnapshot,
  ProjectSnapshot,
  SessionSnapshot,
  TaskSnapshot,
  BusinessTimeZoneResponse,
  ItemTypeSnapshot,
  ItemTypeCatalogSnapshot,
  ListSnapshot,
  TagSnapshot,
  RevisionRef,
} from "../../productivity/types";
import { chooseArrangementCreation } from "../tabs/task/arrangement-create";
import { mountArrangementDetail, type DetailSelection } from "../tabs/task/arrangement-detail";
import { dateAt, defaultSessionTitle as businessSessionTitle, instantForWall, minuteAt, offsetAt, targets, type Target } from "../tabs/task/arrangement-model";
import { getConfirmDialog } from "../../shell/dialog";
import {
  beijingToday,
  defaultTrackWindow,
  MAX_SESSION_SPAN_SEC,
} from "../tabs/health/format";
import { mountActionExecButtons } from "../tabs/item-compose";
import type { TimelineClock } from "./sources";
import "./action-tracks.css";

const PAD_LEFT = 70;
const PAD_RIGHT = 4;
const DEFAULT_LANES = 3;
const MIN_CREATE_SEC = 300;

function clampSessionDuration(
  startUtc: number,
  endUtc: number,
  edge: "start" | "end",
): { startUtc: number; endUtc: number } {
  if (endUtc - startUtc <= MAX_SESSION_SPAN_SEC) return { startUtc, endUtc };
  if (edge === "start") return { startUtc: endUtc - MAX_SESSION_SPAN_SEC, endUtc };
  return { startUtc, endUtc: startUtc + MAX_SESSION_SPAN_SEC };
}
const SNAP_SEC = 300;
const DEFAULT_APPEARANCE_OPACITY = 0.35;
const DEFAULT_APPEARANCE_STROKE: ActionStroke = "solid";
const STROKE_OPTIONS: { value: ActionStroke; label: string }[] = [
  { value: "none", label: "无" },
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线" },
  { value: "dotted", label: "点线" },
  { value: "double", label: "双线" },
  { value: "dash-dot", label: "点划" },
  { value: "dash-dot-dot", label: "双点划" },
];
const OUTER_PAD = 0;
const LANE_GAP = 3;
const TICK_BAND = 0;
const YELLOW_INSET = 2;
const BLUE_INSET = 6;
const LANE_DIVIDER = "#e5e7eb";
const DRAG_THRESHOLD_PX = 4;
const SESSION_EDGE_PX = 8;
const SCHEDULE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/></svg>`;

export type ActionTracksViewHandle = {
  activate: () => void | Promise<void>;
  deactivate: () => void;
  dispose: () => void;
};

type PlacedAction = {
  action: ActionSnapshot;
  startUtc: number;
  endUtc: number;
  lane: number;
};

type ActionTracksViewOpts = {
  signal: AbortSignal;
  clock?: TimelineClock;
  readOnly?: boolean;
  detailHost?: HTMLElement;
};

// ADR 0020: drag geometry uses UTC instants; wall-clock inputs use the authoritative Business TZ.
function snapUtc(ts: number): number {
  return Math.round(ts / SNAP_SEC) * SNAP_SEC;
}

function snapMove(startUtc: number, endUtc: number): { startUtc: number; endUtc: number } {
  const span = endUtc - startUtc;
  const start = snapUtc(startUtc);
  return { startUtc: start, endUtc: start + span };
}

function snapEdge(
  startUtc: number,
  endUtc: number,
  edge: "start" | "end" | "both",
): { startUtc: number; endUtc: number } {
  let start = edge === "end" ? startUtc : snapUtc(startUtc);
  let end = edge === "start" ? endUtc : snapUtc(endUtc);
  if (end - start < SNAP_SEC) {
    if (edge === "start") start = end - SNAP_SEC;
    else end = start + SNAP_SEC;
  }
  return { startUtc: start, endUtc: end };
}

function utcToRfc3339(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

function hexToRgba(hex: string, opacity: number): string {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function applyBlockAppearance(el: HTMLElement, appearance: ActionAppearance | null | undefined): void {
  if (!appearance) {
    el.style.removeProperty("--action-fill");
    el.style.removeProperty("--action-stroke");
    delete el.dataset.stroke;
    return;
  }
  el.style.setProperty("--action-fill", hexToRgba(appearance.color, appearance.opacity));
  el.style.setProperty("--action-stroke", appearance.color);
  el.dataset.stroke = appearance.stroke;
}

function appearanceEqual(a: ActionAppearance | null | undefined, b: ActionAppearance | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.color.toLowerCase() === b.color.toLowerCase() && a.opacity === b.opacity && a.stroke === b.stroke;
}

function parseUtcInstant(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function hasCompletePlan(a: ActionSnapshot): boolean {
  return !!(a.plannedStartAt && a.plannedEndAt && !a.deletedAtUtc);
}

function isPlanLocked(a: ActionSnapshot): boolean {
  return a.intervals.length > 0;
}

function invokeErrorText(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : JSON.stringify(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* not json */
  }
  return raw;
}

function isRevisionConflict(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code: string }).code === "REVISION_CONFLICT";
  }
  return String(err).includes("REVISION_CONFLICT");
}

function plotInnerWidth(w: number): number {
  return Math.max(1, w - PAD_LEFT - PAD_RIGHT);
}

function xForTime(t: number, fromUtc: number, toUtc: number, w: number): number {
  return PAD_LEFT + ((t - fromUtc) / (toUtc - fromUtc)) * plotInnerWidth(w);
}

function timeAtPlotX(x: number, fromUtc: number, toUtc: number, w: number): number | null {
  const innerW = plotInnerWidth(w);
  const local = x - PAD_LEFT;
  if (local < 0 || local > innerW) return null;
  return fromUtc + (local / innerW) * (toUtc - fromUtc);
}

function timeAtPlotXClamped(x: number, fromUtc: number, toUtc: number, w: number): number {
  const innerW = plotInnerWidth(w);
  const local = Math.max(0, Math.min(innerW, x - PAD_LEFT));
  return fromUtc + (local / innerW) * (toUtc - fromUtc);
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

function bindDialogEscape(close: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

function exclusiveLane(
  occupied: { startUtc: number; endUtc: number; lane: number }[],
  startUtc: number,
  endUtc: number,
  preferred: number,
): number {
  const pref = Math.max(0, Math.min(DEFAULT_LANES - 1, preferred));
  const blocked = (lane: number) =>
    occupied.some((p) => p.lane === lane && rangesOverlap(startUtc, endUtc, p.startUtc, p.endUtc));
  if (!blocked(pref)) return pref;
  for (let probe = 0; probe < DEFAULT_LANES; probe++) {
    if (!blocked(probe)) return probe;
  }
  return pref;
}

function assignLanes(actions: ActionSnapshot[], pinned: Map<string, number>): PlacedAction[] {
  const ranged = actions
    .filter(hasCompletePlan)
    .map((a) => ({
      action: a,
      startUtc: parseUtcInstant(a.plannedStartAt!),
      endUtc: parseUtcInstant(a.plannedEndAt!),
    }))
    .sort((a, b) => a.startUtc - b.startUtc);

  const result: PlacedAction[] = [];

  for (const item of ranged) {
    const preferred = pinned.get(item.action.id) ?? 0;
    const lane = exclusiveLane(result, item.startUtc, item.endUtc, preferred);
    pinned.set(item.action.id, lane);
    result.push({ ...item, lane });
  }
  return result;
}

function flattenProjectTasks(project: ProjectSnapshot): { task: TaskSnapshot; label: string }[] {
  const live = project.tasks.filter((t) => !t.deletedAtUtc);
  const byParent = new Map<string | null, TaskSnapshot[]>();
  for (const t of live) {
    const pid = t.parentTaskId ?? null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(t);
  }
  const out: { task: TaskSnapshot; label: string }[] = [];
  const walk = (parentId: string | null, indent: number) => {
    for (const t of byParent.get(parentId) ?? []) {
      out.push({ task: t, label: `${"  ".repeat(indent)}${t.title}` });
      walk(t.id, indent + 1);
    }
  };
  walk(null, 0);
  return out;
}

function sessionById(sessions: SessionSnapshot[], id: string | null | undefined): SessionSnapshot | null {
  if (!id) return null;
  return sessions.find((s) => s.id === id && !s.deletedAtUtc) ?? null;
}

function sessionOverlapsWindow(s: SessionSnapshot, fromUtc: number, toUtc: number): boolean {
  const start = parseUtcInstant(s.plannedStartAt);
  const end = parseUtcInstant(s.plannedEndAt);
  return start < toUtc && end > fromUtc;
}

type SessionLayout = { trackLane: number; trackSpan: number };

function readSessionLayout(s: SessionSnapshot): SessionLayout {
  const ext = s as SessionSnapshot & Partial<SessionLayout>;
  const trackSpan = Math.max(1, Math.min(DEFAULT_LANES, ext.trackSpan ?? 1));
  return { trackLane: 0, trackSpan };
}

function clampSessionLayout(_trackLane: number, trackSpan: number): SessionLayout {
  const span = Math.max(1, Math.min(DEFAULT_LANES, trackSpan));
  return { trackLane: 0, trackSpan: span };
}

type SessionGeomOverride = {
  startUtc?: number;
  endUtc?: number;
  trackSpan?: number;
};

type ActionCoverage = "full-cover" | "full-exclude" | "partial";

function classifyActionCoverage(
  action: ActionSnapshot,
  sessionStart: number,
  sessionEnd: number,
  sessionSpan: number,
  lane: number,
): ActionCoverage {
  if (!hasCompletePlan(action)) return "full-exclude";
  const a0 = parseUtcInstant(action.plannedStartAt!);
  const a1 = parseUtcInstant(action.plannedEndAt!);
  const laneInSpan = lane >= 0 && lane < sessionSpan;
  const timeOverlap = a0 < sessionEnd && a1 > sessionStart;
  if (!timeOverlap || !laneInSpan) return "full-exclude";
  if (a0 >= sessionStart && a1 <= sessionEnd) return "full-cover";
  return "partial";
}

function sessionContainsRange(s: SessionSnapshot, startUtc: number, endUtc: number): boolean {
  const s0 = parseUtcInstant(s.plannedStartAt);
  const s1 = parseUtcInstant(s.plannedEndAt);
  return startUtc >= s0 && endUtc <= s1;
}

function clampRangeToSession(
  startUtc: number,
  endUtc: number,
  session: SessionSnapshot,
): { startUtc: number; endUtc: number } {
  const s0 = parseUtcInstant(session.plannedStartAt);
  const s1 = parseUtcInstant(session.plannedEndAt);
  const span = endUtc - startUtc;
  let start = Math.max(startUtc, s0);
  let end = Math.min(endUtc, s1);
  if (end - start < MIN_CREATE_SEC) {
    if (start + span <= s1) end = start + span;
    else {
      end = s1;
      start = Math.max(s0, end - span);
    }
  }
  return { startUtc: start, endUtc: end };
}

export function mountActionTracksView(
  root: HTMLElement,
  opts: ActionTracksViewOpts,
): ActionTracksViewHandle {
  const signal = opts.signal;
  const clock = opts.clock;
  const readOnly = opts.readOnly ?? false;
  const initialClock = clock?.get();
  let selectedDate = initialClock?.selectedDate ?? beijingToday();

  let fromUtc = initialClock?.fromUtc ?? 0;
  let toUtc = initialClock?.toUtc ?? 0;
  let actions: ActionSnapshot[] = [];
  let sessions: SessionSnapshot[] = [];
  let projects: ProjectSnapshot[] = [];
  let items: ItemSnapshot[] = [];
  let itemTypes: ItemTypeSnapshot[] = [];
  let itemTypeCatalog: ItemTypeCatalogSnapshot | null = null;
  let lists: ListSnapshot[] = [];
  let tags: TagSnapshot[] = [];
  let zone: BusinessTimeZoneResponse | null = null;
  let targetIndex = new Map<string, Target>();
  let selection: DetailSelection = null;
  let detail: ReturnType<typeof mountArrangementDetail> | null = null;
  let loading = false;
  let applyingClock = false;
  const laneById = new Map<string, number>();

  function publishClock(): void {
    if (applyingClock || !clock) return;
    clock.set({ fromUtc, toUtc, selectedDate });
  }

  function applyClock(next: { fromUtc: number; toUtc: number; selectedDate: string }): void {
    if (fromUtc === next.fromUtc && toUtc === next.toUtc && selectedDate === next.selectedDate) {
      return;
    }
    const dateChanged = selectedDate !== next.selectedDate;
    applyingClock = true;
    fromUtc = next.fromUtc;
    toUtc = next.toUtc;
    selectedDate = next.selectedDate;
    if (dateChanged) void reload();
    else paint();
    applyingClock = false;
  }

  root.className = "health-track-card action-track-card";
  if (readOnly) root.classList.add("is-read-only");
  root.dataset.track = "4";
  root.innerHTML = `
    <div class="health-track-card-legend health-track-legend-col">
      <div class="orbita-swatch-toggle-grid">
        <div class="orbita-swatch-toggle-cell is-on">
          <span class="orbita-swatch-toggle-icon action-track-legend-icon">${SCHEDULE_ICON}</span>
          <span class="orbita-swatch-toggle-label">安排</span>
        </div>
      </div>
    </div>
    <div class="health-track-card-plot">
      <canvas class="health-track-canvas" data-track="4"></canvas>
      <div class="action-track-lanes" data-region="lanes">
        <canvas class="action-track-bg-canvas" data-region="bg-canvas"></canvas>
        <div class="action-track-sessions" data-region="sessions"></div>
        <div class="action-track-blocks" data-region="blocks"></div>
        <div class="action-track-create-preview" data-region="create-preview" hidden></div>
        <div class="action-track-time-chip" data-edge="start" hidden></div>
        <div class="action-track-time-chip" data-edge="end" hidden></div>
        <p class="action-track-error" data-region="error" hidden></p>
      </div>
    </div>`;

  const plotCanvas = root.querySelector<HTMLCanvasElement>(".health-track-canvas")!;
  const bgCanvas = root.querySelector<HTMLCanvasElement>('[data-region="bg-canvas"]')!;
  const sessionsEl = root.querySelector<HTMLElement>('[data-region="sessions"]')!;
  const blocksEl = root.querySelector<HTMLElement>('[data-region="blocks"]')!;
  const lanesEl = root.querySelector<HTMLElement>('[data-region="lanes"]')!;
  const createPreview = root.querySelector<HTMLElement>('[data-region="create-preview"]')!;
  const chipStart = root.querySelector<HTMLElement>('[data-edge="start"]')!;
  const chipEnd = root.querySelector<HTMLElement>('[data-edge="end"]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-region="error"]')!;
  if (opts.detailHost && !readOnly) {
    opts.detailHost.innerHTML = '<p class="arrangement-detail-empty">正在加载安排数据…</p>';
    opts.detailHost.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-timeline-retry]")) void reload();
    }, { signal });
  }

  type LaneGeom = { top: number; bottom: number; height: number };

  function plotH(): number {
    const h = plotCanvas.clientHeight || plotCanvas.getBoundingClientRect().height;
    return Math.max(1, Math.floor(h > 0 ? h : lanesEl.clientHeight));
  }

  function lanesGeom(): LaneGeom[] {
    const laneAreaH = plotH() - TICK_BAND;
    const gapTotal = (DEFAULT_LANES - 1) * LANE_GAP;
    const innerH = laneAreaH - 2 * OUTER_PAD - gapTotal;
    const laneH = Math.floor(innerH / DEFAULT_LANES);
    const rem = innerH - laneH * DEFAULT_LANES;
    const padTop = OUTER_PAD + Math.floor(rem / 2);
    const lanes: LaneGeom[] = [];
    let y = padTop;
    for (let i = 0; i < DEFAULT_LANES; i++) {
      lanes.push({ top: y, bottom: y + laneH, height: laneH });
      y += laneH;
      if (i < DEFAULT_LANES - 1) y += LANE_GAP;
    }
    return lanes;
  }

  function boxRect(fromLane: number, span: number, inset: number): { top: number; height: number } {
    const lanes = lanesGeom();
    const top = lanes[fromLane].top + inset;
    const bottom = lanes[fromLane + span - 1].bottom - inset;
    return { top, height: Math.max(1, bottom - top) };
  }

  function sessionBoxRect(span: number): { top: number; height: number } {
    return boxRect(0, span, YELLOW_INSET);
  }

  function actionBoxRect(lane: number): { top: number; height: number } {
    return boxRect(lane, 1, BLUE_INSET);
  }

  function setError(msg: string): void {
    if (msg) {
      errorEl.hidden = false;
      errorEl.textContent = msg;
    } else {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
  }

  function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const pxW = Math.floor(w * dpr);
    const pxH = Math.floor(h * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function liveSessions(): SessionSnapshot[] {
    return sessions.filter((s) => !s.deletedAtUtc && sessionOverlapsWindow(s, fromUtc, toUtc));
  }

  function sessionScreenRect(
    s: SessionSnapshot,
    plotW: number,
    geomOverride?: Map<string, SessionGeomOverride>,
  ): { x0: number; x1: number; top: number; bottom: number; session: SessionSnapshot } {
    const ov = geomOverride?.get(s.id);
    const layout = clampSessionLayout(0, ov?.trackSpan ?? readSessionLayout(s).trackSpan);
    const s0 = ov?.startUtc ?? parseUtcInstant(s.plannedStartAt);
    const s1 = ov?.endUtc ?? parseUtcInstant(s.plannedEndAt);
    const visStart = Math.max(s0, fromUtc);
    const visEnd = Math.min(s1, toUtc);
    const x0 = xForTime(visStart, fromUtc, toUtc, plotW);
    const x1 = xForTime(visEnd, fromUtc, toUtc, plotW);
    const box = sessionBoxRect(layout.trackSpan);
    return { x0, x1: Math.max(x0 + 4, x1), top: box.top, bottom: box.top + box.height, session: s };
  }

  function sessionBodyAt(x: number, y: number, plotW: number): SessionSnapshot | null {
    for (const s of liveSessions()) {
      const r = sessionScreenRect(s, plotW);
      if (x >= r.x0 && x <= r.x1 && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }

  function sessionEdgeAt(
    x: number,
    y: number,
    plotW: number,
  ): { session: SessionSnapshot; edge: "start" | "end" | "span" } | null {
    const hit = 12;
    for (const s of liveSessions()) {
      const r = sessionScreenRect(s, plotW);
      if (x < r.x0 - hit || x > r.x1 + hit || y < r.top - hit || y > r.bottom + hit) continue;
      const onY = y >= r.top && y <= r.bottom;
      const onX = x >= r.x0 && x <= r.x1;
      if (onX && Math.abs(y - r.bottom) <= hit) return { session: s, edge: "span" };
      if (onY && Math.abs(x - r.x0) <= hit) return { session: s, edge: "start" };
      if (onY && Math.abs(x - r.x1) <= hit) return { session: s, edge: "end" };
    }
    return null;
  }

  function paintSessions(plotW: number, geomOverride?: Map<string, SessionGeomOverride>): void {
    sessionsEl.replaceChildren();
    for (const s of liveSessions()) {
      const ov = geomOverride?.get(s.id);
      const layout = clampSessionLayout(0, ov?.trackSpan ?? readSessionLayout(s).trackSpan);
      const s0 = ov?.startUtc ?? parseUtcInstant(s.plannedStartAt);
      const s1 = ov?.endUtc ?? parseUtcInstant(s.plannedEndAt);
      const visStart = Math.max(s0, fromUtc);
      const visEnd = Math.min(s1, toUtc);
      const x0 = xForTime(visStart, fromUtc, toUtc, plotW);
      const x1 = xForTime(visEnd, fromUtc, toUtc, plotW);
      const box = sessionBoxRect(layout.trackSpan);
      const el = document.createElement("div");
      el.className = "action-track-session-box";
      el.dataset.sessionId = s.id;
      el.style.left = `${x0}px`;
      el.style.width = `${Math.max(4, x1 - x0)}px`;
      el.style.top = `${box.top}px`;
      el.style.height = `${box.height}px`;
      el.title = s.title;
      const timeStart = document.createElement("div");
      timeStart.className = "action-track-session-time-resize is-start";
      timeStart.dataset.edge = "start";
      const timeEnd = document.createElement("div");
      timeEnd.className = "action-track-session-time-resize is-end";
      timeEnd.dataset.edge = "end";
      const spanHandle = document.createElement("div");
      spanHandle.className = "action-track-session-span-resize";
      spanHandle.dataset.edge = "span";
      el.append(timeStart, timeEnd, spanHandle);
      sessionsEl.appendChild(el);
    }
  }

  function drawLaneDividers(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    ctx.clearRect(0, 0, w, _h);
    const lanes = lanesGeom();
    ctx.strokeStyle = timelineTheme(root)?.border ?? LANE_DIVIDER;
    ctx.lineWidth = 1;
    for (let i = 0; i < DEFAULT_LANES - 1; i++) {
      const y = lanes[i].bottom + Math.floor(LANE_GAP / 2) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function paintBlocks(placed: PlacedAction[], plotW: number): void {
    blocksEl.replaceChildren();

    for (const p of placed) {
      if (p.endUtc <= fromUtc || p.startUtc >= toUtc) continue;
      const visStart = Math.max(p.startUtc, fromUtc);
      const visEnd = Math.min(p.endUtc, toUtc);
      const x0 = xForTime(visStart, fromUtc, toUtc, plotW);
      const x1 = xForTime(visEnd, fromUtc, toUtc, plotW);
      const box = actionBoxRect(p.lane);
      const el = document.createElement("div");
      el.className = "action-track-block";
      el.dataset.actionId = p.action.id;
      if (isPlanLocked(p.action)) el.classList.add("is-locked");
      el.style.left = `${x0}px`;
      el.style.width = `${Math.max(4, x1 - x0)}px`;
      el.style.top = `${box.top}px`;
      el.style.height = `${box.height}px`;
      el.textContent = p.action.title;
      el.title = p.action.title;
      applyBlockAppearance(el, p.action.appearance);

      if (!isPlanLocked(p.action)) {
        const rs = document.createElement("div");
        rs.className = "action-track-block-resize is-start";
        rs.dataset.edge = "start";
        const re = document.createElement("div");
        re.className = "action-track-block-resize is-end";
        re.dataset.edge = "end";
        el.append(rs, re);
      }

      blocksEl.appendChild(el);
    }
  }

  function paint(geomOverride?: Map<string, SessionGeomOverride>): void {
    const plotW = lanesEl.clientWidth;
    drawLaneDividers(setupCanvas(plotCanvas), plotW, plotCanvas.getBoundingClientRect().height);
    setupCanvas(bgCanvas);
    paintSessions(plotW, geomOverride);
    paintBlocks(assignLanes(actions, laneById), plotW);
  }

  async function reload(): Promise<void> {
    if (loading) return;
    loading = true;
    root.classList.add("is-loading");
    try {
      const [aRes, sRes, pRes, iRes, listRes, typeRes, tagRes, zoneRes] = await Promise.all([
        productivityListActions(),
        productivityListSessions(),
        productivityListProjects(),
        productivityListItems(),
        productivityListLists(),
        productivityGetItemTypeCatalog(),
        productivityListTags(),
        productivityGetBusinessTimeZone(),
      ]);
      actions = aRes.actions.filter((a) => !a.deletedAtUtc);
      sessions = sRes.sessions;
      projects = pRes.projects;
      items = iRes.items.filter((i) => !i.deletedAtUtc);
      itemTypes = typeRes.catalog?.itemTypes ?? [];
      itemTypeCatalog = typeRes.catalog;
      lists = listRes.lists;
      tags = tagRes.tags;
      zone = zoneRes;
      targetIndex = targets(items, projects, itemTypes);
      const archivedLists = new Set(listRes.lists.filter((list) => list.status === "已归档").map((list) => list.id));
      for (const item of items) {
        const target = targetIndex.get(`item:${item.id}`);
        if (target && item.listId && archivedLists.has(item.listId)) { target.archived = true; target.available = false; }
      }
      mountDetailIfReady();
      detail?.render();
      setError("");
    } catch (e) {
      zone = null;
      cancelDrag();
      detail?.dispose();
      detail = null;
      actions = [];
      sessions = [];
      targetIndex.clear();
      if (opts.detailHost) opts.detailHost.innerHTML = '<p class="arrangement-detail-empty">业务时区或安排数据加载失败。<button type="button" data-timeline-retry>重试</button></p>';
      setError(`无法加载安排数据：${invokeErrorText(e)}`);
    } finally {
      loading = false;
      root.classList.remove("is-loading");
      paint();
    }
  }

  const w0 = initialClock ?? defaultTrackWindow(selectedDate);
  fromUtc = w0.fromUtc;
  toUtc = w0.toUtc;

  function actionById(id: string): ActionSnapshot | undefined {
    return actions.find((a) => a.id === id);
  }

  function replaceAction(updated: ActionSnapshot): void {
    const idx = actions.findIndex((a) => a.id === updated.id);
    if (idx >= 0) actions[idx] = updated;
    else actions.push(updated);
  }

  function replaceSession(updated: SessionSnapshot): void {
    const idx = sessions.findIndex((s) => s.id === updated.id);
    if (idx >= 0) sessions[idx] = updated;
    else sessions.push(updated);
  }

  function sessionByDomId(id: string): SessionSnapshot | undefined {
    return sessions.find((s) => s.id === id && !s.deletedAtUtc);
  }

  const ref = (value: { id: string; revision: number }) => ({ id: value.id, expectedRevision: value.revision });
  const requiredAction = (id: string) => {
    const action = actionById(id);
    if (!action) throw new Error("安排已变化，请刷新后重试");
    return action;
  };
  const requiredSession = (id: string) => {
    const session = sessionByDomId(id);
    if (!session) throw new Error("工作时间已变化，请刷新后重试");
    return session;
  };
  const members = (id: string | null) => id
    ? actions.filter((action) => action.sessionId === id && !action.deletedAtUtc).map(ref) : [];
  type ActionMoveBaseline = {
    action: RevisionRef;
    targetOwningRoot: RevisionRef | null;
    currentSession: RevisionRef | null;
    currentSessionMembers: RevisionRef[];
  };
  const captureActionBaseline = (action: ActionSnapshot): ActionMoveBaseline => {
    let owningRoot: { id: string; revision: number } | undefined;
    if (action.targetKind || action.targetId) {
      if (!action.targetKind || !action.targetId) throw new Error("关联事情已变化，请刷新后重试");
      owningRoot = action.targetKind === "item" ? items.find((item) => item.id === action.targetId)
        : action.targetKind === "task" ? projects.find((project) => project.tasks.some((task) => task.id === action.targetId))
          : projects.find((project) => project.id === action.targetId);
      if (!owningRoot) throw new Error("关联事情已变化，请刷新后重试");
    }
    const currentSession = action.sessionId ? ref(requiredSession(action.sessionId)) : null;
    return { action: ref(action), targetOwningRoot: owningRoot ? ref(owningRoot) : null,
      currentSession, currentSessionMembers: members(action.sessionId ?? null) };
  };
  const nextActionName = (kind: "item" | "task", id: string) =>
    `安排 ${actions.filter((action) => action.targetKind === kind && action.targetId === id).length + 1}`;
  const businessTime = (instantSeconds: number): string => {
    if (!zone) throw new Error("业务时区尚未加载");
    const minute = minuteAt(instantSeconds * 1000, zone);
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  };
  const businessLocal = (instantSeconds: number) => {
    if (!zone) throw new Error("业务时区尚未加载");
    return { date: dateAt(instantSeconds * 1000, zone), time: businessTime(instantSeconds) };
  };
  const businessUnix = (date: string, time: string): number => {
    if (!zone) throw new Error("业务时区尚未加载");
    const [hour, minute] = time.split(":").map(Number);
    return instantForWall(date, hour * 60 + minute, zone) / 1000;
  };
  // The shared Timeline axis is still Beijing-based. Until that axis also uses
  // Business TZ, range writes are safe only where the authoritative offset is +08.
  const timelineRangeWritable = (startSeconds: number, endSeconds: number): boolean => {
    if (!zone || endSeconds <= startSeconds) return false;
    const start = startSeconds * 1000;
    const end = endSeconds * 1000;
    if (offsetAt(start, zone) !== 480 || offsetAt(end - 1, zone) !== 480) return false;
    return !zone.replacements.some((replacement) => Date.parse(replacement.startUtc) < end
      && Date.parse(replacement.endUtc) > start
      && offsetAt(Math.max(start, Date.parse(replacement.startUtc)), zone) !== 480);
  };
  function selectObject(next: DetailSelection, focusActionId?: string): void {
    selection = next;
    if (!detail && !opts.detailHost && zone && next?.kind === "action") {
      const action = actionById(next.id);
      if (action) openActionDialog(action);
    } else if (!detail && !opts.detailHost && zone && next?.kind === "session") {
      const session = sessionByDomId(next.id);
      if (session) openSessionDialog(session, "edit");
    }
    detail?.render();
    if (focusActionId) detail?.focusAction(focusActionId);
  }
  async function commitPlan(baseline: ActionMoveBaseline, start: string, end: string, nextSessionId: string | null): Promise<void> {
    if (!timelineRangeWritable(Date.parse(start) / 1000, Date.parse(end) / 1000)) {
      throw new Error("当前时段与时间线时区不一致，暂不能修改计划");
    }
    const nextSession = nextSessionId ? ref(requiredSession(nextSessionId)) : null;
    const nextSessionMembers = nextSessionId === baseline.currentSession?.id
      ? baseline.currentSessionMembers : members(nextSessionId);
    if (nextSession && baseline.currentSession?.id === nextSession.id) {
      const refs = (values: RevisionRef[]) => values.map((value) => `${value.id}:${value.expectedRevision}`).sort().join("|");
      if (nextSession.expectedRevision !== baseline.currentSession.expectedRevision
        || refs(members(nextSessionId)) !== refs(baseline.currentSessionMembers))
        throw new Error("工作时间已变化，请刷新后重试");
    }
    await productivityCommitActionArrangement({
      action: baseline.action,
      targetOwningRoot: baseline.targetOwningRoot,
      currentSession: baseline.currentSession,
      nextSession,
      currentSessionMembers: baseline.currentSessionMembers,
      nextSessionMembers,
      plannedStartAt: start,
      plannedEndAt: end,
    });
    await reload();
  }
  async function createFromRange(startUtc: number, endUtc: number, lane: number, sessionId: string | null, sessionOnly = false, trackSpan = 1): Promise<void> {
    if (!zone) { setError("业务时区尚未加载，请重试"); paint(); return; }
    if (!timelineRangeWritable(startUtc, endUtc)) {
      setError("当前时段与时间线时区不一致，暂不能创建安排"); paint(); return;
    }
    const choice = sessionOnly ? { kind: "session" as const } : await chooseArrangementCreation(targetIndex.values(), !sessionId);
    if (!choice) { paint(); return; }
    const plannedStartAt = utcToRfc3339(startUtc);
    const plannedEndAt = utcToRfc3339(endUtc);
    try {
      if (choice.kind === "session") {
        if (!zone) throw new Error("业务时区尚未加载");
        const result = await productivityCreateSession({ title: businessSessionTitle(startUtc * 1000, endUtc * 1000, zone),
          plannedStartAt, plannedEndAt, trackLane: 0, trackSpan });
        await reload();
        selectObject({ kind: "session", id: result.session.id });
        return;
      }
      if (choice.kind === "new-item") {
        const result = await productivityCommitItemWithActions({
          itemCreate: { title: "新任务", status: "进行中", listId: null }, expectedAssociatedActions: [],
          actionCreates: [{ title: "安排 1", nameLinkMode: "initial-linked", plannedStartAt, plannedEndAt, sessionId }],
          actionUpdates: [], actionDeletes: [],
        });
        if (result.actions[0]) laneById.set(result.actions[0].id, lane);
        await reload();
        selectObject({ kind: "item", id: result.item.id }, result.actions[0]?.id);
        return;
      }
      const result = await productivityCreateAction({ title: nextActionName(choice.kind, choice.id!), nameLinkMode: "initial-linked",
        targetKind: choice.kind, targetId: choice.id, plannedStartAt, plannedEndAt, sessionId });
      laneById.set(result.action.id, lane);
      await reload();
      selectObject({ kind: "action", id: result.action.id }, result.action.id);
    } catch (error) {
      if (isRevisionConflict(error)) void reload();
      setError(invokeErrorText(error));
      paint();
    }
  }

  function mountDetailIfReady(): void {
    if (!opts.detailHost || readOnly || !zone || detail) return;
    detail = mountArrangementDetail({
      host: opts.detailHost,
      getData: () => {
        if (!zone) throw new Error("业务时区尚未加载");
        return { actions, sessions, items, projects, lists, itemTypes, tags, targets: targetIndex, zone };
      },
      getSelection: () => selection,
      week: () => false,
      onSelect: selectObject,
      onSaveAction: async (id, field, value) => {
        const action = requiredAction(id);
        if (field === "plan") {
          if (value === null) {
            if (action.sessionId) throw new Error("请先将安排移出工作时间后清除计划");
            await productivityUpdateAction({ action: ref(action), patch: { plannedStartAt: null, plannedEndAt: null } });
          } else {
            if (!zone) throw new Error("业务时区尚未加载");
            const plan = value as { start: string; end: string };
            const parse = (text: string) => instantForWall(text.slice(0, 10), Number(text.slice(11, 13)) * 60 + Number(text.slice(14, 16)), zone!);
            const start = parse(plan.start);
            const end = parse(plan.end);
            if (end <= start) throw new Error("结束时间须晚于开始时间");
            await commitPlan(captureActionBaseline(action), new Date(start).toISOString(), new Date(end).toISOString(), action.sessionId ?? null);
            return;
          }
        } else if (field === "link") {
          await productivityUpdateAction({ action: ref(action), patch: { nameLinkMode: action.nameLinkMode === "unlinked" ? "manually-linked" : "unlinked" } });
        } else {
          await productivityUpdateAction({ action: ref(action), patch: field === "title"
            ? { title: value as string, ...(action.nameLinkMode === "initial-linked" ? { nameLinkMode: "unlinked" as const } : {}) }
            : { summary: value as string } });
        }
        await reload();
      },
      onSaveSession: async (id, field, value) => {
        const session = requiredSession(id);
        if (field === "plan") {
          if (!zone) throw new Error("业务时区尚未加载");
          const plan = value as { start: string; end: string };
          const parse = (text: string) => instantForWall(text.slice(0, 10), Number(text.slice(11, 13)) * 60 + Number(text.slice(14, 16)), zone!);
          await productivityCommitSessionBoundary({ session: ref(session), expectedMembers: members(id),
            plannedStartAt: new Date(parse(plan.start)).toISOString(), plannedEndAt: new Date(parse(plan.end)).toISOString() });
        } else await productivityUpdateSession({ session: ref(session), patch: { [field]: value as string } });
        await reload();
      },
      onSaveItem: async (id, field, value) => {
        const item = items.find((entry) => entry.id === id);
        if (item) await productivityUpdateItem({ item: ref(item), patch: { [field]: value } });
        else {
          const project = projects.find((entry) => entry.tasks.some((task) => task.id === id));
          if (!project) throw new Error("事情已变化");
          await productivityUpdateTask({ project: ref(project), taskId: id, patch: { [field]: value } });
        }
        await reload();
      },
      onSaveThingChoice: async (kind, id, field, value) => {
        if (kind === "task") {
          if (field !== "status") throw new Error("项目任务不支持该字段");
          const project = projects.find((entry) => entry.tasks.some((task) => task.id === id));
          if (!project) throw new Error("事情已变化");
          await productivitySetTaskStatus({ project: ref(project), taskId: id, status: value as string });
        } else {
          const item = items.find((entry) => entry.id === id);
          if (!item) throw new Error("事情已变化");
          if (field === "status") await productivitySetItemStatus({ item: ref(item), status: value as string });
          else if (field === "listId") {
            const listId = value as string | null;
            if (!listId) await productivityRemoveItemFromList({ item: ref(item) });
            else {
              const list = lists.find((entry) => entry.id === listId);
              if (!list) throw new Error("清单已变化");
              if (item.listId) await productivityMoveItemToList({ item: ref(item), list: ref(list) });
              else await productivityAssignItemToList({ item: ref(item), list: ref(list) });
            }
          } else if (field === "itemTypeId") {
            const typeId = value as string | null;
            if (typeId && !itemTypeCatalog) throw new Error("分类目录不可用");
            await productivityUpdateItem({ item: ref(item), patch: { itemTypeId: typeId,
              classificationExpected: typeId && itemTypeCatalog ? { itemTypeCatalog: ref(itemTypeCatalog) } : undefined } });
          } else {
            const tagIds = value as string[];
            const selected = tagIds.map((tagId) => tags.find((tag) => tag.id === tagId));
            if (selected.some((tag) => !tag)) throw new Error("标签已变化");
            await productivityUpdateItem({ item: ref(item), patch: { tagIds,
              classificationExpected: { tags: selected.map((tag) => ref(tag!)) } } });
          }
        }
        await reload();
      },
      onExecute: async (id, command) => {
        const action = requiredAction(id);
        const request = { action: ref(action) };
        if (command === "start") await productivityStartAction(request);
        if (command === "pause") await productivityPauseAction(request);
        if (command === "resume") await productivityResumeAction(request);
        if (command === "end") await productivityEndAction(request);
        if (command === "reopen") await productivityReopenAction(request);
        await reload();
      },
      onDelete: async (kind, id) => {
        // Action confirmation is owned by the shared arrangement rail; do not ask twice.
        if (kind === "session") {
          const confirmed = await getConfirmDialog()("删除工作时间", "此操作会软删除所选对象。", undefined, {});
          if (!confirmed) return;
        }
        if (kind === "action") await productivityDeleteAction({ action: ref(requiredAction(id)) });
        else await productivityDeleteSessionOnly({ session: ref(requiredSession(id)), expectedMembers: members(id) });
        selectObject(null);
        await reload();
      },
      onCreateAction: async (kind, id) => {
        const result = await productivityCreateAction({ title: nextActionName(kind, id), nameLinkMode: "initial-linked", targetKind: kind, targetId: id });
        await reload();
        selectObject({ kind: "action", id: result.action.id }, result.action.id);
      },
      onLifecycle: async (kind, id, outcome) => {
        const root = kind === "item" ? items.find((item) => item.id === id)
          : projects.find((project) => project.tasks.some((task) => task.id === id));
        if (!root) throw new Error("事情已变化");
        const related = actions.filter((action) => action.targetKind === kind && action.targetId === id && !action.deletedAtUtc && !action.ended);
        const active = related.some((action) => action.intervals.some((interval) => !interval.endedAt && !interval.deletedAtUtc));
        const confirmActiveIntervals = active
          ? await getConfirmDialog()(outcome === "complete" ? "完成事情" : "取消事情", "正在计时的安排将一起结束。", undefined, {}) : false;
        if (active && !confirmActiveIntervals) return;
        await productivityCommitThingLifecycle({ thingKind: kind, owningRoot: ref(root), taskId: kind === "task" ? id : undefined,
          outcome, expectedMembers: related.map(ref), confirmActiveIntervals });
        await reload();
      },
      onError: setError,
    });
  }

  async function deleteSession(session: SessionSnapshot): Promise<void> {
    const members = actions.filter((a) => a.sessionId === session.id && !a.deletedAtUtc);
    try {
      await productivityDeleteSessionOnly({
        session: { id: session.id, expectedRevision: session.revision },
        expectedMembers: members.map((a) => ({ id: a.id, expectedRevision: a.revision })),
      });
      sessions = sessions.filter((s) => s.id !== session.id);
      actions = actions.map((a) =>
        a.sessionId === session.id ? { ...a, sessionId: null } : a,
      );
      setError("");
      paint();
    } catch (err) {
      if (isRevisionConflict(err)) void reload();
      else setError(`删除场景失败：${invokeErrorText(err)}`);
    }
  }

  function sessionForActionDrop(
    startUtc: number,
    endUtc: number,
    hitLane: number,
  ): SessionSnapshot | null {
    for (const s of liveSessions()) {
      const span = readSessionLayout(s).trackSpan;
      if (hitLane < 0 || hitLane >= span) continue;
      const s0 = parseUtcInstant(s.plannedStartAt);
      const s1 = parseUtcInstant(s.plannedEndAt);
      if (rangesOverlap(startUtc, endUtc, s0, s1)) return s;
    }
    return null;
  }

  function pointerInSession(session: SessionSnapshot, timeUtc: number, lane: number): boolean {
    const s0 = parseUtcInstant(session.plannedStartAt);
    const s1 = parseUtcInstant(session.plannedEndAt);
    const span = readSessionLayout(session).trackSpan;
    return timeUtc >= s0 && timeUtc <= s1 && lane >= 0 && lane < span;
  }

  function translatePreservingDuration(
    startUtc: number,
    endUtc: number,
    session: SessionSnapshot,
  ): { startUtc: number; endUtc: number } {
    const s0 = parseUtcInstant(session.plannedStartAt);
    const s1 = parseUtcInstant(session.plannedEndAt);
    const dur = endUtc - startUtc;
    const cap = s1 - s0;
    if (dur > cap) return { startUtc, endUtc };
    let s = startUtc;
    let e = endUtc;
    if (s < s0) {
      s = s0;
      e = s0 + dur;
    }
    if (e > s1) {
      e = s1;
      s = s1 - dur;
    }
    return { startUtc: s, endUtc: e };
  }

  function parkOutsideSession(
    startUtc: number,
    endUtc: number,
    session: SessionSnapshot,
    pointerTime: number,
  ): { startUtc: number; endUtc: number } {
    const s0 = parseUtcInstant(session.plannedStartAt);
    const s1 = parseUtcInstant(session.plannedEndAt);
    const dur = endUtc - startUtc;
    if (pointerTime <= s0) return { startUtc: s0 - dur, endUtc: s0 };
    if (pointerTime >= s1) return { startUtc: s1, endUtc: s1 + dur };
    const mid = (startUtc + endUtc) / 2;
    if (mid < (s0 + s1) / 2) return { startUtc: s0 - dur, endUtc: s0 };
    return { startUtc: s1, endUtc: s1 + dur };
  }

  function constrainActionMove(
    _action: ActionSnapshot,
    startUtc: number,
    endUtc: number,
    lane: number,
    pointerTime: number,
  ): { startUtc: number; endUtc: number; lane: number } {
    for (const session of liveSessions()) {
      const span = readSessionLayout(session).trackSpan;
      if (lane < 0 || lane >= span) continue;
      const s0 = parseUtcInstant(session.plannedStartAt);
      const s1 = parseUtcInstant(session.plannedEndAt);
      const tooLong = endUtc - startUtc > s1 - s0;
      if (pointerInSession(session, pointerTime, lane) && !tooLong) {
        const t = translatePreservingDuration(startUtc, endUtc, session);
        return {
          startUtc: t.startUtc,
          endUtc: t.endUtc,
          lane: Math.max(0, Math.min(span - 1, lane)),
        };
      }
      if (rangesOverlap(startUtc, endUtc, s0, s1)) {
        const t = parkOutsideSession(startUtc, endUtc, session, pointerTime);
        return { startUtc: t.startUtc, endUtc: t.endUtc, lane };
      }
    }
    return { startUtc, endUtc, lane };
  }

  function clampTimesToSession(
    startUtc: number,
    endUtc: number,
    session: SessionSnapshot,
  ): { startUtc: number; endUtc: number } {
    const clamped = clampRangeToSession(startUtc, endUtc, session);
    const s0 = parseUtcInstant(session.plannedStartAt);
    const s1 = parseUtcInstant(session.plannedEndAt);
    let s = Math.max(s0, Math.min(clamped.startUtc, s1 - MIN_CREATE_SEC));
    let e = Math.min(s1, Math.max(clamped.endUtc, s0 + MIN_CREATE_SEC));
    if (e - s < MIN_CREATE_SEC) {
      s = s0;
      e = Math.min(s1, s0 + MIN_CREATE_SEC);
    }
    return { startUtc: s, endUtc: e };
  }

  async function commitActionPlanDrop(
    action: ActionSnapshot,
    baseline: ActionMoveBaseline,
    startUtc: number,
    endUtc: number,
    hitLane: number,
    pointerTime: number,
  ): Promise<void> {
    if (isPlanLocked(action)) {
      paint();
      return;
    }
    const current = action;
    const snapped = snapMove(startUtc, endUtc);
    let s = snapped.startUtc;
    let e = snapped.endUtc;
    if (e - s < MIN_CREATE_SEC) {
      paint();
      return;
    }

    const moved = constrainActionMove(current, s, e, hitLane, pointerTime);
    s = moved.startUtc;
    e = moved.endUtc;
    hitLane = moved.lane;

    const target = sessionForActionDrop(s, e, hitLane);
    if (target) {
      const cap =
        parseUtcInstant(target.plannedEndAt) - parseUtcInstant(target.plannedStartAt);
      if (e - s > cap) {
        setError("任务时长超过场景，无法放入");
        paint();
        return;
      }
    }
    if (target && !current.sessionId) {
      const parked = translatePreservingDuration(s, e, target);
      s = parked.startUtc;
      e = parked.endUtc;
      hitLane = Math.max(0, Math.min(readSessionLayout(target).trackSpan - 1, hitLane));
    }

    try {
      // SPEC-0003 U57–U58: time and explicit Session ownership commit together.
      await commitPlan(baseline, utcToRfc3339(s), utcToRfc3339(e), target?.id ?? null);
    } catch (err) {
      if (isRevisionConflict(err)) void reload();
      else setError(invokeErrorText(err));
      paint();
      return;
    }

    laneById.set(current.id, hitLane);
    setError("");
    paint();
  }

  async function assignFullyCoveredUnstarted(session: SessionSnapshot): Promise<void> {
    const s0 = parseUtcInstant(session.plannedStartAt);
    const s1 = parseUtcInstant(session.plannedEndAt);
    const span = readSessionLayout(session).trackSpan;
    for (const a of actions) {
      if (!hasCompletePlan(a) || a.deletedAtUtc || a.sessionId) continue;
      if (isPlanLocked(a)) continue;
      const lane = currentLane(a.id);
      if (classifyActionCoverage(a, s0, s1, span, lane) !== "full-cover") continue;
      try {
        const res = await productivityAssignActionToSession({
          action: { id: a.id, expectedRevision: a.revision },
          session: { id: session.id, expectedRevision: session.revision },
        });
        replaceAction(res.action);
        laneById.set(res.action.id, Math.max(0, Math.min(span - 1, lane)));
      } catch (err) {
        if (isRevisionConflict(err)) void reload();
        else setError(invokeErrorText(err));
        return;
      }
    }
  }

  function validateSessionGeometryChange(
    session: SessionSnapshot,
    newStart: number,
    newEnd: number,
    newSpan: number,
  ): string | null {
    if (newEnd - newStart > MAX_SESSION_SPAN_SEC) return "场景最长 18 小时";
    for (const a of actions) {
      if (!hasCompletePlan(a) || a.deletedAtUtc) continue;
      const lane = currentLane(a.id);
      const cov = classifyActionCoverage(a, newStart, newEnd, newSpan, lane);
      if (cov === "partial") return "场景不能只覆盖任务的一部分";
      if (cov === "full-cover" && !a.sessionId && isPlanLocked(a)) {
        return "已开始任务不能自动归属场景";
      }
    }
    return null;
  }

  async function commitSessionGeometryChange(
    session: SessionSnapshot,
    newStart: number,
    newEnd: number,
    newSpan: number,
  ): Promise<boolean> {
    const layout = clampSessionLayout(0, newSpan);
    const curStart = parseUtcInstant(session.plannedStartAt);
    const curEnd = parseUtcInstant(session.plannedEndAt);
    const curLayout = readSessionLayout(session);
    const timesChanged = newStart !== curStart || newEnd !== curEnd;
    const spanChanged = layout.trackSpan !== curLayout.trackSpan;
    if (!timesChanged && !spanChanged) return true;

    const errMsg = validateSessionGeometryChange(session, newStart, newEnd, layout.trackSpan);
    if (errMsg) {
      setError(errMsg);
      paint();
      return false;
    }

    // SPEC-0003: lane is only a Timeline layout hint. A span update is safe
    // through the legacy command only while this Session has no live members.
    if (spanChanged) {
      if (timesChanged) {
        setError("请分别调整工作时间的边界和跨轨宽度");
        paint();
        return false;
      }
      if (members(session.id).length > 0) {
        setError("有归属安排时不能调整工作时间跨轨宽度");
        paint();
        return false;
      }
      try {
        await productivityUpdateSession({ session: ref(session), patch: { trackLane: 0, trackSpan: layout.trackSpan } });
        await reload();
        setError("");
        return true;
      } catch (err) {
        if (isRevisionConflict(err)) void reload();
        else setError(`更新工作时间失败：${invokeErrorText(err)}`);
        paint();
        return false;
      }
    }

    if (!timelineRangeWritable(newStart, newEnd)) {
      setError("当前时段与时间线时区不一致，暂不能修改工作时间");
      paint();
      return false;
    }

    try {
      await productivityCommitSessionBoundary({
        session: ref(session),
        expectedMembers: members(session.id),
        plannedStartAt: utcToRfc3339(newStart),
        plannedEndAt: utcToRfc3339(newEnd),
      });
      await reload();
    } catch (err) {
      if (isRevisionConflict(err)) void reload();
      else setError(`更新场景失败：${invokeErrorText(err)}`);
      paint();
      return false;
    }

    setError("");
    paint();
    return true;
  }

  function openSessionDialog(
    session: SessionSnapshot,
    mode: "create" | "edit",
    createExtras?: SessionLayout,
  ): void {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop motion-dialog action-dialog-backdrop";
    const startParts = businessLocal(parseUtcInstant(session.plannedStartAt));
    const endParts = businessLocal(parseUtcInstant(session.plannedEndAt));
    const titleText = mode === "create" ? "新建场景" : "编辑场景";

    backdrop.innerHTML = `
      <form class="dialog-panel motion-dialog-panel action-dialog-panel">
        <div class="dialog-title">${titleText}</div>
        <div class="dialog-field">
          <label>标题</label>
          <input type="text" id="sessionTitle" value="${escapeAttr(session.title)}" required>
        </div>
        <div class="dialog-field">
          <label>开始</label>
          <div class="action-dialog-when">
            <div data-region="start-date"></div>
            <div data-region="start-time"></div>
          </div>
        </div>
        <div class="dialog-field">
          <label>结束</label>
          <div class="action-dialog-when">
            <div data-region="end-date"></div>
            <div data-region="end-time"></div>
          </div>
        </div>
        <p class="action-dialog-error" data-region="form-error" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" data-action="cancel">取消</button>
          <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
        </div>
      </form>`;

    document.body.appendChild(backdrop);
    const titleInput = backdrop.querySelector<HTMLInputElement>("#sessionTitle")!;
    let autoTitle = mode === "create" ? session.title : null;
    let pickersReady = false;
    const syncAutoTitle = () => {
      if (!pickersReady || autoTitle === null) return;
      if (titleInput.value.trim() !== autoTitle) {
        autoTitle = null;
        return;
      }
      const startT = normalizeHhMm(startTime.getValue());
      const endT = normalizeHhMm(endTime.getValue());
      const sd = startDate.getValue();
      const ed = endDate.getValue();
      if (!isValidHhMm(startT) || !isValidHhMm(endT) || !sd || !ed) return;
      const next = businessSessionTitle(businessUnix(sd, startT) * 1000, businessUnix(ed, endT) * 1000, zone!);
      autoTitle = next;
      titleInput.value = next;
    };
    const startDate = mountDecoupledDatePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=start-date]")! },
      value: startParts.date,
      onChange: syncAutoTitle,
    });
    const startTime = mountDecoupledTimePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=start-time]")! },
      value: startParts.time,
      onChange: syncAutoTitle,
    });
    const endDate = mountDecoupledDatePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=end-date]")! },
      value: endParts.date,
      onChange: syncAutoTitle,
    });
    const endTime = mountDecoupledTimePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=end-time]")! },
      value: endParts.time,
      onChange: syncAutoTitle,
    });
    titleInput.addEventListener("input", () => {
      if (autoTitle !== null && titleInput.value.trim() !== autoTitle) autoTitle = null;
    });
    pickersReady = true;
    const formError = backdrop.querySelector<HTMLElement>('[data-region="form-error"]')!;
    const setFormError = (msg: string) => {
      formError.hidden = !msg;
      formError.textContent = msg;
    };
    const dialog = bindDialog(backdrop);
    const closeDialog = () => {
      unbindEsc();
      void dialog.close();
      startDate.dispose();
      startTime.dispose();
      endDate.dispose();
      endTime.dispose();
      backdrop.remove();
    };
    const unbindEsc = bindDialogEscape(closeDialog);
    backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", closeDialog);
    bindBackdropPressDismiss(backdrop, closeDialog);

    backdrop.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = backdrop.querySelector<HTMLInputElement>("#sessionTitle")!.value.trim();
      if (!title) return;
      const startT = normalizeHhMm(startTime.getValue());
      const endT = normalizeHhMm(endTime.getValue());
      if (!isValidHhMm(startT) || !isValidHhMm(endT) || !startDate.getValue() || !endDate.getValue()) {
        setFormError("请填写完整的开始和结束时间");
        return;
      }
      const startTs = businessUnix(startDate.getValue(), startT);
      const endTs = businessUnix(endDate.getValue(), endT);
      if (endTs - startTs < MIN_CREATE_SEC) {
        setFormError("结束须晚于开始至少 5 分钟");
        return;
      }
      if (endTs - startTs > MAX_SESSION_SPAN_SEC) {
        setFormError("场景最长 18 小时");
        return;
      }
      try {
        if (mode === "create") {
          const layout = createExtras ?? { trackLane: 0, trackSpan: 1 };
          if (draftSessionOverlapsLive(startTs, endTs)) {
            setFormError("场景时间不能与已有场景重叠");
            return;
          }
          const geoErr = validateSessionGeometryChange(
            session,
            startTs,
            endTs,
            layout.trackSpan,
          );
          if (geoErr) {
            setFormError(geoErr);
            return;
          }
          const res = await productivityCreateSession({
            title,
            plannedStartAt: utcToRfc3339(startTs),
            plannedEndAt: utcToRfc3339(endTs),
            trackLane: 0,
            trackSpan: layout.trackSpan,
          });
          replaceSession(res.session);
          await assignFullyCoveredUnstarted(res.session);
        } else {
          const cur = sessionByDomId(session.id);
          if (!cur) return;
          const span = readSessionLayout(cur).trackSpan;
          const timesChanged =
            parseUtcInstant(cur.plannedStartAt) !== startTs ||
            parseUtcInstant(cur.plannedEndAt) !== endTs;
          if (timesChanged) {
            const geoErr = validateSessionGeometryChange(cur, startTs, endTs, span);
            if (geoErr) {
              setFormError(geoErr);
              return;
            }
            const ok = await commitSessionGeometryChange(cur, startTs, endTs, span);
            if (!ok) {
              setFormError(errorEl.textContent || "无法更新场景时间");
              return;
            }
          }
          const latest = sessionByDomId(cur.id);
          if (!latest) return;
          if (title !== latest.title) {
            const res = await productivityUpdateSession({
              session: { id: latest.id, expectedRevision: latest.revision },
              patch: { title, trackLane: 0 },
            });
            replaceSession(res.session);
          } else if (!timesChanged) {
            closeDialog();
            return;
          }
        }
        setError("");
        closeDialog();
        paint();
      } catch (err) {
        if (isRevisionConflict(err)) {
          void reload();
          closeDialog();
        } else setFormError(invokeErrorText(err));
      }
    });

    void dialog.open();
  }

  async function deleteAction(action: ActionSnapshot): Promise<void> {
    try {
      await productivityDeleteAction({
        action: { id: action.id, expectedRevision: action.revision },
      });
      actions = actions.filter((a) => a.id !== action.id);
      laneById.delete(action.id);
      setError("");
      paint();
    } catch (err) {
      if (isRevisionConflict(err)) void reload();
      else setError(`删除失败：${invokeErrorText(err)}`);
    }
  }

  function openActionDialog(
    action: ActionSnapshot,
    createOpts?: { mode: "create"; lane: number; sessionId?: string | null },
  ): void {
    const isCreate = createOpts?.mode === "create";
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop motion-dialog action-dialog-backdrop";
    const canSetTarget = !isCreate && action.executionState === "未开始" && !action.ended;
    const canClearTarget = canSetTarget && !!action.targetKind;
    const initialTargetKind: "task" | "item" =
      action.targetKind === "item" ? "item" : "task";
    const initialTargetId = action.targetId ?? "";
    const targetLabel =
      action.targetKind === "task"
        ? projects
            .flatMap((p) => flattenProjectTasks(p).map((t) => ({ ...t, project: p })))
            .find((t) => t.task.id === action.targetId)?.label ?? "选择 Task"
        : action.targetKind === "item"
          ? items.find((i) => i.id === action.targetId)?.title ?? "选择 Item"
          : "未设置";

    const startParts = action.plannedStartAt
      ? businessLocal(parseUtcInstant(action.plannedStartAt))
      : { date: selectedDate, time: "09:00" };
    const endParts = action.plannedEndAt
      ? businessLocal(parseUtcInstant(action.plannedEndAt))
      : { date: selectedDate, time: "10:00" };

    backdrop.innerHTML = `
      <form class="dialog-panel motion-dialog-panel action-dialog-panel">
        <div class="dialog-title">${isCreate ? "新建安排" : "编辑安排"}</div>
        <div class="dialog-field">
          <label>标题</label>
          <input type="text" id="actionTitle" value="${escapeAttr(action.title)}" required>
        </div>
        <div class="dialog-field">
          <label>开始</label>
          <div class="action-dialog-when">
            <div data-region="start-date"></div>
            <div data-region="start-time"></div>
          </div>
        </div>
        <div class="dialog-field">
          <label>结束</label>
          <div class="action-dialog-when">
            <div data-region="end-date"></div>
            <div data-region="end-time"></div>
          </div>
        </div>
        <div class="dialog-field">
          <label>样式</label>
          <div class="action-dialog-style">
            <input type="color" id="actionColor" value="${escapeAttr((action.appearance?.color ?? timelinePrimaryHex(root)).toLowerCase())}">
            <input type="range" id="actionOpacity" min="15" max="100" value="${Math.round((action.appearance?.opacity ?? DEFAULT_APPEARANCE_OPACITY) * 100)}">
            <select id="actionStroke">
              ${STROKE_OPTIONS.map((o) => `<option value="${o.value}"${(action.appearance?.stroke ?? DEFAULT_APPEARANCE_STROKE) === o.value ? " selected" : ""}>${o.label}</option>`).join("")}
            </select>
            <button type="button" class="dialog-btn" data-action="reset-style">默认</button>
          </div>
        </div>
        <div class="dialog-field">
          <label>目标</label>
          <div class="action-dialog-target-row">
            <button type="button" class="action-dialog-target-kind is-active" data-kind="task">Task</button>
            <button type="button" class="action-dialog-target-kind" data-kind="item">Item</button>
            <div class="action-dialog-target-picker">
              <button type="button" class="action-dialog-target-trigger" data-region="target-trigger">${escapeHtml(targetLabel)}</button>
            </div>
          </div>
        </div>
        <p class="action-dialog-error" data-region="form-error" hidden></p>
        <div class="action-track-exec-bar" data-region="exec-bar" hidden></div>
        <div class="dialog-actions">
          ${canClearTarget ? '<button type="button" class="dialog-btn" data-action="clear-target">清除目标</button>' : ""}
          <button type="button" class="dialog-btn" data-action="cancel">取消</button>
          <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
        </div>
      </form>`;

    document.body.appendChild(backdrop);
    const startDate = mountDecoupledDatePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=start-date]")! },
      value: startParts.date,
    });
    const startTime = mountDecoupledTimePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=start-time]")! },
      value: startParts.time,
    });
    const endDate = mountDecoupledDatePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=end-date]")! },
      value: endParts.date,
    });
    const endTime = mountDecoupledTimePicker({
      defaultTrigger: { container: backdrop.querySelector("[data-region=end-time]")! },
      value: endParts.time,
    });
    const colorInput = backdrop.querySelector<HTMLInputElement>("#actionColor")!;
    const opacityInput = backdrop.querySelector<HTMLInputElement>("#actionOpacity")!;
    const strokeInput = backdrop.querySelector<HTMLSelectElement>("#actionStroke")!;
    let styleCustom = !!action.appearance;
    const readStyle = (): ActionAppearance => ({
      color: colorInput.value,
      opacity: Number(opacityInput.value) / 100,
      stroke: strokeInput.value as ActionStroke,
    });
    const fillDefaultStyle = () => {
      colorInput.value = timelinePrimaryHex(backdrop);
      opacityInput.value = String(Math.round(DEFAULT_APPEARANCE_OPACITY * 100));
      strokeInput.value = DEFAULT_APPEARANCE_STROKE;
      styleCustom = false;
    };
    colorInput.addEventListener("input", () => {
      styleCustom = true;
    });
    opacityInput.addEventListener("input", () => {
      styleCustom = true;
    });
    strokeInput.addEventListener("change", () => {
      styleCustom = true;
    });
    backdrop.querySelector<HTMLButtonElement>('[data-action="reset-style"]')?.addEventListener("click", fillDefaultStyle);
    let targetKind: "task" | "item" = initialTargetKind;
    let selectedTargetId = initialTargetId;
    const trigger = backdrop.querySelector<HTMLButtonElement>('[data-region="target-trigger"]')!;
    const kindBtns = [...backdrop.querySelectorAll<HTMLButtonElement>(".action-dialog-target-kind")];
    let popover: ReturnType<typeof mountSearchableSelectPopover> | null = null;

    function syncTargetControls(): void {
      for (const btn of kindBtns) {
        btn.disabled = !canSetTarget;
        btn.classList.toggle("is-active", btn.dataset.kind === targetKind);
      }
      trigger.disabled = !canSetTarget;
    }

    function taskOptions() {
      const opts: { value: string; label: string; sublabel?: string }[] = [];
      for (const p of projects) {
        if (p.deletedAtUtc) continue;
        for (const { task, label } of flattenProjectTasks(p)) {
          opts.push({ value: task.id, label, sublabel: p.title });
        }
      }
      return opts;
    }

    function itemOptions() {
      return items.map((i) => ({ value: i.id, label: i.title }));
    }

    function refreshKindUi(): void {
      syncTargetControls();
      if (!selectedTargetId) {
        trigger.textContent = targetKind === "task" ? "选择 Task" : "选择 Item";
        return;
      }
      if (targetKind === "task") {
        for (const p of projects) {
          const hit = flattenProjectTasks(p).find((t) => t.task.id === selectedTargetId);
          if (hit) {
            trigger.textContent = hit.label;
            return;
          }
        }
      } else {
        const hit = items.find((i) => i.id === selectedTargetId);
        trigger.textContent = hit?.title ?? "选择 Item";
      }
    }

    kindBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!canSetTarget) return;
        targetKind = btn.dataset.kind as "task" | "item";
        selectedTargetId = "";
        refreshKindUi();
      });
    });

    popover = mountSearchableSelectPopover({
      className: "action-dialog-target-menu",
      anchor: trigger,
      options: targetKind === "task" ? taskOptions() : itemOptions(),
      selected: new Set(selectedTargetId ? [selectedTargetId] : []),
      placeholder: "搜索…",
      onChange: (sel) => {
        selectedTargetId = sel.values().next().value ?? "";
        refreshKindUi();
      },
    });

    trigger.addEventListener("click", () => {
      if (!canSetTarget) return;
      popover?.setOptions(targetKind === "task" ? taskOptions() : itemOptions());
      void popover?.open();
    });

    refreshKindUi();

    const formError = backdrop.querySelector<HTMLElement>('[data-region="form-error"]')!;
    function setFormError(msg: string): void {
      formError.hidden = !msg;
      formError.textContent = msg;
    }

    const execBar = backdrop.querySelector<HTMLElement>('[data-region="exec-bar"]')!;
    let execBaseline = actionById(action.id) ?? action;
    function refreshExecBar(): void {
      if (isCreate) {
        execBar.hidden = true;
        return;
      }
      const cur = actionById(action.id) ?? execBaseline;
      execBaseline = cur;
      execBar.hidden = false;
      execBar.replaceChildren();
      mountActionExecButtons(
        execBar,
        { kind: "saved", action: cur, baseline: execBaseline },
        () => {
          const startT = normalizeHhMm(startTime.getValue());
          const endT = normalizeHhMm(endTime.getValue());
          if (!isValidHhMm(startT) || !isValidHhMm(endT) || !startDate.getValue() || !endDate.getValue()) {
            return (
              (cur.plannedStartAt ?? "") !== "" ||
              (cur.plannedEndAt ?? "") !== ""
            );
          }
          const startTs = businessUnix(startDate.getValue(), startT);
          const endTs = businessUnix(endDate.getValue(), endT);
          return (
            (cur.plannedStartAt ?? "") !== utcToRfc3339(startTs) ||
            (cur.plannedEndAt ?? "") !== utcToRfc3339(endTs)
          );
        },
        (updated) => {
          replaceAction(updated);
          execBaseline = updated;
          refreshExecBar();
        },
        setFormError,
      );
    }
    refreshExecBar();

    const dialog = bindDialog(backdrop);
    const closeDialog = () => {
      unbindEsc();
      void dialog.close();
      popover?.dispose();
      startDate.dispose();
      startTime.dispose();
      endDate.dispose();
      endTime.dispose();
      backdrop.remove();
    };
    const unbindEsc = bindDialogEscape(closeDialog);
    backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", closeDialog);
    bindBackdropPressDismiss(backdrop, closeDialog);

    backdrop.querySelector<HTMLButtonElement>('[data-action="clear-target"]')?.addEventListener(
      "click",
      async () => {
        const cur = actionById(action.id);
        if (!cur) return;
        try {
          const res = await productivityClearActionTarget({
            action: { id: cur.id, expectedRevision: cur.revision },
          });
          replaceAction(res.action);
          closeDialog();
          paint();
        } catch (err) {
          if (isRevisionConflict(err)) {
            void reload();
            closeDialog();
          } else setFormError("清除目标失败");
        }
      },
    );

    backdrop.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = backdrop.querySelector<HTMLInputElement>("#actionTitle")!.value.trim();
      if (!title) return;
      const startT = normalizeHhMm(startTime.getValue());
      const endT = normalizeHhMm(endTime.getValue());
      if (!isValidHhMm(startT) || !isValidHhMm(endT) || !startDate.getValue() || !endDate.getValue()) {
        setFormError("请填写完整的开始和结束时间");
        return;
      }
      const startTs = businessUnix(startDate.getValue(), startT);
      const endTs = businessUnix(endDate.getValue(), endT);
      if (endTs - startTs < MIN_CREATE_SEC) {
        setFormError("结束须晚于开始至少 5 分钟");
        return;
      }
      try {
        if (isCreate) {
          const boundSessionId = createOpts?.sessionId;
          if (boundSessionId) {
            const sess = sessionByDomId(boundSessionId);
            if (!sess || !sessionContainsRange(sess, startTs, endTs)) {
              setFormError("时间须落在场景范围内");
              return;
            }
          }
          const appearance = styleCustom ? readStyle() : undefined;
          const res = await productivityCreateAction({
            title,
            plannedStartAt: utcToRfc3339(startTs),
            plannedEndAt: utcToRfc3339(endTs),
            sessionId: createOpts?.sessionId ?? undefined,
            appearance,
          });
          laneById.set(res.action.id, createOpts!.lane);
          replaceAction(res.action);
          setError("");
          closeDialog();
          paint();
          return;
        }
        const cur = actionById(action.id);
        if (!cur) return;
        let latest = cur;
        const patch: ActionPatch = {};
        if (title !== cur.title) patch.title = title;
        if (
          !cur.plannedStartAt ||
          !cur.plannedEndAt ||
          parseUtcInstant(cur.plannedStartAt) !== startTs ||
          parseUtcInstant(cur.plannedEndAt) !== endTs
        ) {
          patch.plannedStartAt = utcToRfc3339(startTs);
          patch.plannedEndAt = utcToRfc3339(endTs);
        }
        const nextAppearance = styleCustom ? readStyle() : null;
        if (!appearanceEqual(cur.appearance, nextAppearance)) patch.appearance = nextAppearance;
        if (Object.keys(patch).length > 0) {
          const res = await productivityUpdateAction({
            action: { id: cur.id, expectedRevision: cur.revision },
            patch,
          });
          latest = res.action;
          replaceAction(latest);
        }
        if (selectedTargetId && canSetTarget) {
          const targetChanged =
            selectedTargetId !== initialTargetId || targetKind !== initialTargetKind;
          if (targetChanged) {
            let owningRoot: { id: string; expectedRevision: number };
            if (targetKind === "task") {
              const project = projects.find((p) =>
                flattenProjectTasks(p).some((t) => t.task.id === selectedTargetId),
              );
              if (!project) throw new Error("project not found");
              owningRoot = { id: project.id, expectedRevision: project.revision };
            } else {
              const item = items.find((i) => i.id === selectedTargetId);
              if (!item) throw new Error("item not found");
              owningRoot = { id: item.id, expectedRevision: item.revision };
            }
            const res = await productivitySetActionTarget({
              action: { id: latest.id, expectedRevision: latest.revision },
              targetKind,
              targetId: selectedTargetId,
              owningRoot,
            });
            replaceAction(res.action);
          }
        }
        setError("");
        closeDialog();
        paint();
      } catch (err) {
        if (isRevisionConflict(err)) {
          void reload();
          closeDialog();
        } else setFormError(invokeErrorText(err));
      }
    });

    void dialog.open();
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeAttr(s: string): string {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function laneAtY(y: number): number {
    const lanes = lanesGeom();
    for (let i = 0; i < DEFAULT_LANES; i++) {
      if (y >= lanes[i].top && y < lanes[i].bottom) return i;
      if (i < DEFAULT_LANES - 1 && y >= lanes[i].bottom && y < lanes[i + 1].top) {
        const gapCenter = (lanes[i].bottom + lanes[i + 1].top) / 2;
        return y < gapCenter ? i : i + 1;
      }
    }
    if (y < lanes[0].top) return 0;
    return DEFAULT_LANES - 1;
  }

  function currentLane(actionId: string): number {
    if (laneById.has(actionId)) return laneById.get(actionId)!;
    return assignLanes(actions, laneById).find((p) => p.action.id === actionId)?.lane ?? 0;
  }

  function livePlaced(actionId: string, patch: Partial<PlacedAction>): PlacedAction[] {
    const placed = assignLanes(actions, laneById);
    return placed.map((p) => {
      if (p.action.id !== actionId) return p;
      const next = { ...p, ...patch };
      next.lane = patch.lane ?? p.lane;
      return next;
    });
  }

  function laneForRange(startUtc: number, endUtc: number, preferred: number, exceptId?: string): number {
    const occupied = assignLanes(actions, laneById).filter((p) => p.action.id !== exceptId);
    return exclusiveLane(occupied, startUtc, endUtc, preferred);
  }

  type DragState =
    | { kind: "create-action"; startUtc: number; endUtc: number; lane: number }
    | { kind: "pending-create-in-session"; sessionId: string; startUtc: number; lane: number }
    | { kind: "create-action-in-session"; sessionId: string; startUtc: number; endUtc: number; lane: number }
    | { kind: "create-session"; startUtc: number; endUtc: number; trackSpan: number }
    | { kind: "session-span"; sessionId: string; trackSpan: number }
    | {
        kind: "session-time";
        sessionId: string;
        edge: "start" | "end";
        startUtc: number;
        endUtc: number;
        trackSpan: number;
      }
    | { kind: "move"; actionId: string; baseline: ActionMoveBaseline; startUtc: number; endUtc: number; lane: number; anchorUtc: number }
    | { kind: "resize"; actionId: string; baseline: ActionMoveBaseline; edge: "start" | "end"; startUtc: number; endUtc: number; lane: number };

  let drag: DragState | null = null;
  let activePointerId: number | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerDidDrag = false;
  let sessionGeomOverride: Map<string, SessionGeomOverride> | null = null;

  function clearEdgeCursor(): void {
    lanesEl.classList.remove("is-edge-ew", "is-edge-ns");
  }

  function updateEdgeCursor(x: number, y: number, plotW: number): void {
    if (readOnly) return;
    const edge = sessionEdgeAt(x, y, plotW);
    lanesEl.classList.toggle("is-edge-ew", edge?.edge === "start" || edge?.edge === "end");
    lanesEl.classList.toggle("is-edge-ns", edge?.edge === "span");
  }

  function isCreateDrag(d: DragState): boolean {
    return (
      d.kind === "create-action" ||
      d.kind === "pending-create-in-session" ||
      d.kind === "create-action-in-session" ||
      d.kind === "create-session"
    );
  }

  function isSessionGeomDrag(d: DragState): boolean {
    return d.kind === "session-span" || d.kind === "session-time";
  }

  function draftSessionOverlapsLive(startUtc: number, endUtc: number): boolean {
    for (const s of liveSessions()) {
      const s0 = parseUtcInstant(s.plannedStartAt);
      const s1 = parseUtcInstant(s.plannedEndAt);
      if (rangesOverlap(startUtc, endUtc, s0, s1)) return true;
    }
    return false;
  }

  function clampCreateInSession(
    startUtc: number,
    endUtc: number,
    session: SessionSnapshot,
  ): { startUtc: number; endUtc: number } | null {
    const s0 = parseUtcInstant(session.plannedStartAt);
    const s1 = parseUtcInstant(session.plannedEndAt);
    let s = snapUtc(Math.min(startUtc, endUtc));
    let e = snapUtc(Math.max(startUtc, endUtc));
    if (e - s < MIN_CREATE_SEC) return null;
    const clamped = clampRangeToSession(s, e, session);
    s = clamped.startUtc;
    e = clamped.endUtc;
    if (e - s < MIN_CREATE_SEC || s < s0 || e > s1) return null;
    return { startUtc: s, endUtc: e };
  }

  function layoutFromBottomDrag(pointerY: number): SessionLayout {
    const lanes = lanesGeom();
    let bottomLane = 0;
    for (let i = 0; i < DEFAULT_LANES; i++) {
      if (pointerY >= lanes[i].top) bottomLane = i;
    }
    const span = Math.max(1, Math.min(3, bottomLane + 1));
    return clampSessionLayout(0, span);
  }

  function showTimeChips(
    startUtc: number,
    endUtc: number,
    lane: number,
    edges: "both" | "start" | "end",
  ): void {
    const plotW = lanesEl.clientWidth;
    const s = Math.min(startUtc, endUtc);
    const e = Math.max(startUtc, endUtc);
    const x0 = xForTime(s, fromUtc, toUtc, plotW);
    const x1 = xForTime(e, fromUtc, toUtc, plotW);
    const top = `${actionBoxRect(lane).top}px`;
    chipStart.hidden = edges === "end";
    chipEnd.hidden = edges === "start";
    if (!chipStart.hidden) {
      chipStart.textContent = businessTime(s);
      chipStart.style.left = `${x0}px`;
      chipStart.style.top = top;
    }
    if (!chipEnd.hidden) {
      chipEnd.textContent = businessTime(e);
      chipEnd.style.left = `${x1}px`;
      chipEnd.style.top = top;
    }
  }

  function hideTimeChips(): void {
    chipStart.hidden = true;
    chipEnd.hidden = true;
  }

  function showRangePreview(
    startUtc: number,
    endUtc: number,
    opts: { lane: number; span?: number; variant: "action" | "session" },
  ): void {
    const plotW = lanesEl.clientWidth;
    const s = Math.min(startUtc, endUtc);
    const e = Math.max(startUtc, endUtc);
    const x0 = xForTime(s, fromUtc, toUtc, plotW);
    const x1 = xForTime(e, fromUtc, toUtc, plotW);
    const span = opts.span ?? 1;
    createPreview.hidden = false;
    createPreview.classList.toggle("is-session", opts.variant === "session");
    createPreview.style.left = `${x0}px`;
    createPreview.style.width = `${Math.max(4, x1 - x0)}px`;
    if (opts.variant === "session") {
      const box = sessionBoxRect(span);
      createPreview.style.top = `${box.top}px`;
      createPreview.style.height = `${box.height}px`;
    } else {
      const box = actionBoxRect(opts.lane);
      createPreview.style.top = `${box.top}px`;
      createPreview.style.height = `${box.height}px`;
    }
    showTimeChips(s, e, opts.lane, "both");
  }

  function hideCreatePreview(): void {
    createPreview.hidden = true;
    createPreview.classList.remove("is-session");
    hideTimeChips();
  }

  function cancelDrag(): void {
    const pid = activePointerId;
    drag = null;
    pointerDidDrag = false;
    sessionGeomOverride = null;
    hideCreatePreview();
    blocksEl.querySelectorAll(".is-dragging, .is-resizing").forEach((el) => {
      el.classList.remove("is-dragging", "is-resizing");
    });
    if (pid != null && lanesEl.hasPointerCapture(pid)) {
      lanesEl.releasePointerCapture(pid);
    }
    activePointerId = null;
    clearEdgeCursor();
    paint();
  }

  function actionFromEvent(e: Event): ActionSnapshot | null {
    const block = (e.target as HTMLElement).closest<HTMLElement>(".action-track-block");
    if (!block?.dataset.actionId) return null;
    return actionById(block.dataset.actionId) ?? null;
  }

  function sessionFromEvent(e: Event): SessionSnapshot | null {
    const box = (e.target as HTMLElement).closest<HTMLElement>(".action-track-session-box");
    if (!box?.dataset.sessionId) return null;
    return sessionByDomId(box.dataset.sessionId) ?? null;
  }

  function showActionMenu(e: PointerEvent | MouseEvent, action: ActionSnapshot): void {
    e.preventDefault();
    e.stopPropagation();
    showCommandMenuAt(
      e.clientX,
      e.clientY,
      [
        { value: "edit", label: "编辑" },
        { value: "delete", label: "删除", danger: true },
      ],
      (kind) => {
        if (kind === "edit") selectObject({ kind: "action", id: action.id }, action.id);
        if (kind === "delete") {
          void (async () => {
            const ok = await getConfirmDialog()("删除安排", "确定删除该安排？", undefined, {
              confirmLabel: "删除",
              danger: true,
            });
            if (ok) void deleteAction(action);
          })();
        }
      },
    );
  }

  function showSessionMenu(e: PointerEvent | MouseEvent, session: SessionSnapshot): void {
    e.preventDefault();
    e.stopPropagation();
    showCommandMenuAt(
      e.clientX,
      e.clientY,
      [
        { value: "edit", label: "编辑" },
        { value: "delete", label: "删除", danger: true },
      ],
      (kind) => {
        if (kind === "edit") selectObject({ kind: "session", id: session.id });
        if (kind === "delete") {
          void (async () => {
            const ok = await getConfirmDialog()("删除工作时间", "确定删除该工作时间？", undefined, {
              confirmLabel: "删除",
              danger: true,
            });
            if (ok) void deleteSession(session);
          })();
        }
      },
    );
  }

  lanesEl.addEventListener(
    "dblclick",
    (e) => {
      if (readOnly || !zone) return;
      const plotW = lanesEl.clientWidth;
      const rect = lanesEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const block = (e.target as HTMLElement).closest<HTMLElement>(".action-track-block");
      if (block?.dataset.actionId) {
        const action = actionById(block.dataset.actionId);
        if (action) selectObject({ kind: "action", id: action.id }, action.id);
        return;
      }
      const session = sessionFromEvent(e) ?? sessionBodyAt(x, y, plotW);
      if (session) selectObject({ kind: "session", id: session.id });
    },
    { signal },
  );

  lanesEl.addEventListener(
    "pointerdown",
    (e) => {
      if (readOnly || !zone) return;
      const plotW = lanesEl.clientWidth;
      const rect = lanesEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (e.button !== 0) return;
      e.preventDefault();

      const ts = timeAtPlotXClamped(x, fromUtc, toUtc, plotW);
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      pointerDidDrag = false;
      activePointerId = e.pointerId;

      const edge = !e.ctrlKey ? sessionEdgeAt(x, y, plotW) : null;
      if (edge) {
        lanesEl.setPointerCapture(e.pointerId);
        const layout = readSessionLayout(edge.session);
        if (edge.edge === "span") {
          drag = { kind: "session-span", sessionId: edge.session.id, trackSpan: layout.trackSpan };
        } else {
          drag = {
            kind: "session-time",
            sessionId: edge.session.id,
            edge: edge.edge,
            startUtc: parseUtcInstant(edge.session.plannedStartAt),
            endUtc: parseUtcInstant(edge.session.plannedEndAt),
            trackSpan: layout.trackSpan,
          };
        }
        return;
      }

      const target = e.target as HTMLElement;
      const block = target.closest<HTMLElement>(".action-track-block");
      if (block) {
        const actionId = block.dataset.actionId!;
        const action = actionById(actionId);
        if (!action || !hasCompletePlan(action)) return;
        if (isPlanLocked(action)) {
          selectObject({ kind: "action", id: actionId }, actionId);
          return;
        }
        let baseline: ActionMoveBaseline;
        try { baseline = captureActionBaseline(action); }
        catch (error) { activePointerId = null; setError(invokeErrorText(error)); return; }
        const resize = target.closest<HTMLElement>(".action-track-block-resize");
        lanesEl.setPointerCapture(e.pointerId);
        if (resize && !isPlanLocked(action)) {
          drag = {
            kind: "resize",
            actionId,
            baseline,
            edge: resize.dataset.edge as "start" | "end",
            startUtc: parseUtcInstant(action.plannedStartAt!),
            endUtc: parseUtcInstant(action.plannedEndAt!),
            lane: currentLane(actionId),
          };
          block.classList.add("is-resizing");
          return;
        }
        if (!isPlanLocked(action)) {
          drag = {
            kind: "move",
            actionId,
            baseline,
            startUtc: parseUtcInstant(action.plannedStartAt!),
            endUtc: parseUtcInstant(action.plannedEndAt!),
            lane: currentLane(actionId),
            anchorUtc: ts,
          };
        }
        return;
      }

      const session = sessionBodyAt(x, y, plotW);
      if (session) {
        lanesEl.setPointerCapture(e.pointerId);
        const layout = readSessionLayout(session);
        const lane = Math.max(0, Math.min(layout.trackSpan - 1, laneAtY(y)));
        drag = {
          kind: "pending-create-in-session",
          sessionId: session.id,
          startUtc: snapUtc(ts),
          lane,
        };
        return;
      }

      lanesEl.setPointerCapture(e.pointerId);
      const lane = laneAtY(y);
      if (e.ctrlKey) {
        drag = {
          kind: "create-session",
          startUtc: snapUtc(ts),
          endUtc: snapUtc(ts),
          trackSpan: 1,
        };
        showRangePreview(drag.startUtc, drag.endUtc, {
          lane: 0,
          span: drag.trackSpan,
          variant: "session",
        });
      } else {
        drag = { kind: "create-action", startUtc: snapUtc(ts), endUtc: snapUtc(ts), lane };
        showRangePreview(drag.startUtc, drag.endUtc, { lane, variant: "action" });
      }
    },
    { signal },
  );

  lanesEl.addEventListener(
    "pointermove",
    (e) => {
      const moved = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);
      if (moved > DRAG_THRESHOLD_PX) pointerDidDrag = true;
      const plotW = lanesEl.clientWidth;
      const rect = lanesEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!drag) {
        updateEdgeCursor(x, y, plotW);
        return;
      }
      clearEdgeCursor();

      if (drag.kind === "pending-create-in-session" && pointerDidDrag) {
        drag = {
          kind: "create-action-in-session",
          sessionId: drag.sessionId,
          startUtc: drag.startUtc,
          endUtc: drag.startUtc,
          lane: drag.lane,
        };
      }

      if (drag.kind === "session-span") {
        const session = sessionByDomId(drag.sessionId);
        if (!session) return;
        const layout = layoutFromBottomDrag(y);
        drag.trackSpan = layout.trackSpan;
        sessionGeomOverride = new Map([
          [
            drag.sessionId,
            {
              startUtc: parseUtcInstant(session.plannedStartAt),
              endUtc: parseUtcInstant(session.plannedEndAt),
              trackSpan: layout.trackSpan,
            },
          ],
        ]);
        paint(sessionGeomOverride);
        return;
      }

      const ts = timeAtPlotXClamped(x, fromUtc, toUtc, plotW);

      if (drag.kind === "create-action") {
        drag.endUtc = ts;
        const rawS = Math.min(drag.startUtc, drag.endUtc);
        const rawE = Math.max(drag.startUtc, drag.endUtc);
        const snapped = snapEdge(rawS, rawE, "both");
        drag.lane = laneForRange(snapped.startUtc, snapped.endUtc, laneAtY(y));
        showRangePreview(snapped.startUtc, snapped.endUtc, { lane: drag.lane, variant: "action" });
        return;
      }

      if (drag.kind === "create-action-in-session") {
        const session = sessionByDomId(drag.sessionId);
        if (!session) return;
        drag.endUtc = ts;
        const rawS = Math.min(drag.startUtc, drag.endUtc);
        const rawE = Math.max(drag.startUtc, drag.endUtc);
        const snapped = snapEdge(rawS, rawE, "both");
        const layout = readSessionLayout(session);
        drag.lane = Math.max(
          layout.trackLane,
          Math.min(layout.trackLane + layout.trackSpan - 1, laneAtY(y)),
        );
        const clamped = clampCreateInSession(snapped.startUtc, snapped.endUtc, session);
        if (clamped) showRangePreview(clamped.startUtc, clamped.endUtc, { lane: drag.lane, variant: "action" });
        return;
      }

      if (drag.kind === "create-session") {
        drag.endUtc = ts;
        const rawS = Math.min(drag.startUtc, drag.endUtc);
        const rawE = Math.max(drag.startUtc, drag.endUtc);
        const snapped = snapEdge(rawS, rawE, "both");
        const edge = drag.endUtc >= drag.startUtc ? "end" : "start";
        const clamped = clampSessionDuration(snapped.startUtc, snapped.endUtc, edge);
        drag.trackSpan = layoutFromBottomDrag(y).trackSpan;
        showRangePreview(clamped.startUtc, clamped.endUtc, {
          lane: 0,
          span: drag.trackSpan,
          variant: "session",
        });
        return;
      }

      if (drag.kind === "session-time") {
        const session = sessionByDomId(drag.sessionId);
        if (!session) return;
        let s = drag.startUtc;
        let end = drag.endUtc;
        if (drag.edge === "start") s = Math.min(ts, end - MIN_CREATE_SEC);
        else end = Math.max(ts, s + MIN_CREATE_SEC);
        const snapped = snapEdge(s, end, drag.edge);
        const clamped = clampSessionDuration(snapped.startUtc, snapped.endUtc, drag.edge);
        sessionGeomOverride = new Map([
          [
            drag.sessionId,
            {
              startUtc: clamped.startUtc,
              endUtc: clamped.endUtc,
              trackSpan: drag.trackSpan,
            },
          ],
        ]);
        paint(sessionGeomOverride);
        const x0 = xForTime(clamped.startUtc, fromUtc, toUtc, plotW);
        const x1 = xForTime(clamped.endUtc, fromUtc, toUtc, plotW);
        const box = sessionBoxRect(drag.trackSpan);
        chipStart.hidden = drag.edge === "end";
        chipEnd.hidden = drag.edge === "start";
        if (!chipStart.hidden) {
          chipStart.textContent = businessTime(clamped.startUtc);
          chipStart.style.left = `${x0}px`;
          chipStart.style.top = `${box.top}px`;
        }
        if (!chipEnd.hidden) {
          chipEnd.textContent = businessTime(clamped.endUtc);
          chipEnd.style.left = `${x1}px`;
          chipEnd.style.top = `${box.top}px`;
        }
        return;
      }

      const action = actionById(drag.actionId);
      if (!action) return;

      if (drag.kind === "move") {
        const delta = ts - drag.anchorUtc;
        let s = drag.startUtc + delta;
        let end = drag.endUtc + delta;
        const snapped = snapMove(s, end);
        s = snapped.startUtc;
        end = snapped.endUtc;
        let lane = laneAtY(y);
        const movedTimes = constrainActionMove(action, s, end, lane, ts);
        s = movedTimes.startUtc;
        end = movedTimes.endUtc;
        lane = movedTimes.lane;
        blocksEl
          .querySelector<HTMLElement>(`[data-action-id="${drag.actionId}"]`)
          ?.classList.add("is-dragging");
        drag.lane = lane;
        paintBlocks(livePlaced(drag.actionId, { startUtc: s, endUtc: end, lane }), plotW);
        showTimeChips(s, end, lane, "both");
        return;
      }

      if (drag.kind === "resize") {
        let s = drag.startUtc;
        let end = drag.endUtc;
        if (drag.edge === "start") s = Math.min(ts, end - MIN_CREATE_SEC);
        else end = Math.max(ts, s + MIN_CREATE_SEC);
        const snapped = snapEdge(s, end, drag.edge);
        s = snapped.startUtc;
        end = snapped.endUtc;
        let lane = laneAtY(y);
        const target = sessionForActionDrop(s, end, lane);
        if (target) {
          const clamped = clampTimesToSession(s, end, target);
          s = clamped.startUtc;
          end = clamped.endUtc;
          lane = Math.max(0, Math.min(readSessionLayout(target).trackSpan - 1, lane));
        }
        drag.lane = lane;
        paintBlocks(livePlaced(drag.actionId, { startUtc: s, endUtc: end, lane }), plotW);
        showTimeChips(s, end, lane, drag.edge);
      }
    },
    { signal },
  );

  lanesEl.addEventListener(
    "pointerup",
    async (e) => {
      const plotW = lanesEl.clientWidth;
      const rect = lanesEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ts = timeAtPlotXClamped(x, fromUtc, toUtc, plotW);
      clearEdgeCursor();
      const cur = drag;
      const didDrag = pointerDidDrag;
      drag = null;
      pointerDidDrag = false;
      activePointerId = null;
      hideCreatePreview();
      blocksEl.querySelectorAll(".is-dragging, .is-resizing").forEach((el) => {
        el.classList.remove("is-dragging", "is-resizing");
      });
      if (e.pointerId != null && lanesEl.hasPointerCapture(e.pointerId)) {
        lanesEl.releasePointerCapture(e.pointerId);
      }

      if (!cur) {
        paint();
        return;
      }

      if (cur.kind === "pending-create-in-session") {
        sessionGeomOverride = null;
        if (!didDrag) {
          const session = sessionByDomId(cur.sessionId);
          if (session) selectObject({ kind: "session", id: session.id });
        }
        paint();
        return;
      }

      if (cur.kind === "create-action") {
        sessionGeomOverride = null;
        if (!didDrag) {
          paint();
          return;
        }
        const s = snapUtc(Math.min(cur.startUtc, cur.endUtc));
        const end = snapUtc(Math.max(cur.startUtc, cur.endUtc));
        if (s === end || end - s < MIN_CREATE_SEC) {
          paint();
          return;
        }
        const lane = laneForRange(s, end, cur.lane);
        const host = sessionForActionDrop(s, end, lane);
        if (host) {
          const clamped = clampTimesToSession(s, end, host);
          void createFromRange(clamped.startUtc, clamped.endUtc,
            Math.max(0, Math.min(readSessionLayout(host).trackSpan - 1, lane)), host.id);
        } else {
          void createFromRange(s, end, lane, null);
        }
        return;
      }

      if (cur.kind === "create-action-in-session") {
        sessionGeomOverride = null;
        if (!didDrag) {
          paint();
          return;
        }
        const session = sessionByDomId(cur.sessionId);
        if (!session) {
          paint();
          return;
        }
        const s = snapUtc(Math.min(cur.startUtc, cur.endUtc));
        const end = snapUtc(Math.max(cur.startUtc, cur.endUtc));
        const clamped = clampCreateInSession(s, end, session);
        if (!clamped) {
          paint();
          return;
        }
        void createFromRange(clamped.startUtc, clamped.endUtc, cur.lane, cur.sessionId);
        return;
      }

      if (cur.kind === "create-session") {
        sessionGeomOverride = null;
        if (!didDrag) {
          paint();
          return;
        }
        const rawS = snapUtc(Math.min(cur.startUtc, cur.endUtc));
        const rawE = snapUtc(Math.max(cur.startUtc, cur.endUtc));
        if (rawS === rawE || rawE - rawS < MIN_CREATE_SEC) {
          paint();
          return;
        }
        const edge = cur.endUtc >= cur.startUtc ? "end" : "start";
        const clamped = clampSessionDuration(rawS, rawE, edge);
        const s = clamped.startUtc;
        const end = clamped.endUtc;
        if (draftSessionOverlapsLive(s, end)) {
          setError("场景时间不能与已有场景重叠");
          paint();
          return;
        }
        const geoErr = validateSessionGeometryChange(
          { id: "" } as SessionSnapshot,
          s,
          end,
          cur.trackSpan,
        );
        if (geoErr) {
          setError(geoErr);
          paint();
          return;
        }
        void createFromRange(s, end, 0, null, true, cur.trackSpan);
        return;
      }

      if (cur.kind === "session-span") {
        const session = sessionByDomId(cur.sessionId);
        const geomOverride = sessionGeomOverride;
        sessionGeomOverride = null;
        hideTimeChips();
        if (!session || !didDrag) {
          if (session && !didDrag) selectObject({ kind: "session", id: session.id });
          paint();
          return;
        }
        const ov = geomOverride?.get(cur.sessionId);
        const newSpan = ov?.trackSpan ?? cur.trackSpan;
        const newStart = ov?.startUtc ?? parseUtcInstant(session.plannedStartAt);
        const newEnd = ov?.endUtc ?? parseUtcInstant(session.plannedEndAt);
        await commitSessionGeometryChange(session, newStart, newEnd, newSpan);
        return;
      }

      if (cur.kind === "session-time") {
        const session = sessionByDomId(cur.sessionId);
        const geomOverride = sessionGeomOverride;
        sessionGeomOverride = null;
        hideTimeChips();
        if (!session || !didDrag) {
          if (session && !didDrag) selectObject({ kind: "session", id: session.id });
          paint();
          return;
        }
        const ov = geomOverride?.get(cur.sessionId);
        const newStart = ov?.startUtc ?? parseUtcInstant(session.plannedStartAt);
        const newEnd = ov?.endUtc ?? parseUtcInstant(session.plannedEndAt);
        const newSpan = ov?.trackSpan ?? cur.trackSpan;
        await commitSessionGeometryChange(session, newStart, newEnd, newSpan);
        return;
      }

      const action = actionById(cur.actionId);
      if (!action || ts === null) {
        sessionGeomOverride = null;
        paint();
        return;
      }

      if ((cur.kind === "move" || cur.kind === "resize") && !didDrag) {
        sessionGeomOverride = null;
        const a = actionById(cur.actionId);
        if (a) selectObject({ kind: "action", id: a.id }, a.id);
        paint();
        return;
      }

      const hitLane = laneAtY(y);

      if (cur.kind === "move") {
        const delta = ts - cur.anchorUtc;
        const s = cur.startUtc + delta;
        const end = cur.endUtc + delta;
        const snapped = snapMove(s, end);
        await commitActionPlanDrop(action, cur.baseline, snapped.startUtc, snapped.endUtc, hitLane, ts);
        return;
      }

      if (cur.kind === "resize") {
        let s = cur.startUtc;
        let end = cur.endUtc;
        if (cur.edge === "start") s = Math.min(ts, end - MIN_CREATE_SEC);
        else end = Math.max(ts, s + MIN_CREATE_SEC);
        const snapped = snapEdge(s, end, cur.edge);
        await commitActionPlanDrop(action, cur.baseline, snapped.startUtc, snapped.endUtc, hitLane, ts);
      }
    },
    { signal },
  );

  lanesEl.addEventListener(
    "contextmenu",
    (e) => {
      if (readOnly || !zone) return;
      const action = actionFromEvent(e);
      if (action) {
        showActionMenu(e, action);
        return;
      }
      const rect = lanesEl.getBoundingClientRect();
      const session =
        sessionFromEvent(e) ??
        sessionBodyAt(e.clientX - rect.left, e.clientY - rect.top, lanesEl.clientWidth);
      if (session) {
        showSessionMenu(e, session);
        return;
      }
      e.preventDefault();
    },
    { signal },
  );

  lanesEl.addEventListener("pointerleave", () => {
    if (!drag) clearEdgeCursor();
  }, { signal });

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !drag) return;
      if (isCreateDrag(drag) || isSessionGeomDrag(drag)) {
        e.preventDefault();
        cancelDrag();
      }
    },
    { signal },
  );

  const unbindClock = clock?.subscribe(() => applyClock(clock.get())) ?? (() => {});

  const unbindTheme = observeTimelineTheme(root, paint);
  const ro = new ResizeObserver(() => paint());
  ro.observe(lanesEl);
  signal.addEventListener("abort", () => {
    ro.disconnect();
    unbindTheme();
  });

  paint();

  return {
    activate() {
      void reload();
    },
    deactivate() {},
    dispose() {
      unbindClock();
      unbindTheme();
      ro.disconnect();
      detail?.dispose();
      root.innerHTML = "";
    },
  };
}
