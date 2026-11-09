import { escHtml } from "../../../../core/html";
import { showCommandMenuAt, type CommandMenuItem } from "../../../../ui/command-menu-popover";
import { ACTIVITY_TYPES } from "../health/activity-glyph";
import type { WeekHealthResponse } from "../../../productivity/types";
import { healthLines, healthInset, renderHealthLines } from "./week-health-render";
import { TRAVEL_HIT } from "./travel/week-model";
import { mountFlatSelectPopover, type FlatSelectPopoverHandle } from "../../../../ui/flat-select-popover";
import { isItemTypeHex, itemTypeColorRoles } from "./item-type-palette";
import { actionTextLayout, renderArrangementWeekBlocks, type ArrangementWeekBlockInput } from "./arrangement-week-render";
import { subscribeCategoryAppearance } from "../../../../ui/color-system";
import { createCheckbox, setCheckbox, setCheckboxWithCompletionFeedback } from "../../../../ui/checkbox";
import { type ListMoveTarget } from "./list-actions";
import type { ActionSnapshot, RevisionRef, SessionSnapshot } from "../../../productivity/types";
import type { CheckpointSnapshot } from "../../../productivity/checkpoint-types";
import {
  actualIntervals, addDays, clampIntoSession, crossesRepeatedWallTime, dateAt, fragments, instantForWall, layoutDay, minuteAt, mondayOf, snapFive, windows,
  type BusinessZone, type Target,
} from "./arrangement-model";
import type { TravelController } from "../../../productivity/travel-v2/controller";
import type { TravelEditPlanPayload, TravelListWeekResult, TravelSplitPolicies, TripSnapshot } from "../../../productivity/travel-v2/types";
import { createTravelWeekLayer, type TravelWeekEditMode } from "./travel/week-interaction";
import { openFlightResultCardStylePreview } from "./travel/flight-result-card";

export type WeekSelection = { kind: "action" | "checkpoint" | "session"; id: string } | null;
export type WeekCreateChoice = "new-item" | "new-checkpoint" | "item" | "task" | "session" | "travel-flight" | "travel-train" | "travel-other" | "health-sleep" | "health-activity" | "health-meal";
export type WeekCreate = { start: string; end: string; sessionId: string | null; sessionOnly: boolean; choice?: WeekCreateChoice; activityType?: string };
export type ActionMoveBaseline = { expectedDataDir?: string; action: RevisionRef; targetOwningRoot: RevisionRef | null; currentSession: RevisionRef | null; currentSessionMembers: RevisionRef[] };
export type SessionMoveBaseline = { expectedDataDir: string; session: RevisionRef; expectedMembers: RevisionRef[]; expectedCheckpoints: RevisionRef[] };
export type WeekMove = { kind: "session"; id: string; start: string; end: string; sessionId: null; baseline?: SessionMoveBaseline }
  | { kind: "action"; id: string; start: string; end: string; sessionId: string | null; baseline: ActionMoveBaseline };
export type CheckpointMoveBaseline = { expectedDataDir: string; checkpoint: RevisionRef; currentSession: RevisionRef | null; expectedCurrentCheckpoints: RevisionRef[]; sessions: Map<string, { session: RevisionRef; members: RevisionRef[] }> };
export type CheckpointMove = { kind: "checkpoint"; id: string; plannedAtUtc: string; sessionId: string | null; baseline: CheckpointMoveBaseline };
export type WeekCopy = { kind: "copy-action" | "copy-item"; id: string; start: string; end: string; sessionId: string | null };
export type WeekData = { actions: ActionSnapshot[]; checkpoints?: CheckpointSnapshot[]; sessions: SessionSnapshot[]; targets: Map<string, Target>; zone: BusinessZone };
export type MenuBranch = { value: string; label: string; sublabel?: string; children?: MenuBranch[] };
export type FlightActionBlock = { departureCode: string; arrivalCode: string };
export type WeekOpts = {
  host: HTMLElement;
  getHealth?: () => WeekHealthResponse | null;
  getHealthSelection?: () => string | null;
  onHealthSelect?: (id: string) => void;
  onHealthMenu?: (id: string, x: number, y: number) => void;
  getData: () => WeekData;
  getFlightActionBlock?: (action: ActionSnapshot) => FlightActionBlock | null;
  getSelection: () => WeekSelection;
  getFocusedCheckpointId?: () => string | null;
  onSelect: (selection: WeekSelection, focusActionId?: string) => void;
  onCreate: (request: WeekCreate) => Promise<void>;
  onMove: (request: WeekMove) => Promise<void>;
  onMoveCheckpoint?: (request: CheckpointMove) => Promise<void>;
  captureCheckpointMove?: (checkpoint: CheckpointSnapshot) => CheckpointMoveBaseline;
  captureSessionMove?: (session: SessionSnapshot) => SessionMoveBaseline;
  getDraggedCheckpointBaseline?: () => CheckpointMoveBaseline | null;
  onCreateCheckpoint?: (plannedAtUtc: string, sessionId: string | null) => Promise<void>;
  onToggleCheckpoint?: (checkpoint: CheckpointSnapshot) => Promise<void>;
  onDeleteCheckpoint?: (checkpoint: CheckpointSnapshot) => void;
  onDeleteCheckpointTarget?: (checkpoint: CheckpointSnapshot) => void;
  getCheckpointMenuData?: (checkpoint: CheckpointSnapshot) => { move?: Array<{value:string;label:string;sublabel?:string}>; lists?: ListMoveTarget[]; categories?: MenuBranch[]; tags?: Array<{value:string;label:string}>; selectedCategory?: string; selectedTags?: ReadonlySet<string> };
  onCheckpointMenuChange?: (checkpoint: CheckpointSnapshot, field: "move" | "category" | "tags", value: string | Set<string>) => void;
  onMoveCheckpointToList?: (checkpoint: CheckpointSnapshot, listId: string | null, expectedDataDir: string) => void;
  onCopy?: (request: WeekCopy) => Promise<void>;
  onError: (message: string) => void;
  getDay: () => string;
  onDay: (day: string) => void;
  /** Captured when the context menu opens; do not re-read at commit time. */
  getExpectedDataDir?: () => string;
  getDraggedActionId?: () => string | null;
  getDraggedActionBaseline?: () => ActionMoveBaseline | null;
  captureActionBaseline: (id: string) => ActionMoveBaseline;
  getActionMenuData?: (action: ActionSnapshot) => {
    move?: Array<{ value: string; label: string; sublabel?: string }>;
    lists?: ListMoveTarget[];
    categories?: MenuBranch[];
    tags?: Array<{ value: string; label: string; sublabel?: string }>;
    selectedCategory?: string;
    selectedTags?: ReadonlySet<string>;
    travel?: boolean;
  };
  onActionMenuChange?: (action: ActionSnapshot, field: "move" | "category" | "tags", value: string | Set<string>) => void;
  onMoveActionToList?: (action: ActionSnapshot, listId: string | null, expectedDataDir: string) => void;
  onDeleteAction?: (action: ActionSnapshot) => void;
  onDeleteLinkedTask?: (action: ActionSnapshot) => void;
  onDeleteSession?: (session: SessionSnapshot, baseline?: SessionMoveBaseline) => void;
  /** Travel v2 week layer (D5 injects data/controller; omitted = legacy week only). */
  getTravelListWeek?: () => TravelListWeekResult | null;
  getTravelSnapshot?: (itemId: string) => TripSnapshot | null | undefined;
  getTravelColor?: (itemId: string) => string;
  getTravelEditMode?: () => TravelWeekEditMode | null;
  getTravelController?: () => TravelController | null;
  onTravelEditPlan?: (itemId:string,payload:TravelEditPlanPayload)=>Promise<void>;
  getTravelSplitPolicies?: () => TravelSplitPolicies;
  getTravelUiSettings?: () => unknown;
  onTravelSelect?: (itemId: string, blockId?: string | null) => void | boolean | Promise<boolean>;
  onTravelEnterEdit?: (itemId: string) => void;
  onTravelExitEdit?: () => void;
};

export type { TravelWeekEditMode } from "./travel/week-interaction";
const HOUR_PX = 56;
const ZOOM_LEVELS = [67, 100, 136, 150, 175, 200] as const;

function mapMenuBranches(nodes: MenuBranch[]): MenuBranch[] {
  return nodes.map((node) => {
    const children = node.children?.length ? mapMenuBranches(node.children) : undefined;
    return { value: node.value || "__no_category", label: node.label, ...(children ? { children } : {}) };
  });
}

