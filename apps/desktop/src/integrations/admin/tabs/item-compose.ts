import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { normalizeHhMm, isValidHhMm } from "../../../ui/time-picker";
import { bindBackdropPressDismiss } from "../../../ui/backdrop-dismiss";
import { bindDialog } from "../../../ui/motion";
import {
  productivityCommitItemWithActions,
  productivityEndAction,
  productivityPauseAction,
  productivityResumeAction,
  productivityStartAction,
} from "../../productivity/client";
import type {
  ActionPatch,
  ActionSnapshot,
  CommitActionCreateDraft,
  CommitActionUpdateDraft,
  CommitItemWithActionsRequest,
  ItemPatch,
  ItemPriority,
  ItemSnapshot,
  RevisionRef,
} from "../../productivity/types";
import { ITEM_ORDER_ROOT_ID } from "../../productivity/types";
import { dateTimeToUnix, unixToLocal } from "./health/format";
import "./item-compose.css";

const PRIORITIES: ItemPriority[] = ["none", "low", "medium", "high"];
const PRIORITY_LABEL: Record<ItemPriority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
};

export function itemPriorityLabel(priority: string): string {
  return PRIORITY_LABEL[priority as ItemPriority] ?? PRIORITY_LABEL.none;
}

export function nextPriority(current: string): ItemPriority {
  const idx = PRIORITIES.indexOf(current as ItemPriority);
  return PRIORITIES[(idx + 1) % PRIORITIES.length];
}

export function priorityClass(priority: string): string {
  if (priority === "high") return "is-high";
  if (priority === "medium") return "is-medium";
  if (priority === "low") return "is-low";
  return "";
}

export function invokeErrorText(err: unknown): string {
  const raw =
    typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string; code?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* not json */
  }
  return raw;
}

export function isRevisionConflict(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code: string }).code === "REVISION_CONFLICT";
  }
  return String(err).includes("REVISION_CONFLICT");
}

