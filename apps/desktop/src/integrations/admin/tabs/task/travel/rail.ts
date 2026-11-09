import { createButton } from "../../../../../ui/button";
import { createCheckbox, readCheckbox, setCheckbox, setCheckboxWithCompletionFeedback } from "../../../../../ui/checkbox";
import { runButtonAction } from "../../../../../ui/action-motion";
import { mountDecoupledDatePicker } from "../../../../../ui/decoupled-date-picker";
import { mountDecoupledDateTimePicker, type DateTimeValue } from "../../../../../ui/decoupled-datetime-picker";
import { mountDecoupledDateTimeRangePicker } from "../../../../../ui/decoupled-datetime-range-picker";
import { mountInlineTextField } from "../../../../../ui/inline-text-field";
import { mountLoadingIndicator } from "../../../../../ui/loading-indicator";
import { mountPopoverPortal } from "../../../../../ui/popover-portal";
import { mountSelectField } from "../../../../../ui/select-field";
import { mountFlatSelectPopover } from "../../../../../ui/flat-select-popover";
import { createInsightDialog } from "../../../../../ui/insight-dialog";
import { FLIGHT_CHOICE_DIALOG_CLASS, flightResultCardFromRecord, paintFlightResultChoices } from "./flight-result-card";
import {
  TRANSPORTATION_TYPE_KEYS,
  TRANSPORTATION_TYPE_LABEL_ZH,
  transportationTypeIconSvg,
  transportationTypeLabelZh,
} from "../../../../../ui/transportation-type";
import type { BusinessTimeZoneResponse, ItemSnapshot } from "../../../../productivity/types";
import { TravelController } from "../../../../productivity/travel-v2";
import {
  buildAppendPayload,
  buildActionFirstCreatePayload,
  buildCheckpointFirstCreatePayload,
  buildTravelEnvelope,
  newTravelMemberId,
  productivityTravelV2SetCheckpointCompleted,
  productivityTravelV2UpdateItem,
  productivityTravelV2UpdatePoint,
  productivityTravelV2UpdateTransportation,
} from "../../../../productivity/travel-v2/client";
import { instantForWall } from "../arrangement-model";
import { isDateTimeRangeComplete, type DateTimeRangeValue } from "../../../../../ui/datetime-range-display";
import type {
  CanonicalTravelPoint,
  TravelAdoptFlightResult,
  TravelAdoptionFieldReport,
  TravelAdoptionReport,
  TravelActionPlan,
  TravelEditPlanPayload,
  TravelCommandEnvelope,
  TravelMutationResult,
  TravelCreatePayload,
  TravelSaveState,
  TravelSetActualMode,
  TravelSetCheckpointCompletedPayload,
  TravelTextDraftKey,
  TravelFirstContentAction,
  TravelTransportationPatch,
  TravelUpdateItemPayload,
  TravelUpdatePointPayload,
  Transportation,
  TransportationType,
  TripSnapshot,
  TravelQueryFlightResult,
} from "../../../../productivity/travel-v2/types";
import { getConfirmDialog } from "../../../../shell/dialog";
import { buildAdoptionToken, fetchTravelV2Trip } from "./rail-v2-api";
import { fieldsForTransportationType, readTransportationField, type TransportationFieldKey } from "./rail-fields";
import { formatGapDuration, formatPointLine, utcToLocalParts } from "./rail-time";
import {
  diffFlightValues,
  formatFlightDiffValue,
  mappedSourceValues,
  matchCandidatesByIata,
  sourceFlightInstant,
  sourceOffsetSeconds,
} from "./flight-refresh";
import "./rail.css";

export type TravelRailOptions = {
  host: HTMLElement;
  controller: TravelController;
  getZone: () => BusinessTimeZoneResponse | null;
  getDefaultQueryDate: () => string;
  getEditing: () => boolean;
  onExitEdit?: () => void;
  onEnterEdit?: () => void;
  onProductivityRefresh?: () => void | Promise<void>;
  onError?: (message: string) => void;
  onEditPlan?: (itemId:string,payload:TravelEditPlanPayload)=>Promise<void>;
  onCreateFirstContent?: (payload: TravelCreatePayload) => Promise<void>;
};

export type TravelRailHandle = {
  setItem: (itemId: string | null) => void;
  beginNewTripDraft: () => Promise<boolean>;
  isNewTripDraft: () => boolean;
  newTripDraftGeneration: () => number | null;
  /** Re-render from controller state (autosave / mutations). */
  refresh: () => void;
  /** After controller mutations (e.g. adoption baseline fill). */
  syncControllerState: () => void;
  dispose: () => void;
};

type DisposeFn = () => void;

function flightQueryResultErrorMessage(result: TravelQueryFlightResult): string | null {
  const status = result.status;
  if (status === "error" || status === "skipped") {
    const base = "航班查询失败";
    const reason = result.reason;
    if (typeof reason === "string" && /^[a-z0-9_]{1,80}$/.test(reason)) {
      return `${base} (${reason})`;
    }
    return base;
  }
  if (!result.candidates?.length) {
    return "未找到匹配航班";
  }
  return null;
}

type TransportDraftFields = NonNullable<TravelFirstContentAction["transportationFields"]>;

function mapFlightCandidate(candidate: Record<string, unknown>): TransportDraftFields {
  const mapped = mappedSourceValues(candidate);
  return {
    serviceNumber: mapped.serviceNumber ?? null,
    operator: mapped.operator ?? null,
    vehicleModel: mapped.vehicleModel ?? null,
    aircraftRegistration: mapped.aircraftRegistration ?? null,
    departureName: mapped.departureName ?? null,
    arrivalName: mapped.arrivalName ?? null,
    departureCode: mapped.departureCode ?? null,
    arrivalCode: mapped.arrivalCode ?? null,
    departureTerminal: mapped.departureTerminal ?? null,
    arrivalTerminal: mapped.arrivalTerminal ?? null,
    departureGate: mapped.departureGate ?? null,
    arrivalGate: mapped.arrivalGate ?? null,
  };
}

function flightCandidateSourceKey(candidate: Record<string, unknown>, flightNumber: string, date: string): string {
  const providerKey = candidate.sourceRecordKey;
  if (typeof providerKey === "string" && providerKey.trim()) return providerKey.trim();
  const number = candidate.FlightNo ?? candidate.flightNo ?? flightNumber;
  const dep = candidate.FlightDepcode ?? candidate.depCode ?? "";
  const arr = candidate.FlightArrcode ?? candidate.arrCode ?? "";
  return `${String(number)}:${String(dep)}:${String(arr)}:${date}`;
}

function enqueueMutation(
  controller: TravelController,
  itemId: string,
  build: (ctx: { requestId: string; snapshot: TripSnapshot | null; expectedDataDir: string }) => TravelCommandEnvelope<unknown>,
  invokeWrite: (envelope: TravelCommandEnvelope<unknown>) => Promise<TravelMutationResult | TravelAdoptFlightResult>,
): void {
  (controller as unknown as {
    enqueueMutation: (
      itemId: string,
      b: (ctx: { requestId: string; snapshot: TripSnapshot | null; expectedDataDir: string }) => TravelCommandEnvelope<unknown>,
      i: (envelope: TravelCommandEnvelope<unknown>) => Promise<TravelMutationResult | TravelAdoptFlightResult>,
    ) => void;
  }).enqueueMutation(itemId, build, invokeWrite);
}

