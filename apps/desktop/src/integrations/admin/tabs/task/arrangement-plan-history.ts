import {
  productivityCommitActionArrangement, productivityCommitSessionBoundary, productivityCommitCheckpointArrangement,
  productivityRestoreActionArrangementState, productivityRestoreSessionBoundaryState,
  productivityMutateHealthPlan, productivityListWeekHealth,
} from "../../../productivity/client";
import type {
  ActionSnapshot, ActionArrangementState, CheckpointSnapshot, CommitActionArrangementRequest,
  CommitSessionBoundaryRequest, CommitCheckpointArrangementRequest, HealthPlanSnapshot,
  ItemSnapshot, ListSnapshot, ProjectSnapshot, SessionSnapshot, SessionBoundaryState,
} from "../../../productivity/types";
import { ArrangementCommitUncertain, type ArrangementHistory, type ArrangementHistoryOperation, type ArrangementReplayResult } from "./arrangement-history";

export type ArrangementPlanGraph = { actions: ActionSnapshot[]; checkpoints: CheckpointSnapshot[]; sessions: SessionSnapshot[]; items: ItemSnapshot[]; projects: ProjectSnapshot[]; lists: ListSnapshot[] };
type Dependencies = { actions: string[]; checkpoints: string[]; sessions: string[] };
type Options = {
  history: ArrangementHistory;
  snapshot: () => ArrangementPlanGraph;
  read: () => Promise<ArrangementPlanGraph>;
  isCurrent: () => boolean;
  install: (changes: { actions?: ActionSnapshot[]; checkpoints?: CheckpointSnapshot[]; sessions?: SessionSnapshot[]; items?: ItemSnapshot[]; health?: HealthPlanSnapshot }) => void;
  refresh: () => Promise<void>;
  report: (message: string) => void;
};
const ref = (value: { id: string; revision: number }) => ({ id: value.id, expectedRevision: value.revision });
const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((id): id is string => !!id))].sort();
export const actionArrangementState = (a: ActionSnapshot): ActionArrangementState => ({ plannedStartAt: a.plannedStartAt ?? null, plannedEndAt: a.plannedEndAt ?? null, plannedDuration: a.plannedDuration ?? null, sessionId: a.sessionId ?? null });
const sessionState = (s: SessionSnapshot): SessionBoundaryState => ({ plannedStartAt: s.plannedStartAt, plannedEndAt: s.plannedEndAt });
const checkpointState = (c: CheckpointSnapshot) => ({ plannedAtUtc: c.plannedAtUtc, sessionId: c.sessionId });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const actionAt = (g: ArrangementPlanGraph, id: string) => { const a = g.actions.find((v) => v.id === id); if (!a) throw new Error("安排已不存在，不能撤销。"); return a; };
const sessionAt = (g: ArrangementPlanGraph, id: string) => { const s = g.sessions.find((v) => v.id === id); if (!s) throw new Error("工作时间已不存在，不能撤销。"); return s; };
const checkpointAt = (g: ArrangementPlanGraph, id: string) => { const c = g.checkpoints.find((v) => v.id === id); if (!c) throw new Error("检查点已不存在，不能撤销。"); return c; };
const members = (g: ArrangementPlanGraph, id: string | null | undefined) => id ? g.actions.filter((v) => v.sessionId === id && !v.deletedAtUtc).map(ref) : [];
const points = (g: ArrangementPlanGraph, id: string | null | undefined) => id ? g.checkpoints.filter((v) => v.sessionId === id && !v.deletedAtUtc).map(ref) : [];
function owningRoot(g: ArrangementPlanGraph, target: { targetKind?: string | null; targetId?: string | null }) {
  if (!target.targetKind && !target.targetId) return null;
  const root = target.targetKind === "item" ? g.items.find((v) => v.id === target.targetId)
    : target.targetKind === "project" ? g.projects.find((v) => v.id === target.targetId)
    : g.projects.find((v) => v.tasks.some((task) => task.id === target.targetId));
  if (!root) throw new Error("关联事情已不可用，不能撤销。");
  return root;
}
function targetGuard(g: ArrangementPlanGraph, target: { targetKind?: string | null; targetId?: string | null }) {
  const root = owningRoot(g, target);
  const task = target.targetKind === "task" && root && "tasks" in root ? root.tasks.find((t) => t.id === target.targetId) : null;
  const list = root && "listId" in root && root.listId ? g.lists.find((v) => v.id === root.listId) : null;
  return { kind: target.targetKind ?? null, id: target.targetId ?? null, root: root ? { id: root.id, status: root.status, deleted: root.deletedAtUtc ?? null } : null,
    task: task ? { id: task.id, parent: task.parentTaskId ?? null, status: task.status, deleted: task.deletedAtUtc ?? null } : null,
    list: list ? { id: list.id, status: list.status, deleted: list.deletedAtUtc ?? null } : null };
}
function dependencies(g: ArrangementPlanGraph, actionIds: string[], checkpointIds: string[], sessionIds: (string | null | undefined)[]): Dependencies {
  const sessions = unique(sessionIds);
  return { sessions, actions: unique([...actionIds, ...g.actions.filter((v) => sessions.includes(v.sessionId ?? "") && !v.deletedAtUtc).map((v) => v.id)]),
    checkpoints: unique([...checkpointIds, ...g.checkpoints.filter((v) => sessions.includes(v.sessionId ?? "") && !v.deletedAtUtc).map((v) => v.id)]) };
}

