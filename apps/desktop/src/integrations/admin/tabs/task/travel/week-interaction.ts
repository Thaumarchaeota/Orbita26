import { showCommandMenuAt } from "../../../../../ui/command-menu-popover";
import { mountDecoupledDateTimePicker, type DateTimeValue } from "../../../../../ui/decoupled-datetime-picker";
import { createInsightDialog } from "../../../../../ui/insight-dialog";
import type { TravelController } from "../../../../productivity/travel-v2/controller";
import { buildAppendPayload, newTravelMemberId } from "../../../../productivity/travel-v2/client";
import type { TravelEditPlanPayload, TravelEndpointSplitPolicy, TravelListWeekResult, TravelSplitPolicies, TripSnapshot } from "../../../../productivity/travel-v2/types";
import { dateAt, instantForWall, minuteAt, snapFive, type BusinessZone } from "../arrangement-model";
import {
  applyTravelDragPreview,
  buildTravelTripLines,
  connectedActionGroup,
  travelLaneInset,
  type TravelDragPreview,
  type TravelTripLine,
} from "./week-model";
import { renderTravelLinesForDay } from "./week-render";
import { travelHitFromTarget, type TravelHitKind } from "./week-hit";
import "./week-travel.css";

export type TravelWeekEditMode = {
  editingItemId: string | null;
  selectedItemId: string | null;
  focusedBlockId?: string | null;
};

export type TravelWeekLayerOptions = {
  getTravelListWeek?: () => TravelListWeekResult | null;
  getTravelSnapshot?: (itemId: string) => TripSnapshot | null | undefined;
  getTravelColor?: (itemId: string) => string;
  getTravelEditMode?: () => TravelWeekEditMode | null;
  getTravelController?: () => TravelController | null;
  onTravelEditPlan?: (itemId:string,payload:TravelEditPlanPayload)=>Promise<void>;
  getTravelSplitPolicies?: () => TravelSplitPolicies;
  /** Optional raw `AppSettings.ui` for split policy when getter absent. */
  getTravelUiSettings?: () => unknown;
  onTravelSelect?: (itemId: string, blockId?: string | null) => void | boolean | Promise<boolean>;
  onTravelEnterEdit?: (itemId: string) => void;
  onTravelExitEdit?: () => void;
  onTravelError?: (message: string) => void;
  zone: () => BusinessZone;
};

type DragState = {
  pointerId: number;
  itemId: string;
  pointerStartX?: number;
  pointerStartY?: number;
  appendMoved?: boolean;
  actionIds: string[];
  detached: boolean;
  originMs: number;
  originMinute: number;
  originDate: string;
  deltaMs: number;
  kind: "segment" | "checkpoint" | "actionBoundary" | "sharedBoundary" | "append";
  actionId?: string;
  pointId?: string;
  checkpointId?: string | null;
  boundaryActionId?: string;
  boundarySide?: "start" | "end";
  frontActionId?: string;
  rearActionId?: string;
  sharedZone?: "both" | "frontEnd" | "rearStart";
  appendStartMs?: number;
  appendEndMs?: number;
  planGeneration: number;
};

type TriggerTarget =
  | { kind: "boundary"; actionId: string; side: "start" | "end"; atUtc: string }
  | { kind: "checkpoint"; checkpointId: string; atUtc: string };

