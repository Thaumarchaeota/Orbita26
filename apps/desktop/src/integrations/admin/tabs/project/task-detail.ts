import {
  productivityCommitActionArrangement, productivityCreateAction, productivityDeleteAction,
  productivityEndAction, productivityGetBusinessTimeZone, productivityGetProject,
  productivityListActions, productivityListSessions, productivityPauseAction,
  productivityReopenAction, productivityResumeAction, productivitySetTaskStatusGuarded,
  productivityStartAction, productivityUpdateAction, productivityUpdateTask,
} from "../../../productivity/client";
import type { ActionSnapshot, ProjectSnapshot, RevisionRef, SessionSnapshot } from "../../../productivity/types";
import { mountArrangementDetail, type DetailSelection } from "../task/arrangement-detail";
import { instantForWall, targets, type BusinessZone } from "../task/arrangement-model";
export type ProjectDetailNavigation = { taskId: string | null; selection: DetailSelection; focusActionId: string | null };

export type ProjectTaskDetailOptions = {
  host: HTMLElement;
  getProject: () => ProjectSnapshot | null;
  getDataDir: () => string;
  isLive: () => boolean;
  onProjectChange: (project: ProjectSnapshot) => void;
  onError: (message: string) => void;
  onDirty?: () => void;
  onNavigate?: (state: ProjectDetailNavigation) => void;
  runWrite?: <T>(job: () => Promise<T>) => Promise<T>;
  lifecycle?: (taskId: string, outcome: "complete" | "cancel") => Promise<void>;
};

const ref = (value: { id: string; revision: number }): RevisionRef => ({ id: value.id, expectedRevision: value.revision });