function lucideIcon(inner: string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

const PENCIL_ICON = lucideIcon(
  '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
);
const PENCIL_OFF_ICON = lucideIcon(
  '<path d="m10 10-6.157 6.162a2 2 0 0 0-.5.833l-1.322 4.36a.5.5 0 0 0 .622.624l4.358-1.323a2 2 0 0 0 .83-.5L14 13.982"/><path d="m12.829 7.172 4.359-4.346a1 1 0 1 1 3.986 3.986l-4.353 4.353"/><path d="m15 5 4 4"/><path d="m2 2 20 20"/>',
);
const CIRCLE_SLASH_ICON = lucideIcon('<circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/>');
const TRASH_ICON = lucideIcon(
  '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
);
const REFRESH_CW_ICON = lucideIcon(
  '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  14,
);

function railIconButton(label: string, icon: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "travel-rail-icon-btn";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

function actualBoundaryMode(currentUtc: string | null | undefined, clearing: boolean): TravelSetActualMode {
  if (clearing) return "clear";
  if (currentUtc) return "correct";
  return "record";
}

function listPendingActualActions(snapshot: TripSnapshot): TravelActionPlan[] {
  return snapshot.actions.filter((action) => {
    if (action.deletedAtUtc) return false;
    const hasStart = Boolean(action.actual.start.atUtc ?? action.actual.start.pendingAtUtc);
    const hasEnd = Boolean(action.actual.end.atUtc ?? action.actual.end.pendingAtUtc);
    return hasStart && !hasEnd;
  });
}

function validateCancelEndAction(snapshot: TripSnapshot, actionId: string, nowIso: string): string | null {
  const action = snapshot.actions.find((entry) => entry.id === actionId);
  if (!action) return "找不到所选行程段";
  const startBoundary =
    action.actual.start.atUtc ?? action.actual.start.pendingAtUtc ?? action.plannedStartAt;
  const startMs = Date.parse(startBoundary);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return "时间格式无效";
  if (startMs >= nowMs) return "结束时间必须晚于行程段开始";
  const sorted = [...snapshot.actions].sort(
    (a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt) || a.id.localeCompare(b.id),
  );
  const idx = sorted.findIndex((entry) => entry.id === actionId);
  if (idx < 0) return "找不到所选行程段";
  for (const later of sorted.slice(idx + 1)) {
    const laterStart = later.actual.start.atUtc ?? later.actual.start.pendingAtUtc;
    if (laterStart && nowMs > Date.parse(laterStart)) return "结束时间不能晚于后段实际开始";
  }
  return null;
}

function sortedCanonicalPoints(snapshot: TripSnapshot): CanonicalTravelPoint[] {
  return [...snapshot.canonicalPoints].sort((a, b) => a.plannedAtUtc.localeCompare(b.plannedAtUtc));
}

function segmentForPoints(snapshot: TripSnapshot, frontPointId: string, rearPointId: string) {
  return snapshot.segments.find((seg) => {
    const start = snapshot.canonicalPoints.find((p) => p.pointId === frontPointId);
    const end = snapshot.canonicalPoints.find((p) => p.pointId === rearPointId);
    if (!start || !end) return false;
    const action = snapshot.actions.find((a) => a.id === seg.actionId);
    return action && seg.plannedStartAt === start.plannedAtUtc && seg.plannedEndAt === end.plannedAtUtc;
  });
}

function transportationForSegment(snapshot: TripSnapshot, actionId: string): Transportation | null {
  const action = snapshot.actions.find((a) => a.id === actionId);
  if (!action?.transportationId) return null;
  return snapshot.transportations.find((t) => t.id === action.transportationId) ?? null;
}

function circleTypeForPoint(snapshot: TripSnapshot, point: CanonicalTravelPoint, index: number, points: CanonicalTravelPoint[]): string | null {
  if (point.attachmentKind === "checkpoint") return null;
  if (point.rearActionId && point.frontActionId) {
    const rear = snapshot.actions.find((a) => a.id === point.rearActionId);
    const t = rear?.transportationId ? snapshot.transportations.find((x) => x.id === rear.transportationId) : null;
    return t?.transportationType ?? null;
  }
  const next = points[index + 1];
  if (next && segmentForPoints(snapshot, point.pointId, next.pointId)) {
    const seg = segmentForPoints(snapshot, point.pointId, next.pointId)!;
    const t = transportationForSegment(snapshot, seg.actionId);
    return t?.transportationType ?? null;
  }
  const prev = points[index - 1];
  if (prev && segmentForPoints(snapshot, prev.pointId, point.pointId)) {
    const seg = segmentForPoints(snapshot, prev.pointId, point.pointId)!;
    const t = transportationForSegment(snapshot, seg.actionId);
    return t?.transportationType === "flight" ? "flight" : null;
  }
  return null;
}

function flightGlyphForPoint(snapshot: TripSnapshot, point: CanonicalTravelPoint, index: number, points: CanonicalTravelPoint[]): "departure" | "arrival" | undefined {
  const type = circleTypeForPoint(snapshot, point, index, points);
  if (type !== "flight") return undefined;
  const next = points[index + 1];
  if (next && segmentForPoints(snapshot, point.pointId, next.pointId)) return "departure";
  return "arrival";
}

export function mountTravelRail(options: TravelRailOptions): TravelRailHandle {
  const root = document.createElement("div");
  root.className = "travel-rail";
  options.host.replaceChildren(root);

  let activeItemId: string | null = null;
  let newTripDraft = false;
  let newTripTitle = "未命名出行";
  let disposed = false;
  let completionAnimationTimer = 0;
  let draftRequestGeneration = 0;
  let loadEpoch = 0;
  const disposers: DisposeFn[] = [];
  let adoptBaselinePending: {
    transportId: string;
    adoptionToken: string;
    generation: number;
    beforeValues: Record<string, string | null>;
  } | null = null;
  const localFieldText = new Map<TravelTextDraftKey, string | null>();
  const fieldKeysByItem = new Map<string, Set<TravelTextDraftKey>>();
  const failedTextCommitsByItem = new Map<string, Map<TravelTextDraftKey, () => void>>();
  const pendingDiscardGuardCancels = new Set<() => void>();
  const pendingInputDialogDisposers = new Set<() => void>();
  let prevSaveState: TravelSaveState = "clean";

  const trackFieldKey = (itemId: string, key: TravelTextDraftKey) => {
    let keys = fieldKeysByItem.get(itemId);
    if (!keys) {
      keys = new Set();
      fieldKeysByItem.set(itemId, keys);
    }
    keys.add(key);
  };

  const clearRailFieldStateForItem = (itemId: string) => {
    for (const key of fieldKeysByItem.get(itemId) ?? []) {
      localFieldText.delete(key);
    }
    fieldKeysByItem.delete(itemId);
    failedTextCommitsByItem.delete(itemId);
  };

  const resolveRailFieldText = (itemId: string, key: TravelTextDraftKey, committed: string): string => {
    const local = localFieldText.get(key);
    if (local !== undefined) return local ?? "";
    const draft = options.controller.getDraft(itemId, key);
    if (draft !== undefined) return draft ?? "";
    return committed;
  };

  const queueRailTextCommit = (
    itemId: string,
    draftKey: TravelTextDraftKey,
    value: string | null,
    buildPayload: (v: string | null) => TravelUpdateItemPayload | TravelUpdatePointPayload | TravelTransportationPatch,
    invoke: (
      envelope: TravelCommandEnvelope<TravelUpdateItemPayload | TravelUpdatePointPayload | TravelTransportationPatch>,
    ) => Promise<TravelMutationResult>,
  ) => {
    trackFieldKey(itemId, draftKey);
    localFieldText.set(draftKey, value);
    const retry = () => {
      const sendValue = localFieldText.get(draftKey) ?? value;
      options.controller.setTextDraft(itemId, draftKey, sendValue);
      options.controller.queueTextCommit(itemId, draftKey, buildPayload, invoke);
    };
    let failures = failedTextCommitsByItem.get(itemId);
    if (!failures) {
      failures = new Map();
      failedTextCommitsByItem.set(itemId, failures);
    }
    failures.set(draftKey, retry);
    options.controller.setTextDraft(itemId, draftKey, value);
    options.controller.queueTextCommit(itemId, draftKey, buildPayload, invoke);
  };

  const needsLeaveGuard = (): boolean => {
    const saveState = options.controller.getState().saveState;
    if (saveState === "dirty" || saveState === "saving" || saveState === "failed" || saveState === "conflict") {
      return true;
    }
    if (!activeItemId) return false;
    return (failedTextCommitsByItem.get(activeItemId)?.size ?? 0) > 0;
  };

  const confirmDiscardUnsaved = (): Promise<boolean> => {
    if (!needsLeaveGuard() || !activeItemId) return Promise.resolve(true);
    const itemId = activeItemId;
    return new Promise((resolve) => {
      let settled = false;
      let dlg: ReturnType<typeof createInsightDialog>;
      let finish: (discard: boolean, closeFirst?: boolean) => void;
      const cancelForDispose = () => finish(false, true);
      finish = (discard, closeFirst = false) => {
        if (settled) return;
        settled = true;
        pendingDiscardGuardCancels.delete(cancelForDispose);
        if (discard) {
          options.controller.abandonDrafts(itemId);
          clearRailFieldStateForItem(itemId);
        }
        if (closeFirst) void dlg.close();
        dlg.dispose();
        resolve(discard);
      };
      dlg = createInsightDialog({
        title: "未保存的修改",
        bodyHtml: "<p>有未保存或保存失败的字段。放弃后将丢失未提交的修改。</p>",
        submitLabel: "放弃修改",
        cancelLabel: "继续编辑",
        dangerSubmit: true,
      });
      pendingDiscardGuardCancels.add(cancelForDispose);
      dlg.bindChrome(() => finish(false));
      dlg.panel.addEventListener("submit", (event) => {
        event.preventDefault();
        finish(true);
      });
      void dlg.open();
    });
  };

  const openCancelTripDialog = (snapshot: TripSnapshot) => {
    const pending = listPendingActualActions(snapshot);
    const itemId = snapshot.item.id;
    if (pending.length === 0) {
      const dlg = createInsightDialog({
        title: "取消出行",
        bodyHtml: "<p>取消后该出行将从时间线隐藏，资料仍保留。确定取消？</p>",
        submitLabel: "取消出行",
        cancelLabel: "返回",
        dangerSubmit: true,
      });
      dlg.bindChrome(() => dlg.dispose());
      dlg.panel.addEventListener("submit", (event) => {
        event.preventDefault();
        options.controller.queueCancel(itemId, {});
        void dlg.close();
        dlg.dispose();
      });
      void dlg.open();
      return;
    }
    const dlg = createInsightDialog({
      title: "取消出行",
      bodyHtml:
        "<p>存在尚未结束的实际行程段。可仅取消出行，或先以当前时间结束所选段再取消。</p><div data-travel-cancel-select></div>",
      submitLabel: "仅取消出行",
      cancelLabel: "返回",
      dangerSubmit: true,
      extraActionsHtml:
        '<button type="button" class="insight-dialog-btn insight-dialog-btn-primary" data-action="end-cancel">结束所选并取消</button>',
    });
    const selectHost = dlg.body.querySelector<HTMLElement>("[data-travel-cancel-select]")!;
    const selectOptions = pending.map((action) => ({
      value: action.id,
      label: action.title?.trim() || "行程段",
    }));
    const field = mountSelectField(selectHost, {
      label: "待结束的实际段",
      multiple: false,
      search: false,
      value: pending[0]?.id ?? null,
      options: selectOptions,
      onChange: () => dlg.setError(""),
    });
    const disposeDialog = () => {
      field.dispose();
      void dlg.close();
      dlg.dispose();
    };
    dlg.bindChrome(disposeDialog);
    const endBtn = dlg.panel.querySelector<HTMLButtonElement>('[data-action="end-cancel"]');
    endBtn?.addEventListener("click", () => {
      const actionId = field.getValue();
      if (!actionId) {
        dlg.setError("请选择行程段");
        return;
      }
      const validationError = validateCancelEndAction(snapshot, actionId, new Date().toISOString());
      if (validationError) {
        dlg.setError(validationError);
        return;
      }
      dlg.setError("");
      options.controller.queueCancel(itemId, { endCurrentActionId: actionId });
      disposeDialog();
    });
    dlg.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      dlg.setError("");
      options.controller.queueCancel(itemId, {});
      disposeDialog();
    });
    void dlg.open();
  };

  const disposeAll = () => {
    disposers.splice(0).forEach((fn) => fn());
  };

  const render = () => {
    // Render replacement disposes the current inline editor. Blur first so its
    // focusout handler commits the live value into the controller draft queue.
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".orbita-inline-text-field__input")
      .forEach((input) => input.blur());
    disposeAll();
    const state = options.controller.getState();
    const snapshot = state.currentSnapshot;
    const zone = options.getZone();
    if (newTripDraft && zone) {
      const head = document.createElement("div");
      head.className = "travel-rail-head";
      const title = document.createElement("div");
      title.className = "travel-rail-title-slot arrangement-detail-title";
      title.dataset.travelField = "item:title";
      const titleField = mountInlineTextField({
        container: title,
        value: newTripTitle,
        placeholder: "未命名出行",
        onCommit: (value) => { newTripTitle = value.trim() || "未命名出行"; },
      });
      disposers.push(() => titleField.dispose());
      const actions = document.createElement("div");
      actions.className = "travel-rail-head-actions";
      const exit = createButton("关闭草稿", { width: 100, height: 28 });
      exit.addEventListener("click", () => {
        draftRequestGeneration += 1;
        newTripDraft = false;
        for (const cleanup of [...pendingInputDialogDisposers]) cleanup();
        options.onExitEdit?.();
      });
      actions.append(exit);
      head.append(title, actions);
      const addRow = document.createElement("div");
      addRow.className = "travel-rail-add-row is-empty-draft";
      const add = (label: string, kind: "flight" | "train" | "action" | "checkpoint") => {
        const button = createButton(label, { height: 28 });
        button.classList.add("travel-rail-draft-add");
        button.addEventListener("click", () => openFirstContentDialog(kind, zone));
        addRow.append(button);
      };
      add("添加航班", "flight");
      add("添加火车", "train");
      add("添加行程", "action");
      add("添加检查点", "checkpoint");
      root.replaceChildren(head, addRow);
      return;
    }
    if (!activeItemId || !snapshot || snapshot.item.id !== activeItemId || !zone) {
      root.replaceChildren();
      if (activeItemId && !snapshot) {
        const loadingHost = document.createElement("div");
        root.append(loadingHost);
        const indicator = mountLoadingIndicator(loadingHost, { label: "加载行程…" });
        disposers.push(() => indicator.dispose());
      }
      return;
    }

    const editing = options.getEditing();
    const caps = snapshot.capabilities;
    const canEditText = caps.canEditText;

    if (state.saveState === "clean" && prevSaveState !== "clean") {
      failedTextCommitsByItem.delete(snapshot.item.id);
    }
    prevSaveState = state.saveState;

    const head = document.createElement("div");
    head.className = "travel-rail-head";
    const titleSlot = document.createElement("div");
    titleSlot.className = "travel-rail-title-slot arrangement-detail-title";
    titleSlot.dataset.travelField = "item:title";
    const titleField = mountInlineTextField({
      container: titleSlot,
      value: resolveRailFieldText(snapshot.item.id, "item:title", snapshot.item.title),
      placeholder: "未命名出行",
      readOnly: !canEditText,
      onCommit: (value) => {
        queueRailTextCommit(
          snapshot.item.id,
          "item:title",
          value,
          (v) => ({ title: (v ?? "").trim() || "未命名出行" }),
          productivityTravelV2UpdateItem,
        );
      },
    });
    disposers.push(() => titleField.dispose());
    head.append(titleSlot);

    const headActions = document.createElement("div");
    headActions.className = "travel-rail-head-actions";
    const missingActual = snapshot.canonicalPoints.filter((point) =>
      snapshot.checkpoints.some((cp) => cp.plannedAtUtc === point.plannedAtUtc && !cp.actualAtUtc)
      || snapshot.actions.some((action) =>
        (action.plannedEndAt === point.plannedAtUtc && !action.actual.end.atUtc && !action.actual.end.pendingAtUtc)
        || (action.plannedStartAt === point.plannedAtUtc && !action.actual.start.atUtc && !action.actual.start.pendingAtUtc)));
    const finished = snapshot.item.completed;
    const cancelled = Boolean(snapshot.profile.cancelledAtUtc);
    const pendingSave = needsLeaveGuard();
    const finish = createCheckbox(finished);
    finish.setAttribute("aria-label", finished ? "撤销完成" : "完成");
    finish.title = cancelled
      ? "已取消"
      : pendingSave
        ? "请先保存或处理未保存的修改"
      : finished
        ? "撤销完成"
        : missingActual.length
          ? `实际时间未填写：${missingActual.map((point) => formatPointLine(point.plannedAtUtc, point.location, point.actionLabel, zone)).join("、")}；接合点两侧均需填写`
          : caps.canFinish
            ? "完成"
            : caps.readOnlyReason || "当前不可完成";
    finish.disabled = cancelled || pendingSave || (finished ? !caps.canEditText : !caps.canFinish || missingActual.length > 0);
    finish.addEventListener("click", () => {
      if (finish.disabled || completionAnimationTimer) return;
      setCheckboxWithCompletionFeedback(finish, !finished);
      finish.setAttribute("aria-busy", "true");
      completionAnimationTimer = window.setTimeout(() => {
        completionAnimationTimer = 0;
        if (!disposed) render();
      }, 600);
      if (finished) options.controller.queueReopen(snapshot.item.id);
      else options.controller.queueFinish(snapshot.item.id);
    });
    const editBtn = railIconButton(editing ? "退出周图编辑" : "周图编辑", editing ? PENCIL_OFF_ICON : PENCIL_ICON);
    editBtn.addEventListener("click", () => {
      if (editing) options.onExitEdit?.();
      else options.onEnterEdit?.();
    });
    const cancelBtn = railIconButton("取消整趟出行", CIRCLE_SLASH_ICON);
    cancelBtn.disabled = !caps.canCancel;
    cancelBtn.addEventListener("click", () => {
      if (cancelBtn.disabled) return;
      openCancelTripDialog(snapshot);
    });
    const deleteBtn = railIconButton("删除整趟出行", TRASH_ICON);
    deleteBtn.addEventListener("click", () => {
      void (async () => {
        const ok = await getConfirmDialog()("删除出行", "将软删除整趟出行。", undefined, { danger: true });
        if (!ok) return;
        options.controller.queueDeleteTrip(snapshot.item.id);
      })();
    });
    headActions.append(finish, editBtn, cancelBtn, deleteBtn);
    head.append(headActions);

    const saveRow = document.createElement("div");
    saveRow.className = "travel-rail-save-row";
    const saveHint = document.createElement("div");
    saveHint.className = "travel-rail-save-hint";
    if (state.saveState === "dirty") saveHint.textContent = "待保存";
    else if (state.saveState === "failed") {
      const detail = typeof state.lastError === "string" ? state.lastError.trim() : "";
      saveHint.textContent = detail ? `保存失败：${detail.slice(0, 240)}` : "保存失败";
      saveHint.classList.add("is-failed");
    } else if (state.saveState === "conflict") {
      saveHint.textContent = "版本冲突";
      saveHint.classList.add("is-failed");
    }
    saveRow.append(saveHint);
    if (state.saveState === "failed") {
      const retryBtn = createButton("重试", { height: 26 });
      retryBtn.addEventListener("click", () => {
        const retries = failedTextCommitsByItem.get(snapshot.item.id);
        if (retries?.size) {
          for (const retry of retries.values()) retry();
          return;
        }
        options.controller.retryFailed(snapshot.item.id);
      });
      saveRow.append(retryBtn);
    } else if (state.saveState === "conflict") {
      const reloadBtn = createButton("重新加载", { height: 26 });
      reloadBtn.addEventListener("click", () => {
        void options.controller.loadTrip(snapshot.item.id).then(() => {
          clearRailFieldStateForItem(snapshot.item.id);
          render();
        });
      });
      saveRow.append(reloadBtn);
    }

    const addRow = document.createElement("div");
    addRow.className = "travel-rail-add-row";
    if (caps.canAppend) {
      const mk = (label: string, kind: "flight" | "train" | "action" | "checkpoint") => {
        const btn = createButton(label, { width: 104, height: 28 });
        btn.addEventListener("click", () => void appendContent(kind));
        return btn;
      };
      addRow.append(mk("添加航班", "flight"), mk("添加火车", "train"), mk("添加行程", "action"), mk("添加检查点", "checkpoint"));
    }

    const axis = document.createElement("div");
    axis.className = "travel-rail-axis";
    const points = sortedCanonicalPoints(snapshot);
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (i > 0) {
        const hasSegment = Boolean(segmentForPoints(snapshot, points[i - 1].pointId, point.pointId));
        const gap = hasSegment ? null : formatGapDuration(points[i - 1].plannedAtUtc, point.plannedAtUtc);
        if (!hasSegment) {
          const gapEl = document.createElement("div");
          gapEl.className = "travel-rail-gap";
          const previous = points[i - 1];
          const previousActual = previous.attachmentKind === "checkpoint" ? previous.actualAtUtc : previous.actualFrontEndAtUtc;
          const nextActual = point.attachmentKind === "checkpoint" ? point.actualAtUtc : point.actualRearStartAtUtc;
          gapEl.classList.toggle("solid", Boolean(previousActual && nextActual));
          if (gap) {
            const duration = document.createElement("span");
            duration.className = "travel-rail-gap-duration";
            duration.textContent = gap;
            gapEl.append(duration);
          }
          axis.append(gapEl);
        }
      }
      axis.append(renderPointRow(snapshot, point, i, points, zone, caps));
      const next = points[i + 1];
      if (next) {
        const seg = segmentForPoints(snapshot, point.pointId, next.pointId);
        if (seg) {
          axis.append(renderSegment(snapshot, seg, point, next, zone, caps));
        }
      }
    }

    root.replaceChildren(head, saveRow, addRow, axis);

    const travelZone = zone;
    const travelSnapshot = snapshot;
    function appendContent(kind: "flight" | "train" | "action" | "checkpoint") {
      const title = kind === "checkpoint"
        ? "添加检查点"
        : kind === "flight"
          ? "添加航班"
          : kind === "train"
            ? "添加火车"
            : "添加行程";
      if (kind === "checkpoint") {
        openCheckpointDateTimeDialog(title, travelZone, (plannedAtUtc) => {
          options.controller.queueAppend(
            travelSnapshot.item.id,
            buildAppendPayload("checkpoint", { plannedAtUtc, title: "未命名检查点" }),
          );
        });
        return;
      }
      if (kind === "flight" || kind === "train") {
        if (kind === "flight") {
          openFirstFlightQueryDialog({
            initialNumber: "",
            contextIsCurrent: () => {
              const current = options.controller.getState().currentSnapshot;
              return current?.item.id === travelSnapshot.item.id && current.item.revision === travelSnapshot.item.revision;
            },
            onPicked: async (candidate, result, flightNumber, queryDate) => {
              const plannedStartAt = sourceFlightInstant(candidate.FlightDeptimePlanDate, sourceOffsetSeconds(candidate.org_timezone));
              const plannedEndAt = sourceFlightInstant(candidate.FlightArrtimePlanDate, sourceOffsetSeconds(candidate.dst_timezone));
              if (!plannedStartAt || !plannedEndAt || Date.parse(plannedEndAt) <= Date.parse(plannedStartAt)) {
                throw new Error("候选航班缺少有效的计划起止时间，请重新查询或选择其他航班");
              }
              options.controller.queueAppend(travelSnapshot.item.id, buildAppendPayload("flight", {
                plannedStartAt,
                plannedEndAt,
                transportationFields: mapFlightCandidate(candidate),
                transportationSourceSnapshot: {
                  provider: result.provider ?? "variflight",
                  raw: candidate,
                  queryGeneration: result.queryGeneration,
                  queryContext: result.context ?? { draft: true, flightNumber, date: queryDate },
                  fetchedAtUtc: result.fetchedAtUtc,
                  queriedAt: result.fetchedAtUtc,
                  sourceRecordKey: flightCandidateSourceKey(candidate, flightNumber, queryDate),
                  mappingVersion: 1,
                },
              }));
            },
          });
          return;
        }
        openTransportDraftDialog(kind, travelZone, async (draft) => {
          options.controller.queueAppend(travelSnapshot.item.id, buildAppendPayload(kind, {
            plannedStartAt: draft.plannedStartAt,
            plannedEndAt: draft.plannedEndAt,
            transportationFields: draft.fields,
            transportationSourceSnapshot: draft.sourceSnapshot,
          }));
        });
        return;
      }
      openRangeDialog(title, false, (rangeValue) => {
        const startMinute = parseHm(rangeValue.startTime);
        const endMinute = parseHm(rangeValue.endTime);
        if (!rangeValue.startDate || !rangeValue.endDate || startMinute == null || endMinute == null) return;
        const plannedStartAt = new Date(instantForWall(rangeValue.startDate, startMinute, travelZone)).toISOString().replace(/\.\d{3}Z$/, "Z");
        const plannedEndAt = new Date(instantForWall(rangeValue.endDate, endMinute, travelZone)).toISOString().replace(/\.\d{3}Z$/, "Z");
        options.controller.queueAppend(travelSnapshot.item.id, buildAppendPayload("action", { plannedStartAt, plannedEndAt }));
      });
    }
  };

  function openFirstContentDialog(kind: "flight" | "train" | "action" | "checkpoint", zone: BusinessTimeZoneResponse) {
    const title = kind === "checkpoint" ? "添加检查点" : kind === "flight" ? "添加航班" : kind === "train" ? "添加火车" : "添加行程";
    if (kind === "checkpoint") {
      openFirstCheckpointDialog(zone);
      return;
    }
    if (kind === "flight") {
      openFirstFlightQueryDialog({
        initialNumber: "",
        onPicked: async (candidate, result, flightNumber, queryDate) => {
          const plannedStartAt = sourceFlightInstant(candidate.FlightDeptimePlanDate, sourceOffsetSeconds(candidate.org_timezone));
          const plannedEndAt = sourceFlightInstant(candidate.FlightArrtimePlanDate, sourceOffsetSeconds(candidate.dst_timezone));
          if (!plannedStartAt || !plannedEndAt || Date.parse(plannedEndAt) <= Date.parse(plannedStartAt)) {
            throw new Error("候选航班缺少有效的计划起止时间，请重新查询或选择其他航班");
          }
          const fields = mapFlightCandidate(candidate);
          const sourceSnapshot = {
            provider: result.provider ?? "variflight",
            raw: candidate,
            queryGeneration: result.queryGeneration,
            queryContext: result.context ?? { draft: true, flightNumber, date: queryDate },
            fetchedAtUtc: result.fetchedAtUtc,
            queriedAt: result.fetchedAtUtc,
            sourceRecordKey: flightCandidateSourceKey(candidate, flightNumber, queryDate),
            mappingVersion: 1,
          };
          if (!options.onCreateFirstContent) throw new Error("出行创建入口不可用");
          await options.onCreateFirstContent(buildActionFirstCreatePayload({
            newItemId: newTravelMemberId(),
            title: newTripTitle,
            plannedStartAt,
            plannedEndAt,
            transportationType: "flight",
            transportationFields: fields,
            transportationSourceSnapshot: sourceSnapshot,
            startLocation: fields.departureName,
            endLocation: fields.arrivalName,
          }));
        },
      });
      return;
    }
    if (kind === "flight" || kind === "train") {
      openTransportDraftDialog(kind, zone, async (draft) => {
        const payload: TravelCreatePayload = buildActionFirstCreatePayload({
          newItemId: newTravelMemberId(),
          title: newTripTitle,
          plannedStartAt: draft.plannedStartAt,
          plannedEndAt: draft.plannedEndAt,
          transportationType: kind,
          transportationFields: draft.fields,
          transportationSourceSnapshot: draft.sourceSnapshot,
          startLocation: draft.fields.departureName,
          endLocation: draft.fields.arrivalName,
        });
        if (!options.onCreateFirstContent) throw new Error("出行创建入口不可用");
        await options.onCreateFirstContent(payload);
      });
      return;
    }
    openRangeDialog(title, false, async (value) => {
      const newItemId = newTravelMemberId();
      const startMinute = parseHm(value.startTime);
      const endMinute = parseHm(value.endTime);
      if (!value.startDate || !value.endDate || startMinute == null || endMinute == null) return;
      const plannedStartAt = new Date(instantForWall(value.startDate, startMinute, zone)).toISOString().replace(/\.\d{3}Z$/, "Z");
      const plannedEndAt = new Date(instantForWall(value.endDate, endMinute, zone)).toISOString().replace(/\.\d{3}Z$/, "Z");
      const payload: TravelCreatePayload = buildActionFirstCreatePayload({
        newItemId, title: newTripTitle, plannedStartAt, plannedEndAt,
        transportationType: kind === "flight" ? "flight" : kind === "train" ? "train" : null,
      });
      if (!options.onCreateFirstContent) throw new Error("出行创建入口不可用");
      await options.onCreateFirstContent(payload);
    }, (value) => {
      const startMinute = parseHm(value.startTime);
      const endMinute = parseHm(value.endTime);
      if (!value.startDate || !value.endDate || startMinute == null || endMinute == null) return "请选择完整起止时间";
      const startMs = instantForWall(value.startDate, startMinute, zone);
      const endMs = instantForWall(value.endDate, endMinute, zone);
      return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? null
        : "结束时间必须晚于开始时间";
    }, true);
  }

  function trackDialog(cleanup: () => void): void {
    pendingInputDialogDisposers.add(cleanup);
  }

  function openMessageDialog(title: string, message: string, submitLabel = "确定"): void {
    const dlg = createInsightDialog({ title, bodyHtml: "", submitLabel });
    const p = document.createElement("p");
    p.textContent = message;
    dlg.body.append(p);
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      pendingInputDialogDisposers.delete(cleanup);
      void dlg.close();
      dlg.dispose();
    };
    trackDialog(cleanup);
    dlg.bindChrome(cleanup);
    dlg.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      cleanup();
    });
    void dlg.open();
  }

  function openFirstFlightQueryDialog(input: {
    initialNumber: string;
    contextIsCurrent?: () => boolean;
    onPicked: (candidate: Record<string, unknown>, result: TravelQueryFlightResult, flightNumber: string, date: string) => void | Promise<void>;
  }): void {
    const dlg = createInsightDialog({ title: "查询航班", bodyHtml: "", submitLabel: "查询" });
    const form = document.createElement("div");
    form.className = FLIGHT_CHOICE_DIALOG_CLASS;
    const numberField = document.createElement("label");
    numberField.className = "insight-dialog-field";
    const numberLabel = document.createElement("span");
    numberLabel.className = "insight-dialog-label";
    numberLabel.textContent = "航班号";
    const numberInput = document.createElement("input");
    numberInput.type = "text";
    numberInput.name = "flightNumber";
    numberInput.autocomplete = "off";
    numberInput.value = input.initialNumber;
    numberInput.setAttribute("aria-label", "航班号");
    numberField.append(numberLabel, numberInput);
    let flightNumber = input.initialNumber;
    numberInput.addEventListener("input", () => { flightNumber = numberInput.value.trim(); });
    const dateField = document.createElement("label");
    dateField.className = "insight-dialog-field";
    const dateLabel = document.createElement("span");
    dateLabel.className = "insight-dialog-label";
    dateLabel.textContent = "日期";
    const dateHost = document.createElement("div");
    dateField.append(dateLabel, dateHost);
    let queryDate = options.getDefaultQueryDate();
    const datePicker = mountDecoupledDatePicker({
      defaultTrigger: { container: dateHost },
      value: queryDate,
      onChange: (value) => { queryDate = value; },
    });
    const choices = document.createElement("div");
    choices.className = "flight-results";
    form.append(numberField, dateField, choices);
    dlg.body.append(form);
    const titleEl = dlg.panel.querySelector<HTMLElement>(".insight-dialog-title");
    const cancelBtn = dlg.panel.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    let step: "query" | "select" = "query";
    let selectedIndex = -1;
    let transitioning = false;
    let listed: { candidate: Record<string, unknown>; result: TravelQueryFlightResult; number: string; date: string }[] = [];
    const setChrome = (title: string, cancel: string, submit: string, continueEnabled?: boolean) => {
      if (titleEl) titleEl.textContent = title;
      if (cancelBtn) cancelBtn.textContent = cancel;
      const submitBtn = dlg.panel.querySelector<HTMLButtonElement>('[type="submit"]');
      if (submitBtn) {
        submitBtn.textContent = submit;
        if (continueEnabled !== undefined) submitBtn.disabled = !continueEnabled;
      }
    };
    const showQueryStep = () => {
      step = "query";
      form.classList.remove("is-selecting");
      choices.replaceChildren();
      listed = [];
      selectedIndex = -1;
      setChrome("查询航班", "取消", "查询", true);
    };
    const paintChoices = () => {
      paintFlightResultChoices(
        choices,
        listed.map((entry) => flightResultCardFromRecord(entry.candidate)),
        selectedIndex,
        (index) => {
          selectedIndex = index;
          paintChoices();
        },
      );
      setChrome("选择航班", "返回", "继续", selectedIndex >= 0);
    };
    let settled = false;
    const transitionStep = async (update: () => void) => {
      if (transitioning || settled) return;
      transitioning = true;
      const parts = [dlg.panel.querySelector<HTMLElement>(".insight-dialog-header"), dlg.body, dlg.panel.querySelector<HTMLElement>(".insight-dialog-footer")].filter((el): el is HTMLElement => !!el);
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced || typeof dlg.panel.animate !== "function") {
        update();
        if (step === "select") choices.querySelector<HTMLElement>(".flight-result-card")?.focus();
        else numberInput.focus();
        transitioning = false;
        return;
      }
      const fadeOut = parts.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-in", fill: "forwards" }));
      await Promise.all(fadeOut.map((animation) => animation.finished.catch(() => undefined)));
      if (settled) { fadeOut.forEach((animation) => animation.cancel()); transitioning = false; return; }
      const before = dlg.panel.getBoundingClientRect().height;
      update();
      const after = dlg.panel.getBoundingClientRect().height;
      const border = dlg.panel.offsetHeight - dlg.panel.clientHeight;
      const resize = dlg.panel.animate([{ height: `${Math.max(0, before - border)}px` }, { height: `${Math.max(0, after - border)}px` }], { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      fadeOut.forEach((animation) => animation.cancel());
      const fadeIn = parts.map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 60, easing: "ease-out" }));
      await Promise.all([resize, ...fadeIn].map((animation) => animation.finished.catch(() => undefined)));
      if (!settled) {
        if (step === "select") choices.querySelector<HTMLElement>(".flight-result-card")?.focus();
        else numberInput.focus();
      }
      transitioning = false;
    };
    const cleanup = () => {
      if (settled) return;
      settled = true;
      pendingInputDialogDisposers.delete(cleanup);
      datePicker.dispose();
      void dlg.close();
      dlg.dispose();
    };
    trackDialog(cleanup);
    dlg.bindChrome(() => {
      if (transitioning) return;
      if (step === "select") {
        dlg.setError("");
        void transitionStep(showQueryStep);
        return;
      }
      cleanup();
    });
    let picking = false;
    const pick = async (candidate: Record<string, unknown>, result: TravelQueryFlightResult, number: string, date: string) => {
      if (picking) return;
      picking = true;
      try {
        await input.onPicked(candidate, result, number, date);
        cleanup();
      } catch (error) {
        if (settled) return;
        dlg.setError(error instanceof Error ? error.message : String(error));
      } finally {
        picking = false;
      }
    };
    const continuePick = async () => {
      const entry = listed[selectedIndex];
      if (!entry) { dlg.setError("请选择航班"); return; }
      const { candidate, result, number, date } = entry;
      if (result.queryGeneration !== options.controller.getState().queryGeneration
        || (input.contextIsCurrent && !input.contextIsCurrent())
        || flightNumber.trim() !== number
        || queryDate !== date) {
        openMessageDialog("查询航班", "航班查询已过期，请重新刷新");
        return;
      }
      await pick(candidate, result, number, date);
    };
    const runQuery = async () => {
      flightNumber = numberInput.value.trim();
      const number = flightNumber.trim();
      if (!number) { dlg.setError("请填写航班号"); return; }
      if (!queryDate) { dlg.setError("请选择日期"); return; }
      const date = queryDate;
      choices.replaceChildren();
      dlg.setError("");
      try {
        const result = await options.controller.queryFlight({ flightNumber: number, date });
        if (settled) return;
        const queryGeneration = result.queryGeneration;
        if (queryGeneration == null
          || queryGeneration !== options.controller.getState().queryGeneration
          || (input.contextIsCurrent && !input.contextIsCurrent())
          || flightNumber.trim() !== number
          || queryDate !== date) {
          openMessageDialog("查询航班", "航班查询已过期，请重新刷新");
          return;
        }
        const queryError = flightQueryResultErrorMessage(result);
        if (queryError) {
          dlg.setError(queryError);
          return;
        }
        if (!result.candidates.length) {
          dlg.setError("没有匹配的航班");
          return;
        }
        listed = result.candidates.map((candidate) => ({
          candidate: candidate as Record<string, unknown>,
          result,
          number,
          date,
        }));
        selectedIndex = -1;
        await transitionStep(() => {
          step = "select";
          form.classList.add("is-selecting");
          paintChoices();
        });
      } catch (error) {
        if (settled) return;
        dlg.setError(error instanceof Error ? error.message : String(error));
      }
    };
    dlg.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      if (transitioning) return;
      const submitBtn = dlg.panel.querySelector<HTMLButtonElement>('[type="submit"]');
      if (step === "select") {
        if (submitBtn) {
          void runButtonAction(submitBtn, { pending: { label: "继续" }, task: continuePick });
          return;
        }
        void continuePick();
        return;
      }
      if (submitBtn) {
        void runButtonAction(submitBtn, { pending: { label: "查询中…" }, task: runQuery }).then(() => {
          if (!settled && step === "select") setChrome("选择航班", "返回", "继续", selectedIndex >= 0);
        });
        return;
      }
      void runQuery();
    });
    void dlg.open();
  }

  function openTransportDraftDialog(
    kind: "flight" | "train",
    zone: BusinessTimeZoneResponse,
    onCommit: (value: { plannedStartAt: string; plannedEndAt: string; fields: TransportDraftFields; sourceSnapshot: Record<string, unknown> | null }) => Promise<void>,
  ) {
    const title = kind === "flight" ? "添加航班" : "添加火车";
    const dlg = createInsightDialog({ title, bodyHtml: "", submitLabel: "添加" });
    const form = document.createElement("div");
    form.className = "travel-rail-transport-draft";
    const addInput = (label: string, placeholder: string) => {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label);
      form.append(input);
      return input;
    };
    const service = addInput(kind === "flight" ? "航班号" : "车次", kind === "flight" ? "航班号" : "车次");
    const operator = addInput("承运方", kind === "flight" ? "航空公司" : "客运段");
    const departure = addInput("出发地点", kind === "flight" ? "出发机场" : "出发站");
    const arrival = addInput("到达地点", kind === "flight" ? "到达机场" : "到达站");
    const rangeHost = document.createElement("div");
    form.append(rangeHost);
    let rangeValue: DateTimeRangeValue = { startDate: "", startTime: "", endDate: "", endTime: "" };
    const rangePicker = mountDecoupledDateTimeRangePicker({
      defaultTrigger: { container: rangeHost, className: "travel-rail-range-trigger" },
      onChange: (value) => { rangeValue = value; candidatePlan = null; },
    });
    let candidateFields: TransportDraftFields | null = null;
    let candidatePlan: { start: string; end: string } | null = null;
    let sourceSnapshot: Record<string, unknown> | null = null;
    const invalidateDraftFlightQuery = () => {
      candidateFields = null;
      candidatePlan = null;
      sourceSnapshot = null;
    };
    if (kind === "flight") service.addEventListener("input", invalidateDraftFlightQuery);
    if (kind === "flight") {
      const applyCandidate = (candidate: Record<string, unknown>, result: TravelQueryFlightResult, flightNumber: string, queryDate: string) => {
        const queryGeneration = result.queryGeneration;
        candidateFields = mapFlightCandidate(candidate);
        sourceSnapshot = {
          provider: result.provider ?? "variflight",
          raw: candidate,
          queryGeneration,
          queryContext: result.context ?? { draft: true, flightNumber, date: queryDate },
          fetchedAtUtc: result.fetchedAtUtc,
          queriedAt: result.fetchedAtUtc,
          sourceRecordKey: flightCandidateSourceKey(candidate, flightNumber, queryDate),
          mappingVersion: 1,
        };
        service.value = candidateFields.serviceNumber ?? service.value;
        operator.value = candidateFields.operator ?? operator.value;
        departure.value = candidateFields.departureName ?? departure.value;
        arrival.value = candidateFields.arrivalName ?? arrival.value;
        const start = sourceFlightInstant(candidate.FlightDeptimePlanDate, sourceOffsetSeconds(candidate.org_timezone));
        const end = sourceFlightInstant(candidate.FlightArrtimePlanDate, sourceOffsetSeconds(candidate.dst_timezone));
        if (start && end && Date.parse(end) > Date.parse(start)) {
          candidatePlan = { start, end };
          const startParts = utcToLocalParts(start, zone);
          const endParts = utcToLocalParts(end, zone);
          const next = { startDate: startParts.date, startTime: startParts.time, endDate: endParts.date, endTime: endParts.time };
          rangeValue = next;
          (rangePicker as unknown as { setValue?: (value: DateTimeRangeValue) => void }).setValue?.(next);
        } else candidatePlan = null;
        dlg.setError("");
      };
      const query = createButton("查询航班", { height: 26 });
      query.addEventListener("click", () => {
        invalidateDraftFlightQuery();
        openFirstFlightQueryDialog({
          initialNumber: service.value.trim(),
          onPicked: applyCandidate,
        });
      });
      form.append(query);
    }
    dlg.body.append(form);
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      pendingInputDialogDisposers.delete(cleanup);
      rangePicker.dispose();
      void dlg.close();
      dlg.dispose();
    };
    pendingInputDialogDisposers.add(cleanup);
    dlg.bindChrome(cleanup);
    let committing = false;
    dlg.panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (committing) return;
      const startMinute = parseHm(rangeValue.startTime);
      const endMinute = parseHm(rangeValue.endTime);
      if (!rangeValue.startDate || !rangeValue.endDate || startMinute == null || endMinute == null) {
        dlg.setError("请选择完整起止时间"); return;
      }
      const startMs = instantForWall(rangeValue.startDate, startMinute, zone);
      const endMs = instantForWall(rangeValue.endDate, endMinute, zone);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        dlg.setError("结束时间必须晚于开始时间"); return;
      }
      const fields: TransportDraftFields = {
        ...candidateFields,
        serviceNumber: service.value.trim() || null,
        operator: operator.value.trim() || null,
        departureName: departure.value.trim() || null,
        arrivalName: arrival.value.trim() || null,
      };
      committing = true;
      try {
        await onCommit({
          plannedStartAt: candidatePlan?.start ?? new Date(startMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
          plannedEndAt: candidatePlan?.end ?? new Date(endMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
          fields,
          sourceSnapshot,
        });
        cleanup();
      } catch (error) {
        dlg.setError(error instanceof Error ? error.message : String(error));
        committing = false;
      }
    });
    void dlg.open();
  }

  function openFirstCheckpointDialog(zone: BusinessTimeZoneResponse) {
    openCheckpointDateTimeDialog("添加检查点", zone, async (plannedAtUtc) => {
      const payload = buildCheckpointFirstCreatePayload({
        newItemId: newTravelMemberId(), title: newTripTitle, plannedAtUtc, titleText: "未命名检查点",
      });
      if (!options.onCreateFirstContent) throw new Error("出行创建入口不可用");
      await options.onCreateFirstContent(payload);
    });
  }

  function openCheckpointDateTimeDialog(
    title: string,
    zone: BusinessTimeZoneResponse,
    onCommit: (plannedAtUtc: string) => void | Promise<void>,
  ) {
    const dlg = createInsightDialog({ title, bodyHtml: "", submitLabel: "添加" });
    const timeHost = document.createElement("div");
    dlg.body.append(timeHost);
    let value: DateTimeValue = { date: "", time: "" };
    const picker = mountDecoupledDateTimePicker({
      defaultTrigger: { container: timeHost, className: "travel-rail-range-trigger" },
      onChange: (next) => { value = next; },
    });
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      pendingInputDialogDisposers.delete(cleanup);
      picker.dispose();
      void dlg.close();
      dlg.dispose();
    };
    pendingInputDialogDisposers.add(cleanup);
    dlg.bindChrome(cleanup);
    let committing = false;
    dlg.panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (committing) return;
      const minute = parseHm(value.time);
      if (!value.date || minute == null) {
        dlg.setError("请选择完整时间");
        return;
      }
      let plannedAtUtc: string;
      try {
        plannedAtUtc = new Date(instantForWall(value.date, minute, zone)).toISOString().replace(/\.\d{3}Z$/, "Z");
      } catch (error) {
        dlg.setError(error instanceof Error ? error.message : String(error));
        return;
      }
      committing = true;
      try {
        await onCommit(plannedAtUtc);
        cleanup();
      } catch (error) {
        dlg.setError(error instanceof Error ? error.message : String(error));
        committing = false;
      }
    });
    void dlg.open();
  }

  function parseHm(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  function openRangeDialog(
    title: string,
    pointOnly: boolean,
    onCommit: (value: DateTimeRangeValue) => void | Promise<void>,
    validateRange?: (value: DateTimeRangeValue) => string | null,
    ownedByRail = false,
  ) {
    const rangeHost = document.createElement("div");
    const dlg = createInsightDialog({ title, bodyHtml: "", submitLabel: "添加" });
    dlg.body.append(rangeHost);
    let rangeValue: DateTimeRangeValue = { startDate: "", startTime: "", endDate: "", endTime: "" };
    const rangePicker = mountDecoupledDateTimeRangePicker({
      defaultTrigger: { container: rangeHost, className: "travel-rail-range-trigger" },
      onChange: (v) => {
        rangeValue = v;
      },
    });
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (ownedByRail) pendingInputDialogDisposers.delete(cleanup);
      rangePicker.dispose();
      void dlg.close();
      dlg.dispose();
    };
    if (ownedByRail) pendingInputDialogDisposers.add(cleanup);
    dlg.bindChrome(cleanup);
    let committing = false;
    dlg.panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (committing) return;
      if (pointOnly) {
        if (!rangeValue.startDate || !rangeValue.startTime) {
          dlg.setError("请选择完整时间");
          return;
        }
      } else if (!isDateTimeRangeComplete(rangeValue)) {
        dlg.setError("请选择完整起止时间");
        return;
      }
      let rangeError: string | null | undefined;
      try {
        rangeError = validateRange?.(rangeValue);
      } catch (error) {
        dlg.setError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (rangeError) {
        dlg.setError(rangeError);
        return;
      }
      committing = true;
      try {
        await onCommit(rangeValue);
        cleanup();
      } catch (error) {
        dlg.setError(error instanceof Error ? error.message : String(error));
        committing = false;
      }
    });
    void dlg.open();
  }

  function renderPointRow(
    snapshot: TripSnapshot,
    point: CanonicalTravelPoint,
    index: number,
    points: CanonicalTravelPoint[],
    zone: BusinessTimeZoneResponse,
    caps: TripSnapshot["capabilities"],
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "travel-rail-point-row";
    const circle = document.createElement("button");
    circle.type = "button";
    circle.className = "travel-rail-point-circle";
    const shared = Boolean(point.frontActionId && point.rearActionId);
    if (shared) circle.classList.add("is-shared");
    const typeKey = circleTypeForPoint(snapshot, point, index, points);
    const glyph = flightGlyphForPoint(snapshot, point, index, points);
    if (typeKey) circle.innerHTML = transportationTypeIconSvg(typeKey, { size: 10, flightGlyph: glyph });
    if (shared) {
      const front = document.createElement("span");
      front.className = `travel-rail-actual-half front${point.actualFrontEndAtUtc ? " is-lit" : ""}`;
      const rear = document.createElement("span");
      rear.className = `travel-rail-actual-half rear${point.actualRearStartAtUtc ? " is-lit" : ""}`;
      circle.append(front, rear);
      const hasFrontActual = Boolean(point.actualFrontEndAtUtc);
      const hasRearActual = Boolean(point.actualRearStartAtUtc);
      circle.classList.add(hasFrontActual && hasRearActual ? "has-actual" : hasFrontActual || hasRearActual ? "has-partial-actual" : "no-actual");
    } else {
      const hasActual = point.attachmentKind === "checkpoint"
        ? Boolean(point.actualAtUtc)
        : Boolean(point.actualFrontEndAtUtc || point.actualRearStartAtUtc);
      circle.classList.add(hasActual ? "has-actual" : "no-actual");
    }
    if (caps.canRecordActual) {
      circle.addEventListener("click", () => openActualPopover(circle, snapshot, point, zone));
    }
    row.append(circle);
    const body = document.createElement("div");
    body.className = "travel-rail-point-body";
    const time = document.createElement(caps.canEditPlan ? "button" : "span");
    time.className = "travel-rail-point-time";
    time.textContent = formatPointLine(point.plannedAtUtc, null, null, zone);
    if (time instanceof HTMLButtonElement) {
      time.type = "button";
      time.setAttribute("aria-label", "修改计划时间");
      const generation = options.controller.getPlanEditGeneration();
      const epoch = loadEpoch;
      let pickerOpen = false;
      const picker = mountDecoupledDateTimePicker({
        anchor: time,
        value: utcToLocalParts(point.plannedAtUtc, zone),
        onOpenChange: (open) => { pickerOpen = open; },
        onChange: (value) => {
          if (disposed || activeItemId !== snapshot.item.id || loadEpoch !== epoch || options.controller.getPlanEditGeneration() !== generation) return;
          const minute = parseHm(value.time);
          if (!value.date || minute == null) return;
          const plannedAtUtc = new Date(instantForWall(value.date, minute, zone)).toISOString();
          const edit = point.ownerCheckpointId
            ? { kind: "moveCheckpoint" as const, checkpointId: point.ownerCheckpointId, plannedAtUtc, planEditGeneration: generation }
            : point.frontActionId && point.rearActionId
              ? { kind: "setSharedBoundary" as const, frontActionId: point.frontActionId, rearActionId: point.rearActionId, zone: "both" as const, plannedAtUtc, planEditGeneration: generation }
              : point.frontActionId
                ? { kind: "setBoundary" as const, actionId: point.frontActionId, side: "end" as const, plannedAtUtc, planEditGeneration: generation }
                : point.rearActionId
                  ? { kind: "setBoundary" as const, actionId: point.rearActionId, side: "start" as const, plannedAtUtc, planEditGeneration: generation }
                  : null;
          if (edit) void (options.onEditPlan ? options.onEditPlan(snapshot.item.id,{edit}) : options.controller.queueEditPlan(snapshot.item.id,{edit})).catch(error=>options.onError?.(String(error)));
        },
      });
      time.addEventListener("click", () => { if (pickerOpen) void picker.close(); else picker.open(); });
      disposers.push(() => picker.dispose());
    }
    body.append(time);
    mountPointEditors(body, snapshot, point);
    row.append(body);
    return row;
  }

  function mountPointEditors(host: HTMLElement, snapshot: TripSnapshot, point: CanonicalTravelPoint) {
    const itemId = snapshot.item.id;
    const fields: { key: "location" | "actionLabel"; label: string; value: string | null }[] = [
      { key: "location", label: "地点", value: point.location },
      { key: "actionLabel", label: "动作", value: point.actionLabel },
    ];
    for (const field of fields) {
      const value = resolveRailFieldText(itemId, `point:${point.pointId}:${field.key}`, field.value ?? "");
      if (!value && !snapshot.capabilities.canEditText) continue;
      const row = document.createElement("div");
      row.className = "travel-rail-point-field";
      const slot = document.createElement("div");
      const draftKey = `point:${point.pointId}:${field.key}` as TravelTextDraftKey;
      slot.dataset.travelField = draftKey;
      const inline = mountInlineTextField({
        container: slot,
        value,
        placeholder: field.label,
        contentSized: true,
        readOnly: !snapshot.capabilities.canEditText,
        onCommit: (value) => {
          queueRailTextCommit(
            itemId,
            draftKey,
            value,
            (v) => ({ pointId: point.pointId, [field.key]: v }),
            productivityTravelV2UpdatePoint,
          );
        },
      });
      disposers.push(() => inline.dispose());
      row.append(slot);
      host.append(row);
    }
  }

  function openActualPopover(
    anchor: HTMLElement,
    snapshot: TripSnapshot,
    point: CanonicalTravelPoint,
    zone: BusinessTimeZoneResponse,
  ) {
    const popover = document.createElement("div");
    popover.className = "travel-rail-actual-popover orbita-popover-panel";
    const portal = mountPopoverPortal({ anchor, popover, placement: "right" });
    disposers.push(() => portal.dispose());

    if (point.attachmentKind === "checkpoint") {
      const title = document.createElement("h4");
      title.textContent = "检查点实际";
      popover.append(title);
      const host = document.createElement("div");
      popover.append(host);
      const parts = utcToLocalParts(point.actualAtUtc ?? "", zone);
      const picker = mountDecoupledDateTimePicker({
        defaultTrigger: { container: host, className: "travel-rail-actual-trigger" },
        commitMode: "confirm",
        value: parts.date ? { date: parts.date, time: parts.time } : undefined,
        onChange: (value) => {
          if (!value.date || !value.time) return;
          const minute = parseHm(value.time);
          if (minute == null) return;
          const atUtc = new Date(instantForWall(value.date, minute, zone)).toISOString().replace(/\.\d{3}Z$/, "Z");
          const payload: TravelSetCheckpointCompletedPayload = {
            checkpointId: point.ownerCheckpointId!,
            completed: true,
            actualAtUtc: atUtc,
          };
          enqueueMutation(
            options.controller,
            snapshot.item.id,
            ({ requestId, snapshot: snap, expectedDataDir }) =>
              buildTravelEnvelope(expectedDataDir, snap, payload, { requestId }),
            productivityTravelV2SetCheckpointCompleted,
          );
          void portal.close();
        },
      });
      disposers.push(() => picker.dispose());
      void portal.open();
      return;
    }

    const shared = Boolean(point.frontActionId && point.rearActionId);
    if (shared) {
      appendActualSide(popover, "前段实际结束", point.actualFrontEndAtUtc, zone, () => {
        if (!point.frontActionId) return;
        options.controller.queueSetActual(snapshot.item.id, {
          target: { kind: "actionBoundary", actionId: point.frontActionId, side: "end" },
          mode: "clear",
          value: null,
        });
      }, (atUtc) => {
        if (!point.frontActionId) return;
        options.controller.queueSetActual(snapshot.item.id, {
          target: { kind: "actionBoundary", actionId: point.frontActionId, side: "end" },
          mode: actualBoundaryMode(point.actualFrontEndAtUtc, false),
          value: atUtc,
        });
        void portal.close();
      });
      appendActualSide(popover, "后段实际开始", point.actualRearStartAtUtc, zone, () => {
        if (!point.rearActionId) return;
        options.controller.queueSetActual(snapshot.item.id, {
          target: { kind: "actionBoundary", actionId: point.rearActionId, side: "start" },
          mode: "clear",
          value: null,
        });
      }, (atUtc) => {
        if (!point.rearActionId) return;
        options.controller.queueSetActual(snapshot.item.id, {
          target: { kind: "actionBoundary", actionId: point.rearActionId, side: "start" },
          mode: actualBoundaryMode(point.actualRearStartAtUtc, false),
          value: atUtc,
        });
        void portal.close();
      });
    } else {
      const actionId = point.frontActionId ?? point.rearActionId;
      const side = point.frontActionId ? "end" : "start";
      const current = side === "end" ? point.actualFrontEndAtUtc : point.actualRearStartAtUtc;
      appendActualSide(popover, "实际时间", current, zone, () => {
        if (!actionId) return;
        options.controller.queueSetActual(snapshot.item.id, {
          target: { kind: "actionBoundary", actionId, side },
          mode: "clear",
          value: null,
        });
      }, (atUtc) => {
        if (!actionId) return;
        options.controller.queueSetActual(snapshot.item.id, {
          target: { kind: "actionBoundary", actionId, side },
          mode: actualBoundaryMode(current, false),
          value: atUtc,
        });
        void portal.close();
      });
    }
    void portal.open();
  }

  function appendActualSide(
    popover: HTMLElement,
    label: string,
    currentUtc: string | null,
    zone: BusinessTimeZoneResponse,
    onClear: () => void,
    onConfirm: (atUtc: string) => void,
  ) {
    const title = document.createElement("h4");
    title.textContent = label;
    popover.append(title);
    const host = document.createElement("div");
    popover.append(host);
    const parts = utcToLocalParts(currentUtc ?? "", zone);
    const picker = mountDecoupledDateTimePicker({
      defaultTrigger: { container: host, className: "travel-rail-actual-trigger" },
      commitMode: "confirm",
      value: parts.date ? { date: parts.date, time: parts.time } : undefined,
      onChange: (value) => {
        if (!value.date || !value.time) return;
        const minute = parseHm(value.time);
        if (minute == null) return;
        const atUtc = new Date(instantForWall(value.date, minute, zone)).toISOString().replace(/\.\d{3}Z$/, "Z");
        onConfirm(atUtc);
      },
    });
    disposers.push(() => picker.dispose());
    const clearBtn = createButton("清除", { height: 26 });
    clearBtn.addEventListener("click", () => {
      onClear();
    });
    popover.append(clearBtn);
  }

  function renderSegment(
    snapshot: TripSnapshot,
    seg: TripSnapshot["segments"][number],
    start: CanonicalTravelPoint,
    end: CanonicalTravelPoint,
    zone: BusinessTimeZoneResponse,
    caps: TripSnapshot["capabilities"],
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "travel-rail-segment";
    const action = snapshot.actions.find((a) => a.id === seg.actionId);
    const transport = transportationForSegment(snapshot, seg.actionId);
    const line = document.createElement("div");
    const startActual = action?.actual.start.atUtc;
    const endActual = action?.actual.end.atUtc;
    line.className = `travel-rail-segment-line ${startActual && endActual ? "solid" : ""}`;
    wrap.append(line);
    if (transport?.transportationType === "flight") {
      mountTransportFields(wrap, snapshot, transport, caps.canEditText, "flight-number");
    }
    if (transport && transport.transportationType !== "flight") {
      const heading = document.createElement("div");
      heading.className = "travel-rail-segment-heading";
      const typeEl = document.createElement(caps.canChangeTransportationType ? "button" : "span");
      typeEl.className = "travel-rail-segment-type";
      typeEl.textContent = transport.transportationType ? transportationTypeLabelZh(transport.transportationType) : "类型";
      if (typeEl instanceof HTMLButtonElement) {
        typeEl.type = "button";
        typeEl.setAttribute("aria-label", `交通类型：${typeEl.textContent}`);
        typeEl.setAttribute("aria-haspopup", "listbox");
        typeEl.setAttribute("aria-expanded", "false");
        const popover = mountFlatSelectPopover({
          anchor: typeEl,
          options: [{ value: "", label: "空" }, ...TRANSPORTATION_TYPE_KEYS.map((key) => ({ value: key, label: TRANSPORTATION_TYPE_LABEL_ZH[key] }))],
          selected: new Set([transport.transportationType ?? ""]),
          multiple: false,
          search: true,
          onOpenChange: (open) => typeEl.setAttribute("aria-expanded", String(open)),
          onChange: (values) => patchTransport(snapshot.item.id, transport.id, "transportationType", (values.values().next().value || null) as TransportationType | null),
        });
        typeEl.addEventListener("click", () => { if (popover.isOpen()) void popover.close(); else void popover.open(); });
        disposers.push(() => popover.dispose());
      }
      heading.append(typeEl);
      const headingField = transport.transportationType === "bus" || transport.transportationType === "metro"
        ? { key: "serviceNumber" as const, placeholder: "线路" }
        : transport.transportationType === "taxi" || transport.transportationType === "bike" || transport.transportationType === "walk"
          ? { key: "note" as const, placeholder: "备注" } : null;
      if (headingField) {
        const draftKey = `transportation:${transport.id}:${headingField.key}` as TravelTextDraftKey;
        const nameValue = resolveRailFieldText(snapshot.item.id, draftKey, readTransportationField(transport, headingField.key));
        if (caps.canEditText || nameValue) {
          const name = document.createElement("div");
          name.className = "travel-rail-segment-name";
          name.classList.toggle("is-empty", !nameValue);
          const dot = document.createElement("span");
          dot.className = "travel-rail-segment-name-dot";
          dot.setAttribute("aria-hidden", "true");
          dot.textContent = "·";
          const slot = document.createElement("div");
          const field = mountInlineTextField({
            container: slot,
            value: nameValue,
            placeholder: headingField.placeholder,
            readOnly: !caps.canEditText,
            contentSized: true,
            onCommit: (value) => {
              name.classList.toggle("is-empty", !value);
              queueRailTextCommit(snapshot.item.id, draftKey, value, (v) => ({ transportationId: transport.id, [headingField.key]: v }), productivityTravelV2UpdateTransportation);
            },
          });
          disposers.push(() => field.dispose());
          name.append(dot, slot);
          heading.append(name);
        }
      }
      wrap.append(heading);
    }
    const duration = formatGapDuration(start.plannedAtUtc, end.plannedAtUtc);
    if (duration) {
      const dur = document.createElement("div");
      dur.className = "travel-rail-segment-duration";
      dur.textContent = duration;
      wrap.append(dur);
    }
    if (transport && !["flight", "bus", "metro", "taxi", "bike", "walk"].includes(transport.transportationType ?? "")) {
      const fieldsHost = document.createElement("div");
      fieldsHost.className = "travel-rail-segment-fields";
      mountTransportFields(fieldsHost, snapshot, transport, caps.canEditText, "all");
      wrap.append(fieldsHost);
    }
    return wrap;
  }

  function mountTransportFields(
    host: HTMLElement,
    snapshot: TripSnapshot,
    transport: Transportation,
    canEditText: boolean,
    scope: "all" | "flight-number" | "without-flight-number" = "all",
  ) {
    const defs = fieldsForTransportationType(transport.transportationType);
    for (const def of defs) {
      if (scope === "flight-number" && def.key !== "serviceNumber") continue;
      if (scope === "without-flight-number" && def.key === "serviceNumber") continue;
      if (def.key === "transportationType") {
        continue;
      }
      const row = document.createElement("div");
      row.className = "travel-rail-field-row";
      if (scope === "flight-number") row.classList.add("travel-rail-flight-number");
      const slot = document.createElement("div");
      const draftKey = `transportation:${transport.id}:${def.key}` as TravelTextDraftKey;
      slot.dataset.travelField = draftKey;
      const fieldValue = resolveRailFieldText(snapshot.item.id, draftKey, readTransportationField(transport, def.key));
      if (!canEditText && !fieldValue) continue;
      const inline = mountInlineTextField({
        container: slot,
        value: fieldValue,
        placeholder: canEditText ? def.label : "",
        readOnly: !canEditText,
        onCommit: (value) => {
          queueRailTextCommit(
            snapshot.item.id,
            draftKey,
            value,
            (v) => ({ transportationId: transport.id, [def.key]: v }),
            productivityTravelV2UpdateTransportation,
          );
        },
      });
      disposers.push(() => inline.dispose());
      row.append(slot);
      if (scope === "flight-number") {
        // GAP: no registered Insight icon-button. Page-private Lucide refresh-cw
        // uses --insight-icon-default / hover --insight-text-secondary only.
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "travel-rail-flight-refresh";
        refresh.setAttribute("aria-label", "刷新航班");
        refresh.title = "刷新航班";
        refresh.innerHTML = REFRESH_CW_ICON;
        refresh.addEventListener("click", () => {
          void refreshExistingFlight(snapshot, transport);
        });
        row.append(refresh);
      }
      host.append(row);
    }
  }

  function patchTransport(itemId: string, transportationId: string, key: TransportationFieldKey, value: string | TransportationType | null) {
    const draftKey = `transportation:${transportationId}:${key}` as TravelTextDraftKey;
    const textValue = value === null ? null : String(value);
    queueRailTextCommit(
      itemId,
      draftKey,
      textValue,
      () => ({ transportationId, [key]: value }),
      productivityTravelV2UpdateTransportation,
    );
  }

  function currentFlightCompareValues(snapshot: TripSnapshot, transport: Transportation): Record<string, string | null> {
    const action = snapshot.actions.find((row) => row.transportationId === transport.id);
    const startPoint = snapshot.points.find((point) => point.actionId === action?.id && point.role === "start");
    const endPoint = snapshot.points.find((point) => point.actionId === action?.id && point.role === "end");
    return {
      ...captureTransportValues(transport),
      plannedStartAt: action?.plannedStartAt ?? null,
      plannedEndAt: action?.plannedEndAt ?? null,
      actualStart: action?.actual.start.atUtc ?? action?.actual.start.pendingAtUtc ?? null,
      actualEnd: action?.actual.end.atUtc ?? action?.actual.end.pendingAtUtc ?? null,
      "start.location": startPoint?.location ?? null,
      "end.location": endPoint?.location ?? null,
      "start.actionLabel": startPoint?.actionLabel ?? null,
      "end.actionLabel": endPoint?.actionLabel ?? null,
    };
  }

  function refreshContextAlive(context: {
    itemId: string;
    transportationId: string;
    revision: number;
    dataDir: string;
    queryGeneration: number;
    flightNumber: string;
    date: string;
    departureCode: string;
    arrivalCode: string;
  }): boolean {
    const state = options.controller.getState();
    const snapshot = state.currentSnapshot;
    const transport = snapshot?.transportations.find((row) => row.id === context.transportationId);
    const action = snapshot?.actions.find((row) => row.transportationId === context.transportationId);
    const zone = options.getZone();
    const date = action && zone ? utcToLocalParts(action.plannedStartAt, zone).date : "";
    return Boolean(
      snapshot
      && transport
      && action
      && snapshot.item.id === context.itemId
      && snapshot.item.revision === context.revision
      && state.expectedDataDir === context.dataDir
      && state.queryGeneration === context.queryGeneration
      && (transport.serviceNumber ?? "").trim() === context.flightNumber
      && date === context.date
      && (transport.departureCode ?? "").trim().toUpperCase() === context.departureCode
      && (transport.arrivalCode ?? "").trim().toUpperCase() === context.arrivalCode,
    );
  }

  async function refreshExistingFlight(snapshot: TripSnapshot, transport: Transportation): Promise<void> {
    const zone = options.getZone();
    const action = snapshot.actions.find((row) => row.transportationId === transport.id);
    const flightNumber = (transport.serviceNumber ?? "").trim();
    const departureCode = (transport.departureCode ?? "").trim().toUpperCase();
    const arrivalCode = (transport.arrivalCode ?? "").trim().toUpperCase();
    if (!flightNumber || !action?.plannedStartAt) {
      openMessageDialog("刷新航班", "请填写航班号和计划出发时间后再刷新");
      return;
    }
    if (!/^[A-Z]{3}$/.test(departureCode) || !/^[A-Z]{3}$/.test(arrivalCode)) {
      openMessageDialog("刷新航班", "请在飞机信息中填写起降机场三字码后再刷新");
      return;
    }
    if (!zone) {
      openMessageDialog("刷新航班", "无法读取当前时区，请稍后重试");
      return;
    }
    const date = utcToLocalParts(action.plannedStartAt, zone).date;
    const queryInputs = {
      itemId: snapshot.item.id,
      transportationId: transport.id,
      revision: snapshot.item.revision,
      dataDir: options.controller.getState().expectedDataDir,
      flightNumber,
      date,
      departureCode,
      arrivalCode,
    };
    try {
      const result = await options.controller.queryFlight({
        itemId: snapshot.item.id,
        transportationId: transport.id,
        flightNumber,
        date,
      });
      const queryGeneration = result.queryGeneration;
      if (queryGeneration == null || !refreshContextAlive({ ...queryInputs, queryGeneration })) {
        openMessageDialog("刷新航班", "航班查询已过期，请重新刷新");
        return;
      }
      const queryError = flightQueryResultErrorMessage(result);
      if (queryError) {
        openMessageDialog("刷新航班", queryError);
        return;
      }
      const matched = matchCandidatesByIata(result.candidates as Record<string, unknown>[], departureCode, arrivalCode);
      if (matched.length === 0) {
        openMessageDialog("刷新航班", "没有与当前起降机场三字码匹配的航班，未自动选择");
        return;
      }
      if (matched.length > 1) {
        openMessageDialog("刷新航班", "找到多条匹配航段，未自动选择");
        return;
      }
      const candidate = matched[0]!;
      const live = options.controller.getState().currentSnapshot;
      const liveTransport = live?.transportations.find((row) => row.id === transport.id);
      if (!live || !liveTransport || !refreshContextAlive({ ...queryInputs, queryGeneration })) {
        openMessageDialog("刷新航班", "航班查询已过期，请重新刷新");
        return;
      }
      const rows = diffFlightValues(currentFlightCompareValues(live, liveTransport), mappedSourceValues(candidate));
      if (!rows.length) {
        openMessageDialog("刷新航班", "当前信息已是最新");
        return;
      }
      const dlg = createInsightDialog({ title: "确认更新航班", bodyHtml: "", submitLabel: "确认更新" });
      const list = document.createElement("div");
      list.className = "travel-rail-flight-diff";
      const checks = rows.map((row) => {
        const line = document.createElement("div");
        line.className = "travel-rail-flight-diff-row";
        const box = createCheckbox(true);
        box.addEventListener("click", () => {
          setCheckbox(box, !readCheckbox(box));
        });
        const text = document.createElement("span");
        text.textContent = `${row.label}：${row.current === "（空）" ? row.current : formatFlightDiffValue(row.field, row.current, zone)} → ${formatFlightDiffValue(row.field, row.source, zone)}`;
        line.append(box, text);
        list.append(line);
        return { field: row.field, box };
      });
      dlg.body.append(list);
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        pendingInputDialogDisposers.delete(cleanup);
        void dlg.close();
        dlg.dispose();
      };
      trackDialog(cleanup);
      dlg.bindChrome(cleanup);
      const confirmUpdate = () => {
        if (!refreshContextAlive({ ...queryInputs, queryGeneration })) {
          cleanup();
          openMessageDialog("刷新航班", "航班查询已过期，请重新刷新");
          return;
        }
        const selectedFields = checks.filter((row) => readCheckbox(row.box)).map((row) => row.field);
        const currentState = options.controller.getState();
        const expectedDataDir = currentState.expectedDataDir;
        const adoptionToken = buildAdoptionToken(
          snapshot.item.id,
          transport.id,
          expectedDataDir,
          queryGeneration,
          queryInputs.revision,
        );
        const beforeValues = captureTransportValues(liveTransport);
        adoptBaselinePending = {
          transportId: transport.id,
          adoptionToken,
          generation: queryGeneration,
          beforeValues: { ...beforeValues },
        };
        options.controller.setRestoreBaseline?.({
          transportationId: transport.id,
          adoptionToken,
          generation: queryGeneration,
          beforeValues: { ...beforeValues },
          adoptedValues: {},
        });
        options.controller.queueAdoptFlight(snapshot.item.id, {
          transportationId: transport.id,
          candidate: {
            ...candidate,
            fetchedAtUtc: result.fetchedAtUtc,
            sourceRecordKey: flightCandidateSourceKey(candidate, flightNumber, date),
          },
          raw: candidate,
          adoptionToken,
          queryGeneration,
          restoreBaselineGeneration: queryGeneration,
          selectedFields,
        });
        cleanup();
        void options.onProductivityRefresh?.();
        render();
      };
      dlg.panel.addEventListener("submit", (event) => {
        event.preventDefault();
        const submitBtn = dlg.panel.querySelector<HTMLButtonElement>('[type="submit"]');
        if (submitBtn) {
          void runButtonAction(submitBtn, { pending: { label: "更新中…" }, task: async () => confirmUpdate() });
          return;
        }
        confirmUpdate();
      });
      void dlg.open();
    } catch (error) {
      openMessageDialog("刷新航班", error instanceof Error ? error.message : String(error));
    }
  }

  function syncAdoptBaselineFromController(): void {
    if (!adoptBaselinePending) return;
    const state = options.controller.getState();
    if (state.saveState === "saving") return;
    if (state.saveState === "failed") {
      adoptBaselinePending = null;
      return;
    }
    const snapshot = state.currentSnapshot;
    if (!snapshot) return;
    const transport = snapshot.transportations.find((t) => t.id === adoptBaselinePending!.transportId);
    if (!transport) return;
    const pending = adoptBaselinePending;
    adoptBaselinePending = null;
    const report = adoptionReportFromTransport(transport);
    const token = report?.adoptionToken ?? pending.adoptionToken;
    const adoptedValues = report?.adopted.length
      ? adoptedValuesFromReport(transport, report)
      : captureTransportValues(transport);
    options.controller.setRestoreBaseline({
      transportationId: pending.transportId,
      adoptionToken: token,
      generation: pending.generation,
      beforeValues: { ...pending.beforeValues },
      adoptedValues: { ...adoptedValues },
    });
  }

  function adoptionReportFromTransport(transport: Transportation): TravelAdoptionReport | null {
    const raw = transport.sourceSnapshot?.adoptionReport;
    if (!raw || typeof raw !== "object") return null;
    const report = raw as Record<string, unknown>;
    const parseList = (value: unknown): TravelAdoptionFieldReport[] => {
      if (!Array.isArray(value)) return [];
      return value
        .filter((entry) => Boolean(entry && typeof entry === "object" && typeof (entry as { field?: unknown }).field === "string"))
        .map((entry) => {
          const row = entry as { field: string; status?: TravelAdoptionFieldReport["status"]; reason?: string | null };
          return {
            field: row.field,
            status: row.status ?? "skipped",
            reason: row.reason ?? null,
          };
        });
    };
    const adoptionToken = typeof report.adoptionToken === "string" ? report.adoptionToken : "";
    if (!adoptionToken) return null;
    return {
      adoptionToken,
      adopted: parseList(report.adopted),
      skipped: parseList(report.skipped),
      conflicting: parseList(report.conflicting),
    };
  }

  function renderAdoptionReportSummary(transport: Transportation): HTMLElement | null {
    const report = adoptionReportFromTransport(transport);
    if (!report) return null;
    const lines: string[] = [];
    if (report.adopted.length) lines.push(`已采纳 ${report.adopted.length} 项`);
    if (report.skipped.length) {
      const detail = report.skipped.map((e) => `${e.field}${e.reason ? `（${e.reason}）` : ""}`).join("、");
      lines.push(`跳过 ${report.skipped.length} 项：${detail}`);
    }
    if (report.conflicting.length) {
      const detail = report.conflicting.map((e) => `${e.field}${e.reason ? `（${e.reason}）` : ""}`).join("、");
      lines.push(`冲突 ${report.conflicting.length} 项：${detail}`);
    }
    if (!lines.length) return null;
    const el = document.createElement("div");
    el.className = "travel-rail-adoption-report";
    el.textContent = lines.join("；");
    return el;
  }

  function renderRestoreAdoption(snapshot: TripSnapshot, transport: Transportation): HTMLElement | null {
    const baseline = options.controller.getState().restoreBaseline;
    if (!baseline || baseline.transportationId !== transport.id) return null;
    if (!Object.keys(baseline.adoptedValues).length) return null;
    const row = document.createElement("div");
    row.className = "travel-rail-restore-row";
    const btn = createButton("恢复本次采纳", { height: 28 });
    btn.addEventListener("click", () => {
      const fields = Object.keys(baseline.adoptedValues);
      options.controller.queueRestoreAdoptionFields(snapshot.item.id, {
        transportationId: baseline.transportationId,
        adoptionToken: baseline.adoptionToken,
        fields,
        expectedCurrentValues: { ...baseline.adoptedValues },
      });
    });
    row.append(btn);
    return row;
  }

  function captureTransportValues(transport: Transportation): Record<string, string | null> {
    const keys = fieldsForTransportationType(transport.transportationType).map((f) => f.key);
    const out: Record<string, string | null> = {};
    for (const key of keys) {
      if (key === "transportationType") out[key] = transport.transportationType;
      else out[key] = readTransportationField(transport, key) || null;
    }
    return out;
  }

  function adoptedValuesFromReport(transport: Transportation, report: TravelAdoptionReport): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const entry of report.adopted) {
      const key = entry.field as TransportationFieldKey;
      if (key === "transportationType") out[key] = transport.transportationType;
      else out[key] = readTransportationField(transport, key) || null;
    }
    return out;
  }

  function applySetItem(itemId: string | null) {
    draftRequestGeneration += 1;
    if (newTripDraft) for (const cleanup of [...pendingInputDialogDisposers]) cleanup();
    const previousItemId = activeItemId;
    if (previousItemId && previousItemId !== itemId) {
      clearRailFieldStateForItem(previousItemId);
    }
    activeItemId = itemId;
    newTripDraft = false;
    loadEpoch += 1;
    adoptBaselinePending = null;
    disposeAll();
    if (!itemId) {
      options.controller.setEditingSelection(null);
      root.replaceChildren();
      return;
    }
    // Generic detail rendering may have replaced the host after this rail was
    // initially mounted. Reclaim the host whenever a concrete travel item is
    // selected so the async load/render cannot update a detached rail subtree.
    if (root.parentElement !== options.host) options.host.replaceChildren(root);
    options.controller.setEditingSelection({ itemId });
    const epoch = loadEpoch;
    void options.controller.loadTrip(itemId).then(() => {
      if (epoch !== loadEpoch || activeItemId !== itemId) return;
      render();
    }).catch((error) => {
      if (epoch !== loadEpoch || activeItemId !== itemId) return;
      options.onError?.(error instanceof Error ? error.message : String(error));
      root.replaceChildren();
    });
  }

  return {
    isNewTripDraft: () => newTripDraft,
    newTripDraftGeneration: () => newTripDraft ? draftRequestGeneration : null,
    refresh() {
      if (completionAnimationTimer) return;
      render();
    },
    syncControllerState() {
      syncAdoptBaselineFromController();
    },
    setItem(itemId: string | null) {
      if (itemId === activeItemId && !newTripDraft) {
        draftRequestGeneration += 1;
        if (itemId && root.parentElement !== options.host) {
          options.host.replaceChildren(root);
          render();
        }
        return;
      }
      const requestGeneration = ++draftRequestGeneration;
      void confirmDiscardUnsaved().then((discard) => {
        if (!discard || disposed || requestGeneration !== draftRequestGeneration) return;
        applySetItem(itemId);
      });
    },
    async beginNewTripDraft() {
      const requestGeneration = ++draftRequestGeneration;
      if (!(await confirmDiscardUnsaved())) return false;
      if (disposed || requestGeneration !== draftRequestGeneration) return false;
      if (newTripDraft) for (const cleanup of [...pendingInputDialogDisposers]) cleanup();
      loadEpoch += 1;
      activeItemId = null;
      newTripDraft = true;
      newTripTitle = "未命名出行";
      disposeAll();
      // Generic Item detail rendering can replace the shared host while this
      // rail remains cached. Reclaim it before rendering an in-memory draft.
      if (root.parentElement !== options.host) options.host.replaceChildren(root);
      options.controller.setEditingSelection(null);
      render();
      return true;
    },
    dispose() {
      disposed = true;
      window.clearTimeout(completionAnimationTimer);
      draftRequestGeneration += 1;
      loadEpoch += 1;
      activeItemId = null;
      for (const cancel of [...pendingDiscardGuardCancels]) cancel();
      for (const cleanup of [...pendingInputDialogDisposers]) cleanup();
      disposeAll();
      root.remove();
    },
  };
}