function dateTimeValue(atUtc: string, zone: BusinessZone): DateTimeValue {
  const ms = Date.parse(atUtc);
  const date = dateAt(ms, zone);
  const m = minuteAt(ms, zone);
  return { date, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
}

function completeDateTime(value: DateTimeValue): boolean {
  return Boolean(value.date && /^\d{2}:\d{2}$/.test(value.time));
}

function planLockedMessage(snap: TripSnapshot): string {
  return snap.capabilities.readOnlyReason?.trim() || "计划已锁定，无法调整时间。";
}

function boundaryActionForPoint(hit: Extract<TravelHitKind, { kind: "point" }>): { actionId: string; side: "start" | "end" } | null {
  if (hit.shared) return null;
  if (hit.role === "end" || hit.role === "single") {
    const actionId = hit.frontActionId ?? hit.ownerActionId;
    return actionId ? { actionId, side: "end" } : null;
  }
  const actionId = hit.rearActionId ?? hit.ownerActionId;
  return actionId ? { actionId, side: "start" } : null;
}

export function createTravelWeekLayer(host: HTMLElement, options: TravelWeekLayerOptions) {
  function queuePlan(controller:TravelController,itemId:string,payload:TravelEditPlanPayload):void {
    void (options.onTravelEditPlan?options.onTravelEditPlan(itemId,payload):controller.queueEditPlan(itemId,payload)).catch(error=>options.onTravelError?.(String(error)));
  }
  let lines: TravelTripLine[] = [];
  let dragging: DragState | null = null;
  let previewDeltaMs = 0;
  let paintHourPx = 56;
  let paintDays: Array<{ date: string; start: number; end: number }> = [];
  let menuCloser: (() => void) | null = null;
  let floatEl: HTMLElement | null = null;
  const pickerDisposers: Array<() => void> = [];
  let pickerOpen = false;

  let pendingSplit: { cancel: () => void; isCurrent: () => boolean } | null = null;
  let disposed = false;

  function selectTravel(itemId: string, blockId: string | null): void | boolean | Promise<boolean> {
    try {
      const result = options.onTravelSelect?.(itemId, blockId);
      if (result instanceof Promise) return result.catch((error) => {
        if (!disposed) options.onTravelError?.(error instanceof Error ? error.message : String(error));
        return false;
      });
      return result;
    } catch (error) {
      if (!disposed) options.onTravelError?.(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function snapshot(itemId: string): TripSnapshot | null {
    return options.getTravelSnapshot?.(itemId) ?? null;
  }

  function rebuildLines(): void {
    const list = options.getTravelListWeek?.();
    if (!list?.items.length) {
      lines = [];
      return;
    }
    lines = buildTravelTripLines({
      list,
      snapshotForItem: (id) => snapshot(id),
      colorForItem: options.getTravelColor,
      zone: options.zone(),
      hourPx: paintHourPx,
    });
  }

  function editMode(): TravelWeekEditMode | null {
    return options.getTravelEditMode?.() ?? null;
  }

  let editingFrame = 0;
  const inertBackground = new Set<HTMLElement>();
  let expectedCaptureLoss: number | null = null;

  function syncEditingChrome(animate = false): void {
    if (pendingSplit && !pendingSplit.isCurrent()) pendingSplit.cancel();
    const editing = Boolean(editMode()?.editingItemId);
    if (!editing && dragging) cancelDrag();
    host.querySelectorAll<HTMLElement>(".arrangement-day[data-date]").forEach((col) => {
      let glass = col.querySelector<HTMLElement>(".arrangement-week-glass");
      if (!glass) {
        glass = document.createElement("div");
        glass.className = "arrangement-week-glass";
        glass.setAttribute("aria-hidden", "true");
        const firstTrip = col.querySelector(".travel-week-trip");
        if (firstTrip) col.insertBefore(glass, firstTrip);
        else col.appendChild(glass);
      }
      glass.hidden = false;
    });
    host.querySelector(".arrangement-grid-scroll > .arrangement-week-glass")?.remove();
    const background = host.querySelector<HTMLElement>(".arrangement-days");
    if (background) {
      background.querySelectorAll<HTMLElement>(
        ".arrangement-action, .arrangement-checkpoint, .arrangement-session, .week-health-event, .week-health-segment, .week-health-point",
      ).forEach((node) => {
        if (editing && !node.hasAttribute("inert")) {
          node.setAttribute("inert", "");
          inertBackground.add(node);
        }
      });
    }
    if (!editing) {
      inertBackground.forEach((node) => node.removeAttribute("inert"));
      inertBackground.clear();
    }
    if (!animate) {
      host.classList.toggle("is-travel-editing", editing);
      return;
    }
    // A full week rebuild inserts the glass already in the end state, so the
    // opacity transition never runs. Toggle the class on the existing nodes.
    editingFrame += 1;
    const frame = editingFrame;
    host.classList.remove("is-travel-editing");
    if (!editing) return;
    void host.offsetWidth;
    requestAnimationFrame(() => {
      if (frame !== editingFrame || !editMode()?.editingItemId) return;
      host.classList.add("is-travel-editing");
    });
  }

  function dragPreviewPayload(): TravelDragPreview | null {
    if (!dragging) return null;
    return {
      itemId: dragging.itemId,
      kind: dragging.kind,
      actionIds: dragging.actionIds,
      checkpointId: dragging.checkpointId,
      boundaryActionId: dragging.boundaryActionId,
      boundarySide: dragging.boundarySide,
      frontActionId: dragging.frontActionId,
      rearActionId: dragging.rearActionId,
      sharedZone: dragging.sharedZone,
      appendStartMs: dragging.appendStartMs,
      appendEndMs: dragging.appendEndMs,
    };
  }

  function linesForPaint(): TravelTripLine[] {
    if (!dragging) return lines;
    const payload = dragPreviewPayload();
    if (!payload) return lines;
    if (dragging.kind === "append") {
      if (dragging.appendStartMs == null || dragging.appendEndMs == null) return lines;
      return applyTravelDragPreview(lines, payload, 0);
    }
    if (!previewDeltaMs) return lines;
    return applyTravelDragPreview(lines, payload, previewDeltaMs);
  }

  function paintTravelIntoDays(hourPx: number, days: Array<{ date: string; start: number; end: number }>): number {
    const mode = editMode();
    const selected = mode?.selectedItemId ?? null;
    const editing = mode?.editingItemId ?? null;
    const zone = options.zone();
    const painted = linesForPaint();
    let maxInset = 0;
    for (const day of days) {
      const col = host.querySelector<HTMLElement>(`.arrangement-day[data-date="${day.date}"]`);
      if (!col) continue;
      col.querySelectorAll(".travel-week-trip").forEach((n) => n.remove());
      const dragEndpoint = dragging && !pendingSplit && (dragging.kind === "actionBoundary" || dragging.kind === "sharedBoundary" || dragging.kind === "checkpoint")
        ? { itemId: dragging.itemId, instant: dragging.originMs + previewDeltaMs }
        : null;
      const html = renderTravelLinesForDay(painted, day, zone, hourPx, selected, editing, dragEndpoint);
      const glass = col.querySelector<HTMLElement>(".arrangement-week-glass");
      if (html) {
        if (glass) glass.insertAdjacentHTML("afterend", html);
        else col.insertAdjacentHTML("beforeend", html);
      }
      if (glass) {
        const firstTrip = col.querySelector(".travel-week-trip");
        if (firstTrip && glass.nextElementSibling !== firstTrip) col.insertBefore(glass, firstTrip);
      }
      maxInset = Math.max(maxInset, travelLaneInset(painted, day.start, day.end));
    }
    return maxInset;
  }

  function renderIntoDays(hourPx: number, days: Array<{ date: string; start: number; end: number }>): number {
    paintHourPx = hourPx;
    rebuildLines();
    paintDays = days;
    syncEditingChrome();
    return paintTravelIntoDays(hourPx, days);
  }

  function clearFloat(): void {
    while (pickerDisposers.length) pickerDisposers.pop()?.();
    pickerOpen = false;
    floatEl?.remove();
    floatEl = null;
  }

  function showTimeFloat(clientX: number, clientY: number, itemId: string, targets: TriggerTarget[]): void {
    clearFloat();
    const controller = options.getTravelController?.();
    if (!controller || !editMode()?.editingItemId) return;
    const generation = controller.getPlanEditGeneration();
    floatEl = document.createElement("div");
    floatEl.className = "travel-week-time-float";
    floatEl.style.left = `${clientX + 12}px`;
    floatEl.style.top = `${clientY + 12}px`;
    document.body.appendChild(floatEl);

    const zone = options.zone();
    for (const target of targets) {
      const row = document.createElement("div");
      row.className = "travel-week-time-trigger-row";
      const label = document.createElement("label");
      label.textContent = target.kind === "checkpoint" ? "检查点时间" : target.side === "start" ? "段开始" : "段结束";
      const slot = document.createElement("div");
      row.append(label, slot);
      floatEl.append(row);
      const initial = dateTimeValue(target.atUtc, zone);
      const picker = mountDecoupledDateTimePicker({
        commitMode: "change",
        value: initial,
        defaultTrigger: { container: slot },
        onOpenChange: (open) => {
          pickerOpen = open;
        },
        onChange: (value) => {
          if (!completeDateTime(value)) return;
          if (controller.getPlanEditGeneration() !== generation) return;
          const [h, m] = value.time.split(":").map(Number);
          const atUtc = new Date(instantForWall(value.date, h * 60 + m, zone)).toISOString();
          const edit =
            target.kind === "checkpoint"
              ? { kind: "moveCheckpoint" as const, checkpointId: target.checkpointId, plannedAtUtc: atUtc, planEditGeneration: generation }
              : {
                  kind: "setBoundary" as const,
                  actionId: target.actionId,
                  side: target.side,
                  plannedAtUtc: atUtc,
                  planEditGeneration: generation,
                };
          queuePlan(controller,itemId, { edit });
        },
      });
      pickerDisposers.push(() => picker.dispose());
    }
  }

  function commitDrag(pointerX: number, pointerY: number, policies: TravelSplitPolicies = { movingFrontEnd: "copy", movingRearStart: "copy" }): void {
    if (!dragging) return;
    const controller = options.getTravelController?.();
    const snap = snapshot(dragging.itemId);
    if (!controller || !snap) return;
    if (controller.getPlanEditGeneration() !== dragging.planGeneration) return;
    const generation = dragging.planGeneration;
    const targets: TriggerTarget[] = [];

    if (dragging.kind === "append") {
      if (!dragging.appendMoved) return;
      const startMs = dragging.appendStartMs;
      const endMs = dragging.appendEndMs;
      if (startMs == null || endMs == null || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        options.onTravelError?.("新增行程段的时间范围无效");
        return;
      }
      if (!snap.capabilities.canAppend) {
        options.onTravelError?.(planLockedMessage(snap));
        return;
      }
      if (startMs < Date.now()) {
        options.onTravelError?.("只能在未来时间追加行程段");
        return;
      }
      controller.queueAppend(
        dragging.itemId,
        buildAppendPayload("action", {
          actionId: newTravelMemberId(),
          transportationId: newTravelMemberId(),
          startPointId: newTravelMemberId(),
          endPointId: newTravelMemberId(),
          plannedStartAt: new Date(startMs).toISOString(),
          plannedEndAt: new Date(endMs).toISOString(),
        }),
      );
      return;
    }

    if (previewDeltaMs === 0) return;

    if (dragging.kind === "actionBoundary" && dragging.boundaryActionId && dragging.boundarySide) {
      if (!snap.capabilities.canEditPlan) {
        options.onTravelError?.(planLockedMessage(snap));
        return;
      }
      const atUtc = new Date(dragging.originMs + previewDeltaMs).toISOString();
      queuePlan(controller,dragging.itemId, {
        edit: {
          kind: "setBoundary",
          actionId: dragging.boundaryActionId,
          side: dragging.boundarySide,
          plannedAtUtc: atUtc,
          planEditGeneration: generation,
        },
      });
      targets.push({
        kind: "boundary",
        actionId: dragging.boundaryActionId,
        side: dragging.boundarySide,
        atUtc,
      });
      showTimeFloat(pointerX, pointerY, dragging.itemId, targets);
      return;
    }

    if (dragging.kind === "sharedBoundary" && dragging.frontActionId && dragging.rearActionId && dragging.sharedZone) {
      if (!snap.capabilities.canEditPlan) {
        options.onTravelError?.(planLockedMessage(snap));
        return;
      }
      const atUtc = new Date(dragging.originMs + previewDeltaMs).toISOString();
      queuePlan(controller,dragging.itemId, {
        edit: {
          kind: "setSharedBoundary",
          frontActionId: dragging.frontActionId,
          rearActionId: dragging.rearActionId,
          zone: dragging.sharedZone,
          plannedAtUtc: atUtc,
          planEditGeneration: generation,
          ...(dragging.sharedZone === "both" ? {} : { splitPolicies: policies }),
        },
      });
      if (dragging.sharedZone !== "rearStart") {
        targets.push({
          kind: "boundary",
          actionId: dragging.frontActionId,
          side: "end",
          atUtc,
        });
      }
      if (dragging.sharedZone !== "frontEnd") {
        targets.push({
          kind: "boundary",
          actionId: dragging.rearActionId,
          side: "start",
          atUtc,
        });
      }
      showTimeFloat(pointerX, pointerY, dragging.itemId, targets);
      return;
    }

    const deltaMinutes = Math.round(previewDeltaMs / 60_000);
    if (!deltaMinutes) return;

    if (dragging.kind === "checkpoint" && dragging.checkpointId) {
      if (!snap.capabilities.canEditPlan) {
        options.onTravelError?.(planLockedMessage(snap));
        return;
      }
      const cp = snap.checkpoints.find((c) => c.id === dragging.checkpointId);
      if (!cp) return;
      const atUtc = new Date(Date.parse(cp.plannedAtUtc) + previewDeltaMs).toISOString();
      queuePlan(controller,dragging.itemId, {
        edit: { kind: "moveCheckpoint", checkpointId: cp.id, plannedAtUtc: atUtc, planEditGeneration: generation },
      });
      targets.push({ kind: "checkpoint", checkpointId: cp.id, atUtc });
      showTimeFloat(pointerX, pointerY, dragging.itemId, targets);
      return;
    }

    if (!snap.capabilities.canEditStructure) {
      options.onTravelError?.(planLockedMessage(snap));
      return;
    }
    const edit = dragging.detached
      ? { kind: "moveDetached" as const, actionId: dragging.actionIds[0], deltaMinutes, splitPolicies: policies }
      : { kind: "moveGroup" as const, actionIds: dragging.actionIds, deltaMinutes, splitPolicies: policies };
    queuePlan(controller,dragging.itemId, { edit });
    for (const actionId of dragging.actionIds) {
      const action = snap.actions.find((a) => a.id === actionId);
      if (!action) continue;
      const startMs = Date.parse(action.plannedStartAt) + previewDeltaMs;
      const endMs = Date.parse(action.plannedEndAt) + previewDeltaMs;
      targets.push({ kind: "boundary", actionId, side: "start", atUtc: new Date(startMs).toISOString() });
      targets.push({ kind: "boundary", actionId, side: "end", atUtc: new Date(endMs).toISOString() });
    }
    showTimeFloat(pointerX, pointerY, dragging.itemId, targets);
  }

  function beginEmptyAppendDrag(event: PointerEvent, itemId: string, controller: TravelController): boolean {
    const snap = snapshot(itemId);
    if (!snap) return false;
    if (!snap.capabilities.canAppend) return false;
    const date = columnDate(event.clientX);
    if (!date) return false;
    const zone = options.zone();
    const body = host.querySelector<HTMLElement>(".arrangement-days");
    if (!body) return false;
    const hourPx = parseFloat(host.style.getPropertyValue("--arrangement-hour-height")) || 56;
    const minute = Math.min(28 * 60, Math.max(0, Math.round(((event.clientY - body.getBoundingClientRect().top) / hourPx * 60) / 5) * 5));
    const originMs = instantForWall(date, minute, zone);
    dragging = {
      pointerId: event.pointerId,
      itemId,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      appendMoved: false,
      actionIds: [],
      detached: false,
      originMs,
      originMinute: minute,
      originDate: date,
      deltaMs: 0,
      kind: "append",
      appendStartMs: originMs,
      appendEndMs: originMs + 5 * 60_000,
      planGeneration: controller.getPlanEditGeneration(),
    };
    previewDeltaMs = 0;
    host.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    paintTravelIntoDays(paintHourPx, paintDays);
    return true;
  }

  function tryPointerDown(event: PointerEvent): boolean {
    if (pendingSplit) return true;
    if (event.button !== 0) return false;
    if (pickerOpen) return false;
    const hit = travelHitFromTarget(event.target as HTMLElement, event.clientY);
    const mode = editMode();
    const editingItemId = mode?.editingItemId ?? null;

    if (!hit || hit.kind === "empty") {
      if (!editingItemId) return false;
      if (hit?.kind === "empty" && hit.itemId && hit.itemId !== editingItemId) {
        void selectTravel(hit.itemId, null);
        return true;
      }
      const controller = options.getTravelController?.();
      if (!controller) {
        options.onTravelError?.("出行控制器未就绪");
        return true;
      }
      if (beginEmptyAppendDrag(event, editingItemId, controller)) {
        return true;
      }
      const snap = snapshot(editingItemId);
      if (!snap) {
        options.onTravelError?.("无法加载出行行程，请刷新后重试");
      } else if (!snap.capabilities.canAppend) {
        options.onTravelError?.(planLockedMessage(snap));
      } else {
        options.onTravelError?.("无法在此添加行程段");
      }
      return true;
    }

    if (!editingItemId || editingItemId !== hit.itemId) {
      if (hit.itemId) {
        void selectTravel(
          hit.itemId,
          hit.kind === "segment" ? hit.actionId : hit.kind === "point" ? hit.pointId : null,
        );
      }
      return Boolean(hit.itemId);
    }
    const snap = snapshot(hit.itemId);
    const controller = options.getTravelController?.();
    if (!snap || !controller) return true;
    if (hit.kind === "point" && hit.checkpointId) {
      const cp = snap.checkpoints.find((c) => c.id === hit.checkpointId);
      if (!cp) return true;
      if (!snap.capabilities.canEditPlan) {
        options.onTravelError?.(planLockedMessage(snap));
        return true;
      }
      const cpMs = Date.parse(cp.plannedAtUtc);
      const zone = options.zone();
      dragging = {
        pointerId: event.pointerId,
        itemId: hit.itemId,
        actionIds: [],
        detached: true,
        originMs: cpMs,
        originMinute: minuteAt(cpMs, zone),
        originDate: dateAt(cpMs, zone),
        deltaMs: 0,
        kind: "checkpoint",
        checkpointId: hit.checkpointId,
        planGeneration: controller.getPlanEditGeneration(),
      };
      previewDeltaMs = 0;
      host.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (hit.kind === "point") {
      if (!snap.capabilities.canEditPlan) {
        options.onTravelError?.(planLockedMessage(snap));
        return true;
      }
      const canonical = snap.canonicalPoints.find((p) => p.pointId === hit.pointId);
      const originMs = canonical ? Date.parse(canonical.plannedAtUtc) : NaN;
      if (!Number.isFinite(originMs)) return true;
      const zone = options.zone();
      if (hit.shared && hit.frontActionId && hit.rearActionId) {
        dragging = {
          pointerId: event.pointerId,
          itemId: hit.itemId,
          actionIds: [],
          detached: false,
          originMs,
          originMinute: minuteAt(originMs, zone),
          originDate: dateAt(originMs, zone),
          deltaMs: 0,
          kind: "sharedBoundary",
          frontActionId: hit.frontActionId,
          rearActionId: hit.rearActionId,
          sharedZone: hit.zone ?? "both",
          planGeneration: controller.getPlanEditGeneration(),
        };
      } else {
        const boundary = boundaryActionForPoint(hit);
        if (!boundary) return true;
        dragging = {
          pointerId: event.pointerId,
          itemId: hit.itemId,
          actionIds: [],
          detached: false,
          originMs,
          originMinute: minuteAt(originMs, zone),
          originDate: dateAt(originMs, zone),
          deltaMs: 0,
          kind: "actionBoundary",
          boundaryActionId: boundary.actionId,
          boundarySide: boundary.side,
          planGeneration: controller.getPlanEditGeneration(),
        };
      }
      previewDeltaMs = 0;
      host.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (hit.kind !== "segment") return true;
    if (!snap.capabilities.canEditStructure) {
      options.onTravelError?.(planLockedMessage(snap));
      return true;
    }
    const detached = event.altKey;
    const group = detached ? [hit.actionId] : connectedActionGroup(hit.itemId, hit.actionId, snap);
    dragging = {
      pointerId: event.pointerId,
      itemId: hit.itemId,
      actionIds: group,
      detached,
      originMs: 0,
      originMinute: 0,
      originDate: "",
      deltaMs: 0,
      kind: "segment",
      actionId: hit.actionId,
      planGeneration: controller.getPlanEditGeneration(),
    };
    previewDeltaMs = 0;
    host.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function columnDate(clientX: number): string | null {
    const days = host.querySelectorAll<HTMLElement>(".arrangement-day[data-date]");
    for (const day of days) {
      const rect = day.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) return day.dataset.date ?? null;
    }
    return null;
  }

  function onPointerMove(event: PointerEvent): void {
    if (pendingSplit) return;
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const zone = options.zone();
    const date = columnDate(event.clientX);
    if (!date) return;
    const body = host.querySelector<HTMLElement>(".arrangement-days");
    if (!body) return;
    if (dragging.kind === "append" && !dragging.appendMoved) {
      const dx = event.clientX - (dragging.pointerStartX ?? event.clientX);
      const dy = event.clientY - (dragging.pointerStartY ?? event.clientY);
      if (Math.hypot(dx, dy) < 4) return;
      dragging.appendMoved = true;
    }
    const hourPx = parseFloat(host.style.getPropertyValue("--arrangement-hour-height")) || 56;
    const minute = Math.min(28 * 60, Math.max(0, Math.round(((event.clientY - body.getBoundingClientRect().top) / hourPx * 60) / 5) * 5));
    const at = instantForWall(date, minute, zone);
    if (dragging.kind === "append") {
      const anchor = dragging.originMs;
      let startMs = Math.min(anchor, at);
      let endMs = Math.max(anchor, at);
      const minDur = 5 * 60_000;
      if (endMs - startMs < minDur) endMs = startMs + minDur;
      dragging.appendStartMs = startMs;
      dragging.appendEndMs = endMs;
      paintTravelIntoDays(paintHourPx, paintDays);
      return;
    }
    if (!dragging.originDate) {
      dragging.originDate = date;
      dragging.originMinute = minute;
      if (!dragging.originMs) dragging.originMs = at;
      return;
    }
    const dayDelta = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dragging.originDate}T00:00:00Z`)) / 86_400_000;
    const deltaMinute = minute - dragging.originMinute + dayDelta * 1440;
    previewDeltaMs = snapFive(deltaMinute * 60_000);
    paintTravelIntoDays(paintHourPx, paintDays);
  }

  function onPointerUp(event: PointerEvent): void {
    if (pendingSplit) return;
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    if (dragging.kind === "append" && !dragging.appendMoved) {
      const dx = event.clientX - (dragging.pointerStartX ?? event.clientX);
      const dy = event.clientY - (dragging.pointerStartY ?? event.clientY);
      if (Math.hypot(dx, dy) >= 4) onPointerMove(event);
    }
    expectedCaptureLoss = event.pointerId;
    host.releasePointerCapture(event.pointerId);
    if (previewDeltaMs && requestSplitPolicies(event.clientX, event.clientY)) return;
    commitDrag(event.clientX, event.clientY);
    dragging = null;
    previewDeltaMs = 0;
    paintTravelIntoDays(paintHourPx, paintDays);
  }

  function cancelDrag(pointerId?: number): void {
    if (!dragging || (pointerId != null && dragging.pointerId !== pointerId)) return;
    if (pendingSplit) { pendingSplit.cancel(); return; }
    const capturedPointerId = dragging.pointerId;
    dragging = null;
    previewDeltaMs = 0;
    if (host.hasPointerCapture(capturedPointerId)) host.releasePointerCapture(capturedPointerId);
    if (!disposed && host.isConnected) paintTravelIntoDays(paintHourPx, paintDays);
  }

  function onLostPointerCapture(pointerId: number): void {
    if (expectedCaptureLoss === pointerId) { expectedCaptureLoss = null; return; }
    cancelDrag(pointerId);
  }

  function requestSplitPolicies(x: number, y: number): boolean {
    const drag = dragging;
    const controller = options.getTravelController?.();
    const snap = drag && snapshot(drag.itemId);
    if (!drag || !controller || !snap) return false;
    const keys: Array<keyof TravelSplitPolicies> = [];
    if (drag.kind === "sharedBoundary" && drag.sharedZone !== "both") {
      if (drag.sharedZone === "frontEnd") keys.push("movingFrontEnd");
      if (drag.sharedZone === "rearStart") keys.push("movingRearStart");
    } else if (drag.kind === "segment" && drag.detached) {
      const actionId = drag.actionIds[0];
      if (snap.canonicalPoints.some(p => p.frontActionId && p.rearActionId === actionId)) keys.push("movingRearStart");
      if (snap.canonicalPoints.some(p => p.frontActionId === actionId && p.rearActionId)) keys.push("movingFrontEnd");
    }
    if (!keys.length) return false;

    const dataDir = controller.getState().expectedDataDir;
    const contextEpoch = controller.getState().contextEpoch;
    const memberRefs = JSON.stringify(snap.memberRefs);
    const policies: TravelSplitPolicies = { movingFrontEnd: "copy", movingRearStart: "copy" };
    let active = true;
    let menu: ReturnType<typeof showCommandMenuAt> | null = null;
    const stillCurrent = () => !disposed && host.isConnected && dragging === drag
      && options.getTravelController?.() === controller && controller.getState().expectedDataDir === dataDir
      && controller.getState().contextEpoch === contextEpoch
      && controller.getPlanEditGeneration() === drag.planGeneration
      && editMode()?.editingItemId === drag.itemId && editMode()?.selectedItemId === drag.itemId
      && JSON.stringify(snapshot(drag.itemId)?.memberRefs) === memberRefs;
    const finish = (commit: boolean) => {
      if (!active) return;
      active = false;
      pendingSplit = null;
      menu?.dispose();
      menu = null;
      if (commit && stillCurrent()) commitDrag(x, y, policies);
      dragging = null;
      previewDeltaMs = 0;
      if (!disposed && host.isConnected) paintTravelIntoDays(paintHourPx, paintDays);
    };
    pendingSplit = { cancel: () => finish(false), isCurrent: stillCurrent };
    paintTravelIntoDays(paintHourPx, paintDays);
    const choose = (index: number) => {
      if (!active || !stillCurrent()) { finish(false); return; }
      const key = keys[index];
      const label = key === "movingFrontEnd" ? "前段终点" : "后段起点";
      let selected: TravelEndpointSplitPolicy | null = null;
      let closed = false;
      menu = showCommandMenuAt(x, y, [
        { value: "copy", label: `${label}：复制两端` },
        { value: "front", label: `${label}：给前段` },
        { value: "rear", label: `${label}：给后段` },
      ], value => { if (value === "copy" || value === "front" || value === "rear") selected = value; }, {
        onClose: () => {
          if (closed) return;
          closed = true;
          menu = null;
          if (!active) return;
          if (!selected || !stillCurrent()) { finish(false); return; }
          policies[key] = selected;
          if (index + 1 < keys.length) choose(index + 1);
          else finish(true);
        },
      });
    };
    choose(0);
    return true;
  }

  /** F1: menu placement time from column + Y; if column missing, use now ISO. */
  function menuAnchorInstantMs(event: MouseEvent): number {
    const zone = options.zone();
    const date = columnDate(event.clientX);
    if (!date) return Date.now();
    const body = host.querySelector<HTMLElement>(".arrangement-days");
    if (!body) return Date.now();
    const hourPx = parseFloat(host.style.getPropertyValue("--arrangement-hour-height")) || 56;
    const minute = Math.min(28 * 60, Math.max(0, Math.round(((event.clientY - body.getBoundingClientRect().top) / hourPx * 60) / 5) * 5));
    try {
      return instantForWall(date, minute, zone);
    } catch {
      return Date.now();
    }
  }

  function defaultSegmentRangeMs(event: MouseEvent, hit: ReturnType<typeof travelHitFromTarget>): { startMs: number; endMs: number } {
    const snap = hit?.itemId ? snapshot(hit.itemId) : null;
    if (hit?.kind === "segment" && snap) {
      const action = snap.actions.find((entry) => entry.id === hit.actionId);
      if (action) {
        const startMs = Date.parse(action.plannedStartAt);
        const endMs = Date.parse(action.plannedEndAt);
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
          const mid = Math.round((startMs + endMs) / 2);
          return { startMs: mid - 30 * 60_000, endMs: mid + 30 * 60_000 };
        }
      }
    }
    const center = menuAnchorInstantMs(event);
    return { startMs: center - 30 * 60_000, endMs: center + 30 * 60_000 };
  }

  function confirmDeleteStage(itemId: string, actionId: string, controller: TravelController): void {
    const snap = snapshot(itemId);
    const action = snap?.actions.find((entry) => entry.id === actionId);
    const endpointCanBeDeleted = (role: "start" | "end"): boolean => {
      if (!snap || !action) return false;
      const atUtc = role === "start" ? action.plannedStartAt : action.plannedEndAt;
      const atMs = Date.parse(atUtc);
      if (!Number.isFinite(atMs)) return false;
      const point = snap.canonicalPoints.find((entry) => Date.parse(entry.plannedAtUtc) === atMs);
      if (!point) return false;
      const isThisEndpoint = role === "start"
        ? point.rearActionId === actionId || (point.rearActionId === null && point.ownerActionId === actionId)
        : point.frontActionId === actionId || (point.frontActionId === null && point.ownerActionId === actionId);
      if (!isThisEndpoint) return false;
      return point.ownerCheckpointId === null
        && [point.frontActionId, point.rearActionId, point.ownerActionId]
          .every((userActionId) => userActionId === null || userActionId === actionId);
    };
    const canDeleteStart = endpointCanBeDeleted("start");
    const canDeleteEnd = endpointCanBeDeleted("end");
    const deleteChoices = [
      { value: "stage-only", label: "仅删除段" },
      ...(canDeleteStart ? [{ value: "with-start", label: "同时删除起点" }] : []),
      ...(canDeleteEnd ? [{ value: "with-end", label: "同时删除终点" }] : []),
      ...(canDeleteStart && canDeleteEnd ? [{ value: "with-both", label: "同时删除两端点" }] : []),
    ];
    const dlg = createInsightDialog({
      title: "删除段",
      bodyHtml: `
        <p class="insight-dialog-hint">确认删除该行程段。仅可连删删除后不再被引用的端点。</p>
        <fieldset class="insight-dialog-field">
          <legend class="insight-dialog-label">删除范围</legend>
          ${deleteChoices.map(({ value, label }, index) => `<label class="insight-dialog-choice"><input type="radio" name="travel-delete-stage" value="${value}"${index === 0 ? " checked" : ""}> ${label}</label>`).join("")}
        </fieldset>`,
      submitLabel: "删除",
      dangerSubmit: true,
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      dlg.dispose();
    };
    dlg.bindChrome(finish);
    dlg.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      if (dlg.busy) return;
      const selected = dlg.panel.querySelector<HTMLInputElement>('input[name="travel-delete-stage"]:checked')?.value ?? "stage-only";
      const deleteStartPoint = selected === "with-start" || selected === "with-both";
      const deleteEndPoint = selected === "with-end" || selected === "with-both";
      dlg.setBusy(true);
      try {
        controller.queueDeleteStage(itemId, {
          actionId,
          deleteStartPoint,
          deleteEndPoint,
        });
        void dlg.close().then(finish);
      } catch (error) {
        dlg.setError(error instanceof Error ? error.message : String(error));
        dlg.setBusy(false);
      }
    });
    void dlg.open();
  }

  function onContextMenu(event: MouseEvent): boolean {
    const hit = travelHitFromTarget(event.target as HTMLElement, event.clientY);
    const mode = editMode();
    if (!mode?.editingItemId) return false;
    const itemId = hit?.itemId ?? mode.editingItemId;
    if (!itemId || itemId !== mode.editingItemId) return false;
    event.preventDefault();
    event.stopPropagation();
    menuCloser?.();
    const items = [
      { value: "add-flight", label: "添加航班" },
      { value: "add-train", label: "添加火车" },
      { value: "add-segment", label: "添加行程段" },
      { value: "add-cp", label: "添加检查点" },
      ...(hit?.kind === "segment" ? [{ value: "delete-stage", label: "删除段", danger: true }] : []),
      ...(hit?.kind === "point" && hit.checkpointId ? [{ value: "delete-cp", label: "删除检查点", danger: true }] : []),
    ];
    const menu = showCommandMenuAt(event.clientX, event.clientY, items, (value) => {
      menuCloser = null;
      const controller = options.getTravelController?.();
      if (!controller) {
        options.onTravelError?.("出行控制器未就绪");
        return;
      }
      const snap = snapshot(itemId);
      if (!snap) {
        options.onTravelError?.("无法加载出行行程，请刷新后重试");
        return;
      }
      try {
        if (value === "delete-cp") {
          if (hit?.kind !== "point" || !hit.checkpointId) return;
          controller.queueDeleteCheckpoint(itemId, { checkpointId: hit.checkpointId });
          return;
        }
        if (value === "delete-stage") {
          if (hit?.kind !== "segment") return;
          confirmDeleteStage(itemId, hit.actionId, controller);
          return;
        }
        if (value === "add-cp") {
          const checkpointCount = snap.checkpoints.filter((entry) => !entry.deletedAtUtc).length;
          const anchorMs = menuAnchorInstantMs(event);
          // F1: click column time when available; otherwise now.
          const plannedAtUtc = new Date(anchorMs).toISOString();
          controller.queueAppend(
            itemId,
            buildAppendPayload("checkpoint", {
              checkpointId: newTravelMemberId(),
              pointId: newTravelMemberId(),
              plannedAtUtc,
              title: `检查点 ${checkpointCount + 1}`,
            }),
          );
          return;
        }
        if (value === "add-flight" || value === "add-train" || value === "add-segment") {
          const { startMs, endMs } = defaultSegmentRangeMs(event, hit);
          const kind = value === "add-flight" ? "flight" : value === "add-train" ? "train" : "action";
          controller.queueAppend(
            itemId,
            buildAppendPayload(kind, {
              actionId: newTravelMemberId(),
              transportationId: newTravelMemberId(),
              startPointId: newTravelMemberId(),
              endPointId: newTravelMemberId(),
              plannedStartAt: new Date(startMs).toISOString(),
              plannedEndAt: new Date(endMs).toISOString(),
            }),
          );
        }
      } catch (error) {
        options.onTravelError?.(error instanceof Error ? error.message : String(error));
      }
    });
    menuCloser = () => menu.dispose();
    return true;
  }

  function onDblClick(event: MouseEvent): boolean {
    const hit = travelHitFromTarget(event.target as HTMLElement, event.clientY);
    if (!hit?.itemId) return false;
    event.preventDefault();
    event.stopPropagation();
    const blockId = hit.kind === "segment"
      ? hit.actionId
      : hit.kind === "point"
        ? hit.pointId
        : null;
    const selected = selectTravel(hit.itemId, blockId);
    if (selected instanceof Promise) {
      void selected.then((accepted) => {
        if (!disposed && accepted) options.onTravelEnterEdit?.(hit.itemId!);
      });
    } else if (selected !== false) options.onTravelEnterEdit?.(hit.itemId);
    return true;
  }

  function onKeyDown(event: KeyboardEvent): boolean {
    if (event.key !== "Escape") return false;
    if (pickerOpen) return false;
    if (dragging) { cancelDrag(); return true; }
    const editing = editMode()?.editingItemId;
    if (!editing) return false;
    clearFloat();
    options.onTravelExitEdit?.();
    return true;
  }

  function dispose(): void {
    disposed = true;
    pendingSplit?.cancel();
    cancelDrag();
    editingFrame += 1;
    inertBackground.forEach((node) => node.removeAttribute("inert"));
    inertBackground.clear();
    clearFloat();
    menuCloser?.();
    menuCloser = null;
    host.classList.remove("is-travel-editing");
    host.querySelectorAll(".arrangement-week-glass").forEach((node) => node.remove());
  }

  return {
    syncLines: (hourPx?: number) => { if (hourPx != null) paintHourPx = hourPx; rebuildLines(); },
    renderIntoDays,
    syncEditing: (animate = false) => syncEditingChrome(animate),
    travelLaneInset: (start: number, end: number) => travelLaneInset(lines, start, end),
    tryPointerDown,
    onPointerMove,
    onPointerUp,
    cancelDrag,
    onLostPointerCapture,
    onContextMenu,
    onDblClick,
    onKeyDown,
    dispose,
    getLines: () => lines,
  };
}
