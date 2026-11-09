import { mountDecoupledDatePicker } from "../../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../../ui/decoupled-time-picker";
import { normalizeHhMm } from "../../../../ui/time-picker";
import { createInsightDialog } from "../../../../ui/insight-dialog";
import {
  productivityCommitItemWithActions,
  productivityListActions,
} from "../../../productivity/client";
import type {
  ActionPatch,
  ActionSnapshot,
  CommitActionCreateDraft,
  CommitActionUpdateDraft,
  CommitItemWithActionsRequest,
  ItemPatch,
  ItemSnapshot,
  ProductivityPoint,
  RevisionRef,
} from "../../../productivity/types";
import { getConfirmDialog } from "../../../shell/dialog";
import { unixToLocal } from "../health/format";
import {
  invokeErrorText,
  isRevisionConflict,
  mountActionExecButtons,
} from "../item-compose";
import "../item-compose.css";
import "./task.css";
import {
  parseUtcInstant,
  validateActionRange,
  type PlanMode,
  type RangeParts,
} from "./action-range";

type ActionDraft =
  | {
      kind: "create";
      localId: string;
      title: string;
      planMode: PlanMode;
      range: RangeParts;
      plannedStartAt: string;
      plannedEndAt: string;
      plannedDurationMinutes: number;
    }
  | {
      kind: "saved";
      action: ActionSnapshot;
      baseline: ActionSnapshot;
      title: string;
      planMode: PlanMode;
      range: RangeParts;
      plannedStartAt: string;
      plannedEndAt: string;
      plannedDurationMinutes: number;
    };

function rangeFromAction(a: ActionSnapshot): RangeParts {
  const start = a.plannedStartAt ? unixToLocal(parseUtcInstant(a.plannedStartAt)) : { date: "", time: "" };
  const end = a.plannedEndAt ? unixToLocal(parseUtcInstant(a.plannedEndAt)) : { date: "", time: "" };
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

function emptyRange(): RangeParts {
  return { startDate: "", startTime: "09:00", endDate: "", endTime: "10:00" };
}

export type ItemDetailResult = {
  item: ItemSnapshot;
  actions: ActionSnapshot[];
};

export type OpenItemDetailOpts = {
  item: ItemSnapshot;
  onSaved: (result: ItemDetailResult) => void;
  onConflict: () => void;
  isCurrent?: () => boolean;
  onRequestClose?: () => void;
};
export type ItemDetailNavigationHandle = { canNavigate: () => boolean; allowDiscard: () => void; setVisible: (visible: boolean) => void; close: () => Promise<void>; dispose: () => void };

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dateFromPoint(p?: ProductivityPoint | null): string {
  if (!p) return "";
  if (p.precision === "date") return p.date;
  return p.atUtc.slice(0, 10);
}

function pointFromDate(date: string): ProductivityPoint | null {
  return date ? { precision: "date", date } : null;
}

function pointsEqual(a?: ProductivityPoint | null, b?: ProductivityPoint | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function actionPlanLocked(a: ActionSnapshot): boolean {
  return a.intervals.length > 0;
}

function initialPlanMode(a: ActionSnapshot): PlanMode {
  if (a.plannedDuration != null && a.plannedDuration > 0) return "duration";
  if (a.plannedStartAt || a.plannedEndAt) return "range";
  return "none";
}

function durationMinutes(a: ActionSnapshot): number {
  if (!a.plannedDuration || a.plannedDuration <= 0) return 0;
  return Math.round(a.plannedDuration / 60);
}

function sortActions(actions: ActionSnapshot[]): ActionSnapshot[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const xs = x.a.plannedStartAt;
      const ys = y.a.plannedStartAt;
      if (!xs && !ys) return x.i - y.i;
      if (!xs) return 1;
      if (!ys) return -1;
      const cmp = xs.localeCompare(ys);
      return cmp !== 0 ? cmp : x.i - y.i;
    })
    .map((x) => x.a);
}

