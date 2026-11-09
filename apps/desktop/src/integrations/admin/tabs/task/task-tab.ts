import {
  productivityAssignItemToList,
  productivityCommitItemWithActions,
  productivityCreateTravel,
  productivityCommitThingLifecycle,
  productivityCreateAction,
  productivityDeleteTravel,
  productivityGetTravel,
  productivityAdoptTravelFlight,
  productivityCreateSession,
  productivityDeleteAction,
  productivityDeleteSessionOnly,
  productivityDeleteTaskSubtree,
  productivityEndAction,
  productivityGetBusinessTimeZone,
  productivityGetItemTypeCatalog,
  productivityListActions,
  productivityListCheckpoints,
  productivityCompleteCheckpoint,
  productivityReopenCheckpoint,
  productivityUpdateCheckpoint,
  productivityDeleteCheckpoint,
  productivityCommitItemWithCheckpoint,
  productivityCreateCheckpoint,
  productivityClearCheckpointTarget,
  productivitySetCheckpointTarget,
  productivityDeleteProject,
  productivityListItems,
  productivityListLists,
  productivityGetListItemMembers,
  productivityDeleteListAndMoveItemsToInbox,
  productivityListProjects,
  productivityListSessions,
  productivityListTags,
  productivityMoveItemToList,
  productivityPauseAction,
  productivityRemoveItemFromList,
  productivityResumeAction,
  productivityReopenAction,
  productivityClearActionTarget,
  productivitySetActionTarget,
  productivitySetItemStatus,
  productivitySetTaskStatus,
  productivityStartAction,
  productivityEditActionInterval,
  productivityUpdateAction,
  productivityUpdateItem,
  productivityUpdateSession,
  productivityUpdateTask,
  productivityQueryTravelSource,
  productivityGetTaskListSnapshot,
  ackInsightItemNavigation,
  getInsightItemNavigationResult,
} from "../../../productivity/client";
import { runButtonAction } from "../../../../ui/action-motion";
import { createWeekHealthControls } from "./week-health-controls";
import { listen } from "@tauri-apps/api/event";
import { productivityCreateItem, productivityCreateItemAfter, productivityDeleteItem, productivityReorderItems, productivityMoveItemToListAndPlace } from "../../../productivity/client";
import { createButton } from "../../../../ui/button";
import type { ActionSnapshot, BusinessTimeZoneResponse, ItemOrderSnapshot, ItemTypeCatalogSnapshot, ItemTypeSnapshot, ItemSnapshot, ListSnapshot, ProductivityPoint, ProjectSnapshot, SessionSnapshot, TagSnapshot, TravelRangeInput, TravelSnapshot, TravelSourceQueryResponse, UpdateTravelRequest } from "../../../productivity/types";
import type { CheckpointSnapshot } from "../../../productivity/checkpoint-types";
import { selectTaskViewState } from "../../tab-host/host-api";
import { getConfirmDialog } from "../../../shell/dialog";
import type { InsightDestinationHandle, InsightHostContext, NavigationState, NavigationToken, NavigationResult } from "../../types";
import { invokeErrorText } from "../item-compose";
import { mountItemList } from "./item-list";
import { openItemDetailDialog, type ItemDetailNavigationHandle } from "./item-detail";
import { ArrangementHistory } from "./arrangement-history";
import { createArrangementPlanHistory, type ArrangementPlanGraph } from "./arrangement-plan-history";
import { createArrangementTravelHistory } from "./arrangement-travel-history";
import { assertHealthPlanMoveBaseline } from "./health-plan-baseline";
import { registerArrangementUndoInputOwner } from "../../undo-input";
import { addDays, dateAt, defaultSessionTitle, instantForWall, mondayOf, targets, type Target } from "./arrangement-model";
import { mountArrangementWeek, type ActionMoveBaseline, type CheckpointMoveBaseline, type SessionMoveBaseline, type WeekMove, type WeekCreate, type WeekCopy } from "./arrangement-week";
import { ARROW_LEFT_SVG, CLIPBOARD_LIST_SVG, metaIcon, mountArrangementDetail, type DetailSelection } from "./arrangement-detail";
import { compareRailActions } from "./arrangement-detail-order-status";
import { chooseArrangementCreation } from "./arrangement-create";
import { createTaskRail, unarchiveList } from "./task-rail";
import { mountItemTypeManager, type ItemTypeManagerHandle } from "./item-type-manager";
import { deleteItems, moveItemsToList, prepareDeleteItems } from "./list-actions";
import { ITEM_TYPE_PALETTE } from "./item-type-palette";
import { getSettings } from "../../../../core/data/settings";
import { escHtml } from "../../../../core/html";
import { appendFlightResultCard, flightResultCardFromRecord, formatFlightStamp } from "./travel/flight-result-card";
import { mountDecoupledDatePicker, type DecoupledDatePickerHandle } from "../../../../ui/decoupled-date-picker";
import { mountDecoupledDateTimeRangePicker, type DecoupledDateTimeRangePickerHandle, type DateTimeRangeValue } from "../../../../ui/decoupled-datetime-range-picker";
import { resolveCategoryRoles } from "../../../../ui/color-system";
import "../../../../ui/insight-dialog.css";
import {
  filterToScope,
  liveLists,
  activeLists,
  scopeKey,
  scopeToRestoreFilter,
  type ScopeVisibility,
  type TaskDataSlice,
  type TaskScope,
} from "./task-selectors";
import "./task.css";
import { applyTaskSelectionClasses, createTaskSelectionState, updateTaskSelection } from "./task-selection";
import { TravelController } from "../../../productivity/travel-v2";
import { newTravelMemberId, productivityTravelV2Get, productivityTravelV2ListWeek, productivityTravelV2UpdatePoint } from "../../../productivity/travel-v2/client";
import type { TravelTextDraftKey } from "../../../productivity/travel-v2/types";
import type {
  TravelListWeekResult,
} from "../../../productivity/travel-v2/types";
import {
  itemIsV2TravelCandidate,
  itemLooksLikeV2Travel,
  mountTravelRail,
  resolveV2TravelItemId,
  v2TravelItemIdForAction,
  v2TravelItemIdForCheckpoint,
  type TravelRailHandle,
} from "./travel/rail";
import { travelSplitPoliciesFromUi } from "./travel/week-split-policies";
import { travelWeekRange } from "./travel/week-range";

type TaskDestState = { view?: "week" | "list"; filter?: string };

type FlightCandidate = {
  flightNumber: string;
  airline: string;
  depCode: string;
  depName: string;
  depAt: string;
  depActualAt: string;
  arrCode: string;
  arrName: string;
  arrAt: string;
  arrActualAt: string;
  aircraft: string;
  sourceRecord?: Record<string, unknown>;
  matchedSegments?: Record<string, unknown>[];
};

type FlightQueryState = {
  candidates: FlightCandidate[];
  request: { fnum: string; date: string };
  fetchedAtUtc: string;
  itemRevision: number;
};


function pythonLiteralToJson(input: string): string {
  let out = "";
  let index = 0;
  while (index < input.length) {
    const quote = input[index];
    if (quote === "'" || quote === '"') {
      index += 1;
      let raw = "";
      while (index < input.length) {
        const char = input[index];
        if (char === "\\") {
          const next = input[index + 1];
          if (next === undefined) break;
          raw += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
          index += 2;
          continue;
        }
        if (char === quote) {
          index += 1;
          break;
        }
        raw += char;
        index += 1;
      }
      out += JSON.stringify(raw);
      continue;
    }
    if (/[A-Za-z_]/.test(input[index])) {
      const start = index;
      index += 1;
      while (index < input.length && /[A-Za-z0-9_]/.test(input[index])) index += 1;
      const word = input.slice(start, index);
      out += word === "None" ? "null" : word === "True" ? "true" : word === "False" ? "false" : word;
      continue;
    }
    out += input[index];
    index += 1;
  }
  return out;
}

function parseLooseStructuredText(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.search(/[{[]/);
  const candidates = start > 0 ? [trimmed, trimmed.slice(start)] : [trimmed];
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* VariFlight tool text is often a Python literal. */ }
    try { return JSON.parse(pythonLiteralToJson(candidate)); } catch { /* try the next candidate */ }
  }
  return null;
}

function flightRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((entry) => flightRecords(entry));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const direct = [object.records, object.data, object.flights, object.result]
    .flatMap((entry) => Array.isArray(entry) ? entry : entry && typeof entry === "object" ? [entry] : []);
  const content = Array.isArray(object.content) ? object.content : [];
  const textRecords = content.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).text !== "string") return [];
    const parsed = parseLooseStructuredText((entry as Record<string, string>).text);
    return parsed == null ? [] : flightRecords(parsed);
  });
  const own = typeof object.FlightNo === "string" || typeof object.flightNo === "string" ? [object] : [];
  return [...own, ...direct.flatMap((entry) => flightRecords(entry)), ...textRecords];
}

export function parseTravelFlightCandidates(response: TravelSourceQueryResponse): FlightCandidate[] {
  const records = flightRecords(response.result);
  return records.map((record) => {
    const stopCode = String(record.StopAirportCode ?? "").trim();
    const isStopover = String(record.StopFlag ?? "") === "1" && stopCode;
    const matchedSegments = isStopover ? records.filter((segment) => {
      const sameFlight = String(segment.FlightNo ?? segment.flightNo ?? "") === String(record.FlightNo ?? record.flightNo ?? "");
      const first = String(segment.FlightDepcode ?? segment.depCode ?? "") === String(record.FlightDepcode ?? record.depCode ?? "")
        && String(segment.FlightArrcode ?? segment.arrCode ?? "") === stopCode;
      const second = String(segment.FlightDepcode ?? segment.depCode ?? "") === stopCode
        && String(segment.FlightArrcode ?? segment.arrCode ?? "") === String(record.FlightArrcode ?? record.arrCode ?? "");
      return sameFlight && (first || second);
    }) : [record];
    return {
    flightNumber: String(record.FlightNo ?? record.flightNo ?? ""),
    airline: String(record.FlightCompany ?? record.airline ?? ""),
    depCode: String(record.FlightDepcode ?? record.depCode ?? ""),
    depName: String(record.FlightDepAirport ?? record.depName ?? ""),
    depAt: String(record.FlightDeptimePlanDate ?? record.depAt ?? ""),
    depActualAt: String(record.FlightDeptimeDate ?? ""),
    arrCode: String(record.FlightArrcode ?? record.arrCode ?? ""),
    arrName: String(record.FlightArrAirport ?? record.arrName ?? ""),
    arrAt: String(record.FlightArrtimePlanDate ?? record.arrAt ?? ""),
    arrActualAt: String(record.FlightArrtimeDate ?? ""),
    aircraft: String(record.ftype ?? record.aircraftTypeCode ?? ""),
      sourceRecord: record,
      matchedSegments: matchedSegments.length === 2 ? matchedSegments : [record],
    };
  }).filter((candidate) => candidate.flightNumber);
}

function resolveItemOrder(
  payload: { itemOrder?: ItemOrderSnapshot },
  prior: ItemOrderSnapshot | null,
): ItemOrderSnapshot | null {
  if (payload.itemOrder) return payload.itemOrder;
  return prior;
}

function scopeHeading(scope: TaskScope, lists: ListSnapshot[]): string {
  switch (scope.kind) {
    case "all":
      return "所有任务";
    case "inbox":
      return "Inbox";
    case "list": {
      const list = lists.find((l) => l.id === scope.listId);
      return list?.title ?? "清单";
    }
    case "archived-index":
      return "已归档";
    case "archived-list": {
      const list = lists.find((l) => l.id === scope.listId);
      return list?.title ?? "已归档清单";
    }
  }
}