/** Revisions are rebuilt only after checking the entire dependent effect; unrelated text is preserved. */
export function planDependencyFingerprint(g: ArrangementPlanGraph, dep: Dependencies): string {
  return JSON.stringify({
    actions: dep.actions.map((id) => { const a = actionAt(g, id); return { id, plan: actionArrangementState(a), deleted: a.deletedAtUtc ?? null,
      ended: a.ended, execution: a.executionState, intervals: a.intervals.map((v) => ({ id: v.id, start: v.startedAt, end: v.endedAt ?? null, deleted: v.deletedAtUtc ?? null })), target: targetGuard(g, a) }; }),
    checkpoints: dep.checkpoints.map((id) => { const c = checkpointAt(g, id); return { id, plan: checkpointState(c), actual: c.actualAtUtc, completed: c.completed, deleted: c.deletedAtUtc, target: targetGuard(g, c) }; }),
    sessions: dep.sessions.map((id) => { const s = sessionAt(g, id); return { id, plan: sessionState(s), actual: s.actualRange, deleted: s.deletedAtUtc ?? null,
      actions: members(g, id).map((v) => v.id).sort(), checkpoints: points(g, id).map((v) => v.id).sort() }; }),
  });
}

// COMMIT failures also use ARCHIVE_LIFECYCLE_ERROR; that code cannot prove rollback (SPEC-0015 §5).
const domainRejectionCodes = new Set(("REVISION_CONFLICT ROOT_NOT_FOUND ROOT_DELETED UNKNOWN_FIELD_WRITE_BLOCKED INVALID_PATCH INVALID_STATUS INVALID_TIME_VALUE ACTION_EXECUTION_STATE_INVALID ACTIVE_ACTION_BLOCKS_THING TARGET_NOT_STARTABLE SESSION_INTERVAL_CONFLICT ACTION_OUTSIDE_SESSION TREE_CYCLE CROSS_PROJECT_MOVE_FORBIDDEN DELETE_BATCH_MISMATCH ARCHIVED_LIST_READONLY CLASSIFICATION_INACTIVE REFERENCE_BLOCKS_PURGE TASK_SEQUENCE_CYCLE TASK_SEQUENCE_DUPLICATE TASK_SEQUENCE_ENDPOINT_INVALID TASK_MOVE_HAS_SEQUENCE_EDGES TASK_PARENT_INVALID TASK_COORDINATE_INVALID TASK_RESTORE_PARENT_DELETED TASK_PENDING_CHECKPOINT_BLOCKS_STATUS TASK_SIBLING_SET_MISMATCH ARCHIVE_BUSY").split(" "));
function isExplicitRejection(error: unknown): boolean {
  try { const value = typeof error === "string" ? JSON.parse(error) : error; return !!value && typeof value === "object" && domainRejectionCodes.has((value as { code: string }).code); }
  catch { return false; }
}