/** V2 travel item for an action (legacy travelKind excluded). */
function v2TravelItemIdForItemTarget(
  itemId: string,
  items: ItemSnapshot[],
  itemTypes: { id: string; systemRole?: string | null }[],
  v2TravelProfileIds: ReadonlySet<string>,
): string | null {
  const item = items.find((entry) => entry.id === itemId);
  if (!item || item.travelKind) return null;
  if (v2TravelProfileIds.has(item.id)) return item.id;
  const type = itemTypes.find((entry) => entry.id === item.itemTypeId);
  if (type?.systemRole === "travel") return item.id;
  return null;
}

export function v2TravelItemIdForAction(
  actionId: string,
  items: ItemSnapshot[],
  actions: { id: string; targetKind?: string | null; targetId?: string | null }[],
  itemTypes: { id: string; systemRole?: string | null }[],
  v2TravelProfileIds: ReadonlySet<string>,
): string | null {
  const action = actions.find((candidate) => candidate.id === actionId);
  if (action?.targetKind !== "item" || !action.targetId) return null;
  return v2TravelItemIdForItemTarget(action.targetId, items, itemTypes, v2TravelProfileIds);
}

export function v2TravelItemIdForCheckpoint(
  checkpoint: { targetKind?: string | null; targetId?: string | null },
  items: ItemSnapshot[],
  itemTypes: { id: string; systemRole?: string | null }[],
  v2TravelProfileIds: ReadonlySet<string>,
): string | null {
  if (checkpoint.targetKind !== "item" || !checkpoint.targetId) return null;
  return v2TravelItemIdForItemTarget(checkpoint.targetId, items, itemTypes, v2TravelProfileIds);
}