export function mountTaskTab(root: HTMLElement, _ctx: InsightHostContext): InsightDestinationHandle {
  type TaskNavigationRoute = { view: "week" | "list"; scope: TaskScope; categoryManager: boolean; selection: DetailSelection; carrier: "rail" | "dialog"; dialogItemId: string | null; focusId: string | null };
  let navigationReady = false;
  let applyingNavigation = false;
  let focusNavigationId: string | null = null;
  let detailDialogItemId: string | null = null;
  let itemDialog: ItemDetailNavigationHandle | null = null;
  let reloadFailure: unknown = null;
  let healthRouteSelection: DetailSelection = null;
  let healthRouteFocus: string | null = null;
  const travelSelectionRoutes = new WeakSet<object>();

  function captureTaskNavigation(): NavigationState {
    const scroll = weekEl.querySelector<HTMLElement>(".arrangement-grid-scroll");
    const navigationSelection = selectedHealth ? healthRouteSelection : selection;
    return { route: { view, scope: { ...scope }, categoryManager: categoryManagerMode, selection: navigationSelection ? { ...navigationSelection } : null,
      carrier: detailDialogItemId ? "dialog" : "rail", dialogItemId: detailDialogItemId, focusId: selectedHealth ? healthRouteFocus : focusNavigationId } satisfies TaskNavigationRoute,
      context: { weekDay, listDate: listDate ? { ...listDate } : null, listTop: mainEl.scrollTop, listLeft: mainEl.scrollLeft,
        weekTop: scroll?.scrollTop ?? 0, weekLeft: scroll?.scrollLeft ?? 0, visibility: { ...getVisibility() } } };
  }
  function requestTaskNavigation(patch: Partial<TaskNavigationRoute>, returnToPrevious = false): boolean {
    if (!navigationReady || applyingNavigation || !_ctx.navigation) return false;
    const state = captureTaskNavigation();
    void _ctx.navigation.navigate({ ...state, route: { ...(state.route as TaskNavigationRoute), ...patch } }, { returnToPrevious });
    return true;
  }
  function showCategoryManager(): void {
    if (requestTaskNavigation({ categoryManager: true, dialogItemId: null, carrier: "rail" })) return;
    categoryManagerMode = true; centerEl.hidden = true; detailEl.hidden = true; managerEl.hidden = false;
    categoryManager?.syncCanonical(itemTypeCatalog); categoryManager?.show();
  }
  let scope: TaskScope = { kind: "all" };
  let view: "week" | "list" = "week";
  let selection: DetailSelection = null;
  let focusedCheckpointId: string | null = null;
  let navigationBusy = false;
  let pendingNavigation: { request: import("../../../productivity/types").ClaimedInsightNavigation; hostInstanceId: string } | null = null;
  let navigationGeneration = 0;
  let flightDatePicker: DecoupledDatePickerHandle | null = null;
  const flightEditPickers: DecoupledDateTimeRangePickerHandle[] = [];
  const flightEditModes = new Set<string>();
  const flightManualFresh = new Set<string>();
  const flightEditDrafts = new Map<string, { serviceNumber: string; operatorName: string; aircraftType: string; seatNumber: string; ranges: TravelRangeInput[] }>();
  const flightEditDirty = new Map<string, Set<string>>();
  const flightEditRangeDirty = new Map<string, Set<number>>();
  const flightEditRangeFields = new Map<string, Map<number, Set<string>>>();
  const flightEditQueues = new Map<string, Promise<void>>();
  const flightEntryDrafts = new Map<string, { flightNumber: string; date: string }>();
  const flightQueryResults = new Map<string, FlightQueryState>();
  const flightSelectedCandidates = new Map<string, number>();
  const travelDetails = new Map<string, TravelSnapshot["detail"]>();
  const travelSnapshots = new Map<string, TravelSnapshot>();
  const travelDetailLoaded = new Set<string>();
  const travelDetailLoading = new Set<string>();
  const flightWeekSnapshotLoading = new Set<string>();
  const flightWeekSnapshotFailed = new Set<string>();
  const flightSelectionSaving = new Set<string>();
  const flightQueryLoading = new Set<string>();
  let flightQueryGeneration = 0;
  let travelController: TravelController | null = null;
  let travelRail: TravelRailHandle | null = null;
  const v2TravelProfileIds = new Set<string>();
  let travelRailEditing = false;
  let travelListWeekCache: TravelListWeekResult | null = null;
  let travelListWeekCacheKey = "";
  let travelWeekRequestGeneration = 0;
  let travelWeekInFlight: { key: string; promise: Promise<void> } | null = null;
  let weekDay = "";
  let listDate: { start: string; end: string } | null = null;
  let zone: BusinessTimeZoneResponse | null = null;
  let actions: ActionSnapshot[] = [];
  let checkpoints: CheckpointSnapshot[] = [];
  let sessions: SessionSnapshot[] = [];
  let projects: ProjectSnapshot[] = [];
  let itemTypes: ItemTypeSnapshot[] = [];
  let itemTypeCatalog: ItemTypeCatalogSnapshot | null = null;
  let tags: TagSnapshot[] = [];
  let targetIndex = new Map<string, Target>();
  let loadGeneration = 0;
  let itemTypeGeneration = 0;
  let railGeneration = 0;
  let draggedActionId: string | null = null;
  let draggedActionBaseline: ActionMoveBaseline | null = null;
  let draggedCheckpointBaseline: CheckpointMoveBaseline | null = null;
  const pendingPlans = new Set<string>();
  const visibilityByScope = new Map<string, ScopeVisibility>();
  let store: TaskDataSlice = { lists: [], items: [], itemOrder: null };
  let loading = true;
  let listReady = false;
  let loadError: string | null = null;
  let disposed = false;
  let categoryManagerMode = false;
  let categoryManager: ItemTypeManagerHandle | null = null;
  const taskSelection = createTaskSelectionState();
  const expectedDataDir = _ctx.dataDirKey && _ctx.dataDirKey !== "_default"
    ? _ctx.dataDirKey
    : getSettings().dataDir.trim();
  let selectedHealth: string | null = null;
  let undoOwnerActive = false;
  let historyNeedsReconcile = false;
  let historyReconciliationBusy = false;
  let historyResetBlocked = false;
  const historyGeneration = _ctx.generation;
  const historyIsCurrent = () => !disposed && _ctx.generation === historyGeneration && getSettings().dataDir.trim() === expectedDataDir;
  const arrangementHistory = new ArrangementHistory({ ownerId: `arrangement:${historyGeneration}:${root.dataset.surface ?? "work"}:${crypto.randomUUID()}`,
    epoch: historyGeneration, expectedDataDir }, () => historyIsCurrent() && !historyReconciliationBusy && !historyResetBlocked, (message) => { historyNeedsReconcile = true; setError(message); });
  const planHistory = createArrangementPlanHistory({
    history: arrangementHistory, isCurrent: historyIsCurrent,
    snapshot: () => ({ actions, checkpoints, sessions, items: store.items, projects, lists: store.lists }),
    async read(): Promise<ArrangementPlanGraph> {
      const [a,c,s,i,p,l] = await Promise.all([productivityListActions(expectedDataDir), productivityListCheckpoints({includeDeleted:true}), productivityListSessions(), productivityListItems({}), productivityListProjects(), productivityListLists()]);
      if (!historyIsCurrent()) throw new Error("安排实例或数据目录已变化。");
      return { actions:a.actions, checkpoints:c.checkpoints, sessions:s.sessions, items:i.items, projects:p.projects, lists:l.lists };
    },
    install(changes) {
      if (!historyIsCurrent()) return;
      if (changes.actions) actions = actions.map((value) => changes.actions!.find((next) => next.id === value.id) ?? value);
      if (changes.checkpoints) checkpoints = checkpoints.map((value) => changes.checkpoints!.find((next) => next.id === value.id) ?? value);
      if (changes.sessions) sessions = sessions.map((value) => changes.sessions!.find((next) => next.id === value.id) ?? value);
      if (changes.items) store = {...store,items:store.items.map((value) => changes.items!.find((next) => next.id === value.id) ?? value)};
      if (changes.health) health.acceptPlan(changes.health);
    },
    refresh: async () => { await refreshAfterWrite(); if (reloadFailure) throw reloadFailure; },
    report: setError,
  });
  const releaseUndoOwner = registerArrangementUndoInputOwner({
    isActive: () => undoOwnerActive && historyIsCurrent(),
    isBusy: () => historyReconciliationBusy || historyResetBlocked || arrangementHistory.isBusy || pendingPlans.size > 0 || (travelController?.getState().queueDepth ?? 0) > 0,
    request: (direction) => arrangementHistory.replay(direction),
    onError: (error) => setError(invokeErrorText(error)),
  });
  const travelHistory = createArrangementTravelHistory({history:arrangementHistory,isCurrent:historyIsCurrent,report:setError,
    installLegacy(snapshot){
      if(!historyIsCurrent())return;
      store={...store,items:store.items.map(item=>item.id===snapshot.item.id?snapshot.item:item)};
      actions=actions.map(action=>snapshot.actions.find(next=>next.id===action.id)??action);
      travelSnapshots.set(snapshot.item.id,snapshot);travelDetails.set(snapshot.item.id,snapshot.detail);travelDetailLoaded.add(snapshot.item.id);
    },
    refresh:async()=>{await reload();if(reloadFailure)throw reloadFailure;},
  });
  async function refreshAndReconcileHistory(): Promise<void> {
    if (arrangementHistory.isBusy || historyReconciliationBusy) return;
    const reconcile = arrangementHistory.isFrozen || historyNeedsReconcile || historyResetBlocked;
    if (reconcile && !(await getConfirmDialog()("刷新核对并清空撤销历史？", "请核对当前计划结果。读取成功后将清空这份安排实例的撤销历史，并解除结果待核实状态。", undefined, {confirmLabel:"刷新并清空"}))) return;
    if (arrangementHistory.isBusy) return;
    historyReconciliationBusy = reconcile;
    try {
      await reload();
      if (reloadFailure) throw reloadFailure;
      if (reconcile && historyIsCurrent()) {
        // Keep the old history frozen until the backend confirms its owner-scoped release.
        await travelController?.resetPlanHistory({ownerId:arrangementHistory.scope.ownerId,hostEpoch:historyGeneration});
        if (!historyIsCurrent()) return;
        arrangementHistory.clear();
        historyNeedsReconcile = false;
        historyResetBlocked = false;
      }
    } catch (error) {
      if (!reconcile) throw error;
      historyNeedsReconcile = true;
      historyResetBlocked = true;
      setError(`撤销历史仍冻结，核对或清理尚未完成：${invokeErrorText(error)}。请再次使用刷新核对并清空历史；不要重新提交原操作。`);
    } finally { historyReconciliationBusy = false; }
  }
  const health = createWeekHealthControls({root:expectedDataDir,
    alive:()=>!disposed&&getSettings().dataDir.trim()===expectedDataDir,
    catalog:()=>itemTypeCatalog,zone:()=>zone,refresh:()=>reload(),error:setError,
    updatePlan:(plan,start,end)=>planHistory.health(plan,start,end),
    select:(id,action)=>{
      if (!selectedHealth) { healthRouteSelection = selection; healthRouteFocus = focusNavigationId; }
      applyingNavigation = true;
      try { selectObject(action?{kind:"action",id:action}:null,action,false); selectedHealth=id; detailEl.replaceChildren(); if (travelRailEditing) week?.render(); else week?.syncSelection(); }
      finally { applyingNavigation = false; }
    },
  });
  let unlistenHealth: (()=>void) | null = null;
  void listen<{dataDir:string}>("productivity-data-invalidated",event=>{
    if(!disposed&&event.payload.dataDir===expectedDataDir&&getSettings().dataDir.trim()===expectedDataDir)void reload();
  }).then(stop=>{if(disposed)stop();else unlistenHealth=stop;}).catch(()=>{});

  root.innerHTML = `
    <div class="insight-chat-page insight-task-page">
      <aside class="insight-chat-rail"></aside>
      <div class="insight-chat-main arrangement-center">
        <div class="insight-chat-main-bar task-toolbar" data-region="toolbar">
          <div class="insight-chat-heading" data-region="heading">所有任务</div>
          <div class="task-toolbar-toggles" data-region="toggles"></div>
        </div>
        <p class="task-scope-message" data-region="scope-message" hidden></p>
        <div class="task-main" data-region="main"></div>
        <div class="arrangement-week-host" data-region="week" hidden></div>
        <p class="task-page-error" data-region="error" hidden></p>
      </div>
      <div class="item-type-manager-page" data-region="type-manager" hidden></div>
      <aside class="arrangement-detail-rail" data-region="detail"></aside>
    </div>`;

  const headingEl = root.querySelector<HTMLElement>('[data-region="heading"]')!;
  const toolbarEl = root.querySelector<HTMLElement>('[data-region="toolbar"]')!;
  const togglesEl = root.querySelector<HTMLElement>('[data-region="toggles"]')!;
  const mainEl = root.querySelector<HTMLElement>('[data-region="main"]')!;
  const weekEl = root.querySelector<HTMLElement>('[data-region="week"]')!;
  const detailEl = root.querySelector<HTMLElement>('[data-region="detail"]')!;
  const centerEl = root.querySelector<HTMLElement>(".arrangement-center")!;
  const managerEl = root.querySelector<HTMLElement>('[data-region="type-manager"]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-region="error"]')!;
  const scopeMessageEl = root.querySelector<HTMLElement>('[data-region="scope-message"]')!;
  const toolbarLeading = document.createElement("div");
  toolbarLeading.className = "task-toolbar-leading";
  const backToWeekButton = createButton("", { width: 32, height: 32, iconSize: 18 });
  backToWeekButton.classList.add("task-list-back", "orbita-picker-nav-arrow");
  backToWeekButton.setAttribute("aria-label", "返回");
  backToWeekButton.title = "返回";
  const backIcon = metaIcon(ARROW_LEFT_SVG);
  backIcon.classList.add("task-list-back-icon");
  backToWeekButton.append(backIcon);
  toolbarEl.insertBefore(toolbarLeading, headingEl);
  toolbarLeading.appendChild(backToWeekButton);
  toolbarLeading.appendChild(headingEl);
  backToWeekButton.addEventListener("click", () => selectWeek());
  function today(): string { return zone ? dateAt(Date.now(), zone) : new Date().toISOString().slice(0, 10); }
  function visibleFirstDay(): string { return weekDay || addDays(today(), -2); }
  function travelWeekRangeUtc(): { fromUtc: string; toUtc: string } {
    return travelWeekRange(visibleFirstDay(), zone);
  }
  let pauseRequestGeneration = 0;
  let pauseRequestKey = "";
  let pauseInFlightKey = "";
  function invalidateActivityPauses(): void {
    pauseRequestGeneration++;
    pauseRequestKey = "";
    pauseInFlightKey = "";
  }
  function refreshActivityPauses(): void {
    if (view !== "week" || disposed || !zone || !health.getData() || getSettings().dataDir.trim() !== expectedDataDir) return;
    const { fromUtc, toUtc } = travelWeekRangeUtc();
    const key = `${expectedDataDir}|${fromUtc}|${toUtc}|${loadGeneration}`;
    if (key === pauseRequestKey || key === pauseInFlightKey) return;
    const turn = ++pauseRequestGeneration, generation = loadGeneration;
    pauseInFlightKey = key;
    const current = () => {
      if (disposed || view !== "week" || !zone || turn !== pauseRequestGeneration || generation !== loadGeneration || getSettings().dataDir.trim() !== expectedDataDir) return false;
      const range = travelWeekRangeUtc();
      return range.fromUtc === fromUtc && range.toUtc === toUtc;
    };
    void health.loadActivityPauses(fromUtc, toUtc, current).then(changed => {
      if (!current()) return;
      pauseRequestKey = key;
      if (changed) week?.render();
    }).catch(error => {
      if (current()) setError(`运动暂停区段加载失败：${invokeErrorText(error)}`);
    }).finally(() => { if (turn === pauseRequestGeneration) pauseInFlightKey = ""; });
  }
  function refreshTravelListWeekBestEffort(): Promise<void> {
    if (view !== "week" || disposed) return Promise.resolve();
    const dataDir = getSettings().dataDir.trim();
    if (dataDir !== expectedDataDir) return Promise.resolve();
    const { fromUtc, toUtc } = travelWeekRangeUtc();
    const key = `${dataDir}|${fromUtc}|${toUtc}`;
    if (key === travelListWeekCacheKey && travelListWeekCache) {
      if (travelWeekInFlight && travelWeekInFlight.key !== key) {
        travelWeekRequestGeneration++;
        travelWeekInFlight = null;
      }
      return Promise.resolve();
    }
    if (travelWeekInFlight?.key === key) return travelWeekInFlight.promise;
    const generation = loadGeneration;
    const requestGeneration = ++travelWeekRequestGeneration;
    const promise = (async () => {
      try {
        const list = await productivityTravelV2ListWeek({ expectedDataDir: dataDir, fromUtc, toUtc });
        // Older desktop backends do not include snapshots; keep their compatibility
        // without changing the selected trip or publishing a half-loaded week.
        const snapshots = await Promise.all(list.items.map((entry) => entry.snapshot
          ? Promise.resolve(entry.snapshot)
          : productivityTravelV2Get({ itemId: entry.itemId, expectedDataDir: dataDir })));
        const currentRange = travelWeekRangeUtc();
        const currentKey = `${dataDir}|${currentRange.fromUtc}|${currentRange.toUtc}`;
        if (disposed || view !== "week" || key !== currentKey || requestGeneration !== travelWeekRequestGeneration || generation !== loadGeneration || getSettings().dataDir.trim() !== expectedDataDir) return;
        ensureTravelRailStack();
        for (const snapshot of snapshots) travelController!.cacheWeekSnapshot(snapshot);
        travelListWeekCache = list;
        travelListWeekCacheKey = key;
        rememberV2TravelItems(list.items.map((entry) => entry.itemId));
        week?.render();
      } catch (error) {
        if (!disposed && requestGeneration === travelWeekRequestGeneration) setError(`出行加载失败：${invokeErrorText(error)}`);
      } finally {
        if (travelWeekInFlight?.promise === promise) travelWeekInFlight = null;
      }
    })();
    travelWeekInFlight = { key, promise };
    return promise;
  }
  async function ensureCurrentTravelWeek(): Promise<void> {
    const generation = loadGeneration;
    while (!disposed && view === "week" && generation === loadGeneration) {
      const before = travelWeekRangeUtc();
      await refreshTravelListWeekBestEffort();
      const after = travelWeekRangeUtc();
      const currentKey = `${expectedDataDir}|${after.fromUtc}|${after.toUtc}`;
      if (before.fromUtc === after.fromUtc && before.toUtc === after.toUtc && travelWeekInFlight?.key !== currentKey) return;
    }
  }
  function refreshCalendar() {
    const selected = view === "week" ? Array.from({ length: 7 }, (_, index) => {
      const date = Date.parse(`${visibleFirstDay()}T00:00:00Z`) + index * 86_400_000;
      return new Date(date).toISOString().slice(0, 10);
    }) : [];
    taskRail.setCalendar(view === "week" ? visibleFirstDay() : listDate?.start ?? today(), selected, listDate);
  }
  function enterTravelEdit(): void {
    travelRailEditing = true;
    travelRail?.refresh();
    week?.syncTravelEditing();
  }
  function exitTravelEdit(): void {
    travelRailEditing = false;
    travelRail?.refresh();
    renderDetail();
    week?.syncTravelEditing();
  }
  function rememberV2TravelItems(itemIds: Iterable<string>): void {
    for (const itemId of itemIds) v2TravelProfileIds.add(itemId);
  }
  function ensureTravelRailStack(): void {
    const dataDir = getSettings().dataDir.trim();
    if (!travelController) {
      travelController = new TravelController({
        expectedDataDir: dataDir,
        historyScope:{ownerId:arrangementHistory.scope.ownerId,hostEpoch:historyGeneration},
        onStateChange: () => {
          travelRail?.syncControllerState();
          travelRail?.refresh();
        },
        onSnapshotCommitted: () => {
          void reload().then(()=>{if(reloadFailure)setError(`行程已保存，页面刷新失败：${invokeErrorText(reloadFailure)}`);},(error)=>setError(`行程已保存，页面刷新失败：${invokeErrorText(error)}`));
        },
      });
    } else if (travelController.getState().expectedDataDir !== dataDir) {
      travelController.setExpectedDataDir(dataDir);
    }
    if (!travelRail) {
      travelRail = mountTravelRail({
        host: detailEl,
        controller: travelController,
        getZone: () => zone,
        getDefaultQueryDate: () => (weekDay || visibleFirstDay()),
        getEditing: () => travelRailEditing,
        onEnterEdit: enterTravelEdit,
        onExitEdit: exitTravelEdit,
        onError: (message) => setError(message.slice(0, 240)),
        onEditPlan:(itemId,payload)=>travelHistory.v2(travelController!,itemId,payload),
        onCreateFirstContent: async (payload) => {
          const creationGeneration = railGeneration;
          const draftGeneration = travelRail?.newTripDraftGeneration();
          const result = await travelController!.createTrip(payload);
          const createdItemId = result.snapshot.item.id;
          rememberV2TravelItems([createdItemId]);
          travelListWeekCache = null;
          travelListWeekCacheKey = "";
          await reload();
          if (disposed || railGeneration !== creationGeneration || draftGeneration == null || travelRail?.newTripDraftGeneration() !== draftGeneration) return;
          travelRailEditing = true;
          selectObject({ kind: "item", id: createdItemId });
          // Route explicitly from the authoritative create result. The generic
          // item list can lag the travel mutation's snapshot/reload callback.
          ensureTravelRailStack();
          travelRail!.setItem(createdItemId);
        },
      });
    }
  }

  function probeV2TravelForSelection(): void {
    const candidateId = resolveV2TravelItemId(selection, store.items, actions);
    if (!candidateId || travelItemForSelection(selection)) return;
    if (v2TravelProfileIds.has(candidateId)) return;
    const item = store.items.find((entry) => entry.id === candidateId);
    void itemLooksLikeV2Travel(candidateId, expectedDataDir, itemTypes, item).then((ok) => {
      if (disposed) return;
      if (ok) v2TravelProfileIds.add(candidateId);
      if (resolveV2TravelItemId(selection, store.items, actions) === candidateId) renderDetail();
    });
  }

  function selectObject(next: DetailSelection, focusActionId?: string, renderWeek = true) {
    if (requestTaskNavigation({ selection: next, focusId: focusActionId ?? null, carrier: "rail", dialogItemId: null })) return;
    focusNavigationId = focusActionId ?? null;
    selectedHealth = null;
    const previousV2 = resolveV2TravelItemId(selection, store.items, actions);
    const previousTravel = travelItemForSelection(selection);
    if (previousTravel && flightManualFresh.has(previousTravel.id)) {
      flightManualFresh.delete(previousTravel.id);
      flightEditDrafts.delete(previousTravel.id);
      flightEditDirty.delete(previousTravel.id);
      flightEditRangeDirty.delete(previousTravel.id);
      flightEditRangeFields.delete(previousTravel.id);
      flightEditModes.delete(previousTravel.id);
    }
    railGeneration++;
    flightQueryGeneration++;
    selection = next;
    focusedCheckpointId = focusActionId && checkpoints.some((checkpoint) => checkpoint.id === focusActionId) ? focusActionId : null;
    const nextV2 = resolveV2TravelItemId(selection, store.items, actions);
    if (nextV2) {
      travelController?.setEditingSelection({ itemId: nextV2 });
    } else {
      travelController?.setEditingSelection(null);
    }
    probeV2TravelForSelection();
    renderDetail(true);
    if (focusActionId && !travelItemForSelection(selection)) detail.focusAction(focusActionId);
    if (renderWeek) {
      if (travelRailEditing && previousV2 !== nextV2) week?.render();
      else week?.syncSelection();
    }
  }

  function travelItemForSelection(value: DetailSelection): ItemSnapshot | null {
    if (!value) return null;
    if (value.kind === "item") return store.items.find((item) => item.id === value.id && item.travelKind) ?? null;
    if (value.kind === "action") {
      const action = actions.find((candidate) => candidate.id === value.id);
      return action?.targetKind === "item" && action.targetId
        ? store.items.find((item) => item.id === action.targetId && item.travelKind) ?? null
        : null;
    }
    return null;
  }
  function hasAdoptedFlightSource(detail: TravelSnapshot["detail"]): boolean {
    const source = detail?.sourceSnapshot;
    return !!source && source.schemaVersion === 1 && typeof source.provider === "string"
      && !!source.request && typeof source.request === "object"
      && !!source.rawRecord && typeof source.rawRecord === "object";
  }
  function applyAdoptedTravelProjection(snapshot: TravelSnapshot): void {
    const itemId = snapshot.item.id;
    store = { ...store, items: store.items.map((item) => item.id === itemId ? snapshot.item : item) };
    actions = actions.filter((action) => !(action.targetKind === "item" && action.targetId === itemId));
    actions.push(...snapshot.actions);
    targetIndex = targets(store.items, projects, itemTypes);
    travelSnapshots.set(itemId, snapshot);
    travelDetails.set(itemId, snapshot.detail ?? null);
    travelDetailLoaded.add(itemId);
    week?.render();
    renderDetail();
  }
  function ensureFlightWeekSnapshots(): void {
    if (disposed || view !== "week") return;
    const itemIds = new Set(actions
      .filter((action) => action.targetKind === "item" && action.targetId)
      .map((action) => action.targetId!)
      .filter((id) => store.items.find((item) => item.id === id)?.travelKind === "flight"));
    const pending = [...itemIds].filter((id) => !travelSnapshots.has(id) && !flightWeekSnapshotLoading.has(id) && !flightWeekSnapshotFailed.has(id));
    if (!pending.length) return;
    const generation = loadGeneration;
    const requestedDataDir = expectedDataDir;
    pending.forEach((id) => flightWeekSnapshotLoading.add(id));
    void Promise.all(pending.map((id) => productivityGetTravel({ itemId: id, includeDeleted: false }).then((snapshot) => {
      if (disposed || generation !== loadGeneration || getSettings().dataDir.trim() !== requestedDataDir) return;
      travelSnapshots.set(id, snapshot);
      flightWeekSnapshotFailed.delete(id);
      travelDetails.set(id, snapshot.detail ?? null);
      travelDetailLoaded.add(id);
    }).catch(() => { flightWeekSnapshotFailed.add(id); }).finally(() => flightWeekSnapshotLoading.delete(id)))).then(() => {
      if (!disposed && generation === loadGeneration && view === "week") week?.render();
    });
  }
  function loadTravelDetail(item: ItemSnapshot): void {
    if (travelDetailLoaded.has(item.id) || travelDetailLoading.has(item.id)) return;
    travelDetailLoading.add(item.id);
    const generation = flightQueryGeneration;
    void productivityGetTravel({ itemId: item.id, includeDeleted: false }).then((snapshot) => {
      if (disposed || generation !== flightQueryGeneration || travelItemForSelection(selection)?.id !== item.id) return;
      travelSnapshots.set(item.id, snapshot);
      travelDetails.set(item.id, snapshot.detail ?? null);
      travelDetailLoaded.add(item.id);
      renderDetail();
    }).catch(() => {
      if (!disposed && generation === flightQueryGeneration && travelItemForSelection(selection)?.id === item.id) {
        travelDetails.set(item.id, null);
        travelDetailLoaded.add(item.id);
      }
    }).finally(() => travelDetailLoading.delete(item.id));
  }
  function sourceValue(record: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
    return "";
  }
  function renderFlightInfoPage(item: ItemSnapshot, snapshot: TravelSnapshot): void {
    const source = snapshot.detail?.sourceSnapshot;
    const raw = source?.rawRecord && typeof source.rawRecord === "object" ? source.rawRecord as Record<string, unknown> : {};
    const flightNumber = sourceValue(raw, "FlightNo", "flightNo");
    const airline = sourceValue(raw, "FlightCompany", "airline");
    const aircraft = snapshot.detail?.aircraftType ?? sourceValue(raw, "ftype", "aircraftTypeCode", "aircraft");
    const departure = { code: sourceValue(raw, "FlightDepcode", "depCode"), name: sourceValue(raw, "FlightDepAirport", "depName"), at: sourceValue(raw, "FlightDeptimePlanDate", "depAt") };
    const arrival = { code: sourceValue(raw, "FlightArrcode", "arrCode"), name: sourceValue(raw, "FlightArrAirport", "arrName"), at: sourceValue(raw, "FlightArrtimePlanDate", "arrAt") };
    const stamp = (value: string) => {
      const parts = formatFlightStamp(value);
      return parts.date ? `<span class="flight-info-date">${escHtml(parts.date)}</span><span class="flight-info-time">${escHtml(parts.time)}</span>` : `<span class="flight-info-time">${escHtml(value || "—")}</span>`;
    };
    const stop = (point: { code: string; name: string; at: string; terminal?: string | null; gate?: string | null }, label: string) => `<div class="flight-info-stop"><div class="flight-info-stop-marker" aria-hidden="true"></div><div class="flight-info-stop-content"><div class="flight-info-stop-label">${label}</div><div class="flight-info-stop-code">${escHtml(point.code || "—")}</div><div class="flight-info-stop-name">${escHtml(point.name || "—")}</div>${point.terminal ? `<div class="flight-info-terminal">航站楼 ${escHtml(point.terminal)}</div>` : ""}${point.gate ? `<div class="flight-info-gate">登机口 ${escHtml(point.gate)}</div>` : ""}<div class="flight-info-source-time">${stamp(point.at)}</div></div></div>`;
    const legs = [...snapshot.legs].sort((a, b) => a.position - b.position);
    const timeline = legs.length ? [
      { code: legs[0]!.departureCode ?? departure.code, name: legs[0]!.departureName ?? departure.name, terminal: legs[0]!.departureTerminal, gate: legs[0]!.departureGate, at: sourceValue(legs[0]!.sourceSnapshot, "FlightDeptimePlanDate", "depAt") || departure.at },
      ...legs.map((leg) => ({ code: leg.arrivalCode ?? "", name: leg.arrivalName ?? "", terminal: leg.arrivalTerminal, gate: leg.arrivalGate, at: sourceValue(leg.sourceSnapshot, "FlightArrtimePlanDate", "arrAt") })),
    ] : [departure, arrival];
    const actionTimes = snapshot.actions.filter((action) => action.targetKind === "item" && action.targetId === item.id).sort((a, b) => (a.plannedStartAt ?? "").localeCompare(b.plannedStartAt ?? ""));
    const planned = actionTimes.length ? `<div class="flight-info-planned">安排时间：${escHtml(actionTimes[0]!.plannedStartAt || "—")} · ${escHtml(actionTimes[actionTimes.length - 1]!.plannedEndAt || "—")}</div>` : "";
    const seat = snapshot.detail?.seatNumber ? `<div><span class="flight-info-label">座位号</span><strong>${escHtml(snapshot.detail.seatNumber)}</strong></div>` : "";
    detailEl.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><div class="arrangement-thing-title">${escHtml(item.title)}</div></div></div><div class="flight-info-summary"><div><span class="flight-info-label">航班号</span><strong>${escHtml(flightNumber || "—")}</strong></div><div><span class="flight-info-label">航司</span><strong>${escHtml(airline || "—")}</strong></div><div><span class="flight-info-label">机型</span><strong>${escHtml(aircraft || "—")}</strong></div>${seat}</div><div class="flight-info-timeline" aria-label="航班起降信息">${timeline.map((point, index) => stop(point, index === 0 ? "出发" : index === timeline.length - 1 ? "到达" : "经停")).join("")}</div>${planned}`;
    const edit = createButton("编辑");
    edit.className += " flight-info-edit";
    edit.addEventListener("click", () => {
      flightEditModes.add(item.id);
      flightManualFresh.delete(item.id);
      flightEditDirty.set(item.id, new Set());
      flightEditRangeDirty.set(item.id, new Set());
      flightEditRangeFields.set(item.id, new Map());
      renderDetail();
    });
    detailEl.querySelector(".arrangement-detail-head")!.append(edit);
  }
  function splitDateTime(value: string | null | undefined): { date: string; time: string } {
    const match = (value ?? "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return match ? { date: match[1]!, time: match[2]! } : { date: "", time: "" };
  }
  function rangeValue(start: string | null | undefined, end: string | null | undefined): DateTimeRangeValue {
    const a = splitDateTime(start); const b = splitDateTime(end);
    return { startDate: a.date, startTime: a.time, endDate: b.date, endTime: b.time };
  }
  function rangeIso(value: DateTimeRangeValue): { start: string | null; end: string | null } {
    const start = value.startDate && value.startTime ? `${value.startDate}T${value.startTime}:00` : null;
    const end = value.endDate && value.endTime ? `${value.endDate}T${value.endTime}:00` : null;
    if ((!start && !end) || (start && end)) return { start, end };
    return { start: null, end: null };
  }
  function enqueueFlightEditSave(item: ItemSnapshot, snapshot: TravelSnapshot, draft: { serviceNumber: string; operatorName: string; aircraftType: string; seatNumber: string; ranges: TravelRangeInput[] }): void {
    const previous = flightEditQueues.get(item.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const dirty = flightEditDirty.get(item.id) ?? new Set<string>();
      const rangeDirty = flightEditRangeDirty.get(item.id) ?? new Set<number>();
      if (!dirty.size && !rangeDirty.size) return;
      const savingDirty = new Set(dirty);
      const savingRangeDirty = new Set(rangeDirty);
      const base = travelSnapshots.get(item.id) ?? snapshot;
      const current = await productivityGetTravel({ itemId: item.id, includeDeleted: false });
      if (current.item.revision !== base.item.revision || current.actions.some((action) => action.revision !== (base.actions.find((candidate) => candidate.id === action.id)?.revision ?? -1))) throw new Error("航班已被其他修改，请刷新后重试");
      const request: UpdateTravelRequest = { expectedDataDir, item: ref(current.item), actionRevisions: savingRangeDirty.size ? current.actions.map(ref) : [] };
      if (savingDirty.has("serviceNumber")) request.serviceNumber = draft.serviceNumber.trim() || null;
      if (savingDirty.has("operatorName")) request.operatorName = draft.operatorName.trim() || null;
      if (savingDirty.has("aircraftType")) request.aircraftType = draft.aircraftType.trim() || null;
      if (savingDirty.has("seatNumber")) request.seatNumber = draft.seatNumber.trim() || null;
      if (savingRangeDirty.size) {
        const fieldsByRange = flightEditRangeFields.get(item.id) ?? new Map<number, Set<string>>();
        request.ranges = draft.ranges.map((range, index) => {
          const baseline = current.legs[index];
          const merged: TravelRangeInput = {
            plannedStartAt: current.actions.find((action) => action.id === baseline?.actionId)?.plannedStartAt ?? null,
            plannedEndAt: current.actions.find((action) => action.id === baseline?.actionId)?.plannedEndAt ?? null,
            departureCode: baseline?.departureCode ?? null,
            departureName: baseline?.departureName ?? null,
            arrivalCode: baseline?.arrivalCode ?? null,
            arrivalName: baseline?.arrivalName ?? null,
            departureTerminal: baseline?.departureTerminal ?? null,
            arrivalTerminal: baseline?.arrivalTerminal ?? null,
            departureGate: baseline?.departureGate ?? null,
            arrivalGate: baseline?.arrivalGate ?? null,
          };
          const changed = fieldsByRange.get(index);
          if (!changed) return merged;
          changed.forEach((field) => { (merged as unknown as Record<string, unknown>)[field] = (range as unknown as Record<string, unknown>)[field] ?? null; });
          return merged;
        });
      }
      const updated = await travelHistory.legacy(request,current);
      if (disposed || travelItemForSelection(selection)?.id !== item.id) return;
      (Object.keys({ serviceNumber: 1, operatorName: 1, aircraftType: 1, seatNumber: 1 }) as Array<"serviceNumber" | "operatorName" | "aircraftType" | "seatNumber">).forEach((key) => {
        const sent = request[key] ?? "";
        if (savingDirty.has(key) && draft[key] === sent) dirty.delete(key);
      });
      savingRangeDirty.forEach((index) => {
        const changed = flightEditRangeFields.get(item.id)?.get(index);
        if (!changed) return;
        [...changed].forEach((field) => {
          if ((draft.ranges[index] as unknown as Record<string, unknown>)[field] === (request.ranges?.[index] as unknown as Record<string, unknown> | undefined)?.[field]) changed.delete(field);
        });
        if (!changed.size) rangeDirty.delete(index);
      });
      if (flightManualFresh.has(item.id) && !dirty.size && !rangeDirty.size) {
        flightManualFresh.delete(item.id);
        flightEditDrafts.delete(item.id);
      }
      travelSnapshots.set(item.id, updated); travelDetails.set(item.id, updated.detail ?? null); travelDetailLoaded.add(item.id); renderDetail();
    });
    flightEditQueues.set(item.id, next);
    void next.then(
      () => { if (flightEditQueues.get(item.id) === next) flightEditQueues.delete(item.id); },
      (error) => {
        if (flightEditQueues.get(item.id) === next) flightEditQueues.delete(item.id);
        if (!disposed && travelItemForSelection(selection)?.id === item.id) setError(invokeErrorText(error).slice(0, 240));
      },
    );
  }
  function renderFlightEditForm(item: ItemSnapshot, snapshot: TravelSnapshot | null): void {
    const detail = snapshot?.detail;
    const fresh = flightManualFresh.has(item.id);
    if (!snapshot && !fresh) {
      detailEl.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><div class="arrangement-thing-title">${escHtml(item.title)}</div></div></div><p class="flight-info-edit-loading">加载航班详情…</p>`;
      return;
    }
    const baseRanges = (snapshot?.legs ?? []).map((leg) => { const action = snapshot?.actions.find((candidate) => candidate.id === leg.actionId); return { plannedStartAt: action?.plannedStartAt ?? null, plannedEndAt: action?.plannedEndAt ?? null, departureCode: leg.departureCode, departureName: leg.departureName, arrivalCode: leg.arrivalCode, arrivalName: leg.arrivalName, departureTerminal: leg.departureTerminal, arrivalTerminal: leg.arrivalTerminal, departureGate: leg.departureGate, arrivalGate: leg.arrivalGate }; });
    const freshRanges = baseRanges.map(() => ({ plannedStartAt: null, plannedEndAt: null, departureCode: null, departureName: null, arrivalCode: null, arrivalName: null, departureTerminal: null, arrivalTerminal: null, departureGate: null, arrivalGate: null }));
    const existing = flightEditDrafts.get(item.id);
    const draft = existing ?? { serviceNumber: fresh ? "" : detail?.serviceNumber ?? "", operatorName: fresh ? "" : detail?.operatorName ?? "", aircraftType: fresh ? "" : detail?.aircraftType ?? "", seatNumber: fresh ? "" : detail?.seatNumber ?? "", ranges: fresh ? freshRanges : baseRanges };
    if (existing && baseRanges.length && existing.ranges.length !== baseRanges.length) draft.ranges = fresh ? freshRanges : baseRanges.map((base, index) => ({ ...base, ...(existing.ranges[index] ?? {}) }));
    flightEditDrafts.set(item.id, draft);
    if (!flightEditDirty.has(item.id)) flightEditDirty.set(item.id, new Set());
    if (!flightEditRangeDirty.has(item.id)) flightEditRangeDirty.set(item.id, new Set());
    if (!flightEditRangeFields.has(item.id)) flightEditRangeFields.set(item.id, new Map());
    detailEl.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><div class="arrangement-thing-title">${escHtml(item.title)}</div></div></div><div class="flight-info-edit-fields"><label>航班号<input data-flight-edit="serviceNumber" value="${escHtml(draft.serviceNumber)}" /></label><label>航司<input data-flight-edit="operatorName" value="${escHtml(draft.operatorName)}" /></label><label>机型<input data-flight-edit="aircraftType" value="${escHtml(draft.aircraftType)}" /></label><label>座位号<input data-flight-edit="seatNumber" value="${escHtml(draft.seatNumber)}" /></label></div><div class="flight-info-edit-legs" data-flight-edit-legs></div><button type="button" class="flight-results-back" data-flight-edit-back>返回详情</button>`;
    const legsHost = detailEl.querySelector<HTMLElement>("[data-flight-edit-legs]")!;
    (snapshot?.legs ?? []).forEach((leg, index) => {
      const range = draft.ranges[index]!;
      const row = document.createElement("div"); row.className = "flight-info-edit-leg"; row.innerHTML = `<div class="flight-info-edit-leg-title">第${index + 1}段</div><div class="flight-info-edit-grid"><input data-edit-range="${index}:departureCode" value="${escHtml(range.departureCode ?? "")}" placeholder="出发代码" /><input data-edit-range="${index}:departureName" value="${escHtml(range.departureName ?? "")}" placeholder="出发机场" /><input data-edit-range="${index}:departureTerminal" value="${escHtml(range.departureTerminal ?? "")}" placeholder="出发航站楼" /><input data-edit-range="${index}:departureGate" value="${escHtml(range.departureGate ?? "")}" placeholder="出发登机口" /><input data-edit-range="${index}:arrivalCode" value="${escHtml(range.arrivalCode ?? "")}" placeholder="到达代码" /><input data-edit-range="${index}:arrivalName" value="${escHtml(range.arrivalName ?? "")}" placeholder="到达机场" /><input data-edit-range="${index}:arrivalTerminal" value="${escHtml(range.arrivalTerminal ?? "")}" placeholder="到达航站楼" /><input data-edit-range="${index}:arrivalGate" value="${escHtml(range.arrivalGate ?? "")}" placeholder="到达登机口" /><div class="flight-info-edit-time" data-edit-time></div></div>`;
      legsHost.append(row);
      const timeHost = row.querySelector<HTMLElement>("[data-edit-time]")!;
      const picker = mountDecoupledDateTimeRangePicker({ defaultTrigger: { container: timeHost }, value: rangeValue(range.plannedStartAt, range.plannedEndAt), onChange: (value) => { const next = rangeIso(value); draft.ranges[index]!.plannedStartAt = next.start; draft.ranges[index]!.plannedEndAt = next.end; flightEditRangeDirty.get(item.id)!.add(index); const fields = flightEditRangeFields.get(item.id)!; if (!fields.has(index)) fields.set(index, new Set()); fields.get(index)!.add("plannedStartAt"); fields.get(index)!.add("plannedEndAt"); if (snapshot) enqueueFlightEditSave(item, snapshot, draft); } });
      flightEditPickers.push(picker);
      row.querySelectorAll<HTMLInputElement>("[data-edit-range]").forEach((input) => input.addEventListener("blur", () => { const [at, field] = input.dataset.editRange!.split(":"); const index = Number(at); (draft.ranges[index] as unknown as Record<string, unknown>)[field!] = input.value.trim() || null; flightEditRangeDirty.get(item.id)!.add(index); const fields = flightEditRangeFields.get(item.id)!; if (!fields.has(index)) fields.set(index, new Set()); fields.get(index)!.add(field!); if (snapshot) enqueueFlightEditSave(item, snapshot, draft); }));
    });
    detailEl.querySelectorAll<HTMLInputElement>("[data-flight-edit]").forEach((input) => input.addEventListener("blur", () => { const key = input.dataset.flightEdit as "serviceNumber" | "operatorName" | "aircraftType" | "seatNumber"; draft[key] = input.value.trim(); flightEditDirty.get(item.id)!.add(key); if (snapshot) enqueueFlightEditSave(item, snapshot, draft); }));
    detailEl.querySelector<HTMLButtonElement>("[data-flight-edit-back]")!.addEventListener("click", () => { flightEditModes.delete(item.id); if (flightManualFresh.has(item.id)) { flightManualFresh.delete(item.id); flightEditDrafts.delete(item.id); flightEditDirty.delete(item.id); flightEditRangeDirty.delete(item.id); flightEditRangeFields.delete(item.id); } renderDetail(); });
  }
  function renderFlightResults(item: ItemSnapshot, state: FlightQueryState): void {
    detailEl.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><div class="arrangement-thing-title">选择你的航班</div></div></div>
      <div class="flight-results" data-flight-results></div>
      <div class="flight-results-actions" data-flight-results-actions></div>
      <button type="button" class="flight-results-back" data-flight-results-back>返回上一步</button>`;
    const results = detailEl.querySelector<HTMLElement>("[data-flight-results]")!;
    const selectedIndex = flightSelectedCandidates.get(item.id) ?? -1;
    const continueButton = createButton("继续");
    continueButton.disabled = selectedIndex < 0;
    detailEl.querySelector("[data-flight-results-actions]")!.append(continueButton);
    state.candidates.forEach((candidate, index) => {
      const card = appendFlightResultCard(results, candidate.sourceRecord ? { ...candidate, ...flightResultCardFromRecord(candidate.sourceRecord) } : candidate, index === selectedIndex);
      const select = () => {
        flightSelectedCandidates.set(item.id, index);
        renderFlightResults(item, state);
      };
      card.addEventListener("click", select);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
    });
    continueButton.addEventListener("click", () => {
      if ((flightSelectedCandidates.get(item.id) ?? -1) < 0) return;
      const selected = state.candidates[flightSelectedCandidates.get(item.id)!];
      if (!selected?.sourceRecord || flightSelectionSaving.has(item.id)) return;
      flightSelectionSaving.add(item.id);
      const requestedDataDir = expectedDataDir;
      void runButtonAction(continueButton, {
        pending: { label: "保存中…" },
        task: () => productivityGetTravel({ itemId: item.id, includeDeleted: false }).then((current) => {
          if (disposed || travelItemForSelection(selection)?.id !== item.id) return;
          if (getSettings().dataDir.trim() !== requestedDataDir) throw new Error("数据目录已切换，操作已取消");
          if (current.item.revision !== state.itemRevision) throw new Error("航班已被其他修改，请刷新后重试");
        return productivityAdoptTravelFlight({
            expectedDataDir: requestedDataDir,
            item: ref(current.item),
          expectedActions: current.actions.map(ref),
          chosenRecord: selected.sourceRecord,
          matchedSegments: selected.matchedSegments ?? [selected.sourceRecord],
          request: state.request,
          fetchedAtUtc: state.fetchedAtUtc,
          });
      }).then((updated) => {
          if (!updated || disposed || travelItemForSelection(selection)?.id !== item.id) return;
          flightQueryGeneration++;
        applyAdoptedTravelProjection(updated);
        }),
      }).catch((error) => {
        if (disposed || travelItemForSelection(selection)?.id !== item.id) return;
        setError(invokeErrorText(error).slice(0, 240));
      }).finally(() => flightSelectionSaving.delete(item.id));
    });
    detailEl.querySelector<HTMLButtonElement>("[data-flight-results-back]")!.addEventListener("click", () => {
      flightQueryResults.delete(item.id);
      flightSelectedCandidates.delete(item.id);
      renderDetail();
    });
  }
  function startFlightQuery(item: ItemSnapshot, draft: { flightNumber: string; date: string }, button: HTMLButtonElement): void {
    if (flightQueryLoading.has(item.id)) return;
    const settings = getSettings() as unknown as { integrations?: { credentials?: { variflight?: { apiKey?: string } } } };
    const apiKey = settings.integrations?.credentials?.variflight?.apiKey?.trim() ?? "";
    if (!apiKey) {
      setError("请先在设置→临时中配置飞常准 API Key");
      return;
    }
    flightQueryLoading.add(item.id);
    const generation = flightQueryGeneration;
    const requestedDataDir = expectedDataDir;
    void runButtonAction(button, {
      pending: { label: "查询中…" },
      task: () => productivityQueryTravelSource({ expectedDataDir, apiKey, fnum: draft.flightNumber.trim(), date: draft.date }).then((response) => {
        const currentDataDir = getSettings().dataDir.trim();
        if (disposed || generation !== flightQueryGeneration || currentDataDir !== requestedDataDir || travelItemForSelection(selection)?.id !== item.id) return;
        const candidates = parseTravelFlightCandidates(response);
        if (!candidates.length) setError("未找到匹配航班");
        else setError("");
        flightQueryResults.set(item.id, {
          candidates,
          request: response.request,
          fetchedAtUtc: response.fetchedAtUtc,
          itemRevision: item.revision,
        });
        renderDetail();
      }),
    }).catch((error) => {
      const currentDataDir = getSettings().dataDir.trim();
      if (disposed || generation !== flightQueryGeneration || currentDataDir !== requestedDataDir || travelItemForSelection(selection)?.id !== item.id) return;
      const text = invokeErrorText(error);
      setError(/api.?key|authorization|bearer|secret|token/i.test(text) ? "航班查询失败，请检查设置中的飞常准 API Key" : text.slice(0, 240));
    }).finally(() => {
      flightQueryLoading.delete(item.id);
    });
  }
  function renderDetail(explicitNavigation = false): void {
    // A new trip exists only in the rail until its first content is saved.
    // Background reloads must not replace it using the previous selection.
    if (!explicitNavigation && travelRail?.isNewTripDraft()) return;
    const healthPlan = selection?.kind === "item" ? health.find(selection.id) : selection?.kind === "action" ? health.getData()?.plans.find(p=>p.action.id===selection.id) : null;
    if (selectedHealth || healthPlan) { detail.clearFocus(); detailEl.replaceChildren(); travelRail?.setItem(null); return; }
    const knownProfileItemId = selection?.kind === "item" && v2TravelProfileIds.has(selection.id)
      ? selection.id
      : null;
    const v2ItemId = knownProfileItemId ?? resolveV2TravelItemId(selection, store.items, actions);
    if (
      v2ItemId
      && !travelItemForSelection(selection)
      && (knownProfileItemId !== null || itemIsV2TravelCandidate(v2ItemId, store.items, itemTypes, v2TravelProfileIds))
    ) {
      detail.clearFocus();
      ensureTravelRailStack();
      travelRail!.setItem(v2ItemId);
      return;
    }
    travelRail?.setItem(null);
    const travel = travelItemForSelection(selection);
    flightDatePicker?.dispose();
    flightDatePicker = null;
    while (flightEditPickers.length) flightEditPickers.pop()!.dispose();
    if (travel) {
      detail.clearFocus();
      loadTravelDetail(travel);
      if (travel.travelKind === "flight") {
        if (flightEditModes.has(travel.id)) {
          renderFlightEditForm(travel, travelSnapshots.get(travel.id) ?? null);
          return;
        }
        if (hasAdoptedFlightSource(travelDetails.get(travel.id) ?? null)) {
          const snapshot = travelSnapshots.get(travel.id);
          if (snapshot) renderFlightInfoPage(travel, snapshot);
          else detailEl.replaceChildren();
          return;
        }
        const queryState = flightQueryResults.get(travel.id);
        if (queryState) {
          renderFlightResults(travel, queryState);
          return;
        }
        const draft = flightEntryDrafts.get(travel.id) ?? { flightNumber: "", date: "" };
        flightEntryDrafts.set(travel.id, draft);
        detailEl.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><div class="arrangement-thing-title">添加你的航班</div></div></div>
          <div class="flight-entry-fields">
            <input class="flight-entry-field" data-flight-number type="text" placeholder="航班号" autocomplete="off" />
            <input type="text" class="flight-entry-field flight-entry-date-trigger" data-flight-date-trigger placeholder="日期" autocomplete="off" inputmode="numeric" />
          </div>
          <div class="flight-entry-actions" data-flight-entry-actions></div>
          <button type="button" class="flight-entry-manual" data-flight-entry-manual>手动填写</button>`;
        const flightNumberInput = detailEl.querySelector<HTMLInputElement>("[data-flight-number]")!;
        flightNumberInput.value = draft.flightNumber;
        const dateTrigger = detailEl.querySelector<HTMLInputElement>("[data-flight-date-trigger]")!;
        dateTrigger.value = draft.date;
        const continueButton = createButton("继续");
        continueButton.disabled = true;
        detailEl.querySelector("[data-flight-entry-actions]")!.append(continueButton);
        continueButton.addEventListener("click", () => startFlightQuery(travel, draft, continueButton));
        flightDatePicker = mountDecoupledDatePicker({
          anchor: dateTrigger,
          value: draft.date,
          onChange: (value) => {
            draft.date = value;
            dateTrigger.value = value;
            continueButton.disabled = !(draft.flightNumber.trim() && draft.date);
          },
        });
        const isCompleteDate = (value: string): boolean => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
          const parsed = new Date(`${value}T00:00:00Z`);
          return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        };
        dateTrigger.addEventListener("input", () => {
          const value = dateTrigger.value.trim();
          draft.date = isCompleteDate(value) ? value : "";
          if (draft.date) flightDatePicker?.setValue(draft.date);
          continueButton.disabled = !(draft.flightNumber.trim() && draft.date);
        });
        dateTrigger.addEventListener("click", () => flightDatePicker?.open());
        dateTrigger.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            flightDatePicker?.open();
          }
        });
        const refreshContinue = () => {
          draft.flightNumber = flightNumberInput.value;
          continueButton.disabled = !(draft.flightNumber.trim() && draft.date);
        };
        flightNumberInput.addEventListener("input", refreshContinue);
        refreshContinue();
        detailEl.querySelector<HTMLButtonElement>("[data-flight-entry-manual]")!.addEventListener("click", () => {
          flightEditModes.add(travel.id);
          flightManualFresh.add(travel.id);
          flightEditDrafts.delete(travel.id);
          flightEditDirty.set(travel.id, new Set());
          flightEditRangeDirty.set(travel.id, new Set());
          renderDetail();
        });
        // Temporary style preview only. Remove when the entry page no longer needs a fixture card.
        const preview = document.createElement("div");
        preview.className = "flight-results flight-entry-preview";
        const sampleCandidate: FlightCandidate = {
          flightNumber: "MU5101",
          airline: "中国东方航空股份有限公司",
          depCode: "SHA",
          depName: "上海虹桥",
          depAt: "2026-10-17 08:00:00",
          depActualAt: "2026-10-17 08:28:00",
          arrCode: "PEK",
          arrName: "北京首都",
          arrAt: "2026-10-17 10:10:00",
          arrActualAt: "",
          aircraft: "B77W",
        };
        appendFlightResultCard(preview, sampleCandidate);
        appendFlightResultCard(preview, sampleCandidate, true);
        detailEl.appendChild(preview);
      } else detailEl.replaceChildren();
      return;
    }
    detail.render();
  }

  function getVisibility(): ScopeVisibility {
    const key = scopeKey(scope);
    return visibilityByScope.get(key) ?? { showCompleted: false, showCancelled: false };
  }

  function setVisibility(patch: Partial<ScopeVisibility>): void {
    const key = scopeKey(scope);
    const current = getVisibility();
    visibilityByScope.set(key, { ...current, ...patch });
    paintToggles();
    itemList.render();
  }

  function setError(msg: string): void {
    errorEl.hidden = !msg;
    errorEl.textContent = msg;
  }

  function setScopeMessage(msg: string | null): void {
    scopeMessageEl.hidden = !msg;
    scopeMessageEl.textContent = msg ?? "";
  }

  function selectScope(next: TaskScope, persist = true): void {
    if (requestTaskNavigation({ view: "list", scope: next, categoryManager: false, carrier: "rail", dialogItemId: null })) return;
    categoryManagerMode = false;
    categoryManager?.hide();
    centerEl.hidden = false;
    detailEl.hidden = false;
    railGeneration++;
    taskSelection.selected.clear();
    taskSelection.anchorId = null;
    scope = next;
    view = "list";
    invalidateActivityPauses();
    toolbarEl.hidden = false;
    setScopeMessage(null);
    headingEl.textContent = scopeHeading(scope, store.lists);
    paintToggles();
    taskRail.setScope(scope);
    taskRail.setView(view);
    mainEl.hidden = false;
    weekEl.hidden = true;
    refreshCalendar();
    renderDetail(true);
    itemList.render();
    if (persist) selectTaskViewState({ view: "list", filter: scopeToRestoreFilter(scope) ?? "all" });
  }

  function selectWeek(persist = true): void {
    if (requestTaskNavigation({ view: "week", categoryManager: false, selection: null, focusId: null, carrier: "rail", dialogItemId: null }, persist)) return;
    categoryManagerMode = false;
    categoryManager?.hide();
    centerEl.hidden = false;
    detailEl.hidden = false;
    railGeneration++;
    taskSelection.selected.clear();
    taskSelection.anchorId = null;
    selection = null;
    view = "week";
    refreshActivityPauses();
    headingEl.textContent = "";
    toolbarEl.hidden = true;
    togglesEl.innerHTML = "";
    taskRail.setView(view);
    mainEl.hidden = true;
    weekEl.hidden = false;
    refreshCalendar();
    if (zone) {
      const generation = loadGeneration;
      void ensureCurrentTravelWeek().then(() => {
        if (disposed || view !== "week" || generation !== loadGeneration) return;
        if (!week) week = mountWeek();
        else week.render();
        ensureFlightWeekSnapshots();
      });
    }
    renderDetail(true);
    if (persist) selectTaskViewState({ view: "week" });
  }

  const taskRail = createTaskRail({
    onSelectScope: (next) => selectScope(next, false),
    onSelectWeek: () => {
      const firstDay = zone ? addDays(today(), -2) : "";
      if (view === "week" && !categoryManagerMode && !selection && !selectedHealth && !focusNavigationId && !healthRouteFocus && !detailDialogItemId) {
        weekDay = firstDay;
        if (firstDay) week?.navigateFirst(firstDay);
        return;
      }
      if (navigationReady && _ctx.navigation) {
        const state = captureTaskNavigation();
        void _ctx.navigation.navigate({ ...state,
          route: { ...(state.route as TaskNavigationRoute), view: "week", categoryManager: false, selection: null, focusId: null, carrier: "rail", dialogItemId: null },
          context: { ...(state.context as object), weekDay: firstDay, centerToday: true, weekLeft: undefined } });
      } else { weekDay = firstDay; selectWeek(false); if (firstDay) week?.navigateFirst(firstDay); }
    },
    onSelectCategoryManager: showCategoryManager,
    onDeleteList: async (list) => {
      try {
        const requestDataDir = expectedDataDir;
        const members = await productivityGetListItemMembers({ expectedDataDir: requestDataDir, listId: list.id });
        if (members.dataDir !== requestDataDir) {
          setError("当前数据目录已变化，请刷新后重试。");
          return false;
        }
        const ok = await getConfirmDialog()("删除清单", "删除清单后，里面的任务会移至 Inbox，任务、分类、标签和安排都会保留。", undefined, { danger: true });
        if (!ok) return false;
        await productivityDeleteListAndMoveItemsToInbox({
          expectedDataDir: requestDataDir,
          list: { id: list.id, expectedRevision: members.list.revision },
          expectedMembers: members.members,
        });
        return true;
      } catch (error) {
        setError(`删除清单失败：${invokeErrorText(error)}`);
        return false;
      }
    },
    onSelectDate: (date, extend) => {
      if (categoryManagerMode) return;
      if (view === "week") { weekDay = mondayOf(date); week?.navigate(weekDay); }
      else { listDate = extend && listDate ? { start: [listDate.start, date].sort()[0], end: [listDate.start, date].sort()[1] } : { start: date, end: date }; itemList.render(); }
      refreshCalendar();
    },
    onClearDate: () => { if (categoryManagerMode) return; listDate = null; itemList.render(); refreshCalendar(); },
    onRefresh: () => refreshAndReconcileHistory(),
    onError: setError,
  });

  const itemList = mountItemList({
    writers: {
      create:productivityCreateItem,createAfter:productivityCreateItemAfter,update:productivityUpdateItem,
      delete:productivityDeleteItem,reorder:productivityReorderItems,move:productivityMoveItemToListAndPlace,
      setStatus:async req=>{
        const plan=health.find(req.item.id);
        if(!plan)return productivitySetItemStatus(req);
        if(plan.item.revision!==req.item.expectedRevision)throw new Error("健康计划已变化，请刷新");
        const result=req.status==="完成"?await health.link(plan):req.status==="进行中"?await health.unlink(plan):await health.mutate(plan,"cancel");
        return {item:result?.item??plan.item};
      },
    },
    host: mainEl,
    getScope: () => scope,
    getStore: () => store,
    getVisibility,
    getLoading: () => loading,
    getLoadError: () => loadError,
    onStoreChange: (next) => {
      store = next;
    },
    onReload: () => reload(),
    onError: setError,
    onSelectArchivedList: (listId) => selectScope({ kind: "archived-list", listId }),
    onSelectList: (listId) => selectScope({ kind: "list", listId }),
    onSelectItem: (itemId) => selectObject({ kind: "item", id: itemId }),
    onOpenItem: (item) => { if(health.find(item.id)){selectObject({kind:"item",id:item.id});return;}
      requestTaskNavigation({ carrier: "dialog", dialogItemId: item.id }); },
    onConfirmDelete: (returnFocus) => getConfirmDialog()("删除任务", "删除后无法恢复。", returnFocus, { danger: true }),
    onUnarchiveList: (list) => unarchiveList(list, setError),
    getSelectedItemIds: () => taskSelection.selected,
    onDeleteSelected: () => deleteSelectedItems(),
    getAddLists: () => activeLists(store.lists).map((list) => ({ id: list.id, title: list.title })),
    getCategoryMenu: (keepTypeIds) => categoryMenu(keepTypeIds),
    onAddToList: (itemIds, listId) => addItemsToList(itemIds, listId),
    onSetCategory: (itemIds, itemTypeId) => setItemsCategory(itemIds, itemTypeId),
    getDateRange: () => listDate,
    getDateRangeInstants: () => listDate && zone ? { start: instantForWall(listDate.start, 0, zone),
      end: instantForWall(new Date(Date.parse(`${listDate.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), 0, zone) } : null,
    getActions: () => actions,
    onRender: () => decorateItemRows(),
  });

  function plannedLabelForItem(itemId: string): string {
    const action = actions
      .filter((candidate) => candidate.targetKind === "item" && candidate.targetId === itemId && !candidate.deletedAtUtc && candidate.plannedStartAt)
      .sort(compareRailActions)[0];
    if (!action?.plannedStartAt || !zone) return "";
    const instant = Date.parse(action.plannedStartAt);
    if (!Number.isFinite(instant)) return "";
    const date = dateAt(instant, zone);
    // Format the wall-clock portion through the existing business-time date helper's offset.
    const offsetMatch = (zone.replacements.find((r) => Date.parse(r.startUtc) <= instant && instant < Date.parse(r.endUtc))?.offset ?? zone.baseOffset).match(/^([+-])(\d{2}):(\d{2})$/);
    const offsetMinutes = offsetMatch ? (offsetMatch[1] === "-" ? -1 : 1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) : 0;
    const wall = new Date(instant + offsetMinutes * 60_000);
    const time = `${String(wall.getUTCHours()).padStart(2, "0")}:${String(wall.getUTCMinutes()).padStart(2, "0")}`;
    const todayDate = today();
    const dayDiff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayDate}T00:00:00Z`)) / 86_400_000);
    if (dayDiff === 0) return time;
    if (dayDiff === 1) return `明天 ${time}`;
    if (dayDiff === 2) return `后天 ${time}`;
    if (date.slice(0, 4) === todayDate.slice(0, 4)) return `${date.slice(5).replace("-", "月")}日 ${time}`;
    return `${date} ${time}`;
  }

  function decorateItemRows(): void {
    mainEl.querySelectorAll<HTMLElement>(".task-item-row[data-item-id]").forEach((row) => {
      const item = store.items.find((candidate) => candidate.id === row.dataset.itemId);
      if (!item) return;
      const titleCol = row.querySelector<HTMLElement>(".task-item-title-col");
      if (titleCol && !titleCol.querySelector(".task-item-meta")) {
        const listName = item.listId ? store.lists.find((list) => list.id === item.listId)?.title : "Inbox";
        const type = item.itemTypeId ? itemTypes.find((candidate) => candidate.id === item.itemTypeId) : undefined;
        const meta = document.createElement("div");
        meta.className = "task-item-meta";
        const listEntry = document.createElement("span");
        listEntry.className = "task-item-meta-entry";
        listEntry.append(metaIcon(CLIPBOARD_LIST_SVG));
        const listLabel = document.createElement("span");
        listLabel.textContent = listName ?? "Inbox";
        listEntry.append(listLabel);
        const typeEntry = document.createElement("span");
        typeEntry.className = "task-item-meta-entry";
        const swatch = document.createElement("span");
        swatch.className = "arrangement-meta-swatch";
        swatch.classList.toggle("is-empty", !type?.effectiveColor);
        if (type?.effectiveColor) swatch.style.background = resolveCategoryRoles(type.effectiveColor).main;
        typeEntry.append(swatch);
        const typeLabel = document.createElement("span");
        typeLabel.textContent = type?.name ?? "无分类";
        typeEntry.append(typeLabel);
        meta.replaceChildren(listEntry, typeEntry);
        titleCol.appendChild(meta);
      }
      const trail = row.querySelector<HTMLElement>(".task-item-trail-col");
      if (trail && !trail.querySelector(".task-item-plan")) {
        const plan = document.createElement("span");
        plan.className = "task-item-plan";
        plan.textContent = plannedLabelForItem(item.id);
        plan.hidden = !plan.textContent;
        trail.insertBefore(plan, trail.firstChild);
      }
    });
    applyTaskSelectionClasses(mainEl, taskSelection);
  }

  function selectedItemSnapshots(): ItemSnapshot[] {
    return [...taskSelection.selected]
      .map((id) => store.items.find((item) => item.id === id))
      .filter((item): item is ItemSnapshot => Boolean(item && !item.deletedAtUtc));
  }

  async function addItemsToList(ids: readonly string[], listId: string | null): Promise<void> {
    const items = ids
      .map((id) => store.items.find((item) => item.id === id && !item.deletedAtUtc))
      .filter((item): item is ItemSnapshot => Boolean(item));
    if (!items.length) return;
    const list = listId ? store.lists.find((candidate) => candidate.id === listId) : null;
    if (listId && !list) { setError("目标清单已变化，请刷新后重试"); return; }
    try {
      await moveItemsToList(items, list ?? null, getSettings().dataDir.trim());
      if (ids.length > 1) { taskSelection.selected.clear(); taskSelection.anchorId = null; }
      await refreshAfterWrite();
    } catch (error) {
      setError(invokeErrorText(error));
    }
  }

  async function setItemsCategory(ids: readonly string[], itemTypeId: string | null): Promise<void> {
    const items = ids
      .map((id) => store.items.find((item) => item.id === id && !item.deletedAtUtc && !item.travelKind))
      .filter((item): item is ItemSnapshot => Boolean(item));
    if (!items.length) return;
    if (itemTypeId && !itemTypeCatalog) { setError("分类目录不可用"); return; }
    try {
      for (const item of items) {
        await productivityUpdateItem({ item: ref(item), patch: {
          itemTypeId,
          classificationExpected: itemTypeId && itemTypeCatalog ? { itemTypeCatalog: ref(itemTypeCatalog) } : undefined,
        } });
      }
      if (ids.length > 1) { taskSelection.selected.clear(); taskSelection.anchorId = null; }
      await refreshAfterWrite();
    } catch (error) {
      setError(invokeErrorText(error));
      await reload().catch(() => undefined);
    }
  }

  async function moveSelectedItems(listId: string | null, capturedDataDir: string): Promise<void> {
    const items = selectedItemSnapshots();
    if (!items.length) return;
    const list = listId ? store.lists.find((candidate) => candidate.id === listId) : null;
    if (listId && !list) { setError("目标清单已变化，请刷新后重试"); return; }
    try {
      await moveItemsToList(items, list ?? null, capturedDataDir);
      taskSelection.selected.clear();
      taskSelection.anchorId = null;
      await refreshAfterWrite();
    } catch (error) {
      setError(invokeErrorText(error));
    }
  }

  async function deleteSelectedItems(): Promise<void> {
    const items = selectedItemSnapshots();
    if (!items.length) return;
    const capturedDataDir = getSettings().dataDir.trim();
    let prepared;
    try {
      prepared = await prepareDeleteItems(items, capturedDataDir);
    } catch (error) {
      setError(invokeErrorText(error));
      return;
    }
    const confirmed = await getConfirmDialog()("删除任务", `将删除 ${items.length} 个任务。`, undefined, {});
    if (!confirmed) return;
    try {
      await deleteItems(items, { prepared });
      taskSelection.selected.clear();
      taskSelection.anchorId = null;
      await refreshAfterWrite();
    } catch (error) {
      setError(invokeErrorText(error));
    }
  }

  mainEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>(".task-item-row[data-item-id]");
    if (!row?.dataset.itemId || target.closest(".task-item-check, .task-item-detail-btn, input, button")) return;
    const visibleIds = [...mainEl.querySelectorAll<HTMLElement>(".task-item-row[data-item-id]")]
      .map((candidate) => candidate.dataset.itemId).filter((id): id is string => Boolean(id));
    updateTaskSelection(taskSelection, visibleIds, row.dataset.itemId, event as MouseEvent);
    applyTaskSelectionClasses(mainEl, taskSelection);
    paintToggles();
    selectObject({ kind: "item", id: row.dataset.itemId });
  });

  taskRail.setOnItemDrop((itemId, targetKey) => itemList.moveToList(itemId, targetKey));

  let week: ReturnType<typeof mountArrangementWeek> | null = null;
  const ref = (value: { id: string; revision: number }) => ({ id: value.id, expectedRevision: value.revision });
  function actionById(id: string): ActionSnapshot {
    const action = actions.find((value) => value.id === id);
    if (!action) throw new Error("安排已变化，请刷新后重试");
    return action;
  }
  function sessionById(id: string): SessionSnapshot {
    const session = sessions.find((value) => value.id === id);
    if (!session) throw new Error("工作时间已变化，请刷新后重试");
    return session;
  }
  function captureActionBaseline(id: string): ActionMoveBaseline {
    if (disposed || getSettings().dataDir.trim() !== expectedDataDir) throw new Error("数据目录已变化，请刷新后重新拖动。");
    const action = actionById(id);
    const targetId = action.targetId;
    let owningRoot: { id: string; revision: number } | null = null;
    const healthPlan = health.getData()?.plans.find((plan) => plan.action.id === id);
    if (healthPlan) {
      if (healthPlan.action.revision !== action.revision) throw new Error("健康计划已变化，请刷新后重新拖动。");
      owningRoot = healthPlan.item;
    } else if (action.targetKind || targetId) {
      if (!action.targetKind || !targetId) throw new Error("关联事情已变化，请刷新后重试");
      owningRoot = action.targetKind === "item" ? store.items.find((item) => item.id === targetId) ?? null
        : action.targetKind === "task" ? projects.find((project) => project.tasks.some((task) => task.id === targetId)) ?? null
          : projects.find((project) => project.id === targetId) ?? null;
      if (!owningRoot) throw new Error("关联事情已变化，请刷新后重试");
    }
    const session = action.sessionId ? sessionById(action.sessionId) : null;
    return { expectedDataDir, action: ref(action), targetOwningRoot: owningRoot ? ref(owningRoot) : null,
      currentSession: session ? ref(session) : null,
      currentSessionMembers: session ? actions.filter((member) => member.sessionId === session.id && !member.deletedAtUtc).map(ref) : [] };
  }
  function captureCheckpointBaseline(checkpoint: CheckpointSnapshot): CheckpointMoveBaseline {
    const memberRefs = (sessionId: string) => checkpoints.filter((value) => value.sessionId === sessionId && !value.deletedAtUtc).map(ref);
    const sessionsSnapshot = new Map(sessions.filter((value) => !value.deletedAtUtc).map((session) => [session.id, { session: ref(session), members: memberRefs(session.id) }]));
    const currentSession = checkpoint.sessionId ? sessions.find((value) => value.id === checkpoint.sessionId) ?? null : null;
    return { expectedDataDir, checkpoint: ref(checkpoint), currentSession: currentSession ? ref(currentSession) : null,
      expectedCurrentCheckpoints: currentSession ? memberRefs(currentSession.id) : [], sessions: sessionsSnapshot };
  }
  function captureSessionBaseline(session: SessionSnapshot): SessionMoveBaseline {
    if (disposed || getSettings().dataDir.trim() !== expectedDataDir) throw new Error("数据目录已切换，请刷新后重试");
    const current = sessions.find((value) => value.id === session.id);
    if (!current || current.revision !== session.revision) throw new Error("工作时间已变化，请刷新后重试");
    return { expectedDataDir, session: ref(current),
      expectedMembers: actions.filter((value) => value.sessionId === current.id && !value.deletedAtUtc).map(ref),
      expectedCheckpoints: checkpoints.filter((value) => value.sessionId === current.id && !value.deletedAtUtc).map(ref) };
  }
  async function refreshAfterWrite(): Promise<void> {
    if (disposed) return;
    const selectedTravel = travelItemForSelection(selection);
    if (selectedTravel) {
      travelDetailLoaded.delete(selectedTravel.id);
      travelDetails.delete(selectedTravel.id);
      travelSnapshots.delete(selectedTravel.id);
    }
    await reload();
  }
  async function commitV2TravelActionPlan(
    actionId: string,
    start: string,
    end: string,
    options?: { confirmWholeTrip?: boolean },
  ): Promise<void> {
    const itemId = v2TravelItemIdForAction(actionId, store.items, actions, itemTypes, v2TravelProfileIds);
    if (!itemId) throw new Error("出行行程已变化，请刷新后重试");
    if (options?.confirmWholeTrip) {
      const confirmed = await getConfirmDialog()("调整行程时间", "将更新行程段的计划时间。", undefined, {});
      if (!confirmed) return;
    }
    ensureTravelRailStack();
    const controller = travelController!;
    const state = controller.getState();
    if (!state.currentSnapshot || state.currentSnapshot.item.id !== itemId) {
      await controller.loadTrip(itemId);
    }
    const generation = controller.getPlanEditGeneration();
    await travelHistory.v2(controller,itemId, {
      edit: {
        kind: "setRange",
        actionId,
        plannedStartAt: start,
        plannedEndAt: end,
        planEditGeneration: generation,
      },
    });
  }
  async function ensureV2TripLoaded(itemId: string): Promise<void> {
    ensureTravelRailStack();
    const controller = travelController!;
    const state = controller.getState();
    if (!controller.getSnapshot(itemId) && (!state.currentSnapshot || state.currentSnapshot.item.id !== itemId)) {
      await controller.loadTrip(itemId);
    }
  }
  async function commitV2CheckpointPlan(itemId: string, checkpointId: string, plannedAtUtc: string): Promise<void> {
    await ensureV2TripLoaded(itemId);
    const controller = travelController!;
    const generation = controller.getPlanEditGeneration();
    await travelHistory.v2(controller,itemId, {
      edit: { kind: "moveCheckpoint", checkpointId, plannedAtUtc, planEditGeneration: generation },
    });
  }
  async function commitV2CheckpointCompleted(itemId: string, checkpointId: string, completed: boolean): Promise<void> {
    await ensureV2TripLoaded(itemId);
    travelController!.queueSetCheckpointCompleted(itemId, { checkpointId, completed });
    await reload();
  }
  async function commitV2CheckpointDelete(itemId: string, checkpointId: string): Promise<void> {
    await ensureV2TripLoaded(itemId);
    travelController!.queueDeleteCheckpoint(itemId, { checkpointId });
    await reload();
  }
  async function movePlan(request: WeekMove): Promise<void> {
    if (request.kind === "action") {
      const plan=health.getData()?.plans.find(p=>p.action.id===request.id);
      if(plan){
        if(request.sessionId)throw new Error("健康计划不能进入工作时间");
        if(disposed)throw new Error("安排实例已关闭。");
        assertHealthPlanMoveBaseline(plan,request.baseline,expectedDataDir,getSettings().dataDir.trim());
        await health.mutate(plan,"update",request.start,request.end);return;
      }
    }
    const pendingKey = `${request.kind}:${request.id}`;
    if (pendingPlans.has(pendingKey)) throw new Error("该安排正在保存，请稍后再试");
    pendingPlans.add(pendingKey);
    try {
    if (request.kind === "session") {
      const baseline = request.baseline;
      if (!baseline || baseline.session.id !== request.id) throw new Error("工作时间基线已失效，请重新拖动");
      await planHistory.session({ expectedDataDir: baseline.expectedDataDir, session: baseline.session,
        expectedMembers: baseline.expectedMembers, expectedCheckpoints: baseline.expectedCheckpoints,
        plannedStartAt: request.start, plannedEndAt: request.end });
    } else {
      const baseline = request.baseline;
      if (baseline.action.id !== request.id) throw new Error("安排已变化，请刷新后重试");
      const v2TravelItemId = v2TravelItemIdForAction(request.id, store.items, actions, itemTypes, v2TravelProfileIds);
      if (v2TravelItemId) {
        const actionBeforeMove = actionById(request.id);
        if (request.sessionId !== actionBeforeMove.sessionId) throw new Error("行程安排不能改变工作时间归属");
        await commitV2TravelActionPlan(request.id, request.start, request.end, { confirmWholeTrip: true });
        return;
      }
      const movedTravel = travelItemForSelection({ kind: "action", id: request.id });
      if (movedTravel) {
        const confirmed = await getConfirmDialog()("调整行程时间", "将更新整趟行程的计划时间。", undefined, {});
        if (!confirmed) return;
        const actionBeforeMove = actionById(request.id);
        if (request.sessionId !== actionBeforeMove.sessionId) throw new Error("行程安排不能改变工作时间归属");
        if (!baseline.targetOwningRoot) throw new Error("行程所属事情已变化，请刷新后重试");
        const travel = await productivityGetTravel({ itemId: movedTravel.id, includeDeleted: false });
        const moved = travel.actions.find((action) => action.id === request.id);
        if (!moved) throw new Error("行程安排已变化，请刷新后重试");
        if (travel.item.revision !== baseline.targetOwningRoot.expectedRevision || moved.revision !== baseline.action.expectedRevision)
          throw new Error("行程已被其他修改，请刷新后重试");
        if (moved.sessionId !== actionBeforeMove.sessionId) throw new Error("行程安排工作时间归属已变化，请刷新后重试");
        const actionRevisions = travel.actions.map(ref);
        const ranges = travel.legs.map((leg) => {
          const action = travel.actions.find((candidate) => candidate.id === leg.actionId);
          if (!action) throw new Error("行程段关联已变化，请刷新后重试");
          const planned = action.id === request.id ? { start: request.start, end: request.end } : { start: action.plannedStartAt, end: action.plannedEndAt };
          return {
            plannedStartAt: planned.start,
            plannedEndAt: planned.end,
            departureCode: leg.departureCode,
            departureName: leg.departureName,
            arrivalCode: leg.arrivalCode,
            arrivalName: leg.arrivalName,
            departureTerminal: leg.departureTerminal,
            arrivalTerminal: leg.arrivalTerminal,
          };
        });
        await travelHistory.legacy({ expectedDataDir, item: ref(travel.item), actionRevisions, ranges },travel);
        return;
      }
      const next = request.sessionId ? ref(sessionById(request.sessionId)) : null;
      const members = (sessionId: string | null) => sessionId ? actions.filter((value) => value.sessionId === sessionId && !value.deletedAtUtc).map(ref) : [];
      const destinationMembers = members(request.sessionId);
      if (next && baseline.currentSession?.id === next.id) {
        const refs = (values: { id: string; expectedRevision: number }[]) => values.map((value) => `${value.id}:${value.expectedRevision}`).sort().join("|");
        if (next.expectedRevision !== baseline.currentSession.expectedRevision || refs(destinationMembers) !== refs(baseline.currentSessionMembers))
          throw new Error("工作时间已变化，请刷新后重试");
      }
      await planHistory.action({ expectedDataDir, action: baseline.action, targetOwningRoot: baseline.targetOwningRoot,
        currentSession: baseline.currentSession, nextSession: next,
        currentSessionMembers: baseline.currentSessionMembers,
        nextSessionMembers: baseline.currentSession?.id === next?.id ? baseline.currentSessionMembers : destinationMembers,
        plannedStartAt: request.start, plannedEndAt: request.end });
    }
    } finally { pendingPlans.delete(pendingKey); }
  }
  function nextActionName(kind: "item" | "task", id: string): string {
    const count = actions.filter((action) => action.targetKind === kind && action.targetId === id).length;
    return `安排 ${count + 1}`;
  }
  function categoryMenu(keepTypeIds: readonly string[]) {
    const keep = new Set(keepTypeIds);
    const visibleTypes = itemTypes.filter((type) => !type.effectiveInactive || keep.has(type.id));
    const visibleIds = new Set(visibleTypes.map((type) => type.id));
    const childrenOf = new Map<string | null, typeof visibleTypes>();
    for (const type of visibleTypes) {
      const parent = type.parentItemTypeId && visibleIds.has(type.parentItemTypeId) ? type.parentItemTypeId : null;
      const siblings = childrenOf.get(parent) ?? [];
      siblings.push(type);
      childrenOf.set(parent, siblings);
    }
    const branch = (parentId: string | null) => (childrenOf.get(parentId) ?? []).map((type) => {
        const children = branch(type.id);
        return { value: type.id, label: type.name, ...(children.length ? { children } : {}) };
      });
    return [{ value: "", label: "无分类" }, ...branch(null)];
  }
  function actionMenuData(action: ActionSnapshot) {
    const move = [{ value: "clear", label: "未关联" },
      ...store.items.filter((item) => !item.deletedAtUtc).map((item) => ({
        value: `item:${item.id}`, label: item.title,
        sublabel: item.listId ? store.lists.find((list) => list.id === item.listId)?.title : "Inbox",
      })),
      ...projects.filter((project) => !project.deletedAtUtc).flatMap((project) => project.tasks
        .filter((task) => !task.deletedAtUtc)
        .map((task) => ({ value: `task:${task.id}`, label: task.title, sublabel: project.title }))),
      ...projects.filter((project) => !project.deletedAtUtc).map((project) => ({
        value: `project:${project.id}`, label: project.title, sublabel: "项目",
      }))];
    const item = action.targetKind === "item" && action.targetId
      ? store.items.find((value) => value.id === action.targetId)
      : undefined;
    const selectedTags = new Set(item?.tagIds ?? []);
    const selectedCategory = item?.itemTypeId ?? "";
    const categories = categoryMenu(selectedCategory ? [selectedCategory] : []);
    const tagsForMenu = tags
      .filter((tag) => !tag.deletedAtUtc && (!tag.inactive || selectedTags.has(tag.id)))
      .map((tag) => ({ value: tag.id, label: tag.name }));
    const travel = action.targetKind === "item" && Boolean(action.targetId && store.items.find((candidate) => candidate.id === action.targetId)?.travelKind);
    const lists = liveLists(store.lists).map((list) => ({ id: list.id, title: list.title, revision: list.revision }));
    return { move, lists, categories, tags: tagsForMenu, selectedCategory, selectedTags, travel };
  }
  async function deleteTravelForAction(action: ActionSnapshot): Promise<void> {
    if (action.targetKind !== "item" || !action.targetId) throw new Error("行程安排缺少所属行程");
    const item = store.items.find((candidate) => candidate.id === action.targetId && candidate.travelKind);
    if (!item) throw new Error("行程已变化，请刷新后重试");
    const confirmed = await getConfirmDialog()(item.travelKind === "flight" ? "删除航班" : "删除铁路行程", "将整趟删除行程及其全部安排。", undefined, {});
    if (!confirmed) return;
    const travel = await productivityGetTravel({ itemId: item.id, includeDeleted: false });
    await productivityDeleteTravel({ expectedDataDir, item: ref(travel.item), expectedActions: travel.actions.map(ref) });
    if (selection?.kind === "item" && selection.id === item.id || selection?.kind === "action" && selection.id === action.id) selectObject(null);
    await refreshAfterWrite();
  }
  async function applyActionMenuChange(action: ActionSnapshot, field: "move" | "category" | "tags", value: string | Set<string>): Promise<void> {
    const current = actionById(action.id);
    if (actionMenuData(current).travel) throw new Error("行程安排不支持移动、分类或标签操作");
    if (field === "move") {
      const encoded = value as string;
      if (encoded === "clear") {
        if (current.targetKind || current.targetId) {
          await productivityClearActionTarget({ action: ref(current) });
        }
      } else {
        const separator = encoded.indexOf(":");
        const targetKind = separator > 0 ? encoded.slice(0, separator) as "project" | "task" | "item" : null;
        const targetId = separator > 0 ? encoded.slice(separator + 1) : "";
        if (!targetKind || !targetId) throw new Error("关联事情已变化，请刷新后重试");
        const owningRoot = targetKind === "item"
          ? store.items.find((item) => item.id === targetId)
          : targetKind === "task"
            ? projects.find((project) => project.tasks.some((task) => task.id === targetId))
            : projects.find((project) => project.id === targetId);
        if (!owningRoot) throw new Error("关联事情已变化，请刷新后重试");
        await productivitySetActionTarget({ action: ref(current), targetKind, targetId, owningRoot: ref(owningRoot) });
      }
    } else {
      if (current.targetKind !== "item" || !current.targetId) throw new Error("只有关联任务支持分类和标签");
      const item = store.items.find((candidate) => candidate.id === current.targetId);
      if (!item) throw new Error("关联任务已变化，请刷新后重试");
      if (field === "category") {
        const itemTypeId = value as string;
        if (itemTypeId && !itemTypeCatalog) throw new Error("分类目录不可用");
        await productivityUpdateItem({ item: ref(item), patch: { itemTypeId: itemTypeId || null,
          classificationExpected: itemTypeId && itemTypeCatalog ? { itemTypeCatalog: ref(itemTypeCatalog) } : undefined } });
      } else {
        const tagIds = [...(value as Set<string>)];
        const selected = tagIds.map((tagId) => tags.find((tag) => tag.id === tagId));
        if (selected.some((tag) => !tag)) throw new Error("标签已变化");
        await productivityUpdateItem({ item: ref(item), patch: { tagIds,
          classificationExpected: { tags: selected.map((tag) => ref(tag!)) } } });
      }
    }
    await refreshAfterWrite();
  }
  async function createFromRange(request: WeekCreate): Promise<void> {
    if(request.choice === "health-sleep" || request.choice === "health-activity") { await health.create(request.choice === "health-sleep" ? "sleep" : "activity",request.start,request.end,request.activityType);return; }
    if(request.choice === "health-meal"){await health.meal(request.start);return;}
    const choice = request.choice ? { kind: request.choice } : request.sessionOnly ? { kind: "session" as const } : await chooseArrangementCreation(targetIndex.values(), !request.sessionId);
    if (!choice) return;
    const selectionBefore = selection;
    const viewBefore = view;
    const keepFocus = () => !disposed && view === viewBefore && selection === selectionBefore;
    if (choice.kind === "session") {
      const result = await productivityCreateSession({ title: defaultSessionTitle(Date.parse(request.start), Date.parse(request.end), zone!), plannedStartAt: request.start, plannedEndAt: request.end });
      await reload(); if (keepFocus()) selectObject({ kind: "session", id: result.session.id }); return;
    }
    if (choice.kind === "new-item") {
      const result = await productivityCommitItemWithActions({
        itemCreate: { title: "新任务", status: "进行中", listId: null }, expectedAssociatedActions: [],
        actionCreates: [{ title: "安排 1", nameLinkMode: "initial-linked", plannedStartAt: request.start,
          plannedEndAt: request.end, sessionId: request.sessionId }], actionUpdates: [], actionDeletes: [],
      });
      await reload(); if (keepFocus()) selectObject({ kind: "item", id: result.item.id }, result.actions[0]?.id); return;
    }
    if (choice.kind === "travel-other" || choice.kind === "travel-flight" || choice.kind === "travel-train") {
      ensureTravelRailStack();
      const started = await travelRail!.beginNewTripDraft();
      if (started) {
        travelRailEditing = false;
        week?.render();
      }
      return;
    }
    const kind = choice.kind;
    const result = await productivityCreateAction({ title: nextActionName(kind, choice.id!), nameLinkMode: "initial-linked",
      targetKind: kind, targetId: choice.id, plannedStartAt: request.start, plannedEndAt: request.end,
      sessionId: request.sessionId });
    await reload(); if (keepFocus()) selectObject({ kind: "action", id: result.action.id }, result.action.id);
  }
  async function copyDropped(request: WeekCopy): Promise<void> {
    const source = actionById(request.id);
    if (source.targetKind !== "item" || !source.targetId) throw new Error("只有任务上的安排可以这样复制");
    const item = store.items.find((candidate) => candidate.id === source.targetId && !candidate.deletedAtUtc);
    if (!item) throw new Error("任务已变化，请刷新后重试");
    if (request.kind === "copy-action") {
      await productivityCreateAction({
        title: source.title,
        nameLinkMode: source.nameLinkMode,
        summary: source.summary ?? undefined,
        targetKind: "item",
        targetId: item.id,
        plannedStartAt: request.start,
        plannedEndAt: request.end,
        sessionId: request.sessionId,
        appearance: source.appearance ?? undefined,
      });
      await reload();
      return;
    }
    if (item.travelKind) {
      const travel = await productivityGetTravel({ itemId: item.id, includeDeleted: false });
      const leg = travel.legs.find((candidate) => candidate.actionId === source.id);
      await productivityCreateTravel({
        expectedDataDir,
        title: item.title,
        kind: item.travelKind,
        listId: item.listId ?? null,
        description: item.description ?? null,
        ranges: [{
          plannedStartAt: request.start,
          plannedEndAt: request.end,
          departureCode: leg?.departureCode,
          departureName: leg?.departureName,
          arrivalCode: leg?.arrivalCode,
          arrivalName: leg?.arrivalName,
          departureTerminal: leg?.departureTerminal,
          arrivalTerminal: leg?.arrivalTerminal,
        }],
      });
      await reload();
      return;
    }
    const selectedTags = item.tagIds.flatMap((tagId) => {
      const tag = tags.find((candidate) => candidate.id === tagId && !candidate.deletedAtUtc);
      return tag ? [ref(tag)] : [];
    });
    if (item.itemTypeId && !itemTypeCatalog) throw new Error("分类目录不可用");
    const classificationExpected = {
      ...(item.itemTypeId && itemTypeCatalog ? { itemTypeCatalog: ref(itemTypeCatalog) } : {}),
      ...(selectedTags.length ? { tags: selectedTags } : {}),
    };
    const result = await productivityCommitItemWithActions({
      itemCreate: {
        title: item.title,
        description: item.description ?? undefined,
        status: item.status,
        listId: item.listId ?? null,
        priority: item.priority,
        plannedPoint: item.plannedPoint ?? undefined,
        duePoint: item.duePoint ?? undefined,
        itemTypeId: item.itemTypeId,
        tagIds: item.tagIds,
        ...(Object.keys(classificationExpected).length ? { classificationExpected } : {}),
      },
      expectedAssociatedActions: [],
      actionCreates: [{
        title: source.title,
        nameLinkMode: source.nameLinkMode,
        summary: source.summary ?? undefined,
        sessionId: request.sessionId,
        plannedStartAt: request.start,
        plannedEndAt: request.end,
        appearance: source.appearance ?? undefined,
      }],
      actionUpdates: [],
      actionDeletes: [],
    });
    await reload();
    selectObject({ kind: "item", id: result.item.id }, result.actions[0]?.id);
  }
  function mountWeek() {
    const deleteOwningTask = async (kind: "item" | "task" | "project", id: string) => {
      const taskIds = kind === "project"
        ? new Set((projects.find((project) => project.id === id)?.tasks ?? []).filter((task) => !task.deletedAtUtc).map((task) => task.id))
        : new Set<string>();
      const matches = (targetKind: string | null | undefined, targetId: string | null | undefined) =>
        !!targetKind && !!targetId && ((targetKind === kind && targetId === id) || (kind === "project" && targetKind === "task" && taskIds.has(targetId)));
      const relatedActions = actions.filter((action) => !action.deletedAtUtc && matches(action.targetKind, action.targetId));
      const relatedCheckpoints = checkpoints.filter((checkpoint) => !checkpoint.deletedAtUtc && matches(checkpoint.targetKind, checkpoint.targetId));
      const confirmed = await getConfirmDialog()("删除所有任务", `删除该任务及附属的 ${relatedActions.length} 个安排和 ${relatedCheckpoints.length} 个检查点`, undefined, { danger: true });
      if (!confirmed) return;
      for (const checkpoint of relatedCheckpoints) {
        const v2ItemId = v2TravelItemIdForCheckpoint(checkpoint, store.items, itemTypes, v2TravelProfileIds);
        if (v2ItemId) await commitV2CheckpointDelete(v2ItemId, checkpoint.id);
        else await productivityDeleteCheckpoint({ expectedDataDir, checkpoint: ref(checkpoint) });
      }
      for (const action of relatedActions) await productivityDeleteAction({ action: ref(action) });
      if (kind === "item") {
        const item = store.items.find((value) => value.id === id && !value.deletedAtUtc);
        if (!item) throw new Error("任务已变化，请刷新后重试");
        const prepared = await prepareDeleteItems([item], expectedDataDir);
        await deleteItems([item], { prepared });
      } else if (kind === "task") {
        const project = projects.find((value) => value.tasks.some((task) => task.id === id && !task.deletedAtUtc));
        if (!project) throw new Error("任务已变化，请刷新后重试");
        await productivityDeleteTaskSubtree({ project: ref(project), taskId: id });
      } else {
        const project = projects.find((value) => value.id === id && !value.deletedAtUtc);
        if (!project) throw new Error("所属项目已变化，请刷新后重试");
        await productivityDeleteProject({ project: ref(project) });
      }
      if (selection && (
        ((selection.kind === "item" || selection.kind === "task") && selection.id === id)
        || (selection.kind === "action" && relatedActions.some((action) => action.id === selection.id))
        || (selection.kind === "checkpoint" && relatedCheckpoints.some((checkpoint) => checkpoint.id === selection.id))
      )) selectObject(null);
      await refreshAfterWrite();
    };
    return mountArrangementWeek({ host: weekEl,
      getHealth:health.getData,getHealthSelection:()=>selectedHealth,
      onHealthSelect:health.select,onHealthMenu:health.menu,
      getData: () => {
        const travelTargets = new Map<string, boolean>();
        const isTravelTarget = (value: { targetKind?: string | null; targetId?: string | null }) => {
          if (value.targetKind !== "item" || !value.targetId) return false;
          const cached = travelTargets.get(value.targetId);
          if (cached !== undefined) return cached;
          const result = Boolean(v2TravelItemIdForCheckpoint(value, store.items, itemTypes, v2TravelProfileIds));
          travelTargets.set(value.targetId, result);
          return result;
        };
        const actionTravel = new Map<string, boolean>();
        for (const action of actions) if (!actionTravel.has(action.id)) actionTravel.set(action.id, isTravelTarget(action));
        return {
          actions: actions.filter((action) => !actionTravel.get(action.id)),
          checkpoints: checkpoints.filter((checkpoint) => !isTravelTarget(checkpoint)),
          sessions,
          targets: targetIndex,
          zone: zone!,
        };
      },
      getFlightActionBlock: (action) => {
        if (action.targetKind !== "item" || !action.targetId) return null;
        const item = store.items.find((candidate) => candidate.id === action.targetId);
        if (item?.travelKind !== "flight") return null;
        const leg = travelSnapshots.get(item.id)?.legs.find((candidate) => candidate.actionId === action.id);
        return { departureCode: leg?.departureCode ?? "", arrivalCode: leg?.arrivalCode ?? "" };
      },
      getExpectedDataDir: () => getSettings().dataDir.trim(),
      getSelection: () => selection?.kind === "action" || selection?.kind === "checkpoint" || selection?.kind === "session" ? selection : null,
      getFocusedCheckpointId: () => focusedCheckpointId,
      onSelect: (next, focusId) => {
        if (next?.kind === "checkpoint") {
          const checkpoint = checkpoints.find((value) => value.id === next.id);
          const target = checkpoint?.targetKind && checkpoint.targetId ? targetIndex.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
          if (target && (checkpoint?.targetKind === "item" || checkpoint?.targetKind === "task") && checkpoint.targetId) {
            selectObject({ kind: checkpoint.targetKind, id: checkpoint.targetId }, checkpoint.id);
            return;
          }
        }
        selectObject(next, focusId);
      },
      onCreate: createFromRange,
      onMove: movePlan,
      captureCheckpointMove: captureCheckpointBaseline,
      captureSessionMove: captureSessionBaseline,
      getDraggedCheckpointBaseline: () => draggedCheckpointBaseline,
      onMoveCheckpoint: async (request) => {
        const v2ItemId = v2TravelItemIdForCheckpoint(request.baseline.checkpoint, store.items, itemTypes, v2TravelProfileIds);
        if (v2ItemId) {
          await commitV2CheckpointPlan(v2ItemId, request.id, request.plannedAtUtc);
          return;
        }
        const target = request.sessionId ? request.baseline.sessions.get(request.sessionId) : null;
        if (request.sessionId && !target) throw new Error("工作时间已变化，请重新拖动检查点");
        await planHistory.checkpoint({ expectedDataDir: request.baseline.expectedDataDir,
          checkpoint: request.baseline.checkpoint, plannedAtUtc: request.plannedAtUtc,
          currentSession: request.baseline.currentSession, nextSession: target?.session ?? null,
          expectedCurrentCheckpoints: request.baseline.expectedCurrentCheckpoints,
          expectedNextCheckpoints: request.sessionId === request.baseline.currentSession?.id
            ? request.baseline.expectedCurrentCheckpoints : target?.members ?? [] });
      },
      onCreateCheckpoint: async (plannedAtUtc, sessionId) => {
        const result = await productivityCommitItemWithCheckpoint({ expectedDataDir, itemTitle: "新任务", checkpointTitle: "检查点 1", plannedAtUtc, session: sessionId ? ref(sessionById(sessionId)) : null });
        await reload();
        selectObject({ kind: "item", id: result.item.id }, result.checkpoint.id);
      },
      onToggleCheckpoint: async (checkpoint) => {
        const v2ItemId = v2TravelItemIdForCheckpoint(checkpoint, store.items, itemTypes, v2TravelProfileIds);
        if (v2ItemId) {
          if (pendingPlans.has(`checkpoint:${checkpoint.id}`)) return;
          pendingPlans.add(`checkpoint:${checkpoint.id}`);
          try {
            await commitV2CheckpointCompleted(v2ItemId, checkpoint.id, !checkpoint.completed);
          } finally { pendingPlans.delete(`checkpoint:${checkpoint.id}`); }
          return;
        }
        if (pendingPlans.has(`checkpoint:${checkpoint.id}`)) return;
        pendingPlans.add(`checkpoint:${checkpoint.id}`);
        try {
          const req = { expectedDataDir, checkpoint: ref(checkpoint) };
          if (checkpoint.completed) await productivityReopenCheckpoint(req);
          else await productivityCompleteCheckpoint(req);
          await refreshAfterWrite();
        } finally { pendingPlans.delete(`checkpoint:${checkpoint.id}`); }
      },
      onDeleteCheckpoint: (checkpoint) => { void (async () => {
        const confirmed = await getConfirmDialog()("删除检查点", "确定删除此检查点？所属事情不会删除。", undefined, { danger: true });
        if (!confirmed) return;
        const v2ItemId = v2TravelItemIdForCheckpoint(checkpoint, store.items, itemTypes, v2TravelProfileIds);
        if (v2ItemId) {
          await commitV2CheckpointDelete(v2ItemId, checkpoint.id);
          return;
        }
        await productivityDeleteCheckpoint({ expectedDataDir, checkpoint: ref(checkpoint) });
        await refreshAfterWrite();
      })().catch((error) => setError(invokeErrorText(error))); },
      onDeleteCheckpointTarget: (checkpoint) => { void (async () => {
        if (!checkpoint.targetKind || !checkpoint.targetId) return;
        await deleteOwningTask(checkpoint.targetKind, checkpoint.targetId);
      })().catch((error) => setError(invokeErrorText(error))); },
      getCheckpointMenuData: (checkpoint) => {
        const targetItem = checkpoint.targetKind === "item" && checkpoint.targetId ? store.items.find((item) => item.id === checkpoint.targetId) : undefined;
        const selectedTags = new Set(targetItem?.tagIds ?? []);
        return {
          move: [{ value: "clear", label: "未关联" },
            ...store.items.filter((item) => !item.deletedAtUtc).map((item) => ({ value: `item:${item.id}`, label: item.title, sublabel: item.listId ? store.lists.find((list) => list.id === item.listId)?.title : "Inbox" })),
            ...projects.filter((project) => !project.deletedAtUtc).flatMap((project) => project.tasks.filter((task) => !task.deletedAtUtc).map((task) => ({ value: `task:${task.id}`, label: task.title, sublabel: project.title }))),
            ...projects.filter((project) => !project.deletedAtUtc).map((project) => ({ value: `project:${project.id}`, label: project.title, sublabel: "项目" }))],
          lists: targetItem ? liveLists(store.lists).map((list) => ({ id: list.id, title: list.title, revision: list.revision })) : [],
          categories: categoryMenu(targetItem?.itemTypeId ? [targetItem.itemTypeId] : []),
          tags: tags.filter((tag) => !tag.deletedAtUtc && (!tag.inactive || selectedTags.has(tag.id))).map((tag) => ({ value: tag.id, label: tag.name })),
          selectedCategory: targetItem?.itemTypeId ?? "", selectedTags,
        };
      },
      onMoveCheckpointToList: (checkpoint, listId, capturedDataDir) => { void (async () => {
        if (checkpoint.targetKind !== "item" || !checkpoint.targetId) throw new Error("只有关联任务支持移动清单");
        const item = store.items.find((value) => value.id === checkpoint.targetId);
        if (!item) throw new Error("任务已变化，请刷新后重试");
        const list = listId ? store.lists.find((value) => value.id === listId) : null;
        if (listId && !list) throw new Error("目标清单已变化，请刷新后重试");
        await moveItemsToList([item], list ?? null, capturedDataDir);
        await refreshAfterWrite();
      })().catch((error) => setError(invokeErrorText(error))); },
      onCheckpointMenuChange: (checkpoint, field, value) => { void (async () => {
        if (!checkpoint.targetKind || !checkpoint.targetId) throw new Error("检查点未关联事情");
        if (field === "move") {
          if (value === "clear") { await productivityClearCheckpointTarget({ expectedDataDir, checkpoint: ref(checkpoint) }); }
          else {
            const [targetKind, targetId] = String(value).split(":") as ["item" | "task" | "project", string];
            const owner = targetKind === "item" ? store.items.find((entry) => entry.id === targetId)
              : targetKind === "project" ? projects.find((entry) => entry.id === targetId)
                : projects.find((entry) => entry.tasks.some((task) => task.id === targetId));
            if (!owner) throw new Error("目标事情已变化，请刷新后重试");
            await productivitySetCheckpointTarget({ expectedDataDir, checkpoint: ref(checkpoint), targetKind, targetId, owningRoot: ref(owner) });
          }
        } else {
          if (checkpoint.targetKind !== "item") throw new Error("分类和标签只适用于任务");
          const item = store.items.find((entry) => entry.id === checkpoint.targetId);
          if (!item) throw new Error("任务已变化，请刷新后重试");
          if (field === "category") {
            const itemTypeId = value as string;
            if (itemTypeId && !itemTypeCatalog) throw new Error("分类目录不可用");
            await productivityUpdateItem({ item: ref(item), patch: { itemTypeId: itemTypeId || null,
              classificationExpected: itemTypeId && itemTypeCatalog ? { itemTypeCatalog: ref(itemTypeCatalog) } : undefined } });
          } else {
            const tagIds = [...(value as Set<string>)];
            const selected = tagIds.map((tagId) => tags.find((tag) => tag.id === tagId));
            if (selected.some((tag) => !tag)) throw new Error("标签已变化");
            await productivityUpdateItem({ item: ref(item), patch: { tagIds, classificationExpected: { tags: selected.map((tag) => ref(tag!)) } } });
          }
        }
        await refreshAfterWrite();
      })().catch((error) => setError(invokeErrorText(error))); },
      onCopy: copyDropped,
      onError: setError, getDay: visibleFirstDay,
      onDay: (day) => { weekDay = day; refreshCalendar(); refreshTravelListWeekBestEffort(); refreshActivityPauses(); },
      getDraggedActionId: () => draggedActionId,
      getDraggedActionBaseline: () => draggedActionBaseline,
      captureActionBaseline,
      getActionMenuData: actionMenuData,
      onMoveActionToList: (action, listId, capturedDataDir) => {
        void (async () => {
          if (action.targetKind !== "item" || !action.targetId) throw new Error("只有关联任务支持移动清单");
          const item = store.items.find((candidate) => candidate.id === action.targetId);
          if (!item) throw new Error("任务已变化，请刷新后重试");
          const list = listId ? store.lists.find((candidate) => candidate.id === listId) : null;
          if (listId && !list) throw new Error("目标清单已变化，请刷新后重试");
          await moveItemsToList([item], list ?? null, capturedDataDir);
          await refreshAfterWrite();
        })().catch((error) => setError(invokeErrorText(error)));
      },
      onActionMenuChange: (action, field, value) => {
        void applyActionMenuChange(action, field, value).catch((error) => setError(invokeErrorText(error)));
      },
      onDeleteAction: (action) => { void (async () => {
        const confirmed = await getConfirmDialog()("删除安排", "此操作会删除所选对象。", undefined, {});
        if (!confirmed) return;
        await productivityDeleteAction({ action: ref(action) });
        if (selection?.kind === "action" && selection.id === action.id) selectObject({ kind: action.targetKind, id: action.targetId });
        await refreshAfterWrite();
      })().catch((error) => setError(invokeErrorText(error))); },
      onDeleteLinkedTask: (action) => { void (async () => {
        if ((action.targetKind !== "item" && action.targetKind !== "task") || !action.targetId) return;
        await deleteOwningTask(action.targetKind, action.targetId);
      })().catch((error) => setError(invokeErrorText(error))); },
      onDeleteSession: (session, baselineAtMenu) => { void (async () => {
        const baseline = baselineAtMenu ?? captureSessionBaseline(session);
        const confirmed = await getConfirmDialog()("删除工作时间", "此操作会软删除所选对象。", undefined, {});
        if (!confirmed) return;
        await productivityDeleteSessionOnly({ expectedDataDir: baseline.expectedDataDir, session: baseline.session,
          expectedMembers: baseline.expectedMembers, expectedCheckpoints: baseline.expectedCheckpoints });
        if (selection?.kind === "session" && selection.id === session.id) selectObject(null);
        await refreshAfterWrite();
      })().catch((error) => setError(invokeErrorText(error))); },
      getTravelController: () => {
        ensureTravelRailStack();
        return travelController;
      },
      onTravelEditPlan:(itemId,payload)=>travelHistory.v2(travelController!,itemId,payload),
      getTravelListWeek: () => travelListWeekCache,
      getTravelSnapshot: (itemId) => {
        ensureTravelRailStack();
        return travelController?.getSnapshot(itemId) ?? null;
      },
      getTravelColor: (itemId) => {
        const item = store.items.find((entry) => entry.id === itemId);
        const itemType = itemTypes.find((entry) => entry.id === item?.itemTypeId);
        return itemType?.effectiveColor ?? "var(--insight-primary)";
      },
      getTravelEditMode: () => {
        const v2Id = resolveV2TravelItemId(selection, store.items, actions);
        if (!v2Id || !itemIsV2TravelCandidate(v2Id, store.items, itemTypes, v2TravelProfileIds)) return null;
        return {
          editingItemId: travelRailEditing ? v2Id : null,
          selectedItemId: v2Id,
        };
      },
      getTravelSplitPolicies: () => travelSplitPoliciesFromUi(getSettings().ui),
      onTravelSelect: async (itemId) => {
        // This callback only comes from the v2 travel overlay; its item id is
        // authoritative even if the general item-list reload is still pending.
        rememberV2TravelItems([itemId]);
        // Keep the hit point node stable through the browser's native dblclick
        // sequence. Editing entry performs the next full week render itself.
        if (applyingNavigation) return false;
        if (resolveV2TravelItemId(selection, store.items, actions) === itemId) return true;
        if (navigationReady && _ctx.navigation) {
          const state = captureTaskNavigation();
          const route: TaskNavigationRoute = {
            ...(state.route as TaskNavigationRoute), selection: { kind: "item", id: itemId },
            focusId: null, carrier: "rail", dialogItemId: null,
          };
          travelSelectionRoutes.add(route);
          try {
            const result = await _ctx.navigation.navigate({ ...state, route });
            return result.status === "applied" && !disposed && resolveV2TravelItemId(selection, store.items, actions) === itemId;
          } catch (error) {
            if (!disposed) setError(`行程选择失败：${invokeErrorText(error)}`);
            return false;
          } finally { travelSelectionRoutes.delete(route); }
        }
        selectObject({ kind: "item", id: itemId }, undefined, false);
        week?.syncSelection();
        return true;
      },
      onTravelEnterEdit: (itemId) => {
        if (!applyingNavigation && resolveV2TravelItemId(selection, store.items, actions) === itemId) enterTravelEdit();
      },
      onTravelExitEdit: exitTravelEdit,
    });
  }
  const detail = mountArrangementDetail({ host: detailEl, taskClassification: true,
    getData: () => ({ actions, checkpoints, sessions, items: store.items, projects, lists: store.lists, itemTypes, tags, targets: targetIndex, zone: zone! }),
    getSelection: () => selection, week: () => view === "week", onSelect: selectObject,
    onSaveAction: async (id, field, value) => {
      const action = actionById(id);
      if (field === "plan") {
        if (value === null) {
          if (v2TravelItemIdForAction(id, store.items, actions, itemTypes, v2TravelProfileIds)) {
            throw new Error("出行行程请在侧栏编辑中调整计划时间");
          }
          if (action.sessionId) throw new Error("请先将安排移出工作时间后清除计划");
          if (travelItemForSelection({kind:"action",id})) throw new Error("出行行程请在专用编辑中调整计划时间");
          if (health.getData()?.plans.some((plan)=>plan.action.id===id)) throw new Error("健康计划须保留完整计划区间");
          await planHistory.action({ clear:id }); return;
        }
        const plan = value as { start: string; end: string };
        const start = plan.start.endsWith("Z") ? Date.parse(plan.start) : instantForWall(plan.start.slice(0, 10), Number(plan.start.slice(11, 13)) * 60 + Number(plan.start.slice(14, 16)), zone!);
        const end = plan.end.endsWith("Z") ? Date.parse(plan.end) : instantForWall(plan.end.slice(0, 10), Number(plan.end.slice(11, 13)) * 60 + Number(plan.end.slice(14, 16)), zone!);
        if (end <= start) throw new Error("结束时间须晚于开始时间");
        const startIso = new Date(start).toISOString();
        const endIso = new Date(end).toISOString();
        if (v2TravelItemIdForAction(id, store.items, actions, itemTypes, v2TravelProfileIds)) {
          await commitV2TravelActionPlan(id, startIso, endIso);
          return;
        }
        const baseline = captureActionBaseline(id);
        await movePlan({ kind: "action", id, start: startIso, end: endIso, sessionId: action.sessionId ?? null, baseline });
        return;
      } else if (field === "link") {
        await productivityUpdateAction({ action: ref(action), patch: { nameLinkMode: action.nameLinkMode === "unlinked" ? "manually-linked" : "unlinked" } });
      } else await productivityUpdateAction({ action: ref(action), patch: field === "title"
        ? { title: value as string, ...(action.nameLinkMode === "initial-linked" ? { nameLinkMode: "unlinked" as const } : {}) }
        : { summary: value as string } });
      await refreshAfterWrite();
    },
    captureSessionBaseline,
    onSaveSession: async (id, field, value, baselineAtIntent) => {
      const session = sessionById(id);
      const baseline = baselineAtIntent ?? captureSessionBaseline(session);
      if (field === "plan") {
        const plan = value as { start: string; end: string };
        const parse = (text: string) => instantForWall(text.slice(0, 10), Number(text.slice(11, 13)) * 60 + Number(text.slice(14, 16)), zone!);
        await movePlan({ kind: "session", id, start: new Date(parse(plan.start)).toISOString(), end: new Date(parse(plan.end)).toISOString(), sessionId: null, baseline });
      } else { await productivityUpdateSession({ expectedDataDir: baseline.expectedDataDir, session: baseline.session,
        expectedCheckpoints: baseline.expectedCheckpoints, patch: { [field]: value as string } }); await refreshAfterWrite(); }
    },
    onSaveItem: async (id, field, value) => {
      const item = store.items.find((current) => current.id === id);
      if (item) {
        const patch = field === "plannedPoint" || field === "duePoint" ? { [field]: value as ProductivityPoint | null } : { [field]: value as string };
        await productivityUpdateItem({ item: ref(item), patch });
      }
      else {
        const project = projects.find((current) => current.tasks.some((task) => task.id === id));
        if (!project) throw new Error("事情已变化");
        const patch = field === "plannedPoint" || field === "duePoint" ? { [field]: value as ProductivityPoint | null } : { [field]: value as string };
        await productivityUpdateTask({ project: ref(project), taskId: id, patch });
      }
      await refreshAfterWrite();
    },
    onSaveThingChoice: async (kind, id, field, value) => {
      if (kind === "task") {
        const project = projects.find((current) => current.tasks.some((task) => task.id === id));
        if (!project) throw new Error("事情已变化");
        if (field === "status") await productivitySetTaskStatus({ project: ref(project), taskId: id, status: value as string });
        else if (field === "itemTypeId") {
          const typeId = value as string | null;
          if (typeId && !itemTypeCatalog) throw new Error("分类目录不可用");
          await productivityUpdateTask({ expectedDataDir, project: ref(project), taskId: id, patch: { itemTypeId: typeId, classificationExpected: typeId && itemTypeCatalog ? { itemTypeCatalog: ref(itemTypeCatalog) } : undefined } });
        } else throw new Error("项目任务不支持该字段");
      } else {
        const item = store.items.find((current) => current.id === id);
        if (!item) throw new Error("事情已变化");
        if (field === "status") await productivitySetItemStatus({ item: ref(item), status: value as string });
        else if (field === "listId") {
          const listId = value as string | null;
          if (!listId) await productivityRemoveItemFromList({ item: ref(item) });
          else {
            const list = store.lists.find((current) => current.id === listId);
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
      await refreshAfterWrite();
    },
    canEditIntervals: (action) => (action.targetKind === "item" || action.targetKind === "task")
      && !actionMenuData(action).travel && !health.getData()?.plans.some((plan) => plan.action.id === action.id),
    onEditInterval: async (action, operation, intervalId, startedAt, endedAt) => {
      const targetId = action.targetId;
      const root = action.targetKind === "item" ? store.items.find((item) => item.id === targetId)
        : action.targetKind === "task" ? projects.find((project) => project.tasks.some((task) => task.id === targetId)) : undefined;
      if (!root) throw new Error("关联事情已变化，请刷新后重试");
      try {
        await productivityEditActionInterval({ expectedDataDir, action: ref(action), targetOwningRoot: ref(root), operation, intervalId, startedAt, endedAt });
        await refreshAfterWrite();
      } catch (error) {
        await refreshAfterWrite();
        throw error;
      }
    },
    onExecute: async (id, command) => {
      const action = actionById(id);
      const req = { action: ref(action) };
      if (command === "start") await productivityStartAction(req);
      if (command === "pause") await productivityPauseAction(req);
      if (command === "resume") await productivityResumeAction(req);
      if (command === "end") await productivityEndAction(req);
      if (command === "reopen") await productivityReopenAction(req);
      await refreshAfterWrite();
    },
    onDelete: async (kind, id) => {
      const selectionBefore = selection;
      const actionTarget = kind === "action" ? actionById(id) : null;
      const sessionBaseline = kind === "session" ? captureSessionBaseline(sessionById(id)) : null;
      // Action confirmation is owned by the shared arrangement rail; do not ask twice.
      if (kind === "session") {
        const confirmed = await getConfirmDialog()("删除工作时间", "此操作会软删除所选对象。", undefined, {});
        if (!confirmed) return;
      }
      if (kind === "action") {
        if (actionTarget && actionMenuData(actionTarget).travel) { await deleteTravelForAction(actionTarget); return; }
        await productivityDeleteAction({ action: ref(actionById(id)) });
      }
      else if (sessionBaseline) await productivityDeleteSessionOnly({ expectedDataDir: sessionBaseline.expectedDataDir,
        session: sessionBaseline.session, expectedMembers: sessionBaseline.expectedMembers, expectedCheckpoints: sessionBaseline.expectedCheckpoints });
      if (selection === selectionBefore) {
        // Keep the owning Item/Task visible after removing its selected Action.
        // The Action is a child detail, so deleting it must not clear the parent rail selection.
        if (actionTarget?.targetKind && actionTarget.targetId) selectObject({ kind: actionTarget.targetKind, id: actionTarget.targetId });
        else selectObject(null);
      }
      await refreshAfterWrite();
    },
    onCreateAction: async (kind, id) => {
      const origin = railGeneration;
      const result = await productivityCreateAction({ title: nextActionName(kind, id), nameLinkMode: "initial-linked", targetKind: kind, targetId: id });
      if (disposed) return;
      await reload();
      if (!disposed && railGeneration === origin) selectObject({ kind: "action", id: result.action.id }, result.action.id);
    },
    onCreateCheckpoint: async (kind, id) => {
      const origin = railGeneration;
      if (kind === "item" && itemIsV2TravelCandidate(id, store.items, itemTypes, v2TravelProfileIds)) {
        await ensureV2TripLoaded(id);
        const controller = travelController!;
        const snap = controller.getSnapshot(id);
        if (!snap) throw new Error("无法加载出行行程，请刷新后重试");
        const checkpointId = newTravelMemberId();
        const pointId = newTravelMemberId();
        const checkpointCount = snap.checkpoints.filter((entry) => !entry.deletedAtUtc).length;
        // F1: default plan time is visible-week noon in business zone, else now.
        const plannedAtUtc = zone
          ? new Date(instantForWall(visibleFirstDay(), 12 * 60, zone)).toISOString()
          : new Date().toISOString();
        controller.queueAppend(id, {
          kind: "checkpoint",
          checkpointId,
          pointId,
          plannedAtUtc,
          title: `检查点 ${checkpointCount + 1}`,
        });
        await reload();
        if (!disposed && railGeneration === origin) selectObject({ kind, id }, checkpointId);
        return;
      }
      const checkpointCount = checkpoints.filter((value) => !value.deletedAtUtc && value.targetKind === kind && value.targetId === id).length;
      const result = await productivityCreateCheckpoint({
        expectedDataDir, title: `检查点 ${checkpointCount + 1}`, nameLinkMode: "initial-linked", targetKind: kind, targetId: id,
        owningRoot: kind === "item" ? store.items.find((value) => value.id === id) ? ref(store.items.find((value) => value.id === id)!) : undefined
          : projects.find((value) => value.tasks.some((task) => task.id === id)) ? ref(projects.find((value) => value.tasks.some((task) => task.id === id))!) : undefined,
      });
      await reload();
      if (!disposed && railGeneration === origin) selectObject({ kind, id }, result.checkpoint.id);
    },
    onSaveCheckpoint: async (checkpoint, field, value) => {
      if (disposed || getSettings().dataDir.trim() !== expectedDataDir) throw new Error("数据目录已切换，请刷新后重试");
      const current = checkpoints.find((entry) => entry.id === checkpoint.id);
      if (!current || current.revision !== checkpoint.revision) throw new Error("检查点已变化，请刷新后重试");
      if (field === "plan" && current.actualAtUtc) throw new Error("已有实际时间的检查点不能修改计划时间");
      if (field === "plan") {
        const plannedAtUtc = value ? new Date(instantForWall((value as {date:string}).date, Number((value as {time:string}).time.slice(0,2))*60+Number((value as {time:string}).time.slice(3,5)), zone!)).toISOString() : null;
        const v2ItemId = v2TravelItemIdForCheckpoint(current, store.items, itemTypes, v2TravelProfileIds);
        if (v2ItemId) {
          if (!plannedAtUtc) throw new Error("出行行程检查点须保留计划时间");
          await commitV2CheckpointPlan(v2ItemId, current.id, plannedAtUtc);
          return;
        }
        const currentSession = current.sessionId ? sessions.find((entry) => entry.id === current.sessionId) ?? null : null;
        const point = plannedAtUtc ? Date.parse(plannedAtUtc) : NaN;
        const keepSession = !!currentSession && Number.isFinite(point) && point >= Date.parse(currentSession.plannedStartAt) && point < Date.parse(currentSession.plannedEndAt);
        const currentRefs = currentSession ? checkpoints.filter((entry) => entry.sessionId === currentSession.id && !entry.deletedAtUtc).map(ref) : [];
        await planHistory.checkpoint({ expectedDataDir, checkpoint: ref(current), plannedAtUtc,
          currentSession: currentSession ? ref(currentSession) : null, nextSession: keepSession && currentSession ? ref(currentSession) : null,
          expectedCurrentCheckpoints: currentRefs, expectedNextCheckpoints: keepSession ? currentRefs : [] });
        return;
      }
      const v2ItemId = v2TravelItemIdForCheckpoint(current, store.items, itemTypes, v2TravelProfileIds);
      if (v2ItemId) {
        if (field === "nameLinkMode") {
          throw new Error("出行行程检查点不支持名称关联模式");
        }
        if (field === "title") {
          await ensureV2TripLoaded(v2ItemId);
          const snap = travelController!.getSnapshot(v2ItemId);
          const point = snap?.canonicalPoints.find((entry) => entry.ownerCheckpointId === current.id);
          if (!point) throw new Error("检查点缺少出行点信息，请刷新后重试");
          const draftKey = `point:${point.pointId}:actionLabel` as TravelTextDraftKey;
          travelController!.setTextDraft(v2ItemId, draftKey, value as string);
          travelController!.queueTextCommit(
            v2ItemId,
            draftKey,
            (text) => ({ pointId: point.pointId, actionLabel: text }),
            productivityTravelV2UpdatePoint,
          );
          await reload();
          return;
        }
      }
      const patch = field === "title" ? { title: value as string,
        ...(current.nameLinkMode === "initial-linked" ? { nameLinkMode: "unlinked" as const } : {}) }
        : { nameLinkMode: value as "manually-linked" | "unlinked" };
      await productivityUpdateCheckpoint({ expectedDataDir, checkpoint: ref(current), ...patch });
      await refreshAfterWrite();
    },
    onCompleteCheckpoint: async (checkpoint, completed) => {
      const v2ItemId = v2TravelItemIdForCheckpoint(checkpoint, store.items, itemTypes, v2TravelProfileIds);
      if (v2ItemId) {
        if (pendingPlans.has(`checkpoint:${checkpoint.id}`)) return;
        pendingPlans.add(`checkpoint:${checkpoint.id}`);
        try {
          await commitV2CheckpointCompleted(v2ItemId, checkpoint.id, completed);
        } finally { pendingPlans.delete(`checkpoint:${checkpoint.id}`); }
        return;
      }
      if (pendingPlans.has(`checkpoint:${checkpoint.id}`)) return;
      pendingPlans.add(`checkpoint:${checkpoint.id}`);
      try {
        if (completed) await productivityCompleteCheckpoint({ expectedDataDir, checkpoint: ref(checkpoint) });
        else await productivityReopenCheckpoint({ expectedDataDir, checkpoint: ref(checkpoint) });
        await refreshAfterWrite();
      } finally { pendingPlans.delete(`checkpoint:${checkpoint.id}`); }
    },
    onDeleteCheckpoint: async (checkpoint) => {
      const v2ItemId = v2TravelItemIdForCheckpoint(checkpoint, store.items, itemTypes, v2TravelProfileIds);
      if (v2ItemId) {
        await commitV2CheckpointDelete(v2ItemId, checkpoint.id);
        return;
      }
      await productivityDeleteCheckpoint({ expectedDataDir, checkpoint: ref(checkpoint) });
      await refreshAfterWrite();
    },
    onLifecycle: async (kind, id, outcome) => {
      const plan=kind==="item"?health.find(id):null;
      if(plan){if(outcome==="complete")await health.link(plan);else await health.mutate(plan,"cancel");return;}
      if (kind === "item" && itemIsV2TravelCandidate(id, store.items, itemTypes, v2TravelProfileIds)) {
        ensureTravelRailStack();
        const related = actions.filter((action) => action.targetKind === kind && action.targetId === id && !action.deletedAtUtc && !action.ended);
        const active = related.some((action) => action.intervals.some((interval) => !interval.endedAt && !interval.deletedAtUtc));
        if (active) {
          const confirmed = await getConfirmDialog()(outcome === "complete" ? "完成事情" : "取消事情", "正在计时的安排将一起结束。", undefined, {});
          if (!confirmed) return;
        }
        if (outcome === "complete") travelController!.queueFinish(id);
        else travelController!.queueCancel(id, {});
        await reload();
        return;
      }
      const owningRoot = kind === "item" ? store.items.find((item) => item.id === id)
        : projects.find((project) => project.tasks.some((task) => task.id === id));
      if (!owningRoot) throw new Error("事情已变化");
      const related = actions.filter((action) => action.targetKind === kind && action.targetId === id && !action.deletedAtUtc && !action.ended);
      const active = related.some((action) => action.intervals.some((interval) => !interval.endedAt && !interval.deletedAtUtc));
      const pendingCheckpoints = checkpoints.filter((checkpoint) => checkpoint.targetKind === kind && checkpoint.targetId === id && !checkpoint.deletedAtUtc && !checkpoint.completed);
      if (outcome === "cancel" && pendingCheckpoints.length) throw new Error("请先完成或删除关联的未完成检查点，再取消此事情");
      let confirmActiveIntervals = false;
      if (active || (outcome === "complete" && pendingCheckpoints.length)) {
        const lines = pendingCheckpoints.map((checkpoint) => `• ${checkpoint.title}`).join("\n");
        const message = [active ? "正在计时的安排将一起结束。" : "", pendingCheckpoints.length
          ? `将同时完成以下检查点，且不记录实际时间：\n${lines}` : ""].filter(Boolean).join("\n\n");
        confirmActiveIntervals = await getConfirmDialog()(outcome === "complete" ? "完成事情" : "取消事情", message, undefined, {});
        if (!confirmActiveIntervals) return;
      }
      await productivityCommitThingLifecycle({ thingKind: kind, owningRoot: ref(owningRoot), taskId: kind === "task" ? id : undefined,
        outcome, expectedMembers: related.map(ref), confirmActiveIntervals, expectedDataDir,
        ...(outcome === "complete" && pendingCheckpoints.length ? { expectedCheckpoints: pendingCheckpoints.map(ref), completeCheckpointsWithoutActual: true } : {}) });
      await reload();
    }, onError: setError, onDragAction: (id) => {
      draggedActionId = id;
      try { draggedActionBaseline = id ? captureActionBaseline(id) : null; }
      catch (error) { draggedActionBaseline = null; setError(invokeErrorText(error)); }
    }, onDragCheckpoint: (checkpoint) => {
      try { draggedCheckpointBaseline = checkpoint ? captureCheckpointBaseline(checkpoint) : null; }
      catch (error) { draggedCheckpointBaseline = null; setError(invokeErrorText(error)); }
    },
  });

  function applyCanonicalItemTypes(next: ItemTypeCatalogSnapshot | null): void {
    // A catalog write wins over older catalog reads without discarding unrelated page data.
    itemTypeGeneration++;
    itemTypeCatalog = next;
    itemTypes = next?.itemTypes ?? [];
    targetIndex = targets(store.items, projects, itemTypes);
    const archived = new Set(store.lists.filter((list) => list.status === "已归档").map((list) => list.id));
    for (const item of store.items) {
      const target = targetIndex.get(`item:${item.id}`);
      if (target && item.listId && archived.has(item.listId)) { target.archived = true; target.available = false; }
    }
    week?.render();
    renderDetail();
    itemList.render();
  }
  categoryManager = mountItemTypeManager({ host: managerEl, initialCatalog: itemTypeCatalog, expectedDataDir,
    onSaved: applyCanonicalItemTypes,
    onBack: () => { if (view === "week") selectWeek(false); else selectScope(scope, false); },
  });

  function paintToggles(): void {
    const vis = getVisibility();
    if (scope.kind === "archived-index") {
      togglesEl.innerHTML = "";
      return;
    }
    const toggles = `
      <label class="task-toggle"><input type="checkbox" data-toggle="completed"${vis.showCompleted ? " checked" : ""}> 显示完成</label>
      <label class="task-toggle"><input type="checkbox" data-toggle="cancelled"${vis.showCancelled ? " checked" : ""}> 显示取消</label>`;
    if (scope.kind === "archived-list") {
      const list = store.lists.find((l) => l.id === scope.listId);
      const unarchive = list
        ? `<button type="button" class="task-unarchive-btn" data-action="unarchive">取消归档</button>`
        : "";
      togglesEl.innerHTML = toggles + unarchive;
      return;
    }
    togglesEl.innerHTML = toggles;
  }

  function validateScopeAfterLoad(): void {
    if (scope.kind === "list") {
      const list = liveLists(store.lists).find((l) => l.id === scope.listId);
      if (!list || list.status === "已归档") {
        selectScope({ kind: "all" });
        setScopeMessage(list ? "所选清单已归档，已切换到所有任务" : "所选清单不可用，已切换到所有任务");
      }
    }
    if (scope.kind === "archived-list") {
      const list = liveLists(store.lists).find((l) => l.id === scope.listId);
      if (!list || list.status !== "已归档") {
        selectScope({ kind: "all" });
        setScopeMessage("所选归档清单不可用，已切换到所有任务");
      }
    }
  }

  async function reload(): Promise<void> {
    reloadFailure = null;
    const generation = ++loadGeneration;
    invalidateActivityPauses();
    travelWeekRequestGeneration++;
    travelWeekInFlight = null;
    travelListWeekCacheKey = "";
    flightWeekSnapshotFailed.clear();
    const catalogGeneration = itemTypeGeneration;
    // Only the first successful snapshot uses the blocking "加载中…" placeholder.
    // Later reloads (tab activate, productivity-data-invalidated, mutation follow-up)
    // keep the current rows until the new snapshot paints.
    if (!listReady) {
      loading = true;
      loadError = null;
      itemList.render();
    }
    try {
      const [listRes, itemRes, actionRes, sessionRes, projectRes, typeRes, zoneRes, tagsRes, checkpointRes] = await Promise.all([
        productivityListLists(), productivityListItems({}), productivityListActions(), productivityListSessions(),
        productivityListProjects(), productivityGetItemTypeCatalog(), productivityGetBusinessTimeZone(), productivityListTags(), productivityListCheckpoints({ includeDeleted: false }),
      ]);
      if (disposed || generation !== loadGeneration || getSettings().dataDir.trim() !== expectedDataDir) return;
      let healthChanges: import("../../../productivity/types").HealthPlanSnapshot[] = [];
      try { healthChanges=await health.load("1900-01-01T00:00:00Z","2200-01-01T00:00:00Z"); }
      catch(error){setError(`健康事件加载失败：${invokeErrorText(error)}`);}
      if(disposed||generation!==loadGeneration||getSettings().dataDir.trim()!==expectedDataDir)return;
      for(const changed of healthChanges){const i=itemRes.items.findIndex(v=>v.id===changed.item.id);if(i>=0)itemRes.items[i]=changed.item;const a=actionRes.actions.findIndex(v=>v.id===changed.action.id);if(a>=0)actionRes.actions[a]=changed.action;}
      const lists = liveLists(listRes.lists);
      const itemOrder = resolveItemOrder(itemRes, store.itemOrder);
      store = { lists, items: itemRes.items, itemOrder };
      actions = actionRes.actions;
      checkpoints = checkpointRes.checkpoints;
      sessions = sessionRes.sessions;
      projects = projectRes.projects;
      if (catalogGeneration === itemTypeGeneration) itemTypeCatalog = typeRes.catalog;
      itemTypes = itemTypeCatalog?.itemTypes ?? [];
      tags = tagsRes.tags;
      zone = zoneRes;
      targetIndex = targets(store.items, projects, itemTypes);
      categoryManager?.syncCanonical(itemTypeCatalog);
      const archived = new Set(lists.filter((list) => list.status === "已归档").map((list) => list.id));
      for (const item of store.items) {
        const target = targetIndex.get(`item:${item.id}`);
        if (target && item.listId && archived.has(item.listId)) { target.archived = true; target.available = false; }
      }
      if (!weekDay) weekDay = addDays(today(), -2);
      if (view === "week") await ensureCurrentTravelWeek();
      if (disposed || generation !== loadGeneration || getSettings().dataDir.trim() !== expectedDataDir) return;
      listReady = true;
      loading = false;
      loadError = null;
      taskRail.setLists(lists);
      headingEl.textContent = view === "week" ? "" : scopeHeading(scope, lists);
      toolbarEl.hidden = view === "week";
      validateScopeAfterLoad();
      if (view === "list") paintToggles();
      else { if (!week) week = mountWeek(); else week.render(); ensureFlightWeekSnapshots(); void refreshTravelListWeekBestEffort(); refreshActivityPauses(); }
      refreshCalendar();
      renderDetail();
      itemList.render();
    } catch (err) {
      if (disposed || generation !== loadGeneration) return;
      reloadFailure = err;
      loading = false;
      const message = invokeErrorText(err);
      if (!listReady) loadError = message;
      setError(`安排加载失败：${message}`);
      itemList.render();
    }
  }

  togglesEl.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.toggle === "completed") setVisibility({ showCompleted: t.checked });
    if (t.dataset.toggle === "cancelled") setVisibility({ showCancelled: t.checked });
  });

  togglesEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="unarchive"]');
    if (!btn || scope.kind !== "archived-list") return;
    const list = store.lists.find((l) => l.id === scope.listId);
    if (!list) return;
    void (async () => {
      const restored = await unarchiveList(list, setError);
      if (!restored) return;
      await reload();
      selectScope({ kind: "list", listId: restored.id });
    })();
  });

  async function processPendingNavigation(request: import("../../../productivity/types").ClaimedInsightNavigation, hostInstanceId: string): Promise<void> {
    pendingNavigation = { request, hostInstanceId };
    navigationGeneration++;
    if (navigationBusy) return;
    navigationBusy = true;
    try {
      while (!disposed && pendingNavigation) {
        const generation = navigationGeneration;
        const pending = pendingNavigation; pendingNavigation = null;
        const req = pending.request;
        const respond = (status: "opened" | "cancelled" | "failed", message?: string) =>
          ackInsightItemNavigation({ requestId: req.requestId, hostInstanceId: pending.hostInstanceId,
            result: { status, ...(message ? { message } : {}) } });
        try {
          const current = await productivityGetTaskListSnapshot();
          if (generation !== navigationGeneration) continue;
          if (current.resolvedDataDir !== req.expectedDataDir || current.dataDirEpoch !== req.expectedDataDirEpoch) {
            await respond("cancelled", "数据目录已变化，请从 Panel 重新打开任务"); continue;
          }
          const state = await getInsightItemNavigationResult({ requestId: req.requestId });
          if (state.status !== "accepted" || generation !== navigationGeneration) continue;
          const item = current.items.find((candidate) => candidate.id === req.itemId && !candidate.deletedAtUtc);
          if (!item) { await respond("failed", "任务已删除或不可用"); continue; }
          if (!(await (categoryManager?.canDispose() ?? Promise.resolve(true)))) {
            await respond("cancelled", "有未保存的分类修改，导航已取消"); continue;
          }
          if (generation !== navigationGeneration) continue;
          const stillAccepted = await getInsightItemNavigationResult({ requestId: req.requestId });
          if (stillAccepted.status !== "accepted" || generation !== navigationGeneration) continue;
          const owner = item.listId ? current.lists.find((list) => list.id === item.listId && !list.deletedAtUtc) : null;
          const destination: TaskScope = !item.listId ? { kind: "inbox" }
            : !owner ? { kind: "all" } : owner.status === "已归档" ? { kind: "archived-list", listId: owner.id } : { kind: "list", listId: owner.id };
          if (destination.kind === "all" && item.listId) { await respond("failed", "任务所属清单已不可用"); continue; }

          store = { lists: liveLists(current.lists), items: current.items, itemOrder: current.itemOrder };
          actions = current.actions; itemTypeCatalog = current.itemTypes; itemTypes = current.itemTypes?.itemTypes ?? [];
          zone = current.businessTimeZone; targetIndex = targets(store.items, projects, itemTypes);
          const archivedIds = new Set(store.lists.filter((list) => list.status === "已归档").map((list) => list.id));
          for (const candidate of store.items) {
            const target = targetIndex.get(`item:${candidate.id}`);
            if (target && candidate.listId && archivedIds.has(candidate.listId)) { target.archived = true; target.available = false; }
          }
          categoryManager?.syncCanonical(itemTypeCatalog);
          loading = false; loadError = null; setError("");
          taskRail.setLists(store.lists);
          listDate = null; selectScope(destination, false);
          if (item.status === "完成") setVisibility({ showCompleted: true });
          if (item.status === "取消") setVisibility({ showCancelled: true });
          itemList.render();
          const row = mainEl.querySelector<HTMLElement>(`.task-item-row[data-item-id="${CSS.escape(item.id)}"]`);
          if (!row) { await respond("failed", "任务列表尚未显示目标任务"); continue; }
          row.scrollIntoView({ block: "center" }); row.focus({ preventScroll: true });
          selectObject({ kind: "item", id: item.id });
          await respond("opened");
        } catch (error) {
          if (generation === navigationGeneration) await respond("failed", error instanceof Error ? error.message : String(error)).catch(() => {});
        }
      }
    } finally { navigationBusy = false; }
  }

  async function restoreTaskNavigation(state: NavigationState, token: NavigationToken): Promise<NavigationResult> {
    const route = state.route as TaskNavigationRoute | null;
    if (!route || (route.view !== "week" && route.view !== "list") || !route.scope ||
      !["all", "inbox", "list", "archived-index", "archived-list"].includes(route.scope.kind) ||
      (route.selection && !["action", "checkpoint", "session", "item", "task"].includes(route.selection.kind)) ||
      (route.carrier !== "rail" && route.carrier !== "dialog")) return { status: "unavailable", message: "安排页面状态已失效" };
    const context = state.context as { weekDay?: string; centerToday?: boolean; listDate?: { start: string; end: string } | null; listTop?: number; listLeft?: number; weekTop?: number; weekLeft?: number; visibility?: ScopeVisibility } | null;
    // A week-overlay selection must retain its hit node through the browser's
    // double-click sequence. Navigation has already run the normal leave guard.
    if (travelSelectionRoutes.has(route) && view === "week" && route.view === "week" && !categoryManagerMode && !route.categoryManager &&
      route.carrier === "rail" && !detailDialogItemId && route.selection?.kind === "item" &&
      scopeKey(route.scope) === scopeKey(scope) && store.items.some((item) => item.id === route.selection!.id && !item.deletedAtUtc)) {
      if (!token.isCurrent() || disposed) return { status: "blocked" };
      applyingNavigation = true;
      try { selectObject(route.selection, undefined, false); week?.syncSelection(); }
      finally { applyingNavigation = false; }
      return { status: "applied" };
    }
    await reload();
    if (!token.isCurrent() || disposed) return { status: "blocked" };
    if (reloadFailure) return { status: "failed", error: reloadFailure };
    const requestedScope = route.scope;
    if ((requestedScope.kind === "list" || requestedScope.kind === "archived-list") && !store.lists.some((list) => list.id === requestedScope.listId)) return { status: "unavailable", message: "原清单已不可用" };
    const selected = route.selection;
    if (selected) {
      const available = selected.kind === "action" ? actions.some((value) => value.id === selected.id && !value.deletedAtUtc)
        : selected.kind === "checkpoint" ? checkpoints.some((value) => value.id === selected.id)
        : selected.kind === "session" ? sessions.some((value) => value.id === selected.id && !value.deletedAtUtc)
        : selected.kind === "item" ? store.items.some((value) => value.id === selected.id && !value.deletedAtUtc)
        : projects.some((project) => project.tasks.some((task) => task.id === selected.id && !task.deletedAtUtc));
      if (!available) return { status: "unavailable", message: "原详情已不可用" };
    }
    const dialogItem = route.dialogItemId ? store.items.find((item) => item.id === route.dialogItemId && !item.deletedAtUtc) : null;
    if (route.carrier === "dialog" && !dialogItem) return { status: "unavailable", message: "原详情已不可用" };
    let preparedDialog: ItemDetailNavigationHandle | null = null;
    if (dialogItem && detailDialogItemId !== dialogItem.id) {
      preparedDialog = await openItemDetailDialog({ item: dialogItem, isCurrent: token.isCurrent,
        onSaved: (result) => {
          store = { ...store, items: store.items.map((item) => item.id === result.item.id ? result.item : item) };
          itemDialog?.allowDiscard();
          requestTaskNavigation({ carrier: "rail", dialogItemId: null }, true);
        },
        onConflict: () => { void reload(); },
        onRequestClose: () => {
          void (async () => {
            if (itemDialog && !itemDialog.canNavigate()) {
              const discard = await getConfirmDialog()("放弃详情修改？", "尚未保存的任务详情会被丢弃。", undefined, { confirmLabel: "放弃修改", danger: true });
              if (!discard || disposed) return;
              itemDialog.allowDiscard();
            }
            requestTaskNavigation({ carrier: "rail", dialogItemId: null }, true);
          })();
        },
      });
      if (!preparedDialog) return token.isCurrent() ? { status: "failed", error: new Error("任务详情读取失败") } : { status: "blocked" };
    }
    if (!token.isCurrent()) { preparedDialog?.dispose(); return { status: "blocked" }; }
    if (itemDialog && (route.carrier !== "dialog" || detailDialogItemId !== route.dialogItemId)) {
      await itemDialog.close(); itemDialog.dispose(); itemDialog = null;
    }
    if (!token.isCurrent()) { preparedDialog?.dispose(); return { status: "blocked" }; }
    if (preparedDialog) itemDialog = preparedDialog;
    detailDialogItemId = route.carrier === "dialog" ? route.dialogItemId : null;
    applyingNavigation = true;
    try {
      if (route.view === "week" && (context?.centerToday || context?.weekDay)) {
        weekDay = context.centerToday ? (zone ? addDays(today(), -2) : "") : context.weekDay!;
        if (weekDay) week?.navigateFirst(weekDay);
      }
      if (context && "listDate" in context) listDate = context.listDate ?? null;
      scope = { ...route.scope };
      if (context?.visibility) visibilityByScope.set(scopeKey(scope), { ...context.visibility });
      if (route.view === "week") selectWeek(false); else selectScope(route.scope, false);
      if (route.categoryManager) showCategoryManager();
      selectObject(route.selection, route.focusId ?? undefined);
    } finally { applyingNavigation = false; }
    await ensureCurrentTravelWeek();
    if (!token.isCurrent()) return { status: "blocked" };
    if (route.view === "week") { if (!week) week = mountWeek(); else week.render(); }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!token.isCurrent()) return { status: "blocked" };
    mainEl.scrollTop = context?.listTop ?? 0; mainEl.scrollLeft = context?.listLeft ?? 0;
    const scroll = weekEl.querySelector<HTMLElement>(".arrangement-grid-scroll");
    if (scroll) { scroll.scrollTop = context?.weekTop ?? scroll.scrollTop; if (!context?.weekDay && !context?.centerToday) scroll.scrollLeft = context?.weekLeft ?? scroll.scrollLeft; }
    return { status: "applied" };
  }

  selectWeek(false);
  navigationReady = true;

  return {
    navigation: {
      capture: captureTaskNavigation,
      onVisible: () => { undoOwnerActive = true; itemDialog?.setVisible(true); },
      restoreContext(value, token) {
        if (!token.isCurrent()) return;
        const context = value as { weekDay?: string; centerToday?: boolean; listDate?: { start: string; end: string } | null; listTop?: number; listLeft?: number; weekTop?: number; weekLeft?: number; visibility?: ScopeVisibility } | null;
        const targetWeekDay = context?.centerToday ? (zone ? addDays(today(), -2) : "") : context?.weekDay;
        if (targetWeekDay !== undefined && (context?.centerToday || targetWeekDay !== weekDay)) {
          weekDay = targetWeekDay;
          if (weekDay) week?.navigateFirst(weekDay);
        }
        if (context && "listDate" in context) listDate = context.listDate ?? null;
        if (context?.visibility) { visibilityByScope.set(scopeKey(scope), { ...context.visibility }); paintToggles(); }
        refreshCalendar();
        if (view === "list") itemList.render();
        mainEl.scrollTop = context?.listTop ?? mainEl.scrollTop; mainEl.scrollLeft = context?.listLeft ?? mainEl.scrollLeft;
        const scroll = weekEl.querySelector<HTMLElement>(".arrangement-grid-scroll");
        if (scroll) { scroll.scrollTop = context?.weekTop ?? scroll.scrollTop; if (!context?.weekDay && !context?.centerToday) scroll.scrollLeft = context?.weekLeft ?? scroll.scrollLeft; }
      },
      resolveTaskView(state) {
        const current = captureTaskNavigation();
        return { ...current, route: { ...(current.route as TaskNavigationRoute), view: state.view,
          ...(state.view === "list" ? { scope: filterToScope(state.filter === "all" ? undefined : state.filter) } : { selection: null, focusId: null }),
          categoryManager: false, carrier: "rail", dialogItemId: null },
          ...(state.view === "week" ? { context: { ...(current.context as object), weekDay: "", centerToday: true, weekLeft: undefined } } : {}) };
      },
      async canNavigate(intent) {
        if (intent.intent === "preserve-instance") return true;
        const travelState = travelController?.getState();
        if (detail.hasBlockingDrafts() || [...flightEditDirty.values()].some((fields) => fields.size > 0) ||
          [...flightEditRangeDirty.values()].some((ranges) => ranges.size > 0) || flightEditQueues.size || travelRailEditing ||
          (travelState && ["dirty", "saving", "failed", "conflict"].includes(travelState.saveState))) {
          setError("请先完成或放弃当前详情的修改。"); return false;
        }
        if (itemDialog && !itemDialog.canNavigate()) return false;
        return categoryManager?.canDispose() ?? true;
      },
      restore: restoreTaskNavigation,
    },
    async activate() {
      await reload();
      if (reloadFailure) throw reloadFailure;
      undoOwnerActive = true;
    },
    processPendingNavigation,
    deactivate() { undoOwnerActive = false; itemDialog?.setVisible(false); },
    getRestoreState() {
      return view === "week" ? { view: "week" } : { view: "list", filter: scopeToRestoreFilter(scope) ?? "all" };
    },
    restoreState(state: unknown) {
      applyingNavigation = true;
      try {
      const s = state as TaskDestState | undefined;
      if (!s?.view || s.view === "week") selectWeek(false);
      else selectScope(filterToScope(s.filter === "all" ? undefined : s.filter), false);
      } finally { applyingNavigation = false; }
    },
    getSecondaryRailDescriptor: () => taskRail.getSecondaryRailDescriptor(),
    canDispose: () => categoryManager?.canDispose() ?? Promise.resolve(true),
    dispose() {
      undoOwnerActive = false; releaseUndoOwner(); arrangementHistory.dispose();
      itemDialog?.dispose(); itemDialog = null;
      health.dispose();
      unlistenHealth?.();unlistenHealth=null;
      disposed = true;
      loadGeneration++;
      flightDatePicker?.dispose();
      flightDatePicker = null;
      flightEntryDrafts.clear();
      travelRail?.dispose();
      travelRail = null;
      travelController?.dispose();
      travelController = null;
      categoryManager?.dispose();
      week?.dispose();
      detail.dispose();
      itemList.dispose();
      taskRail.dispose();
      root.innerHTML = "";
    },
  };
}
