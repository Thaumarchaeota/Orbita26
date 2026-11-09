import { escAttr, escHtml } from "../../../../core/html";
import { isTauri } from "../../../../core/data/client";
import { invoke } from "@tauri-apps/api/core";
import { createCheckbox, readCheckbox, setCheckbox, setCheckboxWithCompletionFeedback } from "../../../../ui/checkbox";
import { createInsightDialog } from "../../../../ui/insight-dialog";
import { mountDecoupledDatePicker } from "../../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../../ui/decoupled-time-picker";
import { mountDecoupledDateTimeRangePicker, type DateTimeRangeValue } from "../../../../ui/decoupled-datetime-range-picker";
import { formatDateTimeRangeLabel } from "../../../../ui/datetime-range-display";
import { mountDecoupledDateTimePicker } from "../../../../ui/decoupled-datetime-picker";
import { mountInlineTextField, type InlineTextFieldHandle } from "../../../../ui/inline-text-field";
import { mountSelectField, type SelectFieldHandle } from "../../../../ui/select-field";
import { mountSearchableCascadingMenu, type SearchableCascadingMenuItem } from "../../../../ui/searchable-cascading-menu";
import { mountFlatSelectPopover } from "../../../../ui/flat-select-popover";
import { openUrl } from "../../../shell/adapter";
import type { ActionSnapshot, ItemSnapshot, ItemTypeSnapshot, ListSnapshot, ProjectSnapshot, ProductivityPoint, SessionSnapshot, TagSnapshot, TaskSnapshot } from "../../../productivity/types";
import type { CheckpointSnapshot } from "../../../productivity/checkpoint-types";
import { dateAt, instantForWall, minuteAt, type BusinessZone, type Target } from "./arrangement-model";
import { compareRailActions, railActionStatus } from "./arrangement-detail-order-status";
import { resolveCategoryRoles, subscribeCategoryAppearance } from "../../../../ui/color-system";
import { commandMenuItemsFromLegacy, showCommandMenuAt } from "../../../../ui/command-menu-popover";
import type { SessionMoveBaseline } from "./arrangement-week";
import { renderArrangementWeekBlocks } from "./arrangement-week-render";
import { isItemTypeHex, itemTypeColorRoles } from "./item-type-palette";

export type DetailSelection = { kind: "action" | "checkpoint" | "session" | "item" | "task"; id: string } | null;
export type DetailData = {
  actions: ActionSnapshot[]; checkpoints?: CheckpointSnapshot[]; sessions: SessionSnapshot[]; items: ItemSnapshot[]; projects: ProjectSnapshot[];
  lists: ListSnapshot[]; itemTypes: ItemTypeSnapshot[]; tags: TagSnapshot[];
  targets: Map<string, Target>; zone: BusinessZone;
};
export type DetailOpts = {
  host: HTMLElement; getData: () => DetailData; getSelection: () => DetailSelection; week: () => boolean;
  taskClassification?: boolean;
  onSelect: (selection: DetailSelection, focusActionId?: string) => void;
  onSaveAction: (id: string, field: "title" | "summary" | "plan" | "link", value: string | { start: string; end: string } | null) => Promise<void>;
  onSaveSession: (id: string, field: "title" | "description" | "plan", value: string | { start: string; end: string }, baseline?: SessionMoveBaseline) => Promise<void>;
  captureSessionBaseline?: (session: SessionSnapshot) => SessionMoveBaseline;
  onSaveItem: (id: string, field: "title" | "description" | "plannedPoint" | "duePoint", value: string | ProductivityPoint | null) => Promise<void>;
  onSaveThingChoice: (kind: "item" | "task", id: string, field: "status" | "listId" | "itemTypeId" | "tagIds", value: string | null | string[]) => Promise<void>;
  canEditIntervals?: (action: ActionSnapshot) => boolean;
  onEditInterval?: (action: ActionSnapshot, operation: "create" | "update" | "delete", intervalId?: string, startedAt?: string, endedAt?: string) => Promise<void>;
  onExecute: (id: string, command: "start" | "pause" | "resume" | "end" | "reopen") => Promise<void>;
  onDelete: (kind: "action" | "session", id: string) => Promise<void>;
  onCreateAction: (kind: "item" | "task", id: string) => Promise<void>;
  onSaveCheckpoint?: (checkpoint: CheckpointSnapshot, field: "title" | "plan" | "nameLinkMode", value: string | { date: string; time: string } | null) => Promise<void>;
  onCompleteCheckpoint?: (checkpoint: CheckpointSnapshot, completed: boolean) => Promise<void>;
  onDeleteCheckpoint?: (checkpoint: CheckpointSnapshot) => Promise<void>;
  onCreateCheckpoint?: (kind: "item" | "task", id: string) => Promise<void>;
  onLifecycle: (kind: "item" | "task", id: string, outcome: "complete" | "cancel") => Promise<void>;
  onError: (message: string) => void;
  onDragAction?: (id: string | null) => void;
  onDragCheckpoint?: (checkpoint: CheckpointSnapshot | null) => void;
};
type Draft = { value: string; failed: boolean; error: string; sessionBaseline?: SessionMoveBaseline };
const localTime = (value: string | null | undefined, zone: BusinessZone) => {
  if (!value) return "";
  const instant = Date.parse(value);
  const minute = minuteAt(instant, zone);
  return `${dateAt(instant, zone)}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};
const executionIcon = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="4" x2="6" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/></svg>',
  end: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>',
};
const linkIcon = {
  linked: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  unlinked: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="m3 3 18 18"/></svg>',
};

export const CLIPBOARD_LIST_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`;
const FOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z"/></svg>`;
export const ARROW_LEFT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;

function formatPointText(date: string, time: string, zone: BusinessZone): string {
  if (!date) return "未安排";
  const today = dateAt(Date.now(), zone);
  const day = date.slice(0, 4) === today.slice(0, 4) ? date.slice(5) : date;
  return time ? `${day} ${time}` : day;
}

export function metaIcon(svg: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "arrangement-meta-icon";
  icon.innerHTML = svg;
  return icon;
}

function isNoteLink(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:"
      || /^zotero:\/\/open\/library\/items\/[A-Za-z0-9]{8}$/.test(url);
  } catch {
    return false;
  }
}

async function openNoteLink(url: string): Promise<void> {
  if (url.startsWith("zotero://") && isTauri()) {
    // The opener plugin intentionally blocks custom schemes; Zotero links use the existing system URI command.
    await invoke("open_external_url", { url });
    return;
  }
  await openUrl(url);
}

function renderNoteInline(text: string): string {
  const links = /\[([^\]\n]+)\]\(([^()\s]+)\)/g;
  let html = "";
  let cursor = 0;
  for (let match = links.exec(text); match; match = links.exec(text)) {
    html += escHtml(text.slice(cursor, match.index));
    const [source, label, url] = match;
    html += isNoteLink(url)
      ? `<a href="${escAttr(url)}" data-note-link="${escAttr(url)}">${escHtml(label)}</a>`
      : escHtml(source);
    cursor = match.index + source.length;
  }
  return `${html}${escHtml(text.slice(cursor))}`;
}

function renderNotePreview(value: string): string {
  const lines = value.split(/\r?\n/);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length;) {
    let ordered = /^(\d+)\.\s+(.+)$/.exec(lines[index]);
    if (ordered) {
      const items: string[] = [];
      const start = Number(ordered[1]);
      do {
        items.push(`<li>${renderNoteInline(ordered![2])}</li>`);
        index += 1;
      } while (index < lines.length && (ordered = /^(\d+)\.\s+(.+)$/.exec(lines[index])) !== null);
      blocks.push(`<ol${Number.isSafeInteger(start) && start > 0 ? ` start="${start}"` : ""}>${items.join("")}</ol>`);
      continue;
    }
    blocks.push(`<div>${renderNoteInline(lines[index]) || "&nbsp;"}</div>`);
    index += 1;
  }
  return blocks.join("");
}