function utcToRfc3339(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

function parseUtcInstant(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type ActionDraft =
  | { kind: "create"; localId: string; title: string; plannedStartAt: string; plannedEndAt: string }
  | { kind: "saved"; action: ActionSnapshot; title: string; plannedStartAt: string; plannedEndAt: string; baseline: ActionSnapshot };

export type ItemComposeResult = {
  item: ItemSnapshot;
  actions: ActionSnapshot[];
};

export type OpenItemComposeOpts = {
  item?: ItemSnapshot;
  associatedActions: ActionSnapshot[];
  defaultListId?: string | null;
  onSaved: (result: ItemComposeResult) => void;
  onConflict: () => void;
};

function planDirty(draft: ActionDraft): boolean {
  if (draft.kind === "create") return !!(draft.plannedStartAt || draft.plannedEndAt);
  const b = draft.baseline;
  const start = draft.plannedStartAt || "";
  const end = draft.plannedEndAt || "";
  return start !== (b.plannedStartAt ?? "") || end !== (b.plannedEndAt ?? "");
}

function actionPlanLocked(a: ActionSnapshot): boolean {
  return a.intervals.length > 0;
}

export function openItemComposeDialog(opts: OpenItemComposeOpts): void {
  const isCreate = !opts.item;
  const itemBaseline = opts.item;
  let title = opts.item?.title ?? "";
  let description = opts.item?.description ?? "";
  let priority = opts.item?.priority ?? "none";
  const drafts: ActionDraft[] = opts.associatedActions.map((a) => ({
    kind: "saved",
    action: a,
    baseline: a,
    title: a.title,
    plannedStartAt: a.plannedStartAt ?? "",
    plannedEndAt: a.plannedEndAt ?? "",
  }));
  const deleted: RevisionRef[] = [];
  let nextLocal = 1;

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop motion-dialog item-compose-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel motion-dialog-panel">
      <div class="dialog-title">${isCreate ? "新建任务" : "任务详情"}</div>
      <div class="dialog-field">
        <label>标题</label>
        <input type="text" id="itemTitle" value="${escapeAttr(title)}" required>
      </div>
      <div class="dialog-field">
        <label>描述</label>
        <textarea id="itemDesc" rows="2">${escapeAttr(description)}</textarea>
      </div>
      <div class="dialog-field">
        <label>优先级</label>
        <select id="itemPriority">
          ${PRIORITIES.map((p) => `<option value="${p}"${priority === p ? " selected" : ""}>${PRIORITY_LABEL[p]}</option>`).join("")}
        </select>
      </div>
      <div class="item-compose-actions" data-region="actions"></div>
      <button type="button" class="dialog-btn" data-action="add-action">添加安排</button>
      <p class="item-compose-error" data-region="error" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>`;

  document.body.appendChild(backdrop);
  const actionsEl = backdrop.querySelector<HTMLElement>('[data-region="actions"]')!;
  const errorEl = backdrop.querySelector<HTMLElement>('[data-region="error"]')!;
  const setError = (msg: string) => {
    errorEl.hidden = !msg;
    errorEl.textContent = msg;
  };

  function syncDraftFromDom(): void {
    title = backdrop.querySelector<HTMLInputElement>("#itemTitle")!.value;
    description = backdrop.querySelector<HTMLTextAreaElement>("#itemDesc")!.value.trim();
    priority = backdrop.querySelector<HTMLSelectElement>("#itemPriority")!.value;
  }

  function renderActions(): void {
    actionsEl.replaceChildren();
    for (const draft of drafts) {
      const row = document.createElement("div");
      row.className = "item-compose-action-row";
      if (draft.kind === "saved") {
        if (draft.action.executionState === "进行中") row.classList.add("is-running");
        if (draft.action.executionState === "暂停") row.classList.add("is-paused");
      }
      const locked = draft.kind === "saved" && actionPlanLocked(draft.action);
      const startParts = draft.plannedStartAt
        ? unixToLocal(parseUtcInstant(draft.plannedStartAt))
        : { date: "", time: "09:00" };
      const endParts = draft.plannedEndAt
        ? unixToLocal(parseUtcInstant(draft.plannedEndAt))
        : { date: "", time: "10:00" };
      row.innerHTML = `
        <div class="item-compose-action-head">
          <input type="text" data-field="title" value="${escapeAttr(draft.title)}" placeholder="安排标题">
          ${draft.kind === "create" ? '<button type="button" class="dialog-btn" data-action="remove">删除</button>' : draft.action.ended || draft.action.executionState !== "未开始" ? "" : '<button type="button" class="dialog-btn" data-action="remove">删除</button>'}
        </div>
        <div class="item-compose-plan-row" data-region="plan">
          <div data-region="start-date"></div>
          <div data-region="start-time"></div>
          <span>—</span>
          <div data-region="end-date"></div>
          <div data-region="end-time"></div>
        </div>
        <div class="item-compose-exec" data-region="exec"></div>`;
      const titleInput = row.querySelector<HTMLInputElement>('[data-field="title"]')!;
      titleInput.disabled = false;
      titleInput.addEventListener("input", () => {
        draft.title = titleInput.value;
      });
      const startDate = mountDecoupledDatePicker({ defaultTrigger: { container: row.querySelector("[data-region=start-date]")! },
        value: startParts.date || undefined,
        onChange: () => syncPlanPickers(draft, startDate, startTime, endDate, endTime),
      });
      const startTime = mountDecoupledTimePicker({ defaultTrigger: { container: row.querySelector("[data-region=start-time]")! },
        value: startParts.time,
        onChange: () => syncPlanPickers(draft, startDate, startTime, endDate, endTime),
      });
      const endDate = mountDecoupledDatePicker({ defaultTrigger: { container: row.querySelector("[data-region=end-date]")! },
        value: endParts.date || undefined,
        onChange: () => syncPlanPickers(draft, startDate, startTime, endDate, endTime),
      });
      const endTime = mountDecoupledTimePicker({ defaultTrigger: { container: row.querySelector("[data-region=end-time]")! },
        value: endParts.time,
        onChange: () => syncPlanPickers(draft, startDate, startTime, endDate, endTime),
      });
      if (locked) {
        row.querySelector<HTMLElement>('[data-region="plan"]')!.style.pointerEvents = "none";
        row.querySelector<HTMLElement>('[data-region="plan"]')!.style.opacity = "0.55";
      }
      row.querySelector<HTMLButtonElement>('[data-action="remove"]')?.addEventListener("click", () => {
        if (draft.kind === "saved") {
          deleted.push({ id: draft.action.id, expectedRevision: draft.action.revision });
        }
        drafts.splice(drafts.indexOf(draft), 1);
        renderActions();
      });
      const execEl = row.querySelector<HTMLElement>('[data-region="exec"]')!;
      if (draft.kind === "saved") {
        mountActionExecButtons(execEl, draft, () => planDirty(draft), (updated) => {
          const idx = drafts.indexOf(draft);
          drafts[idx] = {
            kind: "saved",
            action: updated,
            baseline: updated,
            title: updated.title,
            plannedStartAt: updated.plannedStartAt ?? "",
            plannedEndAt: updated.plannedEndAt ?? "",
          };
          renderActions();
        }, setError);
      }
      actionsEl.appendChild(row);
    }
  }

  function syncPlanPickers(
    draft: ActionDraft,
    startDate: ReturnType<typeof mountDecoupledDatePicker>,
    startTime: ReturnType<typeof mountDecoupledTimePicker>,
    endDate: ReturnType<typeof mountDecoupledDatePicker>,
    endTime: ReturnType<typeof mountDecoupledTimePicker>,
  ): void {
    const sd = startDate.getValue();
    const st = normalizeHhMm(startTime.getValue());
    const ed = endDate.getValue();
    const et = normalizeHhMm(endTime.getValue());
    if (sd && isValidHhMm(st) && ed && isValidHhMm(et)) {
      draft.plannedStartAt = utcToRfc3339(dateTimeToUnix(sd, st));
      draft.plannedEndAt = utcToRfc3339(dateTimeToUnix(ed, et));
    } else {
      draft.plannedStartAt = "";
      draft.plannedEndAt = "";
    }
  }

  renderActions();

  backdrop.querySelector<HTMLButtonElement>('[data-action="add-action"]')?.addEventListener("click", () => {
    syncDraftFromDom();
    drafts.push({
      kind: "create",
      localId: `new-${nextLocal++}`,
      title,
      plannedStartAt: "",
      plannedEndAt: "",
    });
    renderActions();
  });

  const dialog = bindDialog(backdrop);
  const closeDialog = () => {
    void dialog.close();
    backdrop.remove();
  };
  backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", closeDialog);
  bindBackdropPressDismiss(backdrop, closeDialog);

  backdrop.querySelector("form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncDraftFromDom();
    if (!title.trim()) return;
    const patch: ItemPatch = {
      title: title.trim(),
      description: description || null,
      priority,
    };
    const actionCreates: CommitActionCreateDraft[] = [];
    const actionUpdates: CommitActionUpdateDraft[] = [];
    for (const d of drafts) {
      if (d.kind === "create") {
        if (!d.title.trim()) continue;
        actionCreates.push({
          title: d.title.trim(),
          plannedStartAt: d.plannedStartAt || undefined,
          plannedEndAt: d.plannedEndAt || undefined,
        });
      } else {
        const patchA: ActionPatch = {};
        if (d.title !== d.baseline.title) patchA.title = d.title;
        if (!actionPlanLocked(d.baseline)) {
          if (d.plannedStartAt !== (d.baseline.plannedStartAt ?? "")) {
            patchA.plannedStartAt = d.plannedStartAt || null;
          }
          if (d.plannedEndAt !== (d.baseline.plannedEndAt ?? "")) {
            patchA.plannedEndAt = d.plannedEndAt || null;
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
    const expectedAssociated: RevisionRef[] = opts.associatedActions.map((a) => ({
      id: a.id,
      expectedRevision: a.revision,
    }));
    const req: CommitItemWithActionsRequest = {
      expectedAssociatedActions: expectedAssociated,
      actionCreates,
      actionUpdates,
      actionDeletes: deleted,
    };
    if (isCreate) {
      req.itemCreate = {
        title: title.trim(),
        description: description || undefined,
        status: "进行中",
        listId: opts.defaultListId ?? null,
        priority,
      };
    } else if (itemBaseline) {
      req.itemId = itemBaseline.id;
      req.itemExpectedRevision = itemBaseline.revision;
      req.itemPatch = patch;
    }
    try {
      const res = await productivityCommitItemWithActions(req);
      setError("");
      closeDialog();
      opts.onSaved({ item: res.item, actions: res.actions });
    } catch (err) {
      if (isRevisionConflict(err)) {
        setError("任务内容已变化");
        opts.onConflict();
      } else {
        setError(invokeErrorText(err));
      }
    }
  });

  void dialog.open();
}

export function mountActionExecButtons(
  host: HTMLElement,
  draft: { kind: "saved"; action: ActionSnapshot; baseline: ActionSnapshot },
  planDirtyFn: () => boolean,
  onUpdated: (action: ActionSnapshot) => void,
  setError: (msg: string) => void,
): void {
  const a = draft.action;
  if (a.ended) {
    host.innerHTML = `<span class="admin-placeholder-hint">已结束</span>`;
    return;
  }
  const btns: { action: string; label: string; hidden?: boolean }[] = [];
  if (a.executionState === "未开始") {
    btns.push({ action: "start", label: "开始" });
  } else if (a.executionState === "进行中") {
    btns.push({ action: "pause", label: "暂停" });
    btns.push({ action: "end", label: "结束" });
  } else if (a.executionState === "暂停") {
    btns.push({ action: "resume", label: "恢复" });
    btns.push({ action: "end", label: "结束" });
  }
  host.replaceChildren();
  for (const b of btns) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dialog-btn";
    btn.dataset.exec = b.action;
    btn.textContent = b.label;
    if (b.action === "start" && planDirtyFn()) btn.disabled = true;
    btn.addEventListener("click", async () => {
      if (b.action === "start" && planDirtyFn()) return;
      try {
        let res;
        const ref = { id: draft.action.id, expectedRevision: draft.action.revision };
        if (b.action === "start") res = await productivityStartAction({ action: ref });
        else if (b.action === "pause") res = await productivityPauseAction({ action: ref });
        else if (b.action === "resume") res = await productivityResumeAction({ action: ref });
        else res = await productivityEndAction({ action: ref });
        onUpdated(res.action);
        setError("");
      } catch (err) {
        if (isRevisionConflict(err)) setError("任务内容已变化");
        else setError(invokeErrorText(err));
      }
    });
    host.appendChild(btn);
  }
}

export { ITEM_ORDER_ROOT_ID, PRIORITY_LABEL };