function planDirty(draft: ActionDraft): boolean {
  if (draft.kind === "create") {
    if (draft.planMode === "range") {
      return !!(draft.range.startDate || draft.range.endDate || draft.plannedStartAt || draft.plannedEndAt);
    }
    if (draft.planMode === "duration") return draft.plannedDurationMinutes > 0;
    return false;
  }
  const b = draft.baseline;
  if (actionPlanLocked(b)) return false;
  if (draft.planMode !== initialPlanMode(b)) return true;
  if (draft.planMode === "range") {
    const br = rangeFromAction(b);
    return (
      draft.range.startDate !== br.startDate ||
      draft.range.startTime !== br.startTime ||
      draft.range.endDate !== br.endDate ||
      draft.range.endTime !== br.endTime
    );
  }
  if (draft.planMode === "duration") {
    return draft.plannedDurationMinutes !== durationMinutes(b);
  }
  return !!(b.plannedStartAt || b.plannedEndAt || (b.plannedDuration != null && b.plannedDuration > 0));
}

function buildExpectedAssociated(drafts: ActionDraft[], deleted: RevisionRef[]): RevisionRef[] {
  const refs = new Map<string, number>();
  for (const d of drafts) {
    if (d.kind === "saved") refs.set(d.action.id, d.action.revision);
  }
  for (const del of deleted) refs.set(del.id, del.expectedRevision);
  return [...refs.entries()].map(([id, expectedRevision]) => ({ id, expectedRevision }));
}

function actionDraftFromSnapshot(a: ActionSnapshot): ActionDraft {
  return {
    kind: "saved",
    action: a,
    baseline: a,
    title: a.title,
    planMode: initialPlanMode(a),
    range: rangeFromAction(a),
    plannedStartAt: a.plannedStartAt ?? "",
    plannedEndAt: a.plannedEndAt ?? "",
    plannedDurationMinutes: durationMinutes(a),
  };
}

export async function openItemDetailDialog(opts: OpenItemDetailOpts): Promise<ItemDetailNavigationHandle | null> {
    let associated: ActionSnapshot[] = [];
    try {
      const res = await productivityListActions();
      associated = sortActions(
        res.actions.filter(
          (a) => !a.deletedAtUtc && a.targetKind === "item" && a.targetId === opts.item.id,
        ),
      );
    } catch (err) {
      void getConfirmDialog()("无法打开任务详情", invokeErrorText(err), undefined, {
        info: true,
        danger: false,
      });
      return null;
    }
    if (opts.isCurrent && !opts.isCurrent()) return null;
    return mountItemDetailDialog(opts, associated);
}