/** Project business callbacks around the same detail renderer used by the weekly view. */
export function mountProjectTaskDetail(opts: ProjectTaskDetailOptions) {
  const dataDir = opts.getDataDir();
  let disposed = false;
  let selection: DetailSelection = null;
  let selectedTaskId: string | null = null;
  let navigationFocusActionId: string | null = null;
  let project: ProjectSnapshot | null = null;
  let actions: ActionSnapshot[] = [];
  let sessions: SessionSnapshot[] = [];
  let zone: BusinessZone | null = null;
  let loadEpoch = 0;
  let loadedProjectId: string | null = null;
  let pending = 0;
  let writeQueue: Promise<unknown> = Promise.resolve();
  let detail: ReturnType<typeof mountArrangementDetail> | null = null;
  const events = new AbortController();
  const editorWaiters = new Set<() => void>();
  opts.host.classList.add("arrangement-detail-rail");

  const live = () => !disposed && opts.isLive() && opts.getDataDir() === dataDir;
  function assertLive(expected: ProjectSnapshot): void {
    const current = opts.getProject();
    if (!live() || !current || current.deletedAtUtc || current.id !== expected.id) throw new Error("项目已删除或数据目录已切换，请重新选择任务");
    if (current.revision !== expected.revision) throw new Error("项目已变化，请刷新后重试");
  }
  function isDirty(): boolean {
    return pending > 0 || !!opts.host.querySelector(".is-failed, [data-retry]")
      || (opts.host.contains(document.activeElement) && document.activeElement?.matches("input, textarea, [contenteditable=true]") === true);
  }
  const notifyDirty = () => { queueMicrotask(() => { if (!disposed) opts.onDirty?.(); }); };
  const hasFocusedEditor = () => opts.host.contains(document.activeElement) && document.activeElement?.matches("input, textarea, [contenteditable=true]") === true;
  function waitForEditor(): Promise<void> {
    if (!live() || !hasFocusedEditor()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (live() && hasFocusedEditor()) return;
        opts.host.removeEventListener("focusout", onBlur);
        editorWaiters.delete(check); resolve();
      };
      const onBlur = () => queueMicrotask(check);
      editorWaiters.add(check);
      opts.host.addEventListener("focusout", onBlur);
    });
  }
  const draftObserver = new MutationObserver(notifyDirty);
  draftObserver.observe(opts.host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  for (const name of ["input", "focusin", "focusout", "click", "change"]) opts.host.addEventListener(name, notifyDirty, { signal: events.signal });

  function ownTask(expected: ProjectSnapshot, taskId: string) {
    const task = expected.tasks.find((candidate) => candidate.id === taskId && !candidate.deletedAtUtc);
    if (!task) throw new Error("任务已不可用");
    return task;
  }
  function ownAction(id: string): ActionSnapshot {
    const action = actions.find((candidate) => candidate.id === id && !candidate.deletedAtUtc);
    if (!action || action.targetKind !== "task" || !project?.tasks.some((task) => task.id === action.targetId && !task.deletedAtUtc)) throw new Error("安排已变化，请刷新后重试");
    return action;
  }

  async function readDetail(expected: ProjectSnapshot, epoch: number): Promise<boolean> {
    const [actionResult, sessionResult, businessZone] = await Promise.all([
      productivityListActions(dataDir), productivityListSessions(), productivityGetBusinessTimeZone(),
    ]);
    const current = opts.getProject();
    if (!live() || epoch !== loadEpoch || current?.deletedAtUtc || current?.id !== expected.id || current.revision !== expected.revision) return false;
    actions = actionResult.actions;
    sessions = sessionResult.sessions;
    zone = businessZone;
    loadedProjectId = expected.id;
    return true;
  }

  async function refresh(): Promise<void> {
    const current = opts.getProject();
    if (!live() || !current || current.deletedAtUtc) return;
    const epoch = ++loadEpoch;
    try {
      if (await readDetail(current, epoch)) render();
      else if (live() && epoch === loadEpoch && !opts.getProject()?.deletedAtUtc && opts.getProject()?.id === current.id) void refresh();
    } catch (error) {
      if (live() && epoch === loadEpoch) opts.onError(`读取任务安排失败：${String(error)}`);
    }
  }

  async function canonical(expected: ProjectSnapshot): Promise<void> {
    const epoch = ++loadEpoch;
    const result = await productivityGetProject({ id: expected.id, expectedDataDir: dataDir });
    const current = opts.getProject();
    if (!live() || current?.id !== expected.id || epoch !== loadEpoch) return;
    // Another project writer may have delivered a newer canonical snapshot while this read was pending.
    if (current.revision > result.project.revision) return;
    project = result.project;
    opts.onProjectChange(result.project);
    await readDetail(result.project, epoch);
  }

  function write(job: (expected: ProjectSnapshot) => Promise<unknown>): Promise<void> {
    const expected = project;
    if (!expected) return Promise.reject(new Error("请先选择任务"));
    pending += 1;
    notifyDirty();
    const run = async () => {
      // Keep the original write baseline (docs/adr/0027-productivity-aggregate-and-ui-readiness.md).
      try {
        assertLive(expected);
        await job(expected);
        await canonical(expected);
        // Shared save callbacks redraw after resolving; wait until a newly opened editor commits first.
        await waitForEditor();
        // Creation and execution callbacks do not redraw themselves, unlike field-save callbacks.
        // Publish the freshly read canonical Action list without waiting for another task click.
        if (live()) detail?.render();
      } catch (error) {
        // Refresh the baseline for an explicit retry; the shared renderer retains its field draft.
        try { if (live()) await canonical(expected); } catch { /* Keep the original write failure visible. */ }
        await waitForEditor();
        throw error;
      }
    };
    const queued = writeQueue.then(() => opts.runWrite ? opts.runWrite(run) : run());
    writeQueue = queued.catch(() => {});
    return queued.finally(() => { pending -= 1; notifyDirty(); });
  }

  function mountDetail(): void {
    detail = mountArrangementDetail({
      host: opts.host,
      getData: () => ({ actions, sessions, items: [], projects: project ? [project] : [], lists: [], itemTypes: [], tags: [], targets: targets([], project ? [project] : [], []), zone: zone! }),
      getSelection: () => selection,
      week: () => false,
      onSelect: (next, focusActionId) => {
        if (opts.onNavigate) { opts.onNavigate({ taskId: next?.kind === "task" ? next.id : selectedTaskId, selection: next, focusActionId: focusActionId ?? null }); return; }
        selection = next;
        if (next?.kind === "task") selectedTaskId = next.id;
        detail?.render();
        if (focusActionId) detail?.focusAction(focusActionId);
      },
      onSaveItem: (id, field, value) => write(async (expected) => {
        ownTask(expected, id);
        await productivityUpdateTask({ expectedDataDir: dataDir, project: ref(expected), taskId: id, patch: { [field]: value } });
      }),
      onSaveThingChoice: (kind, id, field, value) => write(async (expected) => {
        if (kind !== "task" || field !== "status" || typeof value !== "string") throw new Error("项目任务不支持该字段");
        ownTask(expected, id);
        await productivitySetTaskStatusGuarded({ expectedDataDir: dataDir, project: ref(expected), taskId: id, status: value });
      }),
      onSaveAction: async (id, field, value) => {
        const action = ownAction(id);
        const capturedSessions = sessions;
        const capturedActions = actions;
        const capturedZone = zone!;
        return write(async (expected) => {
          if (field === "plan" && value !== null) {
            const plan = value as { start: string; end: string };
            const parse = (text: string) => /(?:Z|[+-]\d\d:\d\d)$/.test(text) ? Date.parse(text) : instantForWall(text.slice(0, 10), Number(text.slice(11, 13)) * 60 + Number(text.slice(14, 16)), capturedZone);
            const start = parse(plan.start); const end = parse(plan.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("结束时间须晚于开始时间");
            const session = action.sessionId ? capturedSessions.find((entry) => entry.id === action.sessionId) : null;
            if (action.sessionId && !session) throw new Error("工作时间已变化，请刷新后重试");
            if (session && (start < Date.parse(session.plannedStartAt) || end > Date.parse(session.plannedEndAt))) throw new Error("安排时间须位于所属工作时间内");
            const members = session ? capturedActions.filter((entry) => entry.sessionId === session.id && !entry.deletedAtUtc).map(ref) : [];
            await productivityCommitActionArrangement({ expectedDataDir: dataDir, action: ref(action), targetOwningRoot: ref(expected), currentSession: session ? ref(session) : null, currentSessionMembers: members, nextSession: session ? ref(session) : null, nextSessionMembers: members, plannedStartAt: new Date(start).toISOString(), plannedEndAt: new Date(end).toISOString() });
          } else {
            if (field === "plan" && action.sessionId) throw new Error("请先将安排移出工作时间后清除计划");
            await productivityUpdateAction({ expectedDataDir: dataDir, action: ref(action), patch: field === "plan" ? { plannedStartAt: null, plannedEndAt: null }
              : field === "link" ? { nameLinkMode: action.nameLinkMode === "unlinked" ? "manually-linked" : "unlinked" }
              : field === "title" ? { title: value as string, ...(action.nameLinkMode === "initial-linked" ? { nameLinkMode: "unlinked" as const } : {}) }
              : { summary: value as string } });
          }
        });
      },
      onCreateAction: (kind, id) => write(async (expected) => {
        if (kind !== "task") throw new Error("请选择项目任务");
        ownTask(expected, id);
        const count = actions.filter((action) => action.targetKind === kind && action.targetId === id).length;
        const result = await productivityCreateAction({ expectedDataDir: dataDir, title: `安排 ${count + 1}`, nameLinkMode: "initial-linked", targetKind: "task", targetId: id });
        if (live() && selectedTaskId === id) selection = { kind: "action", id: result.action.id };
      }),
      onExecute: async (id, command) => {
        const action = ownAction(id);
        const commands = { start: productivityStartAction, pause: productivityPauseAction, resume: productivityResumeAction, end: productivityEndAction, reopen: productivityReopenAction };
        return write(async () => { await commands[command]({ expectedDataDir: dataDir, action: ref(action) }); });
      },
      onDelete: async (kind, id) => {
        if (kind !== "action") return Promise.reject(new Error("请在周视图编辑工作时间"));
        const action = ownAction(id);
        return write(async () => {
          await productivityDeleteAction({ expectedDataDir: dataDir, action: ref(action) });
          if (selection?.kind === "action" && selection.id === id && action.targetId) selection = { kind: "task", id: action.targetId };
        });
      },
      onSaveSession: async () => { throw new Error("请在周视图编辑工作时间"); },
      onLifecycle: async (kind, id, outcome) => {
        const expected = project;
        if (kind !== "task" || !expected || !opts.lifecycle) throw new Error("任务状态操作不可用");
        assertLive(expected);
        await opts.lifecycle(id, outcome);
        if (live()) await refresh();
      },
      onError: (message) => { if (live()) { opts.onError(message); notifyDirty(); } },
    });
  }

  function render(): void {
    if (!live()) return;
    const current = opts.getProject();
    if (!current || !selectedTaskId) {
      detail?.dispose(); detail = null; project = current;
      opts.host.hidden = false;
      opts.host.innerHTML = '<div class="arrangement-detail-empty">选择任务以查看或编辑</div>';
      return;
    }
    if (current.deletedAtUtc) return;
    if (!current.tasks.some((task) => task.id === selectedTaskId && !task.deletedAtUtc)) {
      detail?.dispose(); detail = null; project = current;
      selectedTaskId = null; selection = null;
      opts.host.innerHTML = '<div class="arrangement-detail-empty">任务已不可用，请重新选择</div>';
      notifyDirty();
      return;
    }
    opts.host.hidden = false;
    if (project?.id !== current.id) {
      detail?.dispose(); detail = null; loadedProjectId = null;
    }
    if (!isDirty()) project = current;
    if (!project || !zone || loadedProjectId !== current.id) {
      if (!detail) opts.host.innerHTML = '<div class="arrangement-detail-empty">正在读取任务…</div>';
      return;
    }
    if (!detail) mountDetail();
    if (!isDirty()) detail?.render();
  }

  function select(taskId: string | null): boolean {
    if (selectedTaskId === taskId) { render(); return true; }
    if (isDirty()) { opts.onError("请先完成或放弃右侧未保存的修改"); return false; }
    selectedTaskId = taskId;
    selection = taskId ? { kind: "task", id: taskId } : null;
    render();
    if (taskId && loadedProjectId !== opts.getProject()?.id) void refresh();
    return true;
  }

  return { select, render, refresh, isDirty, hasPendingWrites: () => pending > 0,
    captureNavigation: (): ProjectDetailNavigation => ({ taskId: selectedTaskId, selection: selection ? { ...selection } : null, focusActionId: navigationFocusActionId }),
    async prepareNavigation(expected: ProjectSnapshot, state: ProjectDetailNavigation): Promise<boolean> {
      const epoch = ++loadEpoch;
      if (!(await readDetail(expected, epoch))) return false;
      const selected = state.selection;
      return !selected || (selected.kind === "task" ? expected.tasks.some((task) => task.id === selected.id && !task.deletedAtUtc)
        : selected.kind === "action" ? actions.some((action) => action.id === selected.id && !action.deletedAtUtc)
        : selected.kind === "session" ? sessions.some((session) => session.id === selected.id && !session.deletedAtUtc) : false);
    },
    restoreNavigation(state: ProjectDetailNavigation) {
      selectedTaskId = state.taskId; selection = state.selection; navigationFocusActionId = state.focusActionId;
      render(); if (state.focusActionId) detail?.focusAction(state.focusActionId);
    },
    dispose() {
    disposed = true; loadEpoch += 1; events.abort(); draftObserver.disconnect(); detail?.dispose(); detail = null;
    for (const release of editorWaiters) release();
    opts.host.classList.remove("arrangement-detail-rail");
  } };
}