export function createArrangementPlanHistory(opts: Options) {
  const dir = opts.history.scope.expectedDataDir;
  const assertCurrent = () => { if (!opts.isCurrent()) throw new Error("安排实例或数据目录已变化。"); };
  async function submit<T>(write: () => Promise<T>): Promise<T> {
    assertCurrent();
    try { return await write(); }
    catch (error) {
      if (isExplicitRejection(error)) throw error;
      // No request-receipt query exists for these ordinary commands. Never retry an unknown commit (SPEC-0015 §5).
      throw new ArrangementCommitUncertain("结果待核实。请使用刷新核对并清空撤销历史；不要重复提交本次计划操作。");
    }
  }
  async function refreshCommitted(): Promise<void> {
    if (!opts.isCurrent()) return;
    try { await opts.refresh(); }
    catch (error) { opts.report(`计划已保存，页面刷新失败；撤销记录已保留：${String(error)}`); }
  }
  const graphAfter = (g: ArrangementPlanGraph, changes: Parameters<Options["install"]>[0]): ArrangementPlanGraph => ({ ...g,
    actions: g.actions.map((v) => changes.actions?.find((n) => n.id === v.id) ?? v),
    checkpoints: g.checkpoints.map((v) => changes.checkpoints?.find((n) => n.id === v.id) ?? v),
    sessions: g.sessions.map((v) => changes.sessions?.find((n) => n.id === v.id) ?? v),
    items: g.items.map((v) => changes.items?.find((n) => n.id === v.id) ?? v),
  });
  function operation(label: string, dep: Dependencies, before: ArrangementPlanGraph, after: ArrangementPlanGraph,
    replay: (g: ArrangementPlanGraph, direction: "undo" | "redo") => Promise<Parameters<Options["install"]>[0]>): ArrangementHistoryOperation {
    let beforeEffect = planDependencyFingerprint(before, dep), afterEffect = planDependencyFingerprint(after, dep);
    return { id: crypto.randomUUID(), label, async replay(direction, scope): Promise<ArrangementReplayResult> {
      if (scope.expectedDataDir !== dir || !opts.isCurrent()) return { status: "cancelled" };
      let current: ArrangementPlanGraph;
      try { current = await opts.read(); assertCurrent(); }
      catch (error) { return { status: "failed", message: `无法读取当前计划：${String(error)}` }; }
      if (planDependencyFingerprint(current, dep) !== (direction === "undo" ? afterEffect : beforeEffect)) return { status: "failed", message: "计划、成员或执行状态已变化，本笔不能撤销。可刷新核对后清空撤销历史。" };
      const changes = await replay(current, direction);
      if (!opts.isCurrent()) return { status: "cancelled" };
      const confirmed = graphAfter(current, changes);
      // Each confirmed receipt supplies the next causal endpoint; every request rebuilds nested refs from this verified graph.
      if (direction === "undo") beforeEffect = planDependencyFingerprint(confirmed, dep); else afterEffect = planDependencyFingerprint(confirmed, dep);
      opts.install(changes);
      await refreshCommitted();
      return { status: "committed" };
    } };
  }

  async function action(req: CommitActionArrangementRequest | { clear: string }): Promise<ActionSnapshot> {
    const result = await opts.history.forward(async () => {
      const before = opts.snapshot();
      const id = "clear" in req ? req.clear : req.action.id;
      const old = actionAt(before, id);
      if (!("clear" in req) && old.revision !== req.action.expectedRevision) throw new Error("拖动基线已变化，请重新操作。");
      const previous = actionArrangementState(old);
      const target: ActionArrangementState = "clear" in req ? { ...previous, plannedStartAt: null, plannedEndAt: null } : { plannedStartAt: req.plannedStartAt, plannedEndAt: req.plannedEndAt, plannedDuration: null, sessionId: req.nextSession?.id ?? null };
      if (same(previous, target)) return { status: "noop" as const, value: old };
      const receipt = await submit(() => "clear" in req ? productivityRestoreActionArrangementState({ expectedDataDir: dir, action: ref(old), targetOwningRoot: owningRoot(before, old) ? ref(owningRoot(before, old)!) : null,
        expectedState: previous, targetState: target, currentSession: old.sessionId ? ref(sessionAt(before, old.sessionId)) : null, currentSessionMembers: members(before, old.sessionId),
        nextSession: target.sessionId ? ref(sessionAt(before, target.sessionId)) : null, nextSessionMembers: members(before, target.sessionId) }) : productivityCommitActionArrangement({ ...req, expectedDataDir: dir }));
      const after = graphAfter(before, { actions: [receipt.action] });
      const next = actionArrangementState(receipt.action);
      const dep = dependencies(before, [id], [], [previous.sessionId, next.sessionId]);
      const entry = operation("调整安排计划", dep, before, after, async (g, direction) => {
        const a = actionAt(g, id), expected = actionArrangementState(a), desired = direction === "undo" ? previous : next;
        const root = owningRoot(g, a);
        const restored = await submit(() => productivityRestoreActionArrangementState({ expectedDataDir: dir, action: ref(a), targetOwningRoot: root ? ref(root) : null,
          expectedState: expected, targetState: desired, currentSession: expected.sessionId ? ref(sessionAt(g, expected.sessionId)) : null, currentSessionMembers: members(g, expected.sessionId),
          nextSession: desired.sessionId ? ref(sessionAt(g, desired.sessionId)) : null, nextSessionMembers: members(g, desired.sessionId) }));
        return { actions: [restored.action] };
      });
      opts.install({ actions: [receipt.action] });
      return { status: "committed" as const, value: receipt.action, operation: entry };
    });
    await refreshCommitted(); return result;
  }

  async function session(req: CommitSessionBoundaryRequest): Promise<SessionSnapshot> {
    const result = await opts.history.forward(async () => {
      const before = opts.snapshot(), old = sessionAt(before, req.session.id), previous = sessionState(old);
      if (old.revision !== req.session.expectedRevision) throw new Error("工作时间基线已变化，请重新操作。");
      if (same(previous, { plannedStartAt: req.plannedStartAt, plannedEndAt: req.plannedEndAt })) return { status: "noop" as const, value: old };
      const receipt = await submit(() => productivityCommitSessionBoundary({ ...req, expectedDataDir: dir }));
      const after = graphAfter(before, { sessions: [receipt.session], actions: receipt.actions });
      const next = sessionState(receipt.session), id = old.id;
      const effect = receipt.actions.filter((a) => (actionAt(before, a.id).sessionId ?? null) !== (a.sessionId ?? null)).map((a) => ({ id: a.id, before: actionAt(before, a.id).sessionId ?? null, after: a.sessionId ?? null }));
      const dep = dependencies(before, effect.map((a) => a.id), [], [id]);
      const beforeMembers = members(before, id).map((v) => v.id), afterMembers = members(after, id).map((v) => v.id);
      const beforePoints = points(before, id).map((v) => v.id), afterPoints = points(after, id).map((v) => v.id);
      const entry = operation("调整工作时间", dep, before, after, async (g, direction) => {
        const s = sessionAt(g, id);
        const restored = await submit(() => productivityRestoreSessionBoundaryState({ expectedDataDir: dir, session: ref(s), expectedState: sessionState(s), targetState: direction === "undo" ? previous : next,
          expectedMembers: members(g, id), expectedCheckpoints: points(g, id), targetMemberIds: direction === "undo" ? beforeMembers : afterMembers,
          targetCheckpointIds: direction === "undo" ? beforePoints : afterPoints,
          membershipChanges: effect.map((change) => { const a = actionAt(g, change.id), root = owningRoot(g, a); return { action: ref(a), targetOwningRoot: root ? ref(root) : null,
            expectedSessionId: a.sessionId ?? null, targetSessionId: direction === "undo" ? change.before : change.after }; }) }));
        return { sessions: [restored.session], actions: restored.actions };
      });
      opts.install({ sessions: [receipt.session], actions: receipt.actions });
      return { status: "committed" as const, value: receipt.session, operation: entry };
    });
    await refreshCommitted(); return result;
  }

  async function checkpoint(req: CommitCheckpointArrangementRequest): Promise<CheckpointSnapshot> {
    const result = await opts.history.forward(async () => {
      const before = opts.snapshot(), old = checkpointAt(before, req.checkpoint.id), previous = checkpointState(old), id = old.id;
      if (old.revision !== req.checkpoint.expectedRevision) throw new Error("检查点基线已变化，请重新操作。");
      if (same(previous, { plannedAtUtc: req.plannedAtUtc, sessionId: req.nextSession?.id ?? null })) return { status: "noop" as const, value: old };
      const receipt = await submit(() => productivityCommitCheckpointArrangement({ ...req, expectedDataDir: dir }));
      const after = graphAfter(before, { checkpoints: [receipt.checkpoint] }), next = checkpointState(receipt.checkpoint);
      const dep = dependencies(before, [], [id], [previous.sessionId, next.sessionId]);
      const entry = operation("调整检查点计划", dep, before, after, async (g, direction) => {
        const c = checkpointAt(g, id), desired = direction === "undo" ? previous : next;
        const restored = await submit(() => productivityCommitCheckpointArrangement({ expectedDataDir: dir, checkpoint: ref(c), plannedAtUtc: desired.plannedAtUtc,
          currentSession: c.sessionId ? ref(sessionAt(g, c.sessionId)) : null, nextSession: desired.sessionId ? ref(sessionAt(g, desired.sessionId)) : null,
          expectedCurrentCheckpoints: points(g, c.sessionId), expectedNextCheckpoints: points(g, desired.sessionId) }));
        return { checkpoints: [restored.checkpoint] };
      });
      opts.install({ checkpoints: [receipt.checkpoint] });
      return { status: "committed" as const, value: receipt.checkpoint, operation: entry };
    });
    await refreshCommitted(); return result;
  }

  async function health(plan: HealthPlanSnapshot, start: string, end: string): Promise<HealthPlanSnapshot> {
    const healthEffect = (value: HealthPlanSnapshot) => JSON.stringify({ plan: actionArrangementState(value.action), ended: value.action.ended, execution: value.action.executionState,
      intervals: value.action.intervals.map((i) => [i.id, i.startedAt, i.endedAt ?? null, i.deletedAtUtc ?? null]), actionDeleted: value.action.deletedAtUtc ?? null,
      itemId: value.item.id, actionId: value.action.id, status: value.item.status, deleted: value.item.deletedAtUtc ?? null, detail: value.detail });
    const result = await opts.history.forward(async () => {
      const previous = { start: plan.action.plannedStartAt!, end: plan.action.plannedEndAt! };
      if (same(previous, { start, end })) return { status: "noop" as const, value: plan };
      const receipt = await submit(() => productivityMutateHealthPlan({ expectedDataDir: dir, item: ref(plan.item), action: ref(plan.action), operation: "update", start, end }));
      const next = { start: receipt.action.plannedStartAt!, end: receipt.action.plannedEndAt! };
      let beforeEffect = healthEffect(plan), afterEffect = healthEffect(receipt);
      const itemId = plan.item.id;
      const entry: ArrangementHistoryOperation = { id: crypto.randomUUID(), label: "调整健康计划", async replay(direction) {
        let current: HealthPlanSnapshot | undefined;
        const expectedRange = direction === "undo" ? next : previous;
        try { current = (await productivityListWeekHealth({ expectedDataDir: dir, start: expectedRange.start, end: expectedRange.end })).plans.find((p) => p.item.id === itemId); assertCurrent(); }
        catch (error) { return { status: "failed", message: `健康计划读取失败：${String(error)}` }; }
        if (!current || healthEffect(current) !== (direction === "undo" ? afterEffect : beforeEffect)) return { status: "failed", message: "健康计划、实际关联或执行状态已变化，不能撤销。" };
        const desired = direction === "undo" ? previous : next;
        const restored = await submit(() => productivityMutateHealthPlan({ expectedDataDir: dir, item: ref(current!.item), action: ref(current!.action), operation: "update", ...desired }));
        if (!opts.isCurrent()) return { status: "cancelled" };
        if (direction === "undo") beforeEffect = healthEffect(restored); else afterEffect = healthEffect(restored);
        opts.install({ actions: [restored.action], items: [restored.item], health: restored });
        await refreshCommitted(); return { status: "committed" };
      } };
      opts.install({ actions: [receipt.action], items: [receipt.item], health: receipt });
      return { status: "committed" as const, value: receipt, operation: entry };
    });
    await refreshCommitted(); return result;
  }
  return { action, session, checkpoint, health };
}