function mountItemDetailDialog(opts: OpenItemDetailOpts, associatedActions: ActionSnapshot[]): ItemDetailNavigationHandle {
  const itemBaseline = opts.item;
  let title = itemBaseline.title;
  let description = itemBaseline.description ?? "";
  let plannedDate = dateFromPoint(itemBaseline.plannedPoint);
  let dueDate = dateFromPoint(itemBaseline.duePoint);
  const drafts: ActionDraft[] = associatedActions.map(actionDraftFromSnapshot);
  const deleted: RevisionRef[] = [];
  const originalDrafts = JSON.stringify(drafts);
  let discardAllowed = false;
  let nextLocal = 1;

  const dlg = createInsightDialog({
    title: "任务详情",
    navigationKind: "navigation-detail",
    submitLabel: "确认",
    panelClass: "task-item-detail-dialog",
    bodyHtml: `
      <div class="insight-dialog-field">
        <label>标题</label>
        <input type="text" id="itemDetailTitle" value="${escapeAttr(title)}" required>
      </div>
      <div class="insight-dialog-field">
        <label>描述</label>
        <textarea id="itemDetailDesc" rows="2">${escapeAttr(description)}</textarea>
      </div>
      <div class="task-item-detail-points-row">
        <div class="insight-dialog-field task-item-detail-points">
          <label>计划点</label>
          <div data-region="planned-point"></div>
        </div>
        <div class="insight-dialog-field task-item-detail-points">
          <label>截止点</label>
          <div data-region="due-point"></div>
        </div>
      </div>
      <div class="task-item-detail-actions-section">
        <div class="task-item-detail-actions-heading">
          <h3 class="task-item-detail-actions-title">安排</h3>
          <button type="button" class="insight-dialog-btn" data-action="add-action">添加安排</button>
        </div>
        <div class="task-item-detail-actions" data-region="actions"></div>
      </div>`,
  });
  const backdrop = dlg.backdrop;
  const actionsEl = backdrop.querySelector<HTMLElement>('[data-region="actions"]')!;
  const setError = (msg: string) => dlg.setError(msg);

  const plannedPicker = mountDecoupledDatePicker({ defaultTrigger: { container: backdrop.querySelector("[data-region=planned-point]")! },
    value: plannedDate || undefined,
    onChange: (v) => {
      plannedDate = v;
    },
  });
  const duePicker = mountDecoupledDatePicker({ defaultTrigger: { container: backdrop.querySelector("[data-region=due-point]")! },
    value: dueDate || undefined,
    onChange: (v) => {
      dueDate = v;
    },
  });

  function syncDraftFromDom(): void {
    title = backdrop.querySelector<HTMLInputElement>("#itemDetailTitle")!.value;
    description = backdrop.querySelector<HTMLTextAreaElement>("#itemDetailDesc")!.value.trim();
    plannedDate = plannedPicker.getValue();
    dueDate = duePicker.getValue();
  }

  function readRange(startDate: ReturnType<typeof mountDecoupledDatePicker>, startTime: ReturnType<typeof mountDecoupledTimePicker>, endDate: ReturnType<typeof mountDecoupledDatePicker>, endTime: ReturnType<typeof mountDecoupledTimePicker>): RangeParts {
    return {
      startDate: startDate.getValue(),
      startTime: normalizeHhMm(startTime.getValue()),
      endDate: endDate.getValue(),
      endTime: normalizeHhMm(endTime.getValue()),
    };
  }

  function markRangeErrors(row: HTMLElement, errors: Partial<Record<keyof RangeParts, string>> | null): void {
    const slots: { key: keyof RangeParts; sel: string }[] = [
      { key: "startDate", sel: "[data-region=start-date]" },
      { key: "startTime", sel: "[data-region=start-time]" },
      { key: "endDate", sel: "[data-region=end-date]" },
      { key: "endTime", sel: "[data-region=end-time]" },
    ];
    for (const slot of slots) {
      const el = row.querySelector<HTMLElement>(slot.sel);
      if (!el) continue;
      el.classList.toggle("is-error", Boolean(errors?.[slot.key]));
      el.classList.toggle("insight-dialog-range-slot", true);
    }
  }

  function renderActions(): void {
    actionsEl.replaceChildren();
    for (const draft of drafts) {
      const row = document.createElement("div");
      row.className = "task-item-detail-action";
      if (draft.kind === "saved") {
        if (draft.action.executionState === "进行中") row.classList.add("is-running");
        if (draft.action.executionState === "暂停") row.classList.add("is-paused");
      }
      const locked = draft.kind === "saved" && actionPlanLocked(draft.action);
      const canDelete =
        draft.kind === "create" ||
        (draft.kind === "saved" &&
          draft.action.executionState !== "进行中" &&
          draft.action.executionState !== "暂停");
      const startParts = draft.range;
      const endParts = draft.range;
      row.innerHTML = `
        <div class="task-item-detail-action-head">
          ${
            draft.kind === "saved" && draft.action.executionState === "进行中"
              ? '<span class="task-detail-action-spinner" aria-hidden="true"></span>'
              : ""
          }
          <input type="text" data-field="title" value="${escapeAttr(draft.title)}" placeholder="安排标题">
          ${canDelete ? '<button type="button" class="insight-dialog-btn" data-action="remove">删除</button>' : ""}
        </div>
        <div class="task-item-detail-plan-modes" data-region="plan-modes">
          <label><input type="radio" name="plan-${draft.kind === "create" ? draft.localId : draft.action.id}" value="range"${draft.planMode === "range" ? " checked" : ""}> 起止</label>
          <label><input type="radio" name="plan-${draft.kind === "create" ? draft.localId : draft.action.id}" value="duration"${draft.planMode === "duration" ? " checked" : ""}> 预计时长</label>
          <label><input type="radio" name="plan-${draft.kind === "create" ? draft.localId : draft.action.id}" value="none"${draft.planMode === "none" ? " checked" : ""}> 无时间</label>
        </div>
        <div class="task-item-detail-plan-row" data-region="plan-range"${draft.planMode !== "range" ? " hidden" : ""}>
          <div data-region="start-date"></div>
          <div data-region="start-time"></div>
          <span>—</span>
          <div data-region="end-date"></div>
          <div data-region="end-time"></div>
        </div>
        <div class="task-item-detail-plan-duration" data-region="plan-duration"${draft.planMode !== "duration" ? " hidden" : ""}>
          <label>预计时长（分钟）</label>
          <input type="number" min="1" step="1" data-field="duration" value="${draft.plannedDurationMinutes || ""}">
        </div>
        ${locked ? '<p class="task-item-detail-plan-locked">计划锁定</p>' : ""}
        <div class="task-item-detail-exec" data-region="exec"></div>`;

      const titleInput = row.querySelector<HTMLInputElement>('[data-field="title"]')!;
      titleInput.addEventListener("input", () => {
        draft.title = titleInput.value;
      });

      const planModesEl = row.querySelector<HTMLElement>('[data-region="plan-modes"]')!;
      planModesEl.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((radio) => {
        radio.disabled = locked;
        radio.addEventListener("change", () => {
          if (!radio.checked) return;
          draft.planMode = radio.value as PlanMode;
          row.querySelector<HTMLElement>('[data-region="plan-range"]')!.hidden = draft.planMode !== "range";
          row.querySelector<HTMLElement>('[data-region="plan-duration"]')!.hidden =
            draft.planMode !== "duration";
        });
      });

      const rangeEl = row.querySelector<HTMLElement>('[data-region="plan-range"]')!;
      const startDate = mountDecoupledDatePicker({ defaultTrigger: { container: row.querySelector("[data-region=start-date]")! },
        value: startParts.startDate || undefined,
        onChange: () => {
          draft.range = readRange(startDate, startTime, endDate, endTime);
          markRangeErrors(row, null);
        },
      });
      const startTime = mountDecoupledTimePicker({ defaultTrigger: { container: row.querySelector("[data-region=start-time]")! },
        value: startParts.startTime || "09:00",
        onChange: () => {
          draft.range = readRange(startDate, startTime, endDate, endTime);
          markRangeErrors(row, null);
        },
      });
      const endDate = mountDecoupledDatePicker({ defaultTrigger: { container: row.querySelector("[data-region=end-date]")! },
        value: endParts.endDate || undefined,
        onChange: () => {
          draft.range = readRange(startDate, startTime, endDate, endTime);
          markRangeErrors(row, null);
        },
      });
      const endTime = mountDecoupledTimePicker({ defaultTrigger: { container: row.querySelector("[data-region=end-time]")! },
        value: endParts.endTime || "10:00",
        onChange: () => {
          draft.range = readRange(startDate, startTime, endDate, endTime);
          markRangeErrors(row, null);
        },
      });
      draft.range = readRange(startDate, startTime, endDate, endTime);
      if (locked) {
        rangeEl.style.pointerEvents = "none";
        rangeEl.style.opacity = "0.55";
        const durEl = row.querySelector<HTMLElement>('[data-region="plan-duration"]');
        if (durEl) {
          durEl.style.pointerEvents = "none";
          durEl.style.opacity = "0.55";
        }
      }

      row.querySelector<HTMLInputElement>('[data-field="duration"]')?.addEventListener("input", (e) => {
        const v = parseInt((e.target as HTMLInputElement).value, 10);
        draft.plannedDurationMinutes = Number.isFinite(v) && v > 0 ? v : 0;
      });

      row.querySelector<HTMLButtonElement>('[data-action="remove"]')?.addEventListener("click", () => {
        if (draft.kind === "saved") {
          deleted.push({ id: draft.action.id, expectedRevision: draft.action.revision });
        }
        drafts.splice(drafts.indexOf(draft), 1);
        renderActions();
      });

      const execEl = row.querySelector<HTMLElement>('[data-region="exec"]')!;
      if (draft.kind === "saved") {
        mountActionExecButtons(
          execEl,
          draft,
          () => planDirty(draft),
          (updated) => {
            const idx = drafts.indexOf(draft);
            const planLocked = updated.intervals.length > 0;
            drafts[idx] = {
              kind: "saved",
              action: updated,
              baseline: updated,
              title: draft.title,
              planMode: planLocked ? initialPlanMode(updated) : draft.planMode,
              range: planLocked ? rangeFromAction(updated) : draft.range,
              plannedStartAt: planLocked ? (updated.plannedStartAt ?? "") : draft.plannedStartAt,
              plannedEndAt: planLocked ? (updated.plannedEndAt ?? "") : draft.plannedEndAt,
              plannedDurationMinutes: planLocked
                ? durationMinutes(updated)
                : draft.plannedDurationMinutes,
            };
            renderActions();
          },
          setError,
        );
      }
      actionsEl.appendChild(row);
    }
  }

  renderActions();

  backdrop.querySelector<HTMLButtonElement>('[data-action="add-action"]')?.addEventListener("click", () => {
    syncDraftFromDom();
    drafts.push({
      kind: "create",
      localId: `new-${nextLocal++}`,
      title,
      planMode: "none",
      range: emptyRange(),
      plannedStartAt: "",
      plannedEndAt: "",
      plannedDurationMinutes: 0,
    });
    renderActions();
  });

  const closeDialog = () => {
    if (dlg.busy) return;
    if (opts.onRequestClose) opts.onRequestClose();
    else void dlg.close();
  };
  dlg.bindChrome(closeDialog);

  dlg.panel.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (dlg.busy) return;
    syncDraftFromDom();
    if (!title.trim()) {
      setError("标题不能为空");
      return;
    }
    const patch: ItemPatch = {};
    if (title.trim() !== itemBaseline.title) patch.title = title.trim();
    const nextDesc = description || null;
    if ((itemBaseline.description ?? null) !== nextDesc) patch.description = nextDesc;
    const nextPlanned = pointFromDate(plannedDate);
    if (!pointsEqual(itemBaseline.plannedPoint, nextPlanned)) patch.plannedPoint = nextPlanned;
    const nextDue = pointFromDate(dueDate);
    if (!pointsEqual(itemBaseline.duePoint, nextDue)) patch.duePoint = nextDue;

    const actionCreates: CommitActionCreateDraft[] = [];
    const actionUpdates: CommitActionUpdateDraft[] = [];
    const actionRows = [...actionsEl.querySelectorAll<HTMLElement>(".task-item-detail-action")];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const row = actionRows[i];
      if (row) markRangeErrors(row, null);
      if (d.kind === "create" && !d.title.trim()) {
        setError("新安排标题不能为空");
        return;
      }
      if (d.planMode === "range" && !(d.kind === "saved" && actionPlanLocked(d.action))) {
        const checked = validateActionRange(d.range);
        if (!checked.ok) {
          if (row) markRangeErrors(row, checked.errors);
          setError(checked.message);
          return;
        }
        d.plannedStartAt = checked.startIso;
        d.plannedEndAt = checked.endIso;
      }
    }
    for (const d of drafts) {
      if (d.kind === "create") {
        const create: CommitActionCreateDraft = { title: d.title.trim() };
        if (d.planMode === "range") {
          create.plannedStartAt = d.plannedStartAt;
          create.plannedEndAt = d.plannedEndAt;
        } else if (d.planMode === "duration" && d.plannedDurationMinutes > 0) {
          create.plannedDuration = d.plannedDurationMinutes * 60;
        }
        actionCreates.push(create);
      } else {
        const patchA: ActionPatch = {};
        if (d.title !== d.baseline.title) patchA.title = d.title;
        if (!actionPlanLocked(d.action) && !actionPlanLocked(d.baseline)) {
          if (d.planMode === "range") {
            if (d.plannedStartAt !== (d.baseline.plannedStartAt ?? "")) {
              patchA.plannedStartAt = d.plannedStartAt;
            }
            if (d.plannedEndAt !== (d.baseline.plannedEndAt ?? "")) {
              patchA.plannedEndAt = d.plannedEndAt;
            }
            if (d.baseline.plannedDuration != null) patchA.plannedDuration = null;
          } else if (d.planMode === "duration") {
            const secs = d.plannedDurationMinutes > 0 ? d.plannedDurationMinutes * 60 : null;
            if (secs !== d.baseline.plannedDuration) patchA.plannedDuration = secs;
            if (d.baseline.plannedStartAt) patchA.plannedStartAt = null;
            if (d.baseline.plannedEndAt) patchA.plannedEndAt = null;
          } else {
            if (d.baseline.plannedStartAt) patchA.plannedStartAt = null;
            if (d.baseline.plannedEndAt) patchA.plannedEndAt = null;
            if (d.baseline.plannedDuration != null) patchA.plannedDuration = null;
          }
        }
        if (Object.keys(patchA).length > 0) {
          actionUpdates.push({
            action: { id: d.action.id, expectedRevision: d.action.revision },
            patch: patchA,
          });
        }
      }
    }

    const req: CommitItemWithActionsRequest = {
      itemId: itemBaseline.id,
      itemExpectedRevision: itemBaseline.revision,
      expectedAssociatedActions: buildExpectedAssociated(drafts, deleted),
      actionCreates,
      actionUpdates,
      actionDeletes: deleted,
    };
    if (Object.keys(patch).length > 0) req.itemPatch = patch;

    dlg.setBusy(true);
    try {
      const res = await productivityCommitItemWithActions(req);
      setError("");
      await dlg.close();
      opts.onSaved({ item: res.item, actions: res.actions });
    } catch (err) {
      dlg.setBusy(false);
      if (isRevisionConflict(err)) {
        setError("任务内容已变化");
        opts.onConflict();
      } else {
        setError(invokeErrorText(err));
      }
    }
  });

  void dlg.open();
  return {
    canNavigate() {
      syncDraftFromDom();
      const dirty = title !== itemBaseline.title || description !== (itemBaseline.description ?? "") ||
        plannedDate !== dateFromPoint(itemBaseline.plannedPoint) || dueDate !== dateFromPoint(itemBaseline.duePoint) ||
        deleted.length > 0 || JSON.stringify(drafts) !== originalDrafts;
      if (dlg.busy || (dirty && !discardAllowed)) { setError("请先确认保存，或通过取消放弃本次编辑。"); return false; }
      return true;
    },
    close: () => dlg.close(),
    allowDiscard: () => { discardAllowed = true; },
    setVisible: (visible) => { dlg.backdrop.hidden = !visible; },
    dispose: () => dlg.dispose(),
  };
}