export function mountArrangementDetail(opts: DetailOpts) {
  const { host } = opts;
  const drafts = new Map<string, Draft>();
  const sessionEditBaselines = new Map<string, SessionMoveBaseline>();
  const pickerHandles = new Set<{ dispose: () => void; isOpen?: () => boolean }>();
  const selectHandles = new Set<SelectFieldHandle>();
  let renderedSelectionKey: string | null = null;
  let pendingRenderTimer = 0;
  let disposeUnscheduledSort: (() => void) | null = null;
  let itemTitleField: InlineTextFieldHandle | null = null;
  const actionTitleFields = new Set<InlineTextFieldHandle>();
  let focusId: string | null = null;
  let focusTimer = 0;
  let disposed = false;
  let completionBusy = false;
  let completionAnimation: { control: HTMLButtonElement; selection: DetailSelection } | null = null;
  let completionAnimationTimer = 0;
  const draftVersions = new Map<string, number>();
  const writeQueues = new Map<string, Promise<void>>();
  const executionWrites = new Set<string>();
  let expandedIntervalAction: string | null = null;
  let intervalSelectionKey = "";
  let cancelConfirmation: (() => void) | null = null;
  function confirmAction(title: string, message: string, submitLabel: string, dangerSubmit = false): Promise<boolean> {
    if (cancelConfirmation || disposed) return Promise.resolve(false);
    const dialog = createInsightDialog({ title, bodyHtml: `<p>${escHtml(message)}</p>`, submitLabel, dangerSubmit });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        dialog.panel.removeEventListener("submit", onSubmit);
        dialog.setBusy(true);
        void dialog.close().finally(() => {
          cancelConfirmation = null;
          resolve(confirmed);
        });
      };
      const onSubmit = (event: Event) => { event.preventDefault(); finish(true); };
      cancelConfirmation = () => finish(false);
      dialog.bindChrome(() => finish(false));
      dialog.panel.addEventListener("submit", onSubmit);
      void dialog.open().catch(() => finish(false));
    });
  }
  const key = (kind: string, id: string, field: string) => `${kind}:${id}:${field}`;
  const currentSelectionKey = () => {
    const selection = opts.getSelection();
    return selection ? `${selection.kind}:${selection.id}` : "none";
  };
  const isInteracting = () => Boolean(host.querySelector('input:focus, textarea:focus, [contenteditable="true"]:focus, [aria-expanded="true"]:not([data-interval-toggle])'))
    || [...pickerHandles].some((handle) => handle.isOpen?.());
  function deferRender(): void {
    if (pendingRenderTimer) return;
    pendingRenderTimer = window.setTimeout(() => {
      pendingRenderTimer = 0;
      if (!disposed) render();
    }, 200);
  }
  function playCompletionAnimation(control: HTMLButtonElement): void {
    let liveControl = control;
    if (!liveControl.isConnected) {
      if (control.hasAttribute("data-completion")) {
        liveControl = [...host.querySelectorAll<HTMLButtonElement>("[data-completion]")]
          .find((candidate) => candidate.dataset.kind === control.dataset.kind && candidate.dataset.id === control.dataset.id) ?? control;
      } else if (control.hasAttribute("data-checkpoint-toggle")) {
        liveControl = [...host.querySelectorAll<HTMLButtonElement>("[data-checkpoint-toggle]")]
          .find((candidate) => candidate.dataset.checkpointToggle === control.dataset.checkpointToggle) ?? control;
      } else if (control.hasAttribute("data-action-completion")) {
        const actionId = control.closest<HTMLElement>("[data-action-card]")?.dataset.actionCard;
        liveControl = actionId
          ? host.querySelector<HTMLButtonElement>(`[data-action-card="${CSS.escape(actionId)}"] [data-action-completion]`) ?? control
          : control;
      }
    }
    if (!liveControl.isConnected) return;
    // This helper is reached only after the completion write succeeds. A data
    // refresh may already have painted the canonical checked state, so restore
    // the pre-completion visual state before emitting this one success effect.
    setCheckbox(liveControl, false);
    setCheckboxWithCompletionFeedback(liveControl, true);
    // Burst lives on the sparks. Waiting on ::after would refresh the rail before the draw finishes.
    const spark = liveControl.querySelector<HTMLElement>(".orbita-checkbox__face i");
    const style = getComputedStyle(spark ?? liveControl);
    const seconds = (value: string) => value.split(",").reduce((max, part) => {
      const duration = parseFloat(part) || 0;
      return Math.max(max, part.trim().endsWith("ms") ? duration / 1000 : duration);
    }, 0);
    const duration = style.animationName === "none" ? 0 : (seconds(style.animationDuration) + seconds(style.animationDelay)) * 1000;
    if (duration <= 0) return;
    completionAnimation = { control: liveControl, selection: opts.getSelection() };
    window.clearTimeout(completionAnimationTimer);
    completionAnimationTimer = window.setTimeout(() => {
      completionAnimation = null;
      completionAnimationTimer = 0;
      if (!disposed) render();
    }, duration);
  }
  function mountIntervalControls(): void {
    host.querySelectorAll<HTMLButtonElement>("[data-interval-picker]").forEach((button) => {
      const action = opts.getData().actions.find((entry) => entry.id === button.dataset.actionId);
      if (!action || !opts.onEditInterval) return;
      const writeInterval = opts.onEditInterval;
      const interval = action.intervals.find((entry) => entry.id === button.dataset.intervalPicker && !entry.deletedAtUtc);
      const zone = opts.getData().zone;
      const start = localTime(interval?.startedAt, zone);
      const end = localTime(interval?.endedAt, zone);
      const original: DateTimeRangeValue = { startDate: start.slice(0, 10), startTime: start.slice(11, 16), endDate: end.slice(0, 10), endTime: end.slice(11, 16) };
      const selectionAtOpen = opts.getSelection();
      let pickerOpen = false;
      // Compare actual instants: business-zone offset replacements can cross this interval (ADR 0020).
      const convert = (date: string, time: string) => instantForWall(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)), zone);
      const picker = mountDecoupledDateTimeRangePicker({ anchor: button, value: original,
        get defaultValue() {
          if (interval) return undefined;
          const today = dateAt(Date.now(), zone);
          return { startDate: today, startTime: "", endDate: today, endTime: "" };
        },
        isEndAfterStart: (next) => {
          try { return convert(next.endDate, next.endTime) > convert(next.startDate, next.startTime); }
          catch { return false; }
        },
        validateConfirm: (next) => {
          if (!next.startDate || !next.startTime || !next.endDate || !next.endTime) return false;
          try { return convert(next.endDate, next.endTime) <= Date.now(); }
          catch { return false; }
        },
        onOpenChange: (open) => { pickerOpen = open; button.setAttribute("aria-expanded", String(open)); }, onChange: (next) => {
        if (!next.startDate || !next.startTime || !next.endDate || !next.endTime) { opts.onError("开始和结束时间均为必填"); picker.setValue(original); return; }
        let startMs: number, endMs: number;
        try { startMs = convert(next.startDate, next.startTime); endMs = convert(next.endDate, next.endTime); }
        catch (error) { opts.onError(String(error)); picker.setValue(original); return; }
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs > Date.now()) { opts.onError("结束时间须晚于开始时间且不晚于当前时间"); picker.setValue(original); return; }
        if (disposed || opts.getSelection() !== selectionAtOpen || executionWrites.has(action.id)) return;
        executionWrites.add(action.id);
        void writeInterval(action, interval ? "update" : "create", interval?.id, new Date(startMs).toISOString(), new Date(endMs).toISOString())
          .catch((error) => opts.onError(String(error))).finally(() => { executionWrites.delete(action.id); if (!disposed) render(); });
      } });
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => { if (pickerOpen) void picker.close(); else picker.open(); });
      pickerHandles.add(picker);
    });
  }
  function mountPlanControls(): void {
    host.querySelectorAll<HTMLElement>("[data-checkpoint-plan]").forEach((container) => {
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === container.dataset.checkpointPlan);
      if (!checkpoint) return;
      const target = checkpoint.targetKind && checkpoint.targetId
        ? opts.getData().targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
      const readonly = !target || !target.available || target.archived;
      container.toggleAttribute("inert", !!checkpoint.actualAtUtc || readonly);
      const planDraft = drafts.get(key("checkpoint", checkpoint.id, "plan"));
      const draftPoint = planDraft ? JSON.parse(planDraft.value) as { date: string; time: string } | null : null;
      const at = planDraft ? draftPoint ? `${draftPoint.date}T${draftPoint.time}` : "" : checkpoint.plannedAtUtc ? localTime(checkpoint.plannedAtUtc, opts.getData().zone) : "";
      const picker = mountDecoupledDateTimePicker({ defaultTrigger: { container, className: "arrangement-summary-time" }, value: at ? { date: at.slice(0,10), time: at.slice(11,16) } : undefined,
        onChange: (value) => {
          if (readonly || checkpoint.actualAtUtc) return;
          const next = value.date && value.time ? { date: value.date, time: value.time } : null;
          saveCheckpointPlan(checkpoint, next);
        } });
      pickerHandles.add(picker);
    });
    host.querySelectorAll<HTMLElement>("[data-plan-range]").forEach((container) => {
      const id = container.dataset.planId;
      if (!id) return;
      const action = opts.getData().actions.find((value) => value.id === id);
      if (!action) return;
      const startText = container.dataset.start ?? "";
      const endText = container.dataset.end ?? "";
      const value = (text: string): DateTimeRangeValue => ({ startDate: text.slice(0, 10), startTime: text.slice(11, 16),
        endDate: text.slice(0, 10), endTime: text.slice(11, 16) });
      let picker!: ReturnType<typeof mountDecoupledDateTimeRangePicker>;
      picker = mountDecoupledDateTimeRangePicker({
        wrapAtSeparator: Boolean(container.closest(".arrangement-action-summary")),
        defaultTrigger: { container: container.querySelector<HTMLElement>("[data-range-trigger]")!,
          className: container.closest(".arrangement-action-summary") ? "arrangement-summary-time" : "arrangement-plan-trigger" },
        value: startText && endText ? { ...value(startText), endDate: endText.slice(0, 10), endTime: endText.slice(11, 16) } : undefined,
        validateConfirm: (next) => {
          if (!next.startDate && !next.startTime && !next.endDate && !next.endTime && action.sessionId) {
            opts.onError("请先将安排移出工作时间后清除计划");
            return false;
          }
          return true;
        },
        onChange: (next) => {
          if (!next.startDate && !next.startTime && !next.endDate && !next.endTime) {
            if (action.sessionId) { opts.onError("请先将安排移出工作时间后清除计划"); picker.setValue({ ...value(startText), endDate: endText.slice(0, 10), endTime: endText.slice(11, 16) }); return; }
            void opts.onSaveAction(id, "plan", null).then(render).catch((error) => opts.onError(String(error)));
            return;
          }
          if (!next.startDate || !next.startTime || !next.endDate || !next.endTime) return;
          const start = `${next.startDate}T${next.startTime}`;
          const end = `${next.endDate}T${next.endTime}`;
          if (end <= start) { opts.onError("结束时间须晚于开始时间"); picker.setValue(value(startText)); return; }
          const fieldKey = key("action", id, "plan");
          const version = nextVersion(fieldKey);
          drafts.set(fieldKey, { value: JSON.stringify({ start, end }), failed: false, error: "" });
          void opts.onSaveAction(id, "plan", { start, end }).then(() => {
            if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey);
            render();
          }).catch((error) => {
            if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: JSON.stringify({ start, end }), failed: true, error: String(error) });
            render();
          });
        },
      });
      pickerHandles.add(picker);
      const checkboxHost = container.closest(".arrangement-action-summary")?.querySelector<HTMLElement>("[data-action-completion-host]");
      if (checkboxHost) {
        const checkbox = createCheckbox(action.ended);
        const target = opts.getData().targets.get(`${action.targetKind}:${action.targetId}`);
        checkbox.disabled = !target?.available || target.archived || executionWrites.has(id);
        checkbox.dataset.execute = action.ended ? "reopen" : "end";
        checkbox.dataset.actionCompletion = "";
        checkbox.setAttribute("aria-label", action.ended ? "撤销结束" : "标记结束");
        checkbox.title = action.ended ? "撤销结束" : "标记结束";
        checkboxHost.append(checkbox);
      }
    });
    host.querySelectorAll<HTMLElement>("[data-plan-id], [data-session-plan]").forEach((container) => {
      if (container.hasAttribute("data-plan-range")) return;
      const kind = container.dataset.planId ? "action" : "session";
      const id = container.dataset.planId ?? container.dataset.sessionPlan!;
      container.querySelectorAll<HTMLElement>("[data-plan-point]").forEach((point) => {
        const raw = point.dataset.value ?? "";
        const [date = "", time = ""] = raw.split("T");
        const dateHost = point.querySelector<HTMLElement>("[data-plan-date]")!;
        const timeHost = point.querySelector<HTMLElement>("[data-plan-time]")!;
        const update = (part: "date" | "time", value: string) => {
          const current = point.dataset.value ?? "";
          const [currentDate = "", currentTime = ""] = current.split("T");
          point.dataset.value = part === "date" ? `${value}T${currentTime}` : `${currentDate}T${value}`;
          savePlanFromControls(container, kind, id);
        };
        const datePicker = mountDecoupledDatePicker({ defaultTrigger: { container: dateHost }, value: date, onChange: (value) => update("date", value) });
        const timePicker = mountDecoupledTimePicker({ defaultTrigger: { container: timeHost }, value: time, onChange: (value) => update("time", value) });
        pickerHandles.add(datePicker);
        pickerHandles.add(timePicker);
      });
    });
    host.querySelectorAll<HTMLElement>("[data-session-range]").forEach((container) => {
      const id = container.dataset.sessionRange;
      if (!id) return;
      const session = opts.getData().sessions.find((value) => value.id === id);
      if (!session) return;
      const fieldKey = key("session", id, "plan");
      const draft = drafts.get(fieldKey);
      const planValue = draft ? JSON.parse(draft.value) as { start: string; end: string } : null;
      const start = planValue?.start ?? localTime(session.plannedStartAt, opts.getData().zone);
      const end = planValue?.end ?? localTime(session.plannedEndAt, opts.getData().zone);
      const toRange = (startText: string, endText: string): DateTimeRangeValue => ({
        startDate: startText.slice(0, 10), startTime: startText.slice(11, 16),
        endDate: endText.slice(0, 10), endTime: endText.slice(11, 16),
      });
      let picker!: ReturnType<typeof mountDecoupledDateTimeRangePicker>;
      picker = mountDecoupledDateTimeRangePicker({
        defaultTrigger: { container: container.querySelector<HTMLElement>("[data-range-trigger]")!, className: "arrangement-session-time-trigger" },
        wrapAtSeparator: true,
        value: toRange(start, end),
        validateConfirm: (next) => Boolean(next.startDate && next.startTime && next.endDate && next.endTime),
        onChange: (next) => {
          if (!next.startDate || !next.startTime || !next.endDate || !next.endTime) {
            picker.setValue(toRange(start, end));
            return;
          }
          const value = { start: `${next.startDate}T${next.startTime}`, end: `${next.endDate}T${next.endTime}` };
          if (value.end <= value.start) {
            opts.onError("结束时间须晚于开始时间");
            picker.setValue(toRange(start, end));
            return;
          }
          const version = nextVersion(fieldKey);
          const currentSession = opts.getData().sessions.find((entry) => entry.id === id);
          const sessionBaseline = currentSession ? opts.captureSessionBaseline?.(currentSession) : undefined;
          drafts.set(fieldKey, { value: JSON.stringify(value), failed: false, error: "", sessionBaseline });
          void opts.onSaveSession(id, "plan", value, sessionBaseline).then(() => {
            if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey);
            render();
          }).catch((error) => {
            if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: JSON.stringify(value), failed: true, error: String(error), sessionBaseline });
            render();
          });
        },
      });
      pickerHandles.add(picker);
    });
  }
  function saveCheckpointPlan(checkpoint: CheckpointSnapshot, value: { date: string; time: string } | null): void {
    const fieldKey = key("checkpoint", checkpoint.id, "plan");
    const encoded = JSON.stringify(value);
    drafts.set(fieldKey, { value: encoded, failed: false, error: "" });
    const version = nextVersion(fieldKey);
    void enqueue("checkpoint", checkpoint.id, async () => {
      if (disposed || draftVersions.get(fieldKey) !== version) return;
      try {
        await opts.onSaveCheckpoint?.(checkpoint, "plan", value);
        if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey);
      } catch (error) {
        if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: encoded, failed: true, error: String(error) });
        if (!disposed) opts.onError("保存失败，请重试或放弃修改");
      }
      if (!disposed) render();
    });
  }
  function savePlanFromControls(container: HTMLElement, kind: string, id: string): void {
    const points = [...container.querySelectorAll<HTMLElement>("[data-plan-point]")];
    const start = points[0]?.dataset.value?.replace(/T$/, "") ?? "";
    const end = points[1]?.dataset.value?.replace(/T$/, "") ?? "";
    const fieldKey = key(kind, id, "plan");
    const value = { start, end };
    const currentSession = kind === "session" ? opts.getData().sessions.find((entry) => entry.id === id) : undefined;
    const sessionBaseline = currentSession ? opts.captureSessionBaseline?.(currentSession) : undefined;
    drafts.set(fieldKey, { value: JSON.stringify(value), failed: false, error: "", sessionBaseline });
    const version = nextVersion(fieldKey);
    if (!start || !end) return;
    if (end <= start) {
      drafts.set(fieldKey, { value: JSON.stringify(value), failed: true, error: "结束时间须晚于开始时间" });
      render();
      return;
    }
    const operation = kind === "action" ? opts.onSaveAction(id, "plan", value) : opts.onSaveSession(id, "plan", value, sessionBaseline);
    void operation.then(() => { if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey); render(); })
      .catch((error) => { if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: JSON.stringify(value), failed: true, error: String(error), sessionBaseline }); render(); });
  }
  const nextVersion = (fieldKey: string) => {
    const version = (draftVersions.get(fieldKey) ?? 0) + 1;
    draftVersions.set(fieldKey, version);
    return version;
  };
  function enqueue(kind: string, id: string, run: () => Promise<void>): Promise<void> {
    const projectId = kind === "task" ? opts.getData().projects.find((project) => project.tasks.some((task) => task.id === id))?.id : null;
    const objectKey = projectId ? `project:${projectId}` : `${kind}:${id}`;
    const pending = writeQueues.get(objectKey) ?? Promise.resolve();
    const next = pending.then(run, run);
    writeQueues.set(objectKey, next);
    void next.then(() => { if (writeQueues.get(objectKey) === next) writeQueues.delete(objectKey); },
      () => { if (writeQueues.get(objectKey) === next) writeQueues.delete(objectKey); });
    return next;
  }
  const draftValue = (kind: string, id: string, field: string, fallback: string) => drafts.get(key(kind, id, field))?.value ?? fallback;
  function field(kind: string, id: string, name: string, label: string, fallback: string, multiline = false, readonly = false, rows = 2): string {
    const state = drafts.get(key(kind, id, name));
    const value = draftValue(kind, id, name, fallback);
    return `<label class="arrangement-field${state?.failed ? " is-failed" : ""}"><span>${label}</span>${multiline
      ? `<textarea rows="${rows}" data-kind="${kind}" data-id="${escAttr(id)}" data-field="${name}"${readonly ? " disabled" : ""}>${escHtml(value)}</textarea>`
      : `<input data-kind="${kind}" data-id="${escAttr(id)}" data-field="${name}" value="${escAttr(value)}"${readonly ? " disabled" : ""}>`}
      ${state?.failed ? `<small>${escHtml(state.error)}</small><span class="arrangement-draft-actions"><button type="button" data-retry="${escAttr(key(kind, id, name))}">重试</button><button type="button" data-discard="${escAttr(key(kind, id, name))}">放弃修改</button></span>` : ""}</label>`;
  }
  function noteField(kind: "item" | "task" | "session", id: string, fallback: string, readonly: boolean): string {
    const state = drafts.get(key(kind, id, "description"));
    const value = draftValue(kind, id, "description", fallback);
    return `<div class="arrangement-field${state?.failed ? " is-failed" : ""}"><span>备注：</span><div class="arrangement-note-preview" data-edit-note="${kind}:${escAttr(id)}" data-note-value="${escAttr(value)}"${readonly ? "" : ' data-note-editable tabindex="0" role="group" aria-label="备注，按 Enter 编辑"'}>${renderNotePreview(value)}</div>
      ${state?.failed ? `<small>${escHtml(state.error)}</small><span class="arrangement-draft-actions"><button type="button" data-retry="${escAttr(key(kind, id, "description"))}">重试</button><button type="button" data-discard="${escAttr(key(kind, id, "description"))}">放弃修改</button></span>` : ""}</div>`;
  }
  function autosizeNote(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    const styles = getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const maxHeight = lineHeight * 8 + (textarea.offsetHeight - textarea.clientHeight);
    const nextHeight = Math.max(lineHeight + 2, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }
  function startEditingNote(preview: HTMLElement): void {
    const [kind, id] = (preview.dataset.editNote ?? "").split(":");
    if ((kind !== "item" && kind !== "task" && kind !== "session") || !id || !preview.hasAttribute("data-note-editable")) return;
    if (kind === "session") {
      const session = opts.getData().sessions.find((entry) => entry.id === id);
      if (session) try { const baseline = opts.captureSessionBaseline?.(session); if (baseline) sessionEditBaselines.set(id, baseline); }
      catch (error) { opts.onError(String(error)); return; }
    }
    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    textarea.className = "arrangement-note-editor";
    textarea.dataset.kind = kind;
    textarea.dataset.id = id;
    textarea.dataset.field = "description";
    textarea.value = preview.dataset.noteValue ?? "";
    preview.replaceWith(textarea);
    autosizeNote(textarea);
    textarea.focus();
  }
  function actionSummary(action: ActionSnapshot): string {
    const { targets, zone } = opts.getData();
    const target = targets.get(`${action.targetKind}:${action.targetId}`);
    const readonly = !target?.available || !!target.archived;
    const linked = action.nameLinkMode === "initial-linked" || action.nameLinkMode === "manually-linked";
    const start = action.plannedStartAt ? localTime(action.plannedStartAt, zone) : "";
    const end = action.plannedEndAt ? localTime(action.plannedEndAt, zone) : "";
    const active = action.executionState === "进行中";
    const paused = action.executionState === "暂停";
    const executionLocked = readonly || action.ended || executionWrites.has(action.id);
    const intervals = action.intervals.filter((entry) => !entry.deletedAtUtc);
    const intervalLocked = readonly || intervals.some((entry) => !entry.endedAt) || executionWrites.has(action.id);
    const intervalSupported = opts.week() && !!opts.onEditInterval && !!opts.canEditIntervals?.(action);
    const expanded = expandedIntervalAction === action.id;
    const intervalRows = intervals.map((entry) => {
      const start = localTime(entry.startedAt, zone);
      const end = localTime(entry.endedAt, zone);
      const label = formatDateTimeRangeLabel({
        startDate: start.slice(0, 10), startTime: start.slice(11, 16),
        endDate: end ? end.slice(0, 10) : start.slice(0, 10), endTime: end ? end.slice(11, 16) : "进行中",
      }, dateAt(Date.now(), zone));
      return `<div class="arrangement-interval-row"><button type="button" class="arrangement-interval-time" data-interval-picker="${escAttr(entry.id)}" data-action-id="${escAttr(action.id)}" aria-haspopup="dialog" aria-label="编辑计时段 ${escAttr(label)}"${intervalLocked ? " disabled" : ""}>${escHtml(label)}</button><button type="button" class="arrangement-interval-delete" data-interval-delete="${escAttr(entry.id)}" aria-label="删除计时段 ${escAttr(label)}"${intervalLocked ? " disabled" : ""}>${executionIcon.trash}</button></div>`;
    }).join("");
    const titleDraft = drafts.get(key("action", action.id, "title"));
    const titleFailed = titleDraft?.failed
      ? `<small>${escHtml(titleDraft.error)}</small><span class="arrangement-draft-actions"><button type="button" data-retry="${escAttr(key("action", action.id, "title"))}">重试</button><button type="button" data-discard="${escAttr(key("action", action.id, "title"))}">放弃修改</button></span>` : "";
    const playCommand = active ? "pause" : paused ? "resume" : "start";
    const playLabel = active ? "暂停" : paused ? "继续" : "开始";
    return `<article class="arrangement-action-summary${linked ? " is-name-linked" : ""}${focusId === action.id ? " is-located" : ""}" data-action-card="${escAttr(action.id)}" data-rail-status="${railActionStatus(action, Date.now())}">
      <div class="arrangement-summary-time-row"><div data-plan-range data-plan-id="${escAttr(action.id)}" data-start="${escAttr(start)}" data-end="${escAttr(end)}"${readonly || intervals.length > 0 ? " inert" : ""}><div data-range-trigger></div></div><span data-action-completion-host></span></div>
      <div class="arrangement-action-line arrangement-action-title-line"><span class="arrangement-action-title-host" data-action-title-host="${escAttr(action.id)}"></span><button type="button" class="arrangement-link-toggle${linked ? " is-linked" : ""}" data-link="${escAttr(action.id)}" aria-label="${linked ? "名称已关联" : "名称未关联"}" title="${linked ? "名称已关联" : "名称未关联"}" aria-pressed="${linked}"${readonly ? " disabled" : ""}>${linked ? linkIcon.linked : linkIcon.unlinked}</button></div>${titleFailed}
      <div class="arrangement-action-line arrangement-action-controls">
        <button type="button" class="arrangement-icon-btn" data-execute="${playCommand}" aria-label="${playLabel}" title="${playLabel}"${executionLocked || (!active && drafts.has(key("action", action.id, "plan"))) ? " disabled" : ""}>${active ? executionIcon.pause : executionIcon.play}</button>
        <button type="button" class="arrangement-icon-btn" data-execute="end" aria-label="结束" title="结束"${executionLocked || (!active && !paused) ? " disabled" : ""}>${executionIcon.end}</button>
        <button type="button" class="arrangement-icon-btn" data-execute="reopen" aria-label="撤销结束" title="撤销结束"${readonly || !action.ended || executionWrites.has(action.id) ? " disabled" : ""}>${executionIcon.undo}</button>
        <button type="button" class="arrangement-icon-btn" data-delete="action" aria-label="删除安排" title="删除安排"${readonly || active || paused || executionWrites.has(action.id) ? " disabled" : ""}>${executionIcon.trash}</button>
        ${intervalSupported ? `<button type="button" class="arrangement-icon-btn arrangement-interval-toggle${expanded ? " is-expanded" : ""}" data-interval-toggle aria-label="${expanded ? "收起" : "展开"}计时段" aria-expanded="${expanded}">▾</button>` : ""}
      </div>
      ${intervalSupported && expanded ? `<div class="arrangement-interval-list"><div class="arrangement-interval-heading">计时段 <span>${intervals.length}</span></div>${intervalRows || '<div class="arrangement-interval-empty">暂无计时段</div>'}<button type="button" class="arrangement-interval-add" data-interval-picker="" data-action-id="${escAttr(action.id)}" aria-haspopup="dialog"${intervalLocked ? " disabled" : ""}><span aria-hidden="true">＋</span> 补录计时段</button></div>` : ""}
    </article>`;
  }
  function mountActionTitleFields(): void {
    host.querySelectorAll<HTMLElement>("[data-action-title-host]").forEach((titleHost) => {
      const action = opts.getData().actions.find((entry) => entry.id === titleHost.dataset.actionTitleHost);
      if (!action) return;
      const actionTarget = opts.getData().targets.get(`${action.targetKind}:${action.targetId}`);
      actionTitleFields.add(mountInlineTextField({
        container: titleHost,
        value: drafts.get(key("action", action.id, "title"))?.value ?? action.title,
        placeholder: "添加名称",
        inputPlaceholder: "添加名称",
        maxLength: 12,
        contentSized: true,
        readOnly: !actionTarget || !actionTarget.available || actionTarget.archived,
        onCommit: (value) => save("action", action.id, "title", value),
      }));
    });
  }
  function checkpointSummary(checkpoint: CheckpointSnapshot): string {
    const { targets } = opts.getData();
    const target = checkpoint.targetKind && checkpoint.targetId ? targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
    const readonly = !target || !target.available || target.archived;
    const linked = checkpoint.nameLinkMode !== "unlinked";
    const titleDraft = drafts.get(key("checkpoint", checkpoint.id, "title"));
    const planDraft = drafts.get(key("checkpoint", checkpoint.id, "plan"));
    const title = titleDraft?.value ?? checkpoint.title;
    const draftActions = (fieldKey: string, state: Draft | undefined) => state?.failed
      ? `<small>${escHtml(state.error)}</small><span class="arrangement-draft-actions"><button type="button" data-retry="${escAttr(fieldKey)}">重试</button><button type="button" data-discard="${escAttr(fieldKey)}">放弃修改</button></span>` : "";
    return `<article class="arrangement-action-summary arrangement-checkpoint-summary${linked ? " is-name-linked" : ""}" data-checkpoint-card="${escAttr(checkpoint.id)}" data-rail-status="${checkpoint.completed ? "ended" : checkpoint.plannedAtUtc && Date.parse(checkpoint.plannedAtUtc) < Date.now() ? "overdue" : "planned"}">
      <div class="arrangement-summary-time-row"><div data-checkpoint-plan="${escAttr(checkpoint.id)}"></div><span data-checkpoint-completion-host></span></div>${draftActions(key("checkpoint", checkpoint.id, "plan"), planDraft)}
      <div class="arrangement-action-line arrangement-action-title-line"><button type="button" class="arrangement-action-title" data-edit-checkpoint-title="${escAttr(checkpoint.id)}"${readonly ? " disabled" : ""}>${escHtml(title)}</button><button type="button" class="arrangement-link-toggle${linked ? " is-linked" : ""}" data-checkpoint-link="${escAttr(checkpoint.id)}" aria-label="${linked ? "名称已关联" : "名称未关联"}" aria-pressed="${linked}"${readonly ? " disabled" : ""}>${linked ? linkIcon.linked : linkIcon.unlinked}</button></div>${draftActions(key("checkpoint", checkpoint.id, "title"), titleDraft)}
    </article>`;
  }
  function render() {
    if (disposed) return;
    // Background snapshots must not destroy the current editor or an owned portal.
    // A changed selection renders immediately; a deferred refresh reads the latest snapshot.
    const selectionKey = currentSelectionKey();
    if (selectionKey === renderedSelectionKey && isInteracting()) { deferRender(); return; }
    window.clearTimeout(pendingRenderTimer);
    pendingRenderTimer = 0;
    renderedSelectionKey = selectionKey;
    // Keep the shared checkbox mounted until its own animation finishes; reloads can arrive sooner.
    if (completionAnimation?.control.isConnected && opts.getSelection() === completionAnimation.selection) return;
    pickerHandles.forEach((handle) => handle.dispose());
    pickerHandles.clear();
    selectHandles.forEach((handle) => handle.dispose());
    selectHandles.clear();
    disposeUnscheduledSort?.();
    disposeUnscheduledSort = null;
    actionTitleFields.forEach((handle) => handle.dispose());
    actionTitleFields.clear();
    itemTitleField?.dispose();
    itemTitleField = null;
    const { actions, sessions, items, projects, lists, itemTypes, tags, targets, zone } = opts.getData();
    const selection = opts.getSelection();
    const nextIntervalSelectionKey = opts.week() && selection ? `${selection.kind}:${selection.id}` : "";
    if (nextIntervalSelectionKey !== intervalSelectionKey) { expandedIntervalAction = null; intervalSelectionKey = nextIntervalSelectionKey; }
    if (!selection) {
      if (!opts.week()) { host.innerHTML = `<div class="arrangement-detail-empty">选择任务以查看或编辑</div>`; return; }
      host.innerHTML = `<div class="arrangement-unscheduled"><div class="arrangement-unscheduled-head"><div class="arrangement-detail-title"><span class="arrangement-thing-title">待安排</span></div><button type="button" class="arrangement-unscheduled-sort" data-unscheduled-sort aria-label="待安排排序" aria-haspopup="listbox" aria-expanded="false" title="待安排排序"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 15 3-7 3 7M3 13h4M10 8h5l-5 7h5M20 8v8m0 0-2-2m2 2 2-2"/></svg></button></div><div data-unscheduled-list></div></div>`;
      const sortTrigger = host.querySelector<HTMLButtonElement>("[data-unscheduled-sort]");
      if (sortTrigger) {
        const sortPopover = mountFlatSelectPopover({ anchor: sortTrigger, options: [
        { value: "created", label: "创建顺序" }, { value: "group", label: "按事情分组" }, { value: "alpha", label: "首字母" },
      ], search: false, multiple: false, selected: new Set([unscheduledSort]), onOpenChange: (open) => sortTrigger.setAttribute("aria-expanded", String(open)), onChange: (values) => {
        const value = [...values][0];
        if (!value) return;
        unscheduledSort = value as typeof unscheduledSort;
        renderUnscheduled();
      } });
        const toggleSort = () => { if (sortPopover.isOpen()) void sortPopover.close(); else void sortPopover.open(); };
        sortTrigger.addEventListener("click", toggleSort);
        disposeUnscheduledSort = () => { sortTrigger.removeEventListener("click", toggleSort); sortPopover.dispose(); };
      }
      renderUnscheduled(); return;
    }
    if (selection.kind === "checkpoint") {
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === selection.id && !value.deletedAtUtc);
      if (!checkpoint) { host.innerHTML = `<div class="arrangement-detail-empty">检查点已不可用</div>`; return; }
      host.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><span class="arrangement-thing-title">检查点</span></div></div>${checkpointSummary(checkpoint)}`;
      const card = host.querySelector<HTMLElement>("[data-checkpoint-card]")!;
      const checkbox = createCheckbox(checkpoint.completed);
      checkbox.dataset.checkpointToggle = checkpoint.id;
      const target = checkpoint.targetKind && checkpoint.targetId ? opts.getData().targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
      checkbox.disabled = !target || !target.available || target.archived;
      checkbox.setAttribute("aria-label", checkpoint.completed ? "撤销检查点完成" : "完成检查点");
      card.querySelector("[data-checkpoint-completion-host]")?.append(checkbox);
      mountIntervalControls();
      mountPlanControls();
      return;
    }
    if (selection.kind === "session") {
      const session = sessions.find((value) => value.id === selection.id);
      if (!session) { host.innerHTML = `<div class="arrangement-detail-empty">安排已不可用</div>`; return; }
      const members = actions.filter((action) => action.sessionId === session.id && !action.deletedAtUtc).sort(compareRailActions);
      const checkpointMembers = (opts.getData().checkpoints ?? []).filter((checkpoint) => checkpoint.sessionId === session.id && !checkpoint.deletedAtUtc)
        .sort((a,b) => Number(a.completed)-Number(b.completed) || (a.plannedAtUtc ? Date.parse(a.plannedAtUtc) : Infinity) - (b.plannedAtUtc ? Date.parse(b.plannedAtUtc) : Infinity) || a.createdAtUtc.localeCompare(b.createdAtUtc) || a.id.localeCompare(b.id));
      const planKey = key("session", session.id, "plan");
      const planDraft = drafts.get(planKey);
      host.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title"><button type="button" class="arrangement-thing-title" data-edit-title="session:${escAttr(session.id)}">${escHtml(session.title)}</button></div><button type="button" class="arrangement-icon-btn arrangement-session-delete" data-delete="session" data-session-id="${escAttr(session.id)}" aria-label="删除工作时间" title="删除工作时间">${executionIcon.trash}</button></div>
        <div class="arrangement-session-plan${planDraft?.failed ? " is-failed" : ""}"><span>时间：</span><div data-session-range="${escAttr(session.id)}"><div data-range-trigger></div></div>${planDraft?.failed ? `<small>${escHtml(planDraft.error)}</small><span class="arrangement-draft-actions"><button type="button" data-retry="${escAttr(planKey)}">重试</button><button type="button" data-discard="${escAttr(planKey)}">放弃修改</button></span>` : ""}</div>
        <div class="arrangement-notes">${noteField("session", session.id, session.description ?? "", false)}</div>
        ${[...members.map((action) => ({ at: action.plannedStartAt ? Date.parse(action.plannedStartAt) : Infinity, order: action.createdAtUtc, id: action.id, kind: "action", html: actionSummary(action), done: action.ended })), ...checkpointMembers.map((checkpoint) => ({ at: checkpoint.plannedAtUtc ? Date.parse(checkpoint.plannedAtUtc) : Infinity, order: checkpoint.createdAtUtc, id: checkpoint.id, kind: "checkpoint", html: checkpointSummary(checkpoint), done: checkpoint.completed }))].sort((a,b)=>Number(a.done)-Number(b.done)||a.at-b.at||a.order.localeCompare(b.order)||a.id.localeCompare(b.id)||a.kind.localeCompare(b.kind)).map((entry)=>entry.html).join("") || `<p>暂无成员</p>`}`;
      mountActionTitleFields();
      mountIntervalControls();
      mountPlanControls();
      host.querySelectorAll<HTMLElement>("[data-checkpoint-card]").forEach((card) => {
        const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === card.dataset.checkpointCard);
        if (!checkpoint) return;
        const checkbox = createCheckbox(checkpoint.completed);
        checkbox.dataset.checkpointToggle = checkpoint.id;
        const target = checkpoint.targetKind && checkpoint.targetId ? opts.getData().targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`) : undefined;
        checkbox.disabled = !!target && (!target.available || target.archived);
        checkbox.setAttribute("aria-label", checkpoint.completed ? "撤销检查点完成" : "完成检查点");
        card.querySelector("[data-checkpoint-completion-host]")?.append(checkbox);
      });
      return;
    }
    let kind: "item" | "task";
    let id: string;
    if (selection.kind === "action") {
      const selected = actions.find((action) => action.id === selection.id);
      if (!selected || (selected.targetKind !== "item" && selected.targetKind !== "task") || !selected.targetId) {
        host.innerHTML = `<div class="arrangement-detail-empty">关联事情已不可用</div>`; return;
      }
      kind = selected.targetKind; id = selected.targetId;
    } else { kind = selection.kind; id = selection.id; }
    const target = targets.get(`${kind}:${id}`);
    if (!target) { host.innerHTML = `<div class="arrangement-detail-empty">事情已不可用</div>`; return; }
    const item = kind === "item" ? items.find((value) => value.id === id) : null;
    const task = kind === "task" ? projects.flatMap((project) => project.tasks).find((value) => value.id === id) : null;
    const related = actions.filter((action) => !action.deletedAtUtc && action.targetKind === kind && action.targetId === id).sort(compareRailActions);
    const relatedCheckpoints = (opts.getData().checkpoints ?? []).filter((checkpoint) => !checkpoint.deletedAtUtc && checkpoint.targetKind === kind && checkpoint.targetId === id)
      .sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.plannedAtUtc?Date.parse(a.plannedAtUtc):Infinity)-(b.plannedAtUtc?Date.parse(b.plannedAtUtc):Infinity)||a.createdAtUtc.localeCompare(b.createdAtUtc)||a.id.localeCompare(b.id));
    const tagKey = key("item", id, "tagIds");
    const tagDraft = drafts.get(tagKey);
    const selectedTags = tagDraft ? JSON.parse(tagDraft.value) as string[] : item?.tagIds ?? [];
    const tagOptions = tags.filter((tag) => !tag.deletedAtUtc && (!tag.inactive || selectedTags.includes(tag.id))).map((tag) => ({ value: tag.id, label: tag.name }));
    const listKey = key(kind, id, "listId");
    const typeKey = key(kind, id, "itemTypeId");
    const listFailed = drafts.get(listKey);
    const typeFailed = drafts.get(typeKey);
    const choiceError = (fieldKey: string, draft: { failed: boolean; error: string } | undefined) => draft?.failed
      ? `<small>${escHtml(draft.error)}</small><span class="arrangement-draft-actions"><button type="button" data-retry="${escAttr(fieldKey)}">重试</button><button type="button" data-discard="${escAttr(fieldKey)}">放弃修改</button></span>`
      : "";
    const showTaskClassification = !!task && !!opts.taskClassification && opts.week();
    const selectors = item || showTaskClassification ? `<div class="arrangement-meta-row">
      <div class="arrangement-meta-slot${listFailed?.failed ? " is-failed" : ""}"><div data-choice-host="${item ? "listId" : "projectId"}"></div>${item ? choiceError(listKey, listFailed) : ""}</div>
      <div class="arrangement-meta-slot is-type${typeFailed?.failed ? " is-failed" : ""}"><div data-choice-host="itemTypeId"></div>${choiceError(typeKey, typeFailed)}</div>
    </div>` : "";
    const tagSelector = item ? `<div class="arrangement-point-list"><div class="arrangement-point-line"><span>标签：</span></div></div>` : "";
    const currentStatus = item?.status ?? task?.status ?? "进行中";
    const itemType = item?.itemTypeId ? itemTypes.find((value) => value.id === item.itemTypeId) : undefined;
    const completion = `<div class="arrangement-completion" data-completion-host></div>`;
    const titleKey = key(kind, id, "title");
    const titleDraft = drafts.get(titleKey);
    const displayTitle = titleDraft?.value ?? item?.title ?? task?.title ?? target.title;
    const titleHead = kind === "item"
      ? `<div data-item-title-host></div>`
      : `<button type="button" class="arrangement-thing-title" data-edit-title="${kind}:${escAttr(id)}">${escHtml(displayTitle)}</button>`;
    const points = `<div class="arrangement-point-list">${(["plannedPoint", "duePoint"] as const).map((fieldName) => {
      const point = (item?.[fieldName] ?? task?.[fieldName]) as ProductivityPoint | null | undefined;
      const date = !point ? "" : point.precision === "date" ? point.date : dateAt(Date.parse(point.atUtc), zone);
      const time = point?.precision === "instant" ? localTime(point.atUtc, zone).slice(11) : "";
      const label = fieldName === "plannedPoint" ? "计划时间：" : "截止时间：";
      const dueClass = fieldName === "duePoint" && date ? " is-due" : "";
      return `<div class="arrangement-point-line"><span class="arrangement-point-label${dueClass}">${label}</span><span class="arrangement-point-hit"><button type="button" class="arrangement-point-value${dueClass}" data-point="${fieldName}" data-kind="${kind}" data-id="${escAttr(id)}" data-date="${escAttr(date)}" data-time="${escAttr(time)}">${escHtml(formatPointText(date, time, zone))}</button>${date && !target.archived ? `<button type="button" class="arrangement-point-clear" data-point-clear aria-label="清空${fieldName === "plannedPoint" ? "计划时间" : "截止时间"}">清空</button>` : ""}</span></div>`;
    }).join("")}</div>`;
    host.innerHTML = `<div class="arrangement-detail-head"><div class="arrangement-detail-title">${titleHead}</div>${completion}</div>
      ${selectors}
      ${points}
      ${tagSelector}
      <div class="arrangement-notes">${noteField(kind, id, item?.description ?? task?.description ?? "", target.archived)}</div>
      <div class="arrangement-point-list"><div class="arrangement-point-line arrangement-summary-heading"><span>安排</span><button type="button" class="arrangement-add-action" data-add-menu="${kind}:${escAttr(id)}" aria-label="新增安排" title="新增安排"${target.available && !target.archived ? "" : " disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div></div>
      ${[...related.map((action) => ({ at: action.plannedStartAt ? Date.parse(action.plannedStartAt) : Infinity, order: action.createdAtUtc, id: action.id, kind: "action", html: actionSummary(action), done: action.ended })), ...relatedCheckpoints.map((checkpoint) => ({ at: checkpoint.plannedAtUtc ? Date.parse(checkpoint.plannedAtUtc) : Infinity, order: checkpoint.createdAtUtc, id: checkpoint.id, kind: "checkpoint", html: checkpointSummary(checkpoint), done: checkpoint.completed }))].sort((a,b)=>Number(a.done)-Number(b.done)||a.at-b.at||a.order.localeCompare(b.order)||a.id.localeCompare(b.id)||a.kind.localeCompare(b.kind)).map((entry)=>entry.html).join("")}`;
    const completionControl = createCheckbox();
    setCheckbox(completionControl, currentStatus === "完成");
    completionControl.dataset.completion = "";
    completionControl.dataset.kind = kind;
    completionControl.dataset.id = id;
    completionControl.disabled = target.archived || (!target.available && currentStatus !== "完成");
    const completionLabel = currentStatus === "完成" ? "取消完成" : "标记完成";
    completionControl.setAttribute("aria-label", completionLabel);
    completionControl.title = completionLabel;
    host.querySelector("[data-completion-host]")!.append(completionControl);
    if (focusId) {
      const card = host.querySelector<HTMLElement>(`[data-action-card="${CSS.escape(focusId)}"], [data-checkpoint-card="${CSS.escape(focusId)}"]`);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    mountThingSelectors(kind, id, item ?? null, showTaskClassification ? task ?? null : null, tagOptions, target.archived);
    if (kind === "item") {
      const titleHost = host.querySelector<HTMLElement>("[data-item-title-host]");
      if (titleHost) {
        itemTitleField = mountInlineTextField({
          container: titleHost,
          value: displayTitle,
          placeholder: "未命名",
          readOnly: target.archived,
          onCommit: (value) => save("item", id, "title", value),
        });
      }
    }
    mountActionTitleFields();
    mountIntervalControls();
    mountItemPoints(kind, id, target.archived);
    mountPlanControls();
    host.querySelectorAll<HTMLElement>("[data-checkpoint-card]").forEach((card) => {
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === card.dataset.checkpointCard);
      if (!checkpoint) return;
      const control = createCheckbox(checkpoint.completed);
      control.dataset.checkpointToggle = checkpoint.id;
      control.disabled = target.archived || !target.available;
      control.setAttribute("aria-label", checkpoint.completed ? "撤销检查点完成" : "完成检查点");
      card.querySelector("[data-checkpoint-completion-host]")?.append(control);
    });
  }
  const pointTimeOpeners = new Map<string, (date: string) => void>();
  function mountItemPoints(kind: "item" | "task", id: string, readonly: boolean) {
    host.querySelectorAll<HTMLButtonElement>("[data-point]").forEach((button) => {
      const fieldName = button.dataset.point as "plannedPoint" | "duePoint";
      const zone = opts.getData().zone;
      let pendingDate = "";
      const pointKey = key(kind, id, fieldName);
      const commit = (point: ProductivityPoint | null, rerender: boolean) => {
        const fieldKey = key(kind, id, fieldName);
        const encoded = JSON.stringify(point);
        const version = nextVersion(fieldKey);
        drafts.set(fieldKey, { value: encoded, failed: false, error: "" });
        let saved = false;
        return enqueue(kind, id, async () => {
          if (disposed || draftVersions.get(fieldKey) !== version) return;
          try {
            await opts.onSaveItem(id, fieldName, point);
            saved = true;
            if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey);
          } catch (error) {
            if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: encoded, failed: true, error: String(error) });
            if (!disposed) opts.onError(String(error));
          }
          if (rerender) render();
        }).then(() => saved);
      };
      const datePicker = mountDecoupledDatePicker({
        anchor: button,
        value: button.dataset.date || undefined,
        onOpenChange: (open) => button.setAttribute("aria-expanded", String(open)),
        onChange: (date) => {
          if (!date) return;
          const selectionAtPick = opts.getSelection();
          button.textContent = formatPointText(date, "", zone);
          button.classList.toggle("is-due", fieldName === "duePoint");
          button.closest(".arrangement-point-line")?.querySelector(".arrangement-point-label")?.classList.toggle("is-due", fieldName === "duePoint");
          // Saving reloads the rail and disposes these pickers; continue on the new owner.
          void datePicker.close().then(() => commit({ precision: "date", date }, false)).then((saved) => {
            if (!saved || disposed || opts.getSelection() !== selectionAtPick) return;
            pointTimeOpeners.get(pointKey)?.(date);
          });
        },
      });
      const timePicker = mountDecoupledTimePicker({
        anchor: button,
        value: button.dataset.time || "00:00",
        onOpenChange: (open) => button.setAttribute("aria-expanded", String(open)),
      });
      const openTime = (date: string) => {
        if (disposed || !button.isConnected || readonly) return;
        pendingDate = date;
        timePicker.open();
      };
      pointTimeOpeners.set(pointKey, openTime);
      button.parentElement?.querySelector<HTMLButtonElement>("[data-point-clear]")?.addEventListener("click", () => {
        if (readonly) return;
        pendingDate = "";
        void datePicker.close();
        void timePicker.close();
        void commit(null, true);
      });
      const finishTime = () => {
        if (!pendingDate) return;
        const date = pendingDate;
        const time = timePicker.getValue();
        pendingDate = "";
        if (!time) return;
        button.textContent = formatPointText(date, time, zone);
        button.classList.toggle("is-due", fieldName === "duePoint");
        commit({
          precision: "instant",
          atUtc: new Date(instantForWall(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)), zone)).toISOString(),
        }, true);
      };
      const onTimeConfirm = (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest(".orbita-time-wheel-confirm")) return;
        finishTime();
      };
      const onTimeEnter = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || !pendingDate) return;
        const target = event.target as HTMLElement | null;
        if (!target?.closest(".orbita-time-wheel-scroll")) return;
        finishTime();
      };
      document.addEventListener("click", onTimeConfirm);
      document.addEventListener("keydown", onTimeEnter);
      pickerHandles.add({
        dispose: () => {
          if (pointTimeOpeners.get(pointKey) === openTime) pointTimeOpeners.delete(pointKey);
          document.removeEventListener("click", onTimeConfirm);
          document.removeEventListener("keydown", onTimeEnter);
          datePicker.dispose();
          timePicker.dispose();
        },
      });
      button.addEventListener("click", () => {
        if (readonly) return;
        datePicker.setValue("");
        datePicker.open();
      });
      if (readonly) button.disabled = true;
    });
  }
  function mountThingSelectors(kind: "item" | "task", id: string, item: ItemSnapshot | null, task: TaskSnapshot | null, tagOptions: { value: string; label: string }[], archived: boolean) {
    if (!item && !task) return;
    const listHost = host.querySelector<HTMLElement>('[data-choice-host="listId"]');
    const projectHost = host.querySelector<HTMLElement>('[data-choice-host="projectId"]');
    const typeHost = host.querySelector<HTMLElement>('[data-choice-host="itemTypeId"]');
    const tagHost = host.querySelector<HTMLElement>('[data-choice-host="tagIds"]');
    const fieldOptions = (options: { value: string; label: string; disabled?: boolean }[]) => options;
    const currentListDraft = drafts.get(key(kind, id, "listId"));
    const currentTypeDraft = drafts.get(key(kind, id, "itemTypeId"));
    const currentTagDraft = drafts.get(key(kind, id, "tagIds"));
    if (projectHost && task) {
      const project = opts.getData().projects.find((value) => value.id === task.projectId);
      const projectField = mountSelectField(projectHost, { label: "项目", options: [{ value: task.projectId, label: project?.title ?? "项目不可用" }], search: false, multiple: false, value: task.projectId, disabled: true, onChange: () => {} });
      projectField.button.prepend(metaIcon(FOLDER_SVG));
      selectHandles.add(projectField);
    }
    if (listHost && item) {
      const listValue = (currentListDraft ? JSON.parse(currentListDraft.value) as string | null : item.listId) ?? "__inbox";
      const listField = mountSelectField(listHost, { label: "清单", placeholder: "Inbox", options: fieldOptions([
        { value: "__inbox", label: "Inbox" }, ...opts.getData().lists.filter((list) => !list.deletedAtUtc).map((list) => ({ value: list.id, label: list.title, disabled: list.status === "已归档" })),
      ]), search: true, multiple: false, value: listValue, disabled: archived,
        onChange: (value) => queueChoice(kind, id, "listId", value === "__inbox" ? null : value) });
      listField.button.prepend(metaIcon(CLIPBOARD_LIST_SVG));
      selectHandles.add(listField);
    }
    if (typeHost) {
      const typeValue = (currentTypeDraft ? JSON.parse(currentTypeDraft.value) as string | null : (item ?? task)?.itemTypeId) ?? "__none";
      const allTypes = opts.getData().itemTypes;
      const swatch = document.createElement("span");
      swatch.className = "arrangement-meta-swatch";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "arrangement-type-trigger";
      trigger.setAttribute("aria-label", "分类");
      trigger.disabled = archived;
      const label = document.createElement("span");
      label.className = "arrangement-type-label";
      const paintType = (value: string | null) => {
        const type = value && value !== "__none" ? allTypes.find((itemType) => itemType.id === value) : undefined;
        swatch.dataset.sourceColor = type?.effectiveColor ?? "";
        swatch.style.background = type?.effectiveColor ? resolveCategoryRoles(type.effectiveColor).main : "";
        swatch.classList.toggle("is-empty", !type?.effectiveColor);
        label.textContent = type?.name ?? (value && value !== "__none" ? "分类不可用" : "无分类");
      };
      paintType(typeValue);
      trigger.append(swatch, label);
      typeHost.append(trigger);
      const eligible = allTypes.filter((type) => !["sleep", "activity", "meal"].includes(type.systemRole ?? ""));
      const visibleIds = new Set(eligible.map((type) => type.id));
      const children = new Map<string | null, ItemTypeSnapshot[]>();
      for (const type of eligible) {
        const parent = type.parentItemTypeId && visibleIds.has(type.parentItemTypeId) ? type.parentItemTypeId : null;
        const siblings = children.get(parent) ?? [];
        siblings.push(type);
        children.set(parent, siblings);
      }
      const branch = (parent: string | null): SearchableCascadingMenuItem[] => (children.get(parent) ?? []).map((type) => {
        const nested = branch(type.id);
        return { value: type.id, label: type.name, disabled: type.effectiveInactive,
          ...(nested.length ? { children: [{ value: type.id, label: `选用「${type.name}」`, disabled: type.effectiveInactive }, ...nested] } : {}) };
      });
      if (!archived) pickerHandles.add(mountSearchableCascadingMenu({ anchor: trigger,
        items: [{ value: "__none", label: "无分类" }, ...branch(null)],
        onSelect: (value) => { paintType(value); queueChoice(kind, id, "itemTypeId", value === "__none" ? null : value); },
      }));
    }
    if (tagHost && item) selectHandles.add(mountSelectField(tagHost, { label: "标签", placeholder: "添加标签", options: tagOptions,
      search: true, multiple: true, values: new Set(currentTagDraft ? JSON.parse(currentTagDraft.value) as string[] : item.tagIds), disabled: archived,
      onChange: (value) => queueChoice(kind, id, "tagIds", [...value]) }));
  }
  let unscheduledSort: "created" | "group" | "alpha" = "created";
  function renderUnscheduled() {
    const list = host.querySelector<HTMLElement>("[data-unscheduled-list]");
    if (!list) return;
    const { actions, targets } = opts.getData();
    const records = actions.filter((action) => !action.deletedAtUtc && !action.ended && !(action.plannedStartAt && action.plannedEndAt)
      && targets.get(`${action.targetKind}:${action.targetId}`)?.available && !targets.get(`${action.targetKind}:${action.targetId}`)?.archived);
    const unscheduledCheckpoints = (opts.getData().checkpoints ?? []).filter((checkpoint) => !checkpoint.deletedAtUtc && !checkpoint.completed && !checkpoint.plannedAtUtc
      && !!checkpoint.targetKind && !!checkpoint.targetId && targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`)?.available
      && !targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`)?.archived);
    const rows = [
      ...records.map((action) => {
        const target = targets.get(`${action.targetKind}:${action.targetId}`);
        const targetColor = target?.actionColor ?? target?.color;
        const sourceColor = isItemTypeHex(targetColor) ? targetColor : "#87909a";
        const roles = itemTypeColorRoles(sourceColor);
        const title = action.nameLinkMode === "unlinked" ? action.title : target?.title ?? action.title;
        const groupKey = `${action.targetKind}:${action.targetId}`;
        const groupLabel = unscheduledSort === "group" ? target?.path ?? "事情" : unscheduledSort === "alpha" ? target?.title[0]?.toLocaleUpperCase() ?? "#" : "";
        return { id: action.id, kind: "action", created: action.createdAtUtc, groupKey, groupLabel, targetTitle: target?.title ?? "",
          html: `<div class="arrangement-unscheduled-card is-action" data-source-color="${escAttr(sourceColor)}" style="--arrangement-color:${escAttr(roles.main)};--arrangement-title-color:${escAttr(roles.unfinishedTitle)};--arrangement-background:${escAttr(roles.unfinishedBackground)}" draggable="true" data-unscheduled-id="${escAttr(action.id)}"><button type="button" data-open-action="${escAttr(action.id)}"><strong>${escHtml(title)}</strong>${action.plannedDuration ? `<small>${Math.round(action.plannedDuration / 60)} 分钟</small>` : ""}</button></div>` };
      }),
      ...unscheduledCheckpoints.map((checkpoint) => {
        const target = targets.get(`${checkpoint.targetKind}:${checkpoint.targetId}`);
        const groupKey = `${checkpoint.targetKind}:${checkpoint.targetId}`;
        const groupLabel = unscheduledSort === "group" ? target?.path ?? "事情" : unscheduledSort === "alpha" ? target?.title[0]?.toLocaleUpperCase() ?? "#" : "";
        const title = checkpoint.nameLinkMode === "unlinked" ? checkpoint.title : target?.title ?? checkpoint.title;
        return { id: checkpoint.id, kind: "checkpoint", created: checkpoint.createdAtUtc, groupKey, groupLabel, targetTitle: target?.title ?? "",
          html: `<div class="arrangement-unscheduled-card" draggable="true" data-unscheduled-checkpoint-id="${escAttr(checkpoint.id)}"><button type="button" data-open-checkpoint="${escAttr(checkpoint.id)}"><strong>${escHtml(title)}</strong><span>${escHtml(checkpoint.title)}</span></button></div>` };
      }),
    ];
    rows.sort((a,b) => {
      if (unscheduledSort === "group") return a.groupKey.localeCompare(b.groupKey) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind);
      if (unscheduledSort === "alpha") return a.targetTitle.localeCompare(b.targetTitle, "zh") || a.created.localeCompare(b.created) || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind);
      return a.created.localeCompare(b.created) || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind);
    });
    let lastGroup = "";
    list.innerHTML = rows.map((row) => {
      const heading = row.groupLabel && row.groupKey !== lastGroup
        ? `<h4 class="arrangement-unscheduled-group">${escHtml(row.groupLabel)}</h4>` : "";
      lastGroup = row.groupKey;
      return `${heading}${row.html}`;
    }).join("") || `<p class="arrangement-unscheduled-empty">暂无待安排</p>`;
  }
  function save(kind: string, id: string, name: string, value: string): void {
    const fieldKey = key(kind, id, name);
    const sessionAtIntent = kind === "session" ? opts.getData().sessions.find((entry) => entry.id === id) : undefined;
    const frozenSessionBaseline = kind === "session" ? sessionEditBaselines.get(id) ?? (sessionAtIntent ? opts.captureSessionBaseline?.(sessionAtIntent) : undefined) : undefined;
    const checkpointAtIntent = kind === "checkpoint" ? (opts.getData().checkpoints ?? []).find((entry) => entry.id === id) : undefined;
    drafts.set(fieldKey, { value, failed: false, error: "" });
    const version = nextVersion(fieldKey);
    void enqueue(kind, id, async () => {
      if (disposed || draftVersions.get(fieldKey) !== version) return;
      try {
        if (kind === "checkpoint") {
          const checkpoint = checkpointAtIntent;
          if (!checkpoint) throw new Error("检查点已变化");
          await opts.onSaveCheckpoint?.(checkpoint, "title", value);
        } else if (kind === "action") await opts.onSaveAction(id, name as "title" | "summary", value);
        else if (kind === "session") await opts.onSaveSession(id, name as "title" | "description", value, frozenSessionBaseline);
        else if (kind === "item" || kind === "task") await opts.onSaveItem(id, name as "title" | "description", value);
        if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey);
        if (kind === "session") sessionEditBaselines.delete(id);
      } catch (error) {
        if (draftVersions.get(fieldKey) === version) {
          drafts.set(fieldKey, { value, failed: true, error: error instanceof Error ? error.message : String(error) });
          if (!disposed) opts.onError("保存失败，请重试或放弃修改");
        }
      }
      render();
    });
  }
  function queueChoice(kind: "item" | "task", id: string, field: "status" | "listId" | "itemTypeId" | "tagIds", value: string | null | string[]): void {
    const fieldKey = key(kind, id, field);
    const encoded = JSON.stringify(value);
    drafts.set(fieldKey, { value: encoded, failed: false, error: "" });
    const version = nextVersion(fieldKey);
    void enqueue(kind, id, async () => {
      if (disposed || draftVersions.get(fieldKey) !== version) return;
      try {
        await opts.onSaveThingChoice(kind, id, field, value);
        if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey);
      } catch (error) {
        if (draftVersions.get(fieldKey) === version) {
          drafts.set(fieldKey, { value: encoded, failed: true, error: error instanceof Error ? error.message : String(error) });
          if (!disposed) opts.onError("保存失败，请重试或放弃修改");
        }
      }
      render();
    });
    render();
  }
  function onInput(event: Event) {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (input instanceof HTMLTextAreaElement && input.classList.contains("arrangement-note-editor")) autosizeNote(input);
    if (input.dataset.plan) {
      const container = input.closest<HTMLElement>("[data-plan-id], [data-session-plan]");
      if (!container) return;
      const kind = container.dataset.planId ? "action" : "session";
      const id = container.dataset.planId ?? container.dataset.sessionPlan!;
      const start = container.querySelector<HTMLInputElement>('[data-plan="start"]')!.value;
      const end = container.querySelector<HTMLInputElement>('[data-plan="end"]')!.value;
      const fieldKey = key(kind, id, "plan");
      drafts.set(fieldKey, { value: JSON.stringify({ start, end }), failed: false, error: "" });
      nextVersion(fieldKey);
      if (kind === "action") container.closest<HTMLElement>("[data-action-card]")?.querySelector<HTMLButtonElement>('[data-execute="start"]')?.setAttribute("disabled", "");
      return;
    }
    const { kind, id, field } = input.dataset;
    if (!kind || !id || !field) return;
    const fieldKey = key(kind, id, field);
    drafts.set(fieldKey, { value: input.value, failed: false, error: "" });
    nextVersion(fieldKey);
  }
  function onFocusOut(event: FocusEvent) {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    const { kind, id, field: name } = input.dataset;
    if (kind && id && name) {
      if (input instanceof HTMLTextAreaElement && input.classList.contains("arrangement-note-editor")) input.scrollTop = 0;
      void save(kind, id, name, input.value);
      if (name === "description" && (kind === "item" || kind === "task" || kind === "session")) render();
    }
  }
  function onChange(event: Event) {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.dataset.choice && input.dataset.kind && input.dataset.id) {
      const { choice: field, kind, id } = input.dataset;
      const item = field === "tagIds" ? opts.getData().items.find((value) => value.id === id) : null;
      if (field === "tagIds" && !item) { render(); return; }
      const tagDraft = item ? drafts.get(key("item", id, "tagIds")) : null;
      const currentTags = tagDraft ? JSON.parse(tagDraft.value) as string[] : item?.tagIds ?? [];
      const value = field === "tagIds" && item ? input instanceof HTMLInputElement && input.checked
        ? [...currentTags.filter((tagId) => tagId !== input.value), input.value] : currentTags.filter((tagId) => tagId !== input.value)
        : input.value || null;
      queueChoice(kind as "item" | "task", id, field as "status" | "listId" | "itemTypeId" | "tagIds", value);
      return;
    }
    if (!input.dataset.plan) return;
    const container = input.closest<HTMLElement>("[data-plan-id], [data-session-plan]");
    if (!container) return;
    const startInput = container.querySelector<HTMLInputElement>('[data-plan="start"]')!;
    const endInput = container.querySelector<HTMLInputElement>('[data-plan="end"]')!;
    endInput.min = startInput.value;
    if (input === startInput && startInput.value && endInput.value && endInput.value < startInput.value) endInput.value = startInput.value;
    const id = container.dataset.planId ?? container.dataset.sessionPlan!;
    const kind = container.dataset.planId ? "action" : "session";
    if (!startInput.value || !endInput.value) {
      const fieldKey = key(kind, id, "plan");
      const existing = kind === "action" ? opts.getData().actions.find((action) => action.id === id) : null;
      if (kind === "session" || !existing?.plannedStartAt || !existing?.plannedEndAt) {
        drafts.set(fieldKey, { value: JSON.stringify({ start: startInput.value, end: endInput.value }), failed: false, error: "" });
        return;
      }
      if (kind === "action") {
        drafts.set(fieldKey, { value: JSON.stringify({ start: "", end: "" }), failed: false, error: "" });
        const version = nextVersion(fieldKey);
        void opts.onSaveAction(id, "plan", null).then(() => { if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey); render(); })
          .catch((error) => { if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: JSON.stringify({ start: "", end: "" }), failed: true, error: String(error) }); render(); });
      }
      return;
    }
    const value = { start: startInput.value, end: endInput.value };
    const fieldKey = key(kind, id, "plan");
    const currentSession = kind === "session" ? opts.getData().sessions.find((entry) => entry.id === id) : undefined;
    const sessionBaseline = currentSession ? opts.captureSessionBaseline?.(currentSession) : undefined;
    drafts.set(fieldKey, { value: JSON.stringify(value), failed: false, error: "", sessionBaseline });
    const version = nextVersion(fieldKey);
    if (value.end <= value.start) { drafts.set(fieldKey, { value: JSON.stringify(value), failed: true, error: "结束时间须晚于开始时间" }); render(); return; }
    if (kind === "action") container.closest<HTMLElement>("[data-action-card]")?.querySelector<HTMLButtonElement>('[data-execute="start"]')?.setAttribute("disabled", "");
    void (kind === "action" ? opts.onSaveAction(id, "plan", value) : opts.onSaveSession(id, "plan", value, sessionBaseline))
      .then(() => { if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey); render(); })
      .catch((error) => { if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: JSON.stringify(value), failed: true, error: String(error), sessionBaseline }); render(); });
  }
  function onClick(event: Event) {
    const target = event.target as HTMLElement;
    const noteLink = target.closest<HTMLAnchorElement>("[data-note-link]");
    if (noteLink?.dataset.noteLink) {
      event.preventDefault();
      void openNoteLink(noteLink.dataset.noteLink).catch((error) => opts.onError(String(error)));
      return;
    }
    const notePreview = target.closest<HTMLElement>("[data-edit-note]");
    if (notePreview) { startEditingNote(notePreview); return; }
    const planTrigger = target.closest<HTMLButtonElement>("[data-plan-trigger]");
    if (planTrigger) {
      const popover = planTrigger.parentElement?.querySelector<HTMLElement>("[data-plan-popover]");
      if (popover) { popover.hidden = !popover.hidden; planTrigger.setAttribute("aria-expanded", String(!popover.hidden)); }
      return;
    }
    const planClear = target.closest<HTMLButtonElement>("[data-plan-clear]");
    if (planClear) {
      const container = planClear.closest<HTMLElement>("[data-plan-id], [data-session-plan]");
      const id = container?.dataset.planId;
      if (container && id) {
        if (opts.getData().actions.find((action) => action.id === id)?.sessionId) { opts.onError("请先将安排移出工作时间后清除计划"); return; }
        void opts.onSaveAction(id, "plan", null).then(() => render()).catch((error) => opts.onError(String(error)));
      }
      return;
    }
    const planConfirm = target.closest<HTMLButtonElement>("[data-plan-confirm]");
    if (planConfirm) {
      const container = planConfirm.closest<HTMLElement>("[data-plan-id], [data-session-plan]");
      if (container) savePlanFromControls(container, container.dataset.planId ? "action" : "session", container.dataset.planId ?? container.dataset.sessionPlan!);
      return;
    }
    const editTitle = target.closest<HTMLButtonElement>("[data-edit-title]");
    const editCheckpointTitle = target.closest<HTMLButtonElement>("[data-edit-checkpoint-title]");
    if (editTitle || editCheckpointTitle) {
      const titleButton = editCheckpointTitle ?? editTitle!;
      if (titleButton.disabled) return;
      if (editCheckpointTitle) {
        const input = document.createElement("input"); input.className = "arrangement-inline-title-input";
        input.dataset.kind = "checkpoint"; input.dataset.id = editCheckpointTitle.dataset.editCheckpointTitle!; input.dataset.field = "title";
        input.value = editCheckpointTitle.textContent ?? ""; editCheckpointTitle.replaceWith(input); input.focus(); input.select(); return;
      }
      if (titleButton.disabled) return;
      const [kind, id] = (titleButton.dataset.editTitle ?? "").split(":");
      if (!kind || !id) return;
      if (kind === "session") {
        const session = opts.getData().sessions.find((entry) => entry.id === id);
        if (session) try { const baseline = opts.captureSessionBaseline?.(session); if (baseline) sessionEditBaselines.set(id, baseline); }
        catch (error) { opts.onError(String(error)); return; }
      }
      const input = document.createElement("input");
      input.className = "arrangement-inline-title-input";
      input.dataset.kind = kind; input.dataset.id = id; input.dataset.field = "title";
      input.value = titleButton.textContent ?? "";
      const point = event instanceof MouseEvent && event.detail > 0
        ? textOffsetAt(titleButton, event.clientX, event.clientY)
        : (titleButton.textContent?.length ?? 0);
      titleButton.replaceWith(input);
      input.focus();
      const caret = Math.max(0, Math.min(point, input.value.length));
      input.setSelectionRange(caret, caret);
      return;
    }
    const completion = target.closest<HTMLButtonElement>("[data-completion]");
    if (completion && completion.dataset.kind && completion.dataset.id) {
      if (completion.disabled || completionBusy) return;
      const kind = completion.dataset.kind as "item" | "task";
      const id = completion.dataset.id;
      if (!readCheckbox(completion)) {
        completionBusy = true;
        playCompletionAnimation(completion);
        void opts.onLifecycle(kind, id, "complete")
          .catch((error) => { setCheckbox(completion, false); opts.onError(String(error)); })
          .finally(() => {
            completionBusy = false;
            if (disposed) return;
            render();
          });
      } else {
        setCheckbox(completion, false);
        queueChoice(kind, id, "status", "进行中");
      }
      return;
    }
    const checkpointToggle = target.closest<HTMLButtonElement>("[data-checkpoint-toggle]");
    if (checkpointToggle) {
      if (checkpointToggle.disabled || completionBusy) return;
      const checkpoint = (opts.getData().checkpoints ?? []).find((entry) => entry.id === checkpointToggle.dataset.checkpointToggle);
      if (!checkpoint) return;
      const nextCompleted = !checkpoint.completed;
      completionBusy = true;
      if (nextCompleted) {
        if (!opts.onCompleteCheckpoint) { completionBusy = false; return; }
      }
      else setCheckbox(checkpointToggle, false);
      if (nextCompleted) playCompletionAnimation(checkpointToggle);
      if (opts.onCompleteCheckpoint) void opts.onCompleteCheckpoint(checkpoint, nextCompleted)
        .catch((error) => { setCheckbox(checkpointToggle, checkpoint.completed); opts.onError(String(error)); })
        .finally(() => { completionBusy = false; if (!disposed) render(); });
      return;
    }
    const checkpointLink = target.closest<HTMLButtonElement>("[data-checkpoint-link]");
    if (checkpointLink?.dataset.checkpointLink) {
      const checkpoint = (opts.getData().checkpoints ?? []).find((entry) => entry.id === checkpointLink.dataset.checkpointLink);
      if (checkpoint && opts.onSaveCheckpoint) void opts.onSaveCheckpoint(checkpoint, "nameLinkMode", checkpoint.nameLinkMode === "unlinked" ? "manually-linked" : "unlinked").then(render).catch((error) => opts.onError(String(error)));
      return;
    }
    const card = target.closest<HTMLElement>("[data-action-card]");
    const id = card?.dataset.actionCard;
    const intervalToggle = target.closest<HTMLButtonElement>("[data-interval-toggle]");
    if (intervalToggle && id) {
      expandedIntervalAction = expandedIntervalAction === id ? null : id;
      render();
      const restoredCard = Array.from(host.querySelectorAll<HTMLElement>("[data-action-card]"))
        .find((entry) => entry.dataset.actionCard === id);
      restoredCard?.querySelector<HTMLButtonElement>("[data-interval-toggle]")?.focus({ preventScroll: true });
      return;
    }
    const intervalDelete = target.closest<HTMLButtonElement>("[data-interval-delete]");
    if (intervalDelete && id && !intervalDelete.disabled) {
      const action = opts.getData().actions.find((entry) => entry.id === id);
      const intervalId = intervalDelete.dataset.intervalDelete;
      if (!action || !intervalId || !opts.onEditInterval || executionWrites.has(id)) return;
      const writeInterval = opts.onEditInterval;
      const selectionAtConfirm = opts.getSelection();
      executionWrites.add(id);
      void (async () => {
        if (!await confirmAction("删除计时段", "确定删除此计时段？", "删除", true) || disposed || opts.getSelection() !== selectionAtConfirm) return;
        await writeInterval(action, "delete", intervalId);
      })().catch((error) => opts.onError(String(error))).finally(() => { executionWrites.delete(id); if (!disposed) render(); });
      return;
    }
    const execute = target.closest<HTMLButtonElement>("[data-execute]");
    if (execute && id) {
      if (execute.disabled || executionWrites.has(id)) return;
      const command = execute.hasAttribute("data-action-completion")
        ? readCheckbox(execute) ? "reopen" : "end"
        : execute.dataset.execute as "start" | "pause" | "resume" | "end" | "reopen";
      const completionWasChecked = execute.hasAttribute("data-action-completion") && readCheckbox(execute);
      if (command === "start" && drafts.has(key("action", id, "plan"))) { opts.onError("请先保存或放弃计划时间修改"); return; }
      executionWrites.add(id);
      const selectionAtConfirm = opts.getSelection();
      void (async () => {
        if (!execute.hasAttribute("data-action-completion") && (command === "end" || command === "reopen")) {
          const confirmed = await confirmAction(command === "end" ? "结束安排" : "撤销结束",
            command === "end" ? "确定结束此安排？正在进行的计时会一并结束。" : "确定撤销结束？原计时记录保留，恢复后可开始或继续执行。",
            command === "end" ? "结束" : "恢复");
          if (!confirmed || disposed || opts.getSelection() !== selectionAtConfirm) return;
        }
        if (execute.hasAttribute("data-action-completion")) {
          if (command === "reopen") setCheckbox(execute, false);
          else playCompletionAnimation(execute);
        }
        card.querySelectorAll<HTMLButtonElement>("[data-execute]").forEach((button) => {
          if (!button.hasAttribute("data-action-completion")) button.disabled = true;
        });
        await opts.onExecute(id, command);
      })()
        .catch((error) => {
          if (execute.hasAttribute("data-action-completion")) setCheckbox(execute, completionWasChecked);
          opts.onError(String(error));
        }).finally(() => { executionWrites.delete(id); if (!disposed) render(); });
      return;
    }
    const del = target.closest<HTMLButtonElement>("[data-delete]");
    if (del) {
      if (del.disabled || (id && executionWrites.has(id))) return;
      const kind = del.dataset.delete as "action" | "session";
      const deleteId = id ?? del.dataset.sessionId ?? "";
      const selectionAtConfirm = opts.getSelection();
      if (kind === "action") executionWrites.add(deleteId);
      void (async () => {
        if (kind === "action") {
          const confirmed = await confirmAction("删除安排", "确定删除此安排？关联的事情不会被删除。", "删除", true);
          if (!confirmed || disposed || opts.getSelection() !== selectionAtConfirm) return;
        }
        await opts.onDelete(kind, deleteId);
      })().catch((error) => opts.onError(String(error))).finally(() => { executionWrites.delete(deleteId); if (!disposed) render(); });
      return;
    }
    const link = target.closest<HTMLButtonElement>("[data-link]");
    if (link?.dataset.link) { void opts.onSaveAction(link.dataset.link, "link", null).catch((error) => opts.onError(String(error))); return; }
    const add = target.closest<HTMLButtonElement>("[data-add-menu]");
    if (add?.dataset.addMenu) {
      const [kind, targetId] = add.dataset.addMenu.split(":");
      showCommandMenuAt(event instanceof MouseEvent ? event.clientX : add.getBoundingClientRect().left, event instanceof MouseEvent ? event.clientY : add.getBoundingClientRect().bottom,
        commandMenuItemsFromLegacy([
          { action: "action", label: "新建安排" },
          { action: "recurring", label: "新建周期安排" },
          { action: "checkpoint", label: "新建检查点" },
        ]), (choice) => {
          if (choice === "recurring") return;
          const operation = choice === "checkpoint" ? opts.onCreateCheckpoint?.(kind as "item" | "task", targetId) : opts.onCreateAction(kind as "item" | "task", targetId);
          if (operation) void operation.catch((error) => opts.onError(String(error)));
        });
      return;
    }
    const lifecycle = target.closest<HTMLButtonElement>("[data-lifecycle]");
    if (lifecycle?.dataset.target) { const [kind, targetId] = lifecycle.dataset.target.split(":");
      void opts.onLifecycle(kind as "item" | "task", targetId, lifecycle.dataset.lifecycle as "complete" | "cancel").catch((error) => opts.onError(String(error))); return; }
    const open = target.closest<HTMLButtonElement>("[data-open-action]");
    const openId = open?.dataset.openAction;
    if (openId) opts.onSelect({ kind: "action", id: openId }, openId);
    const openCheckpoint = target.closest<HTMLButtonElement>("[data-open-checkpoint]");
    if (openCheckpoint?.dataset.openCheckpoint) opts.onSelect({ kind: "checkpoint", id: openCheckpoint.dataset.openCheckpoint });
    const discard = target.closest<HTMLButtonElement>("[data-discard]");
    if (discard?.dataset.discard) { const [kind, id] = discard.dataset.discard.split(":"); if (kind === "session") sessionEditBaselines.delete(id); nextVersion(discard.dataset.discard); drafts.delete(discard.dataset.discard); render(); }
    const retry = target.closest<HTMLButtonElement>("[data-retry]");
    if (retry?.dataset.retry) {
      const [kind, targetId, name] = retry.dataset.retry.split(":");
      const draft = drafts.get(retry.dataset.retry);
      if (draft && ["status", "listId", "itemTypeId", "tagIds"].includes(name))
        queueChoice(kind as "item" | "task", targetId, name as "status" | "listId" | "itemTypeId" | "tagIds", JSON.parse(draft.value) as string | null | string[]);
      else if (draft && name !== "plan") save(kind, targetId, name, draft.value);
      else if (draft && name === "plan") {
        if (kind === "checkpoint") {
          const checkpoint = (opts.getData().checkpoints ?? []).find((entry) => entry.id === targetId);
          if (checkpoint) saveCheckpointPlan(checkpoint, JSON.parse(draft.value) as { date: string; time: string } | null);
          return;
        }
        const value = JSON.parse(draft.value) as { start: string; end: string };
        if (value.start && value.end && value.end <= value.start) {
          drafts.set(retry.dataset.retry, { value: draft.value, failed: true, error: "结束时间须晚于开始时间" });
          render();
          return;
        }
        const fieldKey = retry.dataset.retry;
        const version = nextVersion(fieldKey);
        const currentSession = kind === "session" ? opts.getData().sessions.find((entry) => entry.id === targetId) : undefined;
        const sessionBaseline = draft.sessionBaseline ?? (currentSession ? opts.captureSessionBaseline?.(currentSession) : undefined);
        const operation = kind === "action" ? opts.onSaveAction(targetId, "plan", value.start && value.end ? value : null)
          : opts.onSaveSession(targetId, "plan", value, sessionBaseline);
        void operation.then(() => { if (draftVersions.get(fieldKey) === version) drafts.delete(fieldKey); render(); })
          .catch((error) => { if (draftVersions.get(fieldKey) === version) drafts.set(fieldKey, { value: draft.value, failed: true, error: String(error), sessionBaseline }); render(); });
      }
    }
  }
  function textOffsetAt(el: HTMLElement, x: number, y: number): number {
    const doc = el.ownerDocument;
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos?.offsetNode && el.contains(pos.offsetNode) && pos.offsetNode.nodeType === Node.TEXT_NODE) return pos.offset;
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range && el.contains(range.startContainer) && range.startContainer.nodeType === Node.TEXT_NODE) return range.startOffset;
    return el.textContent?.length ?? 0;
  }
  function onTitleKeyDown(event: KeyboardEvent) {
    const noteEditor = event.target;
    if (noteEditor instanceof HTMLTextAreaElement && event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      && noteEditor.dataset.field === "description" && (noteEditor.dataset.kind === "item" || noteEditor.dataset.kind === "task")) {
      const start = noteEditor.selectionStart;
      const line = noteEditor.value.slice(0, start).split("\n").at(-1) ?? "";
      const ordered = /^(\s*)(\d+)\.\s+/.exec(line);
      if (ordered) {
        event.preventDefault();
        const continuation = `\n${ordered[1]}${Number(ordered[2]) + 1}. `;
        noteEditor.setRangeText(continuation, start, noteEditor.selectionEnd, "end");
        noteEditor.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("[data-note-link]")) return;
    const notePreview = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-edit-note]") : null;
    if (notePreview && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      startEditingNote(notePreview);
      return;
    }
    if (event.key !== "Enter") return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains("arrangement-inline-title-input")) return;
    event.preventDefault();
    input.blur();
  }
  let dragGhost: HTMLElement | null = null;
  function clearDragGhost() {
    dragGhost?.remove();
    dragGhost = null;
  }
  function moveDragGhost(event: DragEvent) {
    if (!dragGhost || (!event.clientX && !event.clientY)) return;
    dragGhost.style.left = `${event.clientX}px`;
    dragGhost.style.top = `${event.clientY}px`;
  }
  function onDragStart(event: DragEvent) {
    const checkpointRow = (event.target as HTMLElement).closest<HTMLElement>("[data-unscheduled-checkpoint-id]");
    if (checkpointRow?.dataset.unscheduledCheckpointId && event.dataTransfer) {
      const checkpoint = (opts.getData().checkpoints ?? []).find((value) => value.id === checkpointRow.dataset.unscheduledCheckpointId);
      if (!checkpoint) return;
      event.dataTransfer.setData("application/orbita-arrangement-checkpoint", checkpoint.id);
      event.dataTransfer.effectAllowed = "move";
      opts.onDragCheckpoint?.(checkpoint);
      return;
    }
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-unscheduled-id]");
    if (!row?.dataset.unscheduledId || !event.dataTransfer) return;
    const { actions, targets } = opts.getData();
    const action = actions.find((value) => value.id === row.dataset.unscheduledId);
    const week = document.querySelector<HTMLElement>(".arrangement-week");
    const day = week?.querySelector<HTMLElement>(".arrangement-day");
    if (action && week && day) {
      clearDragGhost();
      const weekStyle = getComputedStyle(week);
      const scale = week.offsetWidth ? week.getBoundingClientRect().width / week.offsetWidth : 1;
      const hourPx = (parseFloat(weekStyle.getPropertyValue("--arrangement-hour-height")) || 60) * scale;
      const target = targets.get(`${action.targetKind}:${action.targetId}`);
      const targetColor = target?.actionColor ?? target?.color;
      const sourceColor = isItemTypeHex(targetColor) ? targetColor : "#87909a";
      const roles = itemTypeColorRoles(sourceColor);
      const start = Date.UTC(2020, 0, 1);
      const duration = action.plannedDuration && action.plannedDuration > 0 ? action.plannedDuration : 3600;
      const ghost = document.createElement("div");
      ghost.className = "arrangement-week arrangement-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      for (const property of weekStyle) if (property.startsWith("--insight-") || property.startsWith("--arrangement-")) ghost.style.setProperty(property, weekStyle.getPropertyValue(property));
      ghost.style.font = weekStyle.font;
      ghost.style.width = `${day.getBoundingClientRect().width}px`;
      ghost.style.height = `${Math.max(12, duration / 3600 * hourPx)}px`;
      ghost.innerHTML = renderArrangementWeekBlocks({ date: "2020-01-01", zone: { baseOffset: "+00:00", replacements: [] }, hourPx, blocks: [{
        kind: "action", id: action.id, start, end: start + duration * 1000, realStart: false, realEnd: false,
        left: 0, width: 1, dense: false, title: action.nameLinkMode === "unlinked" ? action.title : target?.title ?? action.title,
        sourceColor, color: roles.main, titleColor: roles.unfinishedTitle, background: roles.unfinishedBackground,
      }] });
      document.body.appendChild(ghost);
      dragGhost = ghost;
      moveDragGhost(event);
      const transparent = document.createElement("canvas");
      transparent.width = transparent.height = 1;
      event.dataTransfer.setDragImage(transparent, 0, 0);
    }
    event.dataTransfer.setData("application/orbita-arrangement-action", row.dataset.unscheduledId);
    event.dataTransfer.effectAllowed = "move";
    opts.onDragAction?.(row.dataset.unscheduledId);
  }
  function onDragEnd() { clearDragGhost(); opts.onDragAction?.(null); opts.onDragCheckpoint?.(null); }
  function onDragWindowBlur() { if (dragGhost) { clearDragGhost(); opts.onDragAction?.(null); } }
  function resizeNoteEditors(): void {
    host.querySelectorAll<HTMLTextAreaElement>(".arrangement-note-editor").forEach(autosizeNote);
  }
  host.addEventListener("focusout", onFocusOut);
  host.addEventListener("input", onInput);
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onTitleKeyDown);
  host.addEventListener("dragstart", onDragStart);
  host.addEventListener("dragend", onDragEnd);
  host.addEventListener("drag", moveDragGhost);
  document.addEventListener("dragover", moveDragGhost, true);
  document.addEventListener("drop", clearDragGhost, true);
  window.addEventListener("blur", onDragWindowBlur);
  window.addEventListener("resize", resizeNoteEditors);
  const unsubscribeAppearance = subscribeCategoryAppearance(() => {
    host.querySelectorAll<HTMLElement>(".arrangement-unscheduled-card.is-action[data-source-color]").forEach((card) => {
      const roles = itemTypeColorRoles(card.dataset.sourceColor ?? "#87909a");
      card.style.setProperty("--arrangement-color", roles.main);
      card.style.setProperty("--arrangement-title-color", roles.unfinishedTitle);
      card.style.setProperty("--arrangement-background", roles.unfinishedBackground);
    });
    host.querySelectorAll<HTMLElement>(".arrangement-meta-swatch[data-source-color]").forEach((swatch) => {
      if (swatch.dataset.sourceColor) swatch.style.background = resolveCategoryRoles(swatch.dataset.sourceColor).main;
    });
  });
  render();
  // Clearing the locate highlight without another render keeps open plan pickers intact.
  const releaseLocateHighlight = () => {
    focusId = null;
    host.querySelectorAll(".arrangement-action-summary.is-located").forEach((card) => card.classList.remove("is-located"));
  };
  return { render, hasBlockingDrafts: () => drafts.size > 0 || writeQueues.size > 0 || !!host.querySelector("input:focus, textarea:focus, [contenteditable=true]:focus"), clearFocus() { clearTimeout(focusTimer); focusTimer = 0; releaseLocateHighlight(); }, focusAction(id: string) { focusId = id; render(); clearTimeout(focusTimer); focusTimer = window.setTimeout(() => { focusTimer = 0; releaseLocateHighlight(); }, 1300); },
    dispose() { disposed = true; clearTimeout(pendingRenderTimer); clearDragGhost(); document.removeEventListener("dragover", moveDragGhost, true); document.removeEventListener("drop", clearDragGhost, true); window.removeEventListener("blur", onDragWindowBlur); unsubscribeAppearance(); cancelConfirmation?.(); clearTimeout(focusTimer); clearTimeout(completionAnimationTimer); completionAnimation = null; pickerHandles.forEach((handle) => handle.dispose()); pickerHandles.clear(); selectHandles.forEach((handle) => handle.dispose()); selectHandles.clear(); disposeUnscheduledSort?.(); disposeUnscheduledSort = null; actionTitleFields.forEach((handle) => handle.dispose()); actionTitleFields.clear(); itemTitleField?.dispose(); itemTitleField = null; host.removeEventListener("focusout", onFocusOut); host.removeEventListener("input", onInput); host.removeEventListener("change", onChange);
      host.removeEventListener("click", onClick); host.removeEventListener("keydown", onTitleKeyDown); host.removeEventListener("dragstart", onDragStart); host.removeEventListener("dragend", onDragEnd); host.removeEventListener("drag", moveDragGhost); window.removeEventListener("resize", resizeNoteEditors); host.innerHTML = ""; } };
}