/** Resolve v2 travel item id from task selection (legacy travelKind items excluded). */
export function resolveV2TravelItemId(
  selection: { kind: string; id: string } | null,
  items: ItemSnapshot[],
  actions: { id: string; targetKind?: string | null; targetId?: string | null }[],
): string | null {
  if (!selection) return null;
  if (selection.kind === "item") {
    const item = items.find((i) => i.id === selection.id);
    if (!item || item.travelKind) return null;
    return item.id;
  }
  if (selection.kind === "action") {
    const action = actions.find((a) => a.id === selection.id);
    if (action?.targetKind !== "item" || !action.targetId) return null;
    const item = items.find((i) => i.id === action.targetId);
    if (!item || item.travelKind) return null;
    return item.id;
  }
  return null;
}

export function itemIsV2TravelCandidate(
  itemId: string,
  items: ItemSnapshot[],
  itemTypes: { id: string; systemRole?: string | null }[],
  v2TravelProfileIds: ReadonlySet<string>,
): boolean {
  return v2TravelItemIdForItemTarget(itemId, items, itemTypes, v2TravelProfileIds) !== null;
}

export async function itemLooksLikeV2Travel(
  itemId: string,
  expectedDataDir: string,
  itemTypes: { id: string; systemRole?: string | null }[],
  item: ItemSnapshot | undefined,
): Promise<boolean> {
  if (!item || item.travelKind) return false;
  const type = itemTypes.find((t) => t.id === item.itemTypeId);
  if (type?.systemRole !== "travel") return false;
  const snapshot = await fetchTravelV2Trip(itemId, expectedDataDir);
  return Boolean(snapshot);
}