const MIN_HOUR_PX = HOUR_PX * ZOOM_LEVELS[0] / 100;
const MAX_HOUR_PX = 112;
const VISIBLE_HOURS = 28;
const MIN_PX = 12;
const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function mountArrangementWeek(opts: WeekOpts) {
  const { host } = opts;
  // getDay is the first visible date after a snapped scroll; only calendar navigation realigns to Monday.
  let first = addDays(opts.getDay(), -7);
  let dragging: null | {
    pointerId: number; kind: "new" | "move" | "move-checkpoint" | "resize-start" | "resize-end" | "unscheduled" | "copy-action" | "copy-item";
    canCopy: boolean;
    id: string | null; originDate: string; originMinute: number; originX: number; start: number; end: number;
    sessionId: string | null; sessionOnly: boolean; candidate: WeekCreate | WeekMove | WeekCopy | CheckpointMove | null; originY: number;
    baseline: ActionMoveBaseline | null;
    checkpointBaseline: CheckpointMoveBaseline | null;
    sessionBaseline: SessionMoveBaseline | null;
  } = null;
  let scrollTimer = 0;
  let edgeTimer = 0;
  let pointerX = 0;
  let pointerY = 0;
  let unscheduledDragging = false;
  let disposed = false;
  let hiddenLayout = false;
  let pendingScrollDay: string | null = null;
  let appearancePending = false;
  let dayPx = 100;
  let hourPx = HOUR_PX;
  let actionMenuControl: FlatSelectPopoverHandle | null = null;
  let actionMenuAnchor: HTMLElement | null = null;
  let livePreview: WeekCreate | WeekMove | WeekCopy | CheckpointMove | null = null;
  let creationMenu: FlatSelectPopoverHandle | null = null;
  let dismissCreation: (() => void) | null = null;
  let committing = false;
  let contextCheckpoint: CheckpointSnapshot | null = null;
  const pendingCheckpointToggles = new Set<string>();
  let createBaseline: Set<string> | null = null;
  let gestureStartHour = HOUR_PX;
  let wheelZoomDelta = 0;
  let lastZoomWheel = 0;
  host.classList.add("arrangement-week");
  host.style.setProperty("--arrangement-hour-height", `${hourPx}px`);
  host.style.setProperty("--arrangement-grid-height", `${VISIBLE_HOURS * hourPx}px`);

  const travelLayer = opts.getTravelListWeek
    ? createTravelWeekLayer(host, {
        getTravelListWeek: opts.getTravelListWeek,
        getTravelSnapshot: opts.getTravelSnapshot,
        getTravelColor: opts.getTravelColor,
        getTravelEditMode: opts.getTravelEditMode,
        getTravelController: opts.getTravelController,
        onTravelEditPlan:opts.onTravelEditPlan,
        getTravelSplitPolicies: opts.getTravelSplitPolicies,
        getTravelUiSettings: opts.getTravelUiSettings,
        onTravelSelect: opts.onTravelSelect,
        onTravelEnterEdit: opts.onTravelEnterEdit,
        onTravelExitEdit: opts.onTravelExitEdit,
        onTravelError: opts.onError,
        zone: () => opts.getData().zone,
      })
    : null;

  function grid(): HTMLElement | null { return host.querySelector<HTMLElement>(".arrangement-grid-scroll"); }
  function zoomIndex() {
    const percent = hourPx / HOUR_PX * 100;
    return ZOOM_LEVELS.reduce<number>((best, value, index) => Math.abs(value - percent) < Math.abs(ZOOM_LEVELS[best] - percent) ? index : best, 0);
  }
  function rulerLabels() {
    return Array.from({ length: VISIBLE_HOURS * 2 }, (_, index) => {
      const hour = index / 2;
      const half = index % 2 !== 0;
      const label = half ? `${hour < 24 ? String(Math.floor(hour)).padStart(2, "0") : Math.floor(hour) - 24}:30`
        : hour >= 24 ? `${String(hour - 24).padStart(2, "0")}:00` : `${String(hour).padStart(2, "0")}:00`;
      return `<span data-hour="${hour}"${half ? ` data-half-hour${hourPx < HOUR_PX * 1.5 ? " hidden" : ""}` : ""} style="top:${hour === 0 ? 8 : hour * hourPx}px">${label}</span>`;
    }).join("");
  }
  function columnAt(clientX: number): { date: string; index: number } | null {
    const body = host.querySelector<HTMLElement>(".arrangement-days");
    if (!body) return null;
    const rect = body.getBoundingClientRect();
    const index = Math.floor((clientX - rect.left) / dayPx);
    if (index < 0 || index >= 21) return null;
    return { date: addDays(first, index), index };
  }
  function minuteAtY(clientY: number): number {
    const body = host.querySelector<HTMLElement>(".arrangement-days");
    if (!body) return 0;
    return Math.min(VISIBLE_HOURS * 60, Math.max(0, Math.round(((clientY - body.getBoundingClientRect().top) / hourPx * 60) / 5) * 5));
  }
  function timeAt(date: string, minute: number): number {
    const normalized = minute >= 1440 ? addDays(date, 1) : date;
    return instantForWall(normalized, minute % 1440, opts.getData().zone);
  }
  function sessionAt(x: number, y: number): SessionSnapshot | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-session-id]");
    if (!element?.dataset.sessionId) return null;
    return opts.getData().sessions.find((session) => session.id === element.dataset.sessionId) ?? null;
  }
  function checkpointWritable(checkpoint: CheckpointSnapshot): boolean {
    const target = checkpoint.targetKind && checkpoint.targetId
      ? opts.getData().targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
    return !!target?.available && !target.archived;
  }
  function render() {
    if (disposed) return;
    const scroll = grid();
    const priorDay = scroll ? scroll.scrollLeft / dayPx : 7;
    const priorTop = scroll?.scrollTop ?? HOUR_PX * 8;
    const { actions, sessions, checkpoints = [], targets, zone } = opts.getData();
    const actionById = new Map<string, typeof actions[number]>();
    const sessionById = new Map<string, typeof sessions[number]>();
    const checkpointById = new Map<string, typeof checkpoints[number]>();
    for (const action of actions) if (!actionById.has(action.id)) actionById.set(action.id, action);
    for (const session of sessions) if (!sessionById.has(session.id)) sessionById.set(session.id, session);
    for (const checkpoint of checkpoints) if (!checkpointById.has(checkpoint.id)) checkpointById.set(checkpoint.id, checkpoint);
    travelLayer?.syncLines(hourPx);
    const travelPad = TRAVEL_HIT / 2 / hourPx * 3_600_000;
    const travelInset = (start: number, end: number) => travelLayer?.travelLaneInset(start - travelPad, end + travelPad) ?? 0;
    const healthData = opts.getHealth?.() ?? null;
    const healthActions = new Set(healthData?.plans.map(plan => plan.action.id) ?? []);
    const healthPreview = livePreview && "kind" in livePreview && livePreview.kind === "action"
      && healthActions.has(livePreview.id) ? livePreview : null;
    // Project only the candidate plan: actual Health sources stay canonical.
    const projectedHealth = healthData && healthPreview ? {
      ...healthData,
      plans: healthData.plans.map(plan => plan.action.id === healthPreview.id ? {
        ...plan, action: { ...plan.action, plannedStartAt: healthPreview.start, plannedEndAt: healthPreview.end },
      } : plan),
    } : healthData;
    const health = healthLines(projectedHealth, hourPx, targets, travelInset);
    const travelActionIds = new Set<string>();
    const travelCheckpointIds = new Set<string>();
    for (const segment of opts.getTravelListWeek?.()?.segments ?? []) travelActionIds.add(segment.actionId);
    for (const point of opts.getTravelListWeek?.()?.canonicalPoints ?? []) {
      if (point.ownerCheckpointId) travelCheckpointIds.add(point.ownerCheckpointId);
    }
    for (const line of travelLayer?.getLines() ?? []) {
      for (const segment of line.segments) travelActionIds.add(segment.actionId);
      for (const point of line.points) {
        if (point.ownerCheckpointId) travelCheckpointIds.add(point.ownerCheckpointId);
      }
    }
    // The visible tail belongs to the following business date, but remains in
    // this column's geometry. Use the same extended window for facts and previews.
    const days = windows(first, 21, zone).map((day) => ({ ...day,
      end: instantForWall(addDays(day.date, 1), (VISIBLE_HOURS - 24) * 60, zone) }));
    if (committing && livePreview && "kind" in livePreview && livePreview.kind === "checkpoint") {
      const checkpoint = checkpointById.get(livePreview.id);
      const previewPoint = livePreview;
      if (checkpoint?.plannedAtUtc && Date.parse(checkpoint.plannedAtUtc) === Date.parse(previewPoint.plannedAtUtc)
        && checkpoint.sessionId === previewPoint.sessionId) livePreview = null;
    }
    if (committing && createBaseline && livePreview && !("kind" in livePreview)) {
      const records = livePreview.sessionOnly ? sessions : actions;
      if (records.some((record) => !createBaseline!.has(record.id)
        && record.plannedStartAt && record.plannedEndAt
        && Date.parse(record.plannedStartAt) === Date.parse(livePreview!.start)
        && Date.parse(record.plannedEndAt) === Date.parse(livePreview!.end))) livePreview = null;
    }
    const maxWeekActionMs = 24 * 60 * 60 * 1000;
    const weekActions = actions.filter((action) => !healthActions.has(action.id) && !travelActionIds.has(action.id) && (actualIntervals(action).length > 0 || !action.plannedStartAt || !action.plannedEndAt
      || Date.parse(action.plannedEndAt) - Date.parse(action.plannedStartAt) <= maxWeekActionMs));
    const parts = fragments(weekActions, sessions, days);
    const checkpointFootprintMs = 48 / hourPx * 3_600_000;
    for (const checkpoint of checkpoints) {
      if (checkpoint.deletedAtUtc || !checkpoint.plannedAtUtc || travelCheckpointIds.has(checkpoint.id)) continue;
      const instant = Date.parse(checkpoint.plannedAtUtc);
      if (!Number.isFinite(instant)) continue;
      // A checkpoint is a single instant. Keep its footprint in its own date
      // column even when its private 48px collision footprint reaches midnight.
      const checkpointDate = dateAt(instant, zone);
      const day = days.find((entry) => entry.date === checkpointDate);
      if (day) parts.push({ kind: "action", id: `checkpoint:${checkpoint.id}`, date: day.date,
        start: instant, end: instant + checkpointFootprintMs, realStart: true, realEnd: false, sessionId: checkpoint.sessionId });
    }
    if (livePreview && !healthPreview) {
      const pointPreview = "kind" in livePreview && livePreview.kind === "checkpoint" ? livePreview : null;
      const isPoint = pointPreview !== null;
      let start: number;
      let end: number;
      if ("kind" in livePreview && livePreview.kind === "checkpoint") {
        start = Date.parse(livePreview.plannedAtUtc); end = start + checkpointFootprintMs;
      } else { start = Date.parse(livePreview.start); end = Date.parse(livePreview.end); }
      const copying = "kind" in livePreview && (livePreview.kind === "copy-action" || livePreview.kind === "copy-item");
      let kind: "action" | "session";
      if ("kind" in livePreview && livePreview.kind === "checkpoint") kind = "action";
      else if (copying) kind = "action";
      else if ("kind" in livePreview) kind = livePreview.kind;
      else kind = livePreview.sessionOnly ? "session" : "action";
      const previewDays = pointPreview ? days.filter((day) => day.date === dateAt(start, zone)) : days;
      for (const day of kind === "action" && !isPoint && end - start > maxWeekActionMs ? [] : previewDays) {
        if (start >= day.end || end <= day.start) continue;
        const sortId = !isPoint && "kind" in livePreview && livePreview.kind === "action" ? livePreview.id : undefined;
        parts.push({ kind, id: pointPreview ? `checkpoint-preview:${pointPreview.id}` : "__live-preview", sortId, date: day.date, start: Math.max(start, day.start), end: Math.min(end, day.end),
          realStart: start >= day.start, realEnd: end <= day.end, sessionId: kind === "action" ? livePreview.sessionId : null });
      }
      if (pointPreview) {
        const sourceId = `checkpoint:${pointPreview.id}`;
        for (let i = parts.length - 1; i >= 0; i--) if (parts[i].id === sourceId) parts.splice(i, 1);
      }
      if (!isPoint && "kind" in livePreview && livePreview.kind !== "checkpoint" && livePreview.kind !== "copy-action" && livePreview.kind !== "copy-item") {
        const movingPreview = livePreview;
        const current = movingPreview.kind === "action" ? actions : sessions;
        const original = current.find((value) => value.id === movingPreview.id);
        if (original?.plannedStartAt && original.plannedEndAt) {
          const originalStart = Date.parse(original.plannedStartAt);
          const originalEnd = Date.parse(original.plannedEndAt);
          for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i];
            if (part.id === livePreview.id && part.kind === livePreview.kind && part.start >= originalStart && part.end <= originalEnd) parts.splice(i, 1);
          }
        }
      }
    }
    const selection = opts.getSelection();
    const today = dateAt(Date.now(), zone);
    const nowMinute = minuteAt(Date.now(), zone);
    const header = days.map(({ date }) => {
      const d = new Date(`${date}T00:00:00Z`);
      return `<div class="arrangement-day-head${date === today ? " is-today" : ""}">${weekday[d.getUTCDay()]} ${d.getUTCDate()}</div>`;
    }).join("");
    const healthDragEndpoint = healthPreview && dragging && (dragging.kind === "resize-start" || dragging.kind === "resize-end")
      ? { actionId: healthPreview.id, edge: dragging.kind === "resize-start" ? "start" as const : "end" as const }
      : undefined;
    const cols = days.map((day) => {
      const dayParts = parts.filter((part) => part.date === day.date);
      const laidAll = layoutDay(dayParts);
      const blockInputs: ArrangementWeekBlockInput[] = laidAll.filter((part) => part.kind === "session").concat(laidAll.filter((part) => part.kind === "action"))
        .flatMap((part) => {
          if (part.id.startsWith("checkpoint:") || part.id.startsWith("checkpoint-preview:")) {
            const previewPoint = part.id.startsWith("checkpoint-preview:");
            const checkpointId = part.id.slice(previewPoint ? "checkpoint-preview:".length : "checkpoint:".length);
            const checkpoint = checkpointById.get(checkpointId);
            if (!checkpoint?.plannedAtUtc) return [];
            const point = previewPoint && livePreview && "kind" in livePreview && livePreview.kind === "checkpoint" ? livePreview : null;
            const pointAt = point ? point.plannedAtUtc : checkpoint.plannedAtUtc;
            const target = checkpoint.targetKind && checkpoint.targetId ? targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
            const sourceColor = target?.color ?? "#87909a";
            const roles = itemTypeColorRoles(isItemTypeHex(sourceColor) ? sourceColor : "#87909a");
            const title = checkpoint.nameLinkMode === "unlinked" ? checkpoint.title : target?.title ?? checkpoint.title;
            const minute = minuteAt(Date.parse(pointAt), zone);
            return [{ kind: "checkpoint" as const, id: checkpoint.id, start: part.start, end: part.end,
              realStart: true, realEnd: false, left: part.left, width: part.width, dense: part.dense,
              ended: checkpoint.completed,
              selected: !previewPoint && ((selection?.kind === "checkpoint" && selection.id === checkpoint.id) || opts.getFocusedCheckpointId?.() === checkpoint.id),
              preview: previewPoint, title, sourceColor, color: checkpoint.completed ? roles.completed : roles.main,
              titleColor: checkpoint.completed ? roles.completed : roles.unfinishedTitle,
              background: checkpoint.completed ? roles.completedBackground : roles.unfinishedBackground,
              checkpointTime: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}` }];
          }
          const previewPart = part.id === "__live-preview";
          const previewAction = livePreview && "kind" in livePreview && (livePreview.kind === "action" || livePreview.kind === "copy-action" || livePreview.kind === "copy-item");
          const original = previewPart
            ? previewAction ? actionById.get((livePreview as WeekMove).id) : null
            : part.kind === "action" ? actionById.get(part.id) : sessionById.get(part.id);
          if (!original && !previewPart) return [];
          if (crossesRepeatedWallTime(part.start, part.end, zone)) throw new Error(`${day.date} 的业务时间发生重复，安排块无法唯一投影`);
          if (part.kind === "session") return [{ kind: "session" as const, id: part.id, start: part.start, end: part.end,
            realStart: part.realStart, realEnd: part.realEnd, left: part.left, width: part.width, dense: part.dense,
            selected: selection?.kind === "session" && selection.id === part.id, preview: previewPart }];
          const action = original as ActionSnapshot | null;
          if (!action) return [{ kind: "action" as const, id: part.id, start: part.start, end: part.end, realStart: part.realStart, realEnd: part.realEnd,
            left: part.left, width: part.width, dense: part.dense, preview: true, color: "var(--insight-primary)" }];
          const target = targets.get(`${action.targetKind}:${action.targetId}`);
          const title = (action as ActionSnapshot & { nameLinkMode?: string }).nameLinkMode === "unlinked" ? action.title : target?.title ?? action.title;
          const sourceColor = target?.actionColor ?? target?.color ?? "#87909a";
          const color = isItemTypeHex(sourceColor) ? sourceColor : "#87909a";
          const roles = itemTypeColorRoles(color);
          const displayColor = action.ended ? roles.completed : roles.main;
          const titleColor = action.ended ? roles.completed : roles.unfinishedTitle;
          const displayBackground = action.ended ? roles.completedBackground : roles.unfinishedBackground;
          return [{ kind: "action" as const, id: action.id, start: part.start, end: part.end, realStart: part.realStart, realEnd: part.realEnd,
            left: part.left, width: part.width, dense: part.dense, ended: action.ended,
            selected: selection?.kind === "action" && selection.id === action.id, preview: previewPart,
            title, sourceColor: color, color: displayColor, titleColor, background: displayBackground,
            actualIntervals: previewPart ? undefined : actualIntervals(action),
            labelStart: !previewPart && actualIntervals(action).length && action.plannedStartAt && action.plannedEndAt
              ? (Date.parse(action.plannedStartAt) < day.end && Date.parse(action.plannedEndAt) > day.start
                ? Math.max(Date.parse(action.plannedStartAt), day.start) : Date.parse(action.plannedStartAt)) : undefined,
            labelEnd: !previewPart && actualIntervals(action).length && action.plannedStartAt && action.plannedEndAt
              ? (Date.parse(action.plannedStartAt) < day.end && Date.parse(action.plannedEndAt) > day.start
                ? Math.min(Date.parse(action.plannedEndAt), day.end) : Date.parse(action.plannedEndAt)) : undefined,
            flight: opts.getFlightActionBlock?.(action) ?? undefined }];
        });
      for (const block of blockInputs) {
        if (block.kind === "checkpoint") continue;
        const original = block.kind === "action" ? actionById.get(block.id) : sessionById.get(block.id);
        const parent = block.kind === "action" && original && "sessionId" in original && original.sessionId ? sessionById.get(original.sessionId) : null;
        const owner=parent??original;
        const actual = block.kind === "action" ? block.actualIntervals : undefined;
        const blockStart = actual?.length ? Math.min(...actual.map((interval) => interval.start)) : owner?.plannedStartAt ? Date.parse(owner.plannedStartAt) : block.start;
        const blockEnd = actual?.length ? Math.max(...actual.map((interval) => interval.end)) : owner?.plannedEndAt ? Date.parse(owner.plannedEndAt) : block.end;
        block.insetPx = Math.max(healthInset(health, blockStart, blockEnd), travelInset(blockStart, blockEnd));
      }
      const blocks = renderArrangementWeekBlocks({ date: day.date, zone, hourPx, blocks: blockInputs });
      const now = day.date === today || addDays(day.date, 1) === today && nowMinute < (VISIBLE_HOURS - 24) * 60
        ? `<div class="arrangement-now" data-now-minute="${nowMinute + (day.date === today ? 0 : 1440)}" style="top:${(nowMinute + (day.date === today ? 0 : 1440)) / 60 * hourPx}px"></div>` : "";
      return `<div class="arrangement-day" data-date="${day.date}">${blocks}${renderHealthLines(health,day,zone,hourPx,opts.getHealthSelection?.()??null,healthDragEndpoint)}${now}</div>`;
    }).join("");
    if (unscheduledDragging && grid()) {
      // Keep the native drop target mounted while updating only preview geometry.
      const template = document.createElement("template");
      template.innerHTML = cols;
      for (const nextDay of template.content.querySelectorAll<HTMLElement>(".arrangement-day[data-date]")) {
        const existingDay = [...host.querySelectorAll<HTMLElement>(".arrangement-day[data-date]")].find((day) => day.dataset.date === nextDay.dataset.date);
        if (!existingDay) continue;
        for (const node of [...existingDay.children]) if (node.matches(".arrangement-action.is-preview")) node.remove();
        for (const node of [...nextDay.children]) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(".arrangement-action.is-preview")) { existingDay.append(node); continue; }
          const key = node.dataset.actionId ? "actionId" : node.dataset.sessionId ? "sessionId" : node.dataset.checkpointId ? "checkpointId" : null;
          if (!key) continue;
          const previous = [...existingDay.children].find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && candidate.dataset[key] === node.dataset[key]);
          if (!previous) continue;
          previous.style.left = node.style.left;
          previous.style.width = node.style.width;
          previous.dataset.layoutLeft = node.dataset.layoutLeft ?? "";
          previous.dataset.layoutWidth = node.dataset.layoutWidth ?? "";
          previous.classList.toggle("is-dense", node.classList.contains("is-dense"));
          const copy = previous.querySelector(".arrangement-action-copy");
          const nextCopy = node.querySelector(".arrangement-action-copy");
          if (copy && nextCopy) copy.innerHTML = nextCopy.innerHTML;
        }
      }
      return;
    }
    host.innerHTML = `<div class="arrangement-top"><div class="arrangement-corner"></div><div class="arrangement-header-viewport"><div class="arrangement-header">${header}</div></div></div>
      <div class="arrangement-body"><div class="arrangement-hours"><div class="arrangement-hour-inner">${rulerLabels()}</div></div>
      <div class="arrangement-grid-scroll"><div class="arrangement-days">${cols}</div></div></div><div class="arrangement-preview" hidden></div><div class="arrangement-zoom" aria-label="时间轴缩放">
        <button type="button" data-zoom="out" aria-label="缩小时间轴" title="缩小"${hourPx <= MIN_HOUR_PX ? " disabled" : ""}>−</button><button type="button" data-zoom="reset" aria-label="重置时间轴缩放" title="重置缩放">${Math.round(hourPx / HOUR_PX * 100)}%</button><button type="button" data-zoom="in" aria-label="放大时间轴" title="放大"${hourPx >= MAX_HOUR_PX ? " disabled" : ""}>+</button></div>`;
    host.querySelectorAll<HTMLElement>(".arrangement-checkpoint-checkbox-host").forEach((slot) => {
      const checkpoint = checkpointById.get(slot.dataset.checkpointId ?? "");
      if (!checkpoint) return;
      const checkbox = createCheckbox(checkpoint.completed, 16);
      checkbox.classList.add("arrangement-checkpoint-checkbox");
      checkbox.dataset.checkpointToggle = checkpoint.id;
      const target = checkpoint.targetKind && checkpoint.targetId ? targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
      checkbox.disabled = !target || !target.available || target.archived || pendingCheckpointToggles.has(checkpoint.id);
      if (pendingCheckpointToggles.has(checkpoint.id)) checkbox.setAttribute("aria-busy", "true");
      checkbox.setAttribute("aria-label", checkpoint.completed ? "撤销检查点完成" : "完成检查点");
      slot.append(checkbox);
    });
    host.style.setProperty("--arrangement-hour-height", `${hourPx}px`);
    host.style.setProperty("--arrangement-grid-height", `${VISIBLE_HOURS * hourPx}px`);
    host.classList.toggle("has-half-hours", hourPx >= HOUR_PX * 1.5);
    const nextScroll = grid()!;
    // Use the drawable viewport, including its scrollbar reservation, for both rows.
    // Fractional day widths retain the remainder instead of leaving a seam after day seven.
    const viewportWidth = nextScroll.clientWidth;
    dayPx = Math.max(1, viewportWidth / 7);
    host.style.setProperty("--arrangement-day-width", `${dayPx}px`);
    host.style.setProperty("--arrangement-viewport-width", `${viewportWidth}px`);
    nextScroll.scrollLeft = priorDay * dayPx;
    nextScroll.scrollTop = priorTop;
    syncHeader();
    travelLayer?.renderIntoDays(hourPx, days);
  }
  function syncTravelEditing(): void {
    travelLayer?.syncEditing(true);
  }
  function syncSelection(): void {
    const selection = opts.getSelection();
    const focusedCheckpointId = opts.getFocusedCheckpointId?.();
    const healthSelection = opts.getHealthSelection?.();
    host.querySelectorAll<HTMLElement>(".arrangement-action[data-action-id], .arrangement-action[data-checkpoint-id], .arrangement-session[data-session-id]").forEach((node) => {
      const selected = node.dataset.actionId ? selection?.kind === "action" && selection.id === node.dataset.actionId
        : node.dataset.checkpointId ? (selection?.kind === "checkpoint" && selection.id === node.dataset.checkpointId) || focusedCheckpointId === node.dataset.checkpointId
        : selection?.kind === "session" && selection.id === node.dataset.sessionId;
      node.classList.toggle("is-selected", Boolean(selected));
    });
    host.querySelectorAll<HTMLElement>(".week-health-event[data-health-id]").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.healthId === healthSelection);
    });
    const selectedTravel = opts.getTravelEditMode?.()?.selectedItemId;
    host.querySelectorAll<HTMLElement>(".travel-week-trip[data-travel-item]").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.travelItem === selectedTravel);
    });
    travelLayer?.syncEditing();
  }
  function safeRender() {
    if (!host.clientWidth) { hiddenLayout = true; return; }
    try { render(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.innerHTML = `<p class="task-page-error arrangement-week-error" role="alert">${escHtml(message)}</p>`;
      opts.onError(message);
    }
  }
  const unsubscribeAppearance = subscribeCategoryAppearance(() => {
    if (dragging) appearancePending = true;
    else refreshBlockColors();
  });
  function refreshBlockColors(): void {
    host.querySelectorAll<HTMLElement>(".arrangement-action[data-source-color]").forEach((block) => {
      const roles = itemTypeColorRoles(block.dataset.sourceColor ?? "#87909a");
      const ended = block.classList.contains("is-ended");
      block.style.setProperty("--arrangement-color", ended ? roles.completed : roles.main);
      block.style.setProperty("--arrangement-title-color", ended ? roles.completed : roles.unfinishedTitle);
      block.style.setProperty("--arrangement-background", ended ? roles.completedBackground : roles.unfinishedBackground);
    });
    host.querySelectorAll<HTMLElement>(".arrangement-checkpoint[data-source-color]").forEach((block) => {
      const roles = itemTypeColorRoles(block.dataset.sourceColor ?? "#87909a");
      const completed = block.classList.contains("is-completed");
      block.style.setProperty("--arrangement-color", completed ? roles.completed : roles.main);
      block.style.setProperty("--arrangement-title-color", completed ? roles.completed : roles.unfinishedTitle);
      block.style.setProperty("--arrangement-background", completed ? roles.completedBackground : roles.unfinishedBackground);
    });
    // Palette previews change display roles while the mounted travel lines retain canonical HEX.
    travelLayer?.renderIntoDays(hourPx, [...host.querySelectorAll<HTMLElement>(".arrangement-day[data-date]")].map((column) => {
      const date = column.dataset.date!;
      return { date, start: instantForWall(date, 0, opts.getData().zone), end: instantForWall(addDays(date, 1), (VISIBLE_HOURS - 24) * 60, opts.getData().zone) };
    }));
  }
  function syncHeader() {
    const scroll = grid();
    const head = host.querySelector<HTMLElement>(".arrangement-header-viewport");
    const hours = host.querySelector<HTMLElement>(".arrangement-hour-inner");
    const left = scroll && head ? scroll.scrollLeft : 0;
    const top = scroll && hours ? scroll.scrollTop : 0;
    if (scroll && head) head.scrollLeft = left;
    if (scroll && hours) hours.style.transform = `translateY(${-top}px)`;
  }
  function onScroll() {
    if (!host.clientWidth || hiddenLayout) return;
    syncHeader();
    const currentScroll = grid();
    if (currentScroll && !dragging && !unscheduledDragging) {
      pendingScrollDay = addDays(first, Math.round(currentScroll.scrollLeft / dayPx));
    }
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const scroll = grid();
      if (!scroll || !host.clientWidth || dragging || unscheduledDragging) return;
      const target = Math.round(scroll.scrollLeft / dayPx) * dayPx;
      scroll.scrollTo({ left: target, behavior: "smooth" });
      const index = Math.round(target / dayPx);
      const date = addDays(first, index);
      pendingScrollDay = null;
      opts.onDay(date);
      if (index < 3 || index > 11) {
        first = addDays(date, -7);
        safeRender();
        const rebased = grid();
        if (rebased) rebased.scrollLeft = dayPx * 7;
      }
    }, 140);
  }
  function candidateAt(x: number, y: number): WeekCreate | WeekMove | CheckpointMove | null {
    if (!dragging) return null;
    const gesture = dragging;
    const column = columnAt(x);
    if (!column) return null;
    let minute = minuteAtY(y);
    if (dragging.kind === "new") {
      const origin = timeAt(dragging.originDate, dragging.originMinute);
      const end = timeAt(dragging.originDate, minute);
      const startMs = Math.min(origin, end);
      const endMs = Math.max(origin, end);
      if (startMs === endMs) return null;
      return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
        sessionId: dragging.sessionId, sessionOnly: dragging.sessionOnly };
    }
    if (dragging.kind === "move-checkpoint") {
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === gesture.id);
      if (!checkpoint || checkpoint.actualAtUtc || !gesture.checkpointBaseline) return null;
      const dayDelta = (Date.parse(`${column.date}T00:00:00Z`) - Date.parse(`${gesture.originDate}T00:00:00Z`)) / 86_400_000;
      const deltaMinute = (minute - gesture.originMinute) + dayDelta * 1440;
      const plannedAt = gesture.start + snapFive(deltaMinute * 60_000);
      const session = sessionAt(x, y);
      const sessionId = session && plannedAt >= Date.parse(session.plannedStartAt) && plannedAt < Date.parse(session.plannedEndAt) ? session.id : null;
      return { kind: "checkpoint", id: checkpoint.id, plannedAtUtc: new Date(plannedAt).toISOString(), sessionId, baseline: gesture.checkpointBaseline };
    }
    if (dragging.kind === "unscheduled") {
      const action = opts.getData().actions.find((value) => value.id === gesture.id);
      if (!action || !dragging.baseline) return null;
      let start = timeAt(column.date, minute);
      let end = start + (action.plannedDuration ? action.plannedDuration * 1000 : 3_600_000);
      const session = sessionAt(x, y);
      if (session) ({ start, end } = clampIntoSession(start, end - start, session));
      return { kind: "action", id: action.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), sessionId: session?.id ?? null, baseline: dragging.baseline };
    }
    const original = dragging.id && (dragging.sessionOnly
      ? opts.getData().sessions.find((value) => value.id === gesture.id)
      : opts.getData().actions.find((value) => value.id === gesture.id));
    if (!original) return null;
    let start = dragging.start;
    let end = dragging.end;
    const relocating = dragging.kind === "move" || dragging.kind === "copy-action" || dragging.kind === "copy-item";
    if (relocating) {
      const dayDelta = (Date.parse(`${column.date}T00:00:00Z`) - Date.parse(`${dragging.originDate}T00:00:00Z`)) / 86_400_000;
      const minutes = (minute - dragging.originMinute) + dayDelta * 1440;
      const delta = snapFive(minutes * 60_000);
      start += delta; end += delta;
    } else if (dragging.kind === "resize-start") start = timeAt(dragging.originDate, minute);
    else end = timeAt(dragging.originDate, minute);
    if (end <= start) return null;
    const session = !dragging.sessionOnly && relocating ? sessionAt(x, y) : null;
    const sessionId = dragging.sessionOnly ? null : session && start >= Date.parse(session.plannedStartAt) && end <= Date.parse(session.plannedEndAt)
      ? session.id : relocating ? null : dragging.sessionId;
    if (dragging.kind === "copy-action" || dragging.kind === "copy-item") {
      return { kind: dragging.kind, id: original.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), sessionId };
    }
    if (dragging.sessionOnly) return { kind: "session", id: original.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), sessionId: null, baseline: dragging.sessionBaseline ?? undefined };
    if (!dragging.baseline) return null;
    return { kind: "action", id: original.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), sessionId, baseline: dragging.baseline };
  }
  function safeCandidateAt(x: number, y: number): WeekCreate | WeekMove | WeekCopy | CheckpointMove | null {
    try { return candidateAt(x, y); }
    catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); return null; }
  }
  function showPreview(candidate: WeekCreate | WeekMove | WeekCopy | CheckpointMove | null) {
    livePreview = candidate;
    safeRender();
  }
  function onPointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (travelLayer?.tryPointerDown(event)) return;
    if (target.closest("[data-checkpoint-toggle]")) { event.stopPropagation(); return; }
    if (target.closest(".arrangement-zoom")) { event.stopPropagation(); return; }
    if (committing || creationMenu?.isOpen()) return;
    const healthHit = target.closest<HTMLElement>("[data-health-id]");
    if (healthHit?.dataset.healthId && !target.closest("[data-health-plan-edge]")) { opts.onHealthSelect?.(healthHit.dataset.healthId); return; }
    const actionEl = target.closest<HTMLElement>("[data-action-id]");
    const checkpointEl = target.closest<HTMLElement>("[data-checkpoint-id]");
    const sessionEl = target.closest<HTMLElement>("[data-session-id]");
    const column = columnAt(event.clientX);
    if (!column || event.button !== 0) return;
    const checkpoint = checkpointEl && (opts.getData().checkpoints ?? []).find((value) => value.id === checkpointEl.dataset.checkpointId);
    if (checkpoint) {
      opts.onSelect({ kind: "checkpoint", id: checkpoint.id });
      if (checkpoint.actualAtUtc || !checkpoint.plannedAtUtc || !checkpointWritable(checkpoint) || target.closest("[data-checkpoint-toggle]")) return;
      let checkpointBaseline: CheckpointMoveBaseline | null = null;
      try { checkpointBaseline = opts.captureCheckpointMove?.(checkpoint) ?? null; }
      catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); return; }
      if (!checkpointBaseline) return;
      const minute = minuteAtY(event.clientY);
      dragging = { pointerId: event.pointerId, kind: "move-checkpoint", canCopy: false, id: checkpoint.id,
        originDate: column.date, originMinute: minute, originY: event.clientY, originX: event.clientX,
        start: Date.parse(checkpoint.plannedAtUtc), end: Date.parse(checkpoint.plannedAtUtc), sessionId: checkpoint.sessionId,
        sessionOnly: false, candidate: null, baseline: null, checkpointBaseline, sessionBaseline: null };
      host.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    const action = actionEl && opts.getData().actions.find((value) => value.id === actionEl.dataset.actionId);
    const session = sessionEl && opts.getData().sessions.find((value) => value.id === sessionEl.dataset.sessionId);
    let sessionBaseline: SessionMoveBaseline | null = null;
    if (session) {
      try { sessionBaseline = opts.captureSessionMove?.(session) ?? null; }
      catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); return; }
    }
    if (action && (action.intervals.length || opts.getData().targets.get(`${action.targetKind}:${action.targetId}`)?.archived)) {
      opts.onSelect({ kind: "action", id: action.id }, action.id);
      return;
    }
    let baseline: ActionMoveBaseline | null = null;
    if (action) {
      try { baseline = opts.captureActionBaseline(action.id); }
      catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); return; }
    }
    if (action || session) opts.onSelect({ kind: action ? "action" : "session", id: (action ?? session)!.id }, action?.id);
    const minute = minuteAtY(event.clientY);
    const edge = target.closest<HTMLElement>("[data-edge]")?.dataset.edge;
    const duplicate = action && !edge ? (event.altKey ? "copy-item" as const : (event.ctrlKey || event.metaKey) ? "copy-action" as const : null) : null;
    const kind = duplicate ?? (action || session ? edge ? `resize-${edge}` as "resize-start" | "resize-end" : action ? "move" : "new" : "new");
    if (!kind) return;
    const base = action ?? session;
    dragging = { pointerId: event.pointerId, kind, canCopy: !!action && !edge, id: base?.id ?? null, originDate: column.date, originMinute: minute, originY: event.clientY,
      originX: event.clientX, start: base ? Date.parse(base.plannedStartAt!) : 0,
      end: base ? Date.parse(base.plannedEndAt!) : 0, sessionId: action?.sessionId ?? session?.id ?? null,
      sessionOnly: !!session && !!edge || (!base && event.ctrlKey && !sessionEl), candidate: null, baseline, checkpointBaseline: null, sessionBaseline };
    host.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function onDblClick(event: MouseEvent) {
    if (travelLayer?.onDblClick(event)) return;
  }
  function onContextMenu(event: MouseEvent) {
    if ((event.target as HTMLElement).closest(".arrangement-zoom")) { event.preventDefault(); return; }
    if (travelLayer?.onContextMenu(event)) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    const health = target.closest<HTMLElement>("[data-health-id]");
    if (health?.dataset.healthId) { opts.onHealthMenu?.(health.dataset.healthId,event.clientX,event.clientY); return; }
    const capturedDataDir = opts.getExpectedDataDir?.() ?? "";
    const checkpointEl = target.closest<HTMLElement>("[data-checkpoint-id]");
    const checkpoint = checkpointEl && (opts.getData().checkpoints ?? []).find((value) => value.id === checkpointEl.dataset.checkpointId);
    if (checkpoint) {
      const data = opts.getCheckpointMenuData?.(checkpoint);
      const owner = checkpoint.targetKind && checkpoint.targetId ? opts.getData().targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
      const readonly = !owner || !owner.available || owner.archived;
      const moveOptions = (data?.move ?? []).map((option) => ({ value: option.value, label: option.label }));
      const categories = mapMenuBranches(data?.categories ?? []);
      const tags = (data?.tags ?? []).map((tag) => ({ value: `tag:${tag.value}`, label: tag.label }));
      const anchor = document.createElement("span");
      anchor.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;width:1px;height:1px;opacity:0;pointer-events:none`;
      document.body.appendChild(anchor);
      actionMenuControl?.dispose();
      actionMenuControl = mountFlatSelectPopover({ anchor, options: [
        { value: "details", label: "详情" },
        { value: "move", label: "移动到", disabled: readonly, children: data?.lists?.length ? [{ value: "__inbox", label: "Inbox" }, ...data.lists.map((list) => ({ value: `list:${list.id}`, label: list.title }))] : moveOptions.length ? moveOptions : [{ value: "__empty", label: "暂无可移动目标", disabled: true }] },
        { value: "category", label: "分类", disabled: readonly, children: categories.length ? categories : [{ value: "__empty_category", label: "暂无分类", disabled: true }] },
        { value: "tags", label: "标签", disabled: readonly, children: tags.length ? tags : [{ value: "__empty_tags", label: "暂无标签", disabled: true }] },
        // A deleted owning thing leaves the checkpoint behind. Keep delete available or the orphan cannot be removed.
        { value: "delete-checkpoint", label: "删除检查点", danger: true, disabled: !!owner && readonly },
        ...(checkpoint.targetKind && checkpoint.targetId ? [{ value: "delete-target", label: "删除所有任务", danger: true, disabled: readonly }] : []),
      ], selected: new Set(), multiple: false, search: false, menu: true,
      onOpenChange: (open) => { if (!open) anchor.remove(); },
      onChange: (values) => {
        const value = [...values][0];
        if (!value) return;
        if (value === "details") opts.onSelect({ kind: "checkpoint", id: checkpoint.id });
        else if (value === "delete-checkpoint") opts.onDeleteCheckpoint?.(checkpoint);
        else if (value === "delete-target") opts.onDeleteCheckpointTarget?.(checkpoint);
        else if (value.startsWith("tag:")) {
          const selected = new Set(data?.selectedTags ?? []); const tagId = value.slice(4);
          if (selected.has(tagId)) selected.delete(tagId); else selected.add(tagId);
          opts.onCheckpointMenuChange?.(checkpoint, "tags", selected);
        } else if ((value === "__inbox" || value.startsWith("list:")) && opts.onMoveCheckpointToList)
          opts.onMoveCheckpointToList(checkpoint, value === "__inbox" ? null : value.slice(5), capturedDataDir);
        else if (value === "__no_category") opts.onCheckpointMenuChange?.(checkpoint, "category", "");
        else if (value.startsWith("item:") || value.startsWith("task:") || value.startsWith("project:") || value === "clear")
          opts.onCheckpointMenuChange?.(checkpoint, "move", value);
        else if (value && value !== "move" && value !== "category" && value !== "tags") opts.onCheckpointMenuChange?.(checkpoint, "category", value);
      } });
      void actionMenuControl.open();
      return;
    }
    const actionEl = target.closest<HTMLElement>("[data-action-id]");
    const sessionEl = target.closest<HTMLElement>("[data-session-id]");
    const action = actionEl && opts.getData().actions.find((value) => value.id === actionEl.dataset.actionId);
    const session = sessionEl && opts.getData().sessions.find((value) => value.id === sessionEl.dataset.sessionId);
    let sessionBaseline: SessionMoveBaseline | undefined;
    if (session) {
      try { sessionBaseline = opts.captureSessionMove?.(session); }
      catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); return; }
    }
    if (!action && !session) {
      const column = columnAt(event.clientX);
      if (!column) return;
      const minute = minuteAtY(event.clientY);
      const request: WeekCreate = { start: new Date(timeAt(column.date, minute)).toISOString(), end: new Date(timeAt(column.date, minute + 60)).toISOString(), sessionId: null, sessionOnly: false };
      openCreateChoice(request, event.clientX, event.clientY, "point", column.date);
      return;
    }
    actionMenuControl?.dispose();
    actionMenuAnchor?.remove();
    const anchor = document.createElement("span");
    actionMenuAnchor = anchor;
    anchor.dataset.arrangementMenuAnchor = "true";
    anchor.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;width:1px;height:1px;opacity:0;pointer-events:none`;
    document.body.appendChild(anchor);
    const closeMenu = () => {
      anchor.remove();
      if (actionMenuAnchor === anchor) actionMenuAnchor = null;
    };
    if (action) {
      const data = opts.getActionMenuData?.(action);
      const moveOptions = (data?.move ?? []).map((option) => ({ value: option.value, label: option.label }));
      const categoryOptions = mapMenuBranches(data?.categories ?? []);
      const tagOptions = (data?.tags ?? []).map((option) => ({ value: `tag:${option.value}`, label: option.label }));
      const listMoveAvailable = Boolean(data?.lists && opts.onMoveActionToList && action.targetKind === "item");
      const deleteOptions = [
        { value: "delete", label: "删除此安排", danger: true },
        ...(action.targetId && (action.targetKind === "item" || action.targetKind === "task")
          ? [{ value: "delete-linked", label: "删除所有任务", danger: true }]
          : []),
      ];
      const listMoveOptions = listMoveAvailable && data?.lists
        ? [{ value: "__inbox", label: "Inbox" }, ...data.lists.map((list) => ({ value: `list:${list.id}`, label: list.title }))]
        : [];
      const options = data?.travel ? [
        { value: "details", label: "详情" },
        ...deleteOptions,
      ] : [
        { value: "details", label: "详情" },
        { value: "move", label: "移动到", children: listMoveOptions.length
          ? listMoveOptions
          : (moveOptions.length ? moveOptions : [{ value: "__empty_move", label: "暂无可移动目标", disabled: true }]) },
        { value: "category", label: "分类", children: categoryOptions.length ? categoryOptions : [{ value: "__empty_category", label: "暂无分类", disabled: true }] },
        { value: "tags", label: "标签", children: tagOptions.length ? tagOptions : [{ value: "__empty_tag", label: "暂无标签", disabled: true }] },
        ...deleteOptions,
      ];
      actionMenuControl = mountFlatSelectPopover({ anchor, options, selected: new Set(), multiple: false, search: false, menu: true, submenuSearch: true,
        onOpenChange: (open) => { if (!open) closeMenu(); },
        onChange: (values) => {
          const value = [...values][0];
          if (!value) return;
          if (value === "details") opts.onSelect({ kind: "action", id: action.id }, action.id);
          else if (value === "delete") opts.onDeleteAction?.(action);
          else if (value === "delete-linked") opts.onDeleteLinkedTask?.(action);
          else if (value.startsWith("tag:")) {
            const tagId = value.slice(4);
            const selected = new Set(data?.selectedTags ?? []);
            if (selected.has(tagId)) selected.delete(tagId); else selected.add(tagId);
            opts.onActionMenuChange?.(action, "tags", selected);
          } else if ((value === "__inbox" || value.startsWith("list:")) && opts.onMoveActionToList && action.targetKind === "item")
            opts.onMoveActionToList(action, value === "__inbox" ? null : value.slice(5), capturedDataDir);
          else if (value.startsWith("item:") || value.startsWith("task:") || value.startsWith("project:") || value === "clear")
            opts.onActionMenuChange?.(action, "move", value);
          else if (value === "__no_category") opts.onActionMenuChange?.(action, "category", "");
          else if (value !== "category") opts.onActionMenuChange?.(action, "category", value);
        },
      });
    } else {
      actionMenuControl = mountFlatSelectPopover({ anchor, options: [
        { value: "details", label: "详情" }, { value: "move-action", label: "移动内部安排" },
        { value: "resize", label: "调整时间" }, { value: "delete-session", label: "删除工作时间" },
      ], selected: new Set(), multiple: false, search: false, menu: true,
      onOpenChange: (open) => { if (!open) closeMenu(); },
      onChange: (values) => {
        const value = [...values][0];
        if (value === "details") opts.onSelect({ kind: "session", id: session!.id });
        else if (value === "delete-session") opts.onDeleteSession?.(session!, sessionBaseline);
        else opts.onError("该操作请在右侧详情中完成");
      },
    });
    }
    void actionMenuControl.open();
  }
  function createMenuItems(mode: "drag" | "point", inSession: boolean): CommandMenuItem[] {
    const items: CommandMenuItem[] = [
      { value: "new-item", label: "新建任务" },
      ...(mode === "point" ? [{ value: "new-checkpoint", label: "新建检查点" }] : []),
      { value: "health-sleep", label: "安排睡眠" },
      { value: "health-activity", label: "安排运动", children: ACTIVITY_TYPES.map((type) => ({ value: `activity:${type.value}`, label: type.label })) },
      { value: "travel-other", label: "新建出行" },
    ];
    if (mode === "point") items.push({ value: "health-meal", label: "记录饮食" });
    if (mode === "drag" && !inSession) items.push({ value: "session", label: "新建工作时间" });
    items.push({ value: "test-flight-card", label: "测试" });
    return items;
  }
  function openCreateChoice(request: WeekCreate, x: number, y: number, mode: "drag" | "point" = "drag", day?: string) {
    dismissCreation?.();
    if (mode !== "point") showPreview(request);
    let committed = false;
    creationMenu = showCommandMenuAt(x, y, createMenuItems(mode, !!request.sessionId), value => {
      if (value === "health-activity") return;
      if (value === "test-flight-card") { committed = true; openFlightResultCardStylePreview(); return; }
      if (value === "new-checkpoint") { committed = true; void opts.onCreateCheckpoint?.(request.start, request.sessionId); return; }
      const activityType = value.startsWith("activity:") ? value.slice("activity:".length) : undefined;
      const choice = (activityType ? "health-activity" : value) as WeekCreateChoice;
      let next: WeekCreate = { ...request, choice, activityType, sessionOnly: choice === "session" };
      if (mode === "point" && choice === "health-sleep" && day) {
        const zone = opts.getData().zone;
        const night = addDays(day, 1);
        next = { ...next, start: new Date(instantForWall(night, 0, zone)).toISOString(), end: new Date(instantForWall(night, 8 * 60, zone)).toISOString() };
      }
      committed = true;
      void submitCreate(next, mode !== "point");
    }, { onClose: () => { creationMenu = null; dismissCreation = null; if (!committed && !committing) showPreview(null); } });
    dismissCreation = () => { creationMenu?.dispose(); creationMenu = null; showPreview(null); };
  }
  function copyKind(event: PointerEvent): "copy-item" | "copy-action" | null {
    if (event.altKey) return "copy-item";
    if (event.ctrlKey || event.metaKey) return "copy-action";
    return null;
  }
  function applyCopyModifier(event: PointerEvent) {
    if (!dragging?.canCopy) return;
    const next = copyKind(event) ?? "move";
    if (dragging.kind === next) return;
    dragging.kind = next;
    dragging.candidate = safeCandidateAt(pointerX, pointerY);
    showPreview(dragging.candidate);
  }
  function onPointerMove(event: PointerEvent) {
    travelLayer?.onPointerMove(event);
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    pointerX = event.clientX; pointerY = event.clientY;
    applyCopyModifier(event);
    dragging.candidate = safeCandidateAt(event.clientX, event.clientY);
    showPreview(dragging.candidate);
    if (!edgeTimer) edgeTimer = window.setInterval(() => {
      if (!dragging) return;
      const scroll = grid();
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      if (pointerY < rect.top + 30) scroll.scrollTop -= 18;
      else if (pointerY > rect.bottom - 30) scroll.scrollTop += 18;
      if (dragging.kind === "move" || dragging.kind === "copy-action" || dragging.kind === "copy-item") {
        if (pointerX < rect.left + 30) scroll.scrollLeft -= 18;
        else if (pointerX > rect.right - 30) scroll.scrollLeft += 18;
      }
      dragging.candidate = safeCandidateAt(pointerX, pointerY);
      showPreview(dragging.candidate);
    }, 40);
  }
  function stopDrag(keepPreview: boolean) {
    dragging = null;
    clearInterval(edgeTimer); edgeTimer = 0;
    if (!keepPreview) showPreview(null);
    if (appearancePending) { appearancePending = false; queueMicrotask(() => { if (!disposed) refreshBlockColors(); }); }
  }
  function clearDrag() { stopDrag(false); }
  function onPointerCancel(event: PointerEvent) {
    travelLayer?.cancelDrag(event.pointerId);
    if (dragging?.pointerId === event.pointerId) clearDrag();
  }
  function clearUnscheduledDrag() {
    if (!unscheduledDragging) return;
    unscheduledDragging = false;
  }
  function onWindowBlur() { travelLayer?.cancelDrag(); clearDrag(); clearUnscheduledDrag(); }
  function onVisibilityChange() { if (document.visibilityState !== "visible") { travelLayer?.cancelDrag(); clearDrag(); clearUnscheduledDrag(); } }
  function onLostPointerCapture(event: PointerEvent) {
    travelLayer?.onLostPointerCapture(event.pointerId);
    if (dragging?.pointerId === event.pointerId) clearDrag();
  }
  async function submitCreate(request: WeekCreate, preview = true) {
    committing = true;
    const data = opts.getData();
    createBaseline = new Set((request.sessionOnly ? data.sessions : data.actions).map((record) => record.id));
    if (preview) showPreview(request);
    try { await opts.onCreate(request); }
    catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); }
    finally { committing = false; createBaseline = null; if (preview) showPreview(null); }
  }
  async function submitCopy(request: WeekCopy) {
    committing = true;
    showPreview(request);
    try { await opts.onCopy?.(request); }
    catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); }
    finally { committing = false; showPreview(null); }
  }
  async function submitMove(request: WeekMove) {
    committing = true;
    showPreview(request);
    try { await opts.onMove(request); }
    catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); }
    finally { committing = false; showPreview(null); }
  }
  function onPointerUp(event: PointerEvent) {
    travelLayer?.onPointerUp(event);
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const draft = dragging;
    // Modifiers may change after the last pointermove; use the actual drop event.
    pointerX = event.clientX; pointerY = event.clientY;
    applyCopyModifier(event);
    const candidate = safeCandidateAt(event.clientX, event.clientY);
    const moved = Math.hypot(event.clientX - draft.originX, event.clientY - draft.originY) > 4;
    stopDrag(true);
    if (!moved || !candidate) {
      showPreview(null);
      if (!draft.id) opts.onSelect(null);
      return;
    }
    if (draft.kind === "copy-action" || draft.kind === "copy-item") {
      const request = candidate as WeekCopy | null;
      if (!request || (request.kind !== "copy-action" && request.kind !== "copy-item")) { showPreview(null); return; }
      void submitCopy(request);
      return;
    }
    if (draft.kind === "move-checkpoint") {
      const request = candidate as CheckpointMove | null;
      if (request?.kind === "checkpoint" && opts.onMoveCheckpoint) {
        showPreview(request);
        committing = true;
        void opts.onMoveCheckpoint(request).catch((error) => opts.onError(error instanceof Error ? error.message : String(error)))
        .finally(() => { committing = false; safeRender(); });
      }
      return;
    }
    if (draft.kind === "new") {
      const request = candidate as WeekCreate;
      if (request.sessionOnly) void submitCreate(request);
      else openCreateChoice(request, event.clientX, event.clientY);
    }
    else void submitMove(candidate as WeekMove);
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      // Escape belongs to the topmost transient UI before it can leave travel edit.
      // The shared dialog/picker listeners run later in the event path, so let them
      // consume this key without asking the travel layer to exit first.
      if (document.querySelector(".insight-dialog-backdrop.is-open")) return;
      if (creationMenu?.isOpen()) {
        // The creation menu owns the held range preview until it closes; clear both together.
        dismissCreation?.();
        event.preventDefault();
        return;
      }
      if (document.querySelector(".orbita-standard-popover.is-open")) return;
      if (travelLayer?.onKeyDown(event)) { event.preventDefault(); return; }
      if (dragging) { clearDrag(); event.preventDefault(); return; }
      return;
    }
    if (travelLayer?.onKeyDown(event)) { event.preventDefault(); return; }
    if (event.key !== "Delete" && event.code !== "Delete") return;
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (dragging || unscheduledDragging || committing || creationMenu?.isOpen() || actionMenuControl?.isOpen()) return;
    if (!host.isConnected || host.hidden) return;
    if (document.querySelector(".insight-dialog-backdrop.is-open")) return;
    const selection = opts.getSelection();
    if (selection?.kind !== "action") return;
    const action = opts.getData().actions.find((value) => value.id === selection.id && !value.deletedAtUtc);
    if (!action) return;
    event.preventDefault();
    opts.onDeleteAction?.(action);
  }
  function applyZoom(next: number, anchorY: number) {
    const scroll = grid();
    if (!scroll || dragging || unscheduledDragging || committing || creationMenu?.isOpen()) return;
    const rect = scroll.getBoundingClientRect();
    const offsetY = Math.max(0, Math.min(scroll.clientHeight, anchorY - rect.top));
    const anchoredMinute = (scroll.scrollTop + offsetY) / hourPx * 60;
    if (!Number.isFinite(next)) return;
    const percent = next / HOUR_PX * 100;
    const level = ZOOM_LEVELS.reduce<number>((best, value) => Math.abs(value - percent) < Math.abs(best - percent) ? value : best, ZOOM_LEVELS[0]);
    const nextHour = HOUR_PX * level / 100;
    if (!Number.isFinite(nextHour) || nextHour === hourPx) return;
    hourPx = nextHour;
    // Keep the gesture's original target alive across pinch events. Replacing
    // the scroll subtree here interrupts native trackpad gesture delivery.
    host.style.setProperty("--arrangement-hour-height", `${hourPx}px`);
    host.style.setProperty("--arrangement-grid-height", `${VISIBLE_HOURS * hourPx}px`);
    host.classList.toggle("has-half-hours", hourPx >= HOUR_PX * 1.5);
    host.querySelectorAll<HTMLElement>("[data-start-minute]").forEach((block) => {
      const height = block.classList.contains("is-checkpoint") ? 48 : Math.max(MIN_PX, Number(block.dataset.durationMinutes) / 60 * hourPx);
      block.style.top = `${Number(block.dataset.startMinute) / 60 * hourPx}px`;
      block.style.height = `${height}px`;
      const title = block.querySelector<HTMLElement>(".arrangement-action-title");
      const time = block.querySelector<HTMLElement>("small");
      const textLayout = actionTextLayout(height);
      if (title) { title.hidden = !textLayout.showTitle; title.style.webkitLineClamp = String(textLayout.titleLines); }
      if (time) time.hidden = !textLayout.showTime;
    });
    host.querySelectorAll<HTMLElement>("[data-hour]").forEach((label) => {
      const hour = Number(label.dataset.hour);
      label.style.top = `${hour === 0 ? 8 : hour * hourPx}px`;
      if (label.hasAttribute("data-half-hour")) label.hidden = hourPx < HOUR_PX * 1.5;
    });
    host.querySelectorAll<HTMLElement>("[data-now-minute]").forEach((line) => {
      line.style.top = `${Number(line.dataset.nowMinute) / 60 * hourPx}px`;
    });
    const reset = host.querySelector<HTMLButtonElement>('[data-zoom="reset"]');
    const smaller = host.querySelector<HTMLButtonElement>('[data-zoom="out"]');
    const larger = host.querySelector<HTMLButtonElement>('[data-zoom="in"]');
    if (reset) reset.textContent = `${Math.round(hourPx / HOUR_PX * 100)}%`;
    if (smaller) smaller.disabled = hourPx <= MIN_HOUR_PX;
    if (larger) larger.disabled = hourPx >= MAX_HOUR_PX;
    scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, anchoredMinute / 60 * hourPx - offsetY));
    syncHeader();
    // Health hitboxes/lane occupancy depend on projected pixels. Recompute only
    // their private layer and the corresponding block inset, preserving the
    // scroll subtree used by native pinch delivery.
    travelLayer?.syncLines(hourPx);
    const data=opts.getData(),travelPad=TRAVEL_HIT/2/hourPx*3_600_000;
    const travelInset=(start:number,end:number)=>travelLayer?.travelLaneInset(start-travelPad,end+travelPad)??0;
    const health=healthLines(opts.getHealth?.()??null,hourPx,data.targets,travelInset);
    for(const column of host.querySelectorAll<HTMLElement>(".arrangement-day[data-date]")){
      const date=column.dataset.date!;
      column.querySelectorAll(".week-health-event").forEach(node=>node.remove());
      column.insertAdjacentHTML("beforeend",renderHealthLines(health,{date,start:instantForWall(date,0,data.zone),end:instantForWall(addDays(date,1),(VISIBLE_HOURS-24)*60,data.zone)},data.zone,hourPx,opts.getHealthSelection?.()??null));
      for(const block of column.querySelectorAll<HTMLElement>(".arrangement-action,.arrangement-session")){
        const id=block.dataset.actionId??block.dataset.sessionId;
        const record=block.dataset.actionId?data.actions.find(a=>a.id===id):data.sessions.find(s=>s.id===id);
        const session=record&&"sessionId" in record&&record.sessionId?data.sessions.find(s=>s.id===record.sessionId):null;
        const owner=session??record;
        const intervals=block.classList.contains("has-actual-intervals") && record && "intervals" in record ? actualIntervals(record) : [];
        const start=intervals.length?intervals[0].start:owner?.plannedStartAt?Date.parse(owner.plannedStartAt):null;
        const end=intervals.length?Math.max(...intervals.map(interval=>interval.end)):owner?.plannedEndAt?Date.parse(owner.plannedEndAt):null;
        const inset=start!==null&&end!==null?Math.max(healthInset(health,start,end),travelInset(start,end)):0;
        // Renderer retains the original fractional geometry in public data attrs.
        if(block.dataset.layoutLeft&&block.dataset.layoutWidth){const l=Number(block.dataset.layoutLeft),w=Number(block.dataset.layoutWidth);block.style.left=`calc(${l*100}% + ${4+inset*(1-l)}px)`;const width=`calc(${w*100}% - ${8+inset*w}px)`;block.style.width=inset?`max(12px,${width})`:width;}
        block.dataset.healthInset=String(inset);
      }
    }
    // Zoom keeps the existing week DOM for native pinch continuity, so travel's
    // pixel-projected overlay must be repainted explicitly just like Health.
    // Otherwise its positions retain the previous hourPx until another render.
    travelLayer?.renderIntoDays(hourPx, [...host.querySelectorAll<HTMLElement>(".arrangement-day[data-date]")].map((column) => {
      const date = column.dataset.date!;
      return { date, start: instantForWall(date, 0, data.zone), end: instantForWall(addDays(date, 1), (VISIBLE_HOURS - 24) * 60, data.zone) };
    }));
  }
  function onZoomClick(event: MouseEvent) {
    const checkpointToggle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-checkpoint-toggle]");
    if (checkpointToggle) {
      if (checkpointToggle.disabled) return;
      event.preventDefault(); event.stopPropagation();
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === checkpointToggle.dataset.checkpointToggle);
      if (checkpoint && opts.onToggleCheckpoint && !pendingCheckpointToggles.has(checkpoint.id)) {
        pendingCheckpointToggles.add(checkpoint.id);
        checkpointToggle.setAttribute("aria-disabled", "true");
        checkpointToggle.setAttribute("aria-busy", "true");
        if (checkpoint.completed) {
          setCheckbox(checkpointToggle, false);
        } else {
          setCheckboxWithCompletionFeedback(checkpointToggle, true);
        }
        void opts.onToggleCheckpoint(checkpoint).catch((error) => {
          const liveToggle = [...host.querySelectorAll<HTMLButtonElement>("[data-checkpoint-toggle]")]
            .find((candidate) => candidate.dataset.checkpointToggle === checkpoint.id) ?? checkpointToggle;
          setCheckbox(liveToggle, checkpoint.completed);
          opts.onError(error instanceof Error ? error.message : String(error));
        }).finally(() => {
          pendingCheckpointToggles.delete(checkpoint.id);
          const liveToggle = [...host.querySelectorAll<HTMLButtonElement>("[data-checkpoint-toggle]")]
            .find((candidate) => candidate.dataset.checkpointToggle === checkpoint.id);
          liveToggle?.removeAttribute("aria-disabled");
          liveToggle?.removeAttribute("aria-busy");
          safeRender();
        });
      }
      return;
    }
    const checkpointEl = (event.target as HTMLElement).closest<HTMLElement>("[data-checkpoint-id]");
    if (checkpointEl?.dataset.checkpointId) { event.preventDefault(); opts.onSelect({ kind: "checkpoint", id: checkpointEl.dataset.checkpointId }); return; }
    const health = (event.target as HTMLElement).closest<HTMLElement>("[data-health-id]");
    if (health?.dataset.healthId) { opts.onHealthSelect?.(health.dataset.healthId); return; }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".arrangement-zoom button[data-zoom]");
    if (!button || dragging || unscheduledDragging) return;
    event.preventDefault(); event.stopPropagation();
    const mode = button.dataset.zoom;
    const scroll = grid();
    if (!scroll) return;
    const index = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIndex() + (mode === "in" ? 1 : -1)));
    applyZoom(mode === "reset" ? HOUR_PX : HOUR_PX * ZOOM_LEVELS[index] / 100, scroll.getBoundingClientRect().top + scroll.clientHeight / 2);
  }
  function onZoomWheel(event: WheelEvent) {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || event.deltaY === 0 || dragging || unscheduledDragging) return;
    event.preventDefault();
    // WebView2 emits Ctrl+wheel for pinch only when native pinch input is enabled.
    // Accumulate small trackpad deltas; each threshold advances one approved level.
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? grid()?.clientHeight ?? 800 : 1);
    const now = performance.now();
    if (now - lastZoomWheel > 250 || Math.sign(wheelZoomDelta) !== Math.sign(delta)) wheelZoomDelta = 0;
    lastZoomWheel = now;
    wheelZoomDelta += delta;
    if (Math.abs(wheelZoomDelta) < 12) return;
    const index = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIndex() + (wheelZoomDelta < 0 ? 1 : -1)));
    wheelZoomDelta = 0;
    applyZoom(HOUR_PX * ZOOM_LEVELS[index] / 100, event.clientY);
  }
  type ScaleGesture = Event & { scale?: number; clientY?: number };
  function onGestureStart(event: Event) {
    event.preventDefault();
    gestureStartHour = hourPx;
  }
  function onGestureChange(event: Event) {
    event.preventDefault();
    const gesture = event as ScaleGesture;
    const scroll = grid();
    if (!scroll || !gesture.scale) return;
    applyZoom(gestureStartHour * gesture.scale, gesture.clientY ?? scroll.getBoundingClientRect().top + scroll.clientHeight / 2);
  }
  function onGestureEnd(event: Event) { event.preventDefault(); }
  function unscheduledCandidate(id: string, x: number, y: number): WeekMove | null {
    const column = columnAt(x);
    const action = opts.getData().actions.find((value) => value.id === id);
    const baseline = opts.getDraggedActionBaseline?.();
    if (!column || !action || !baseline || baseline.action.id !== id || action.intervals.length || action.ended) return null;
    let start = timeAt(column.date, minuteAtY(y));
    let end = start + (action.plannedDuration ? action.plannedDuration * 1000 : 3_600_000);
    const session = sessionAt(x, y);
    if (session) {
      ({ start, end } = clampIntoSession(start, end - start, session));
      const duration = end - start;
      const zone = opts.getData().zone;
      let snapped = timeAt(dateAt(start, zone), Math.round(minuteAt(start, zone) / 5) * 5);
      if (snapped < Date.parse(session.plannedStartAt)) snapped += 300_000;
      if (snapped + duration > Date.parse(session.plannedEndAt)) snapped -= 300_000;
      if (snapped < Date.parse(session.plannedStartAt) || snapped + duration > Date.parse(session.plannedEndAt)) return null;
      start = snapped;
      end = start + duration;
    }
    return { kind: "action", id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), sessionId: session?.id ?? null, baseline };
  }
  function inVisibleGrid(x: number, y: number): boolean {
    const rect = grid()?.getBoundingClientRect();
    return !!rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }
  function onDragOver(event: DragEvent) {
    if (!inVisibleGrid(event.clientX, event.clientY)) { clearUnscheduledDrag(); return; }
    if (event.dataTransfer?.types.includes("application/orbita-arrangement-checkpoint") && columnAt(event.clientX)) { event.preventDefault(); return; }
    if (!event.dataTransfer?.types.includes("application/orbita-arrangement-action") || !columnAt(event.clientX)) return;
    event.preventDefault();
    unscheduledDragging = true;
  }
  function onDrop(event: DragEvent) {
    if (!inVisibleGrid(event.clientX, event.clientY)) { clearUnscheduledDrag(); return; }
    const checkpointId = event.dataTransfer?.getData("application/orbita-arrangement-checkpoint");
    const checkpointColumn = columnAt(event.clientX);
    if (checkpointId && checkpointColumn) {
      event.preventDefault();
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === checkpointId);
      const baseline = opts.getDraggedCheckpointBaseline?.();
      if (!checkpoint || checkpoint.actualAtUtc || !checkpointWritable(checkpoint) || !baseline || baseline.checkpoint.id !== checkpoint.id) return;
      const plannedAt = timeAt(checkpointColumn.date, minuteAtY(event.clientY));
      const session = sessionAt(event.clientX, event.clientY);
      const sessionId = session && plannedAt >= Date.parse(session.plannedStartAt) && plannedAt < Date.parse(session.plannedEndAt) ? session.id : null;
      if (opts.onMoveCheckpoint) void opts.onMoveCheckpoint({ kind: "checkpoint", id: checkpoint.id, plannedAtUtc: new Date(plannedAt).toISOString(), sessionId, baseline })
        .catch((error) => opts.onError(error instanceof Error ? error.message : String(error)));
      return;
    }
    const id = event.dataTransfer?.getData("application/orbita-arrangement-action");
    const column = columnAt(event.clientX);
    unscheduledDragging = false;
    if (!id || !column) return;
    event.preventDefault();
    let candidate: WeekMove | null;
    try { candidate = unscheduledCandidate(id, event.clientX, event.clientY); }
    catch (error) { opts.onError(error instanceof Error ? error.message : String(error)); return; }
    if (!candidate) return;
    void submitMove(candidate);
  }
  function onDragLeave(event: DragEvent) {
    if (!host.contains(event.relatedTarget as Node | null)) unscheduledDragging = false;
  }
  function navigateFirst(day: string) {
    pendingScrollDay = null;
    first = addDays(day, -7);
    safeRender();
    const scroll = grid();
    if (scroll) scroll.scrollLeft = dayPx * 7;
    opts.onDay(day);
  }
  function navigate(day: string) { navigateFirst(mondayOf(day)); }
  host.addEventListener("scroll", onScroll, true);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("click", onZoomClick);
  host.addEventListener("wheel", onZoomWheel, { passive: false, capture: true });
  host.addEventListener("gesturestart", onGestureStart, { passive: false });
  host.addEventListener("gesturechange", onGestureChange, { passive: false });
  host.addEventListener("gestureend", onGestureEnd, { passive: false });
  host.addEventListener("dblclick", onDblClick);
  host.addEventListener("contextmenu", onContextMenu);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  host.addEventListener("lostpointercapture", onLostPointerCapture);
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("dragleave", onDragLeave);
  host.addEventListener("drop", onDrop);
  document.addEventListener("dragend", clearUnscheduledDrag);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const resizeObserver = new ResizeObserver(() => {
    if (!host.clientWidth) {
      hiddenLayout = true;
      clearTimeout(scrollTimer);
      if (pendingScrollDay) { opts.onDay(pendingScrollDay); pendingScrollDay = null; }
      return;
    }
    if (dragging) return;
    if (hiddenLayout) {
      hiddenLayout = false;
      // Hidden tabs have no measurable scroll geometry; restore the logical date when visible.
      navigateFirst(pendingScrollDay ?? opts.getDay());
      return;
    }
    const scroll = grid();
    if (!scroll) { safeRender(); return; }
    const priorDay = scroll.scrollLeft / dayPx;
    const viewportWidth = scroll.clientWidth;
    dayPx = Math.max(1, viewportWidth / 7);
    host.style.setProperty("--arrangement-day-width", `${dayPx}px`);
    host.style.setProperty("--arrangement-viewport-width", `${viewportWidth}px`);
    scroll.scrollLeft = priorDay * dayPx;
    syncHeader();
  });
  resizeObserver.observe(host);
  const nowTimer = window.setInterval(() => { if (!dragging && !disposed) safeRender(); }, 60_000);
  safeRender();
  return { render: safeRender, navigate, navigateFirst, syncTravelEditing, syncSelection, dispose() { disposed = true; unsubscribeAppearance(); dismissCreation?.(); clearDrag(); clearTimeout(scrollTimer); host.removeEventListener("scroll", onScroll, true);
    host.removeEventListener("pointerdown", onPointerDown); host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("click", onZoomClick); host.removeEventListener("wheel", onZoomWheel, true);
    host.removeEventListener("gesturestart", onGestureStart); host.removeEventListener("gesturechange", onGestureChange); host.removeEventListener("gestureend", onGestureEnd);
    host.removeEventListener("pointerup", onPointerUp); host.removeEventListener("pointercancel", onPointerCancel);
    host.removeEventListener("lostpointercapture", onLostPointerCapture);
    host.removeEventListener("dragover", onDragOver); host.removeEventListener("dragleave", onDragLeave); host.removeEventListener("drop", onDrop);
    document.removeEventListener("dragend", clearUnscheduledDrag);
    window.removeEventListener("keydown", onKeyDown, true); window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange); host.removeEventListener("dblclick", onDblClick); host.removeEventListener("contextmenu", onContextMenu);
    actionMenuControl?.dispose(); actionMenuAnchor?.remove(); actionMenuAnchor = null; travelLayer?.dispose(); resizeObserver.disconnect(); clearInterval(nowTimer); host.innerHTML = ""; } };
}
