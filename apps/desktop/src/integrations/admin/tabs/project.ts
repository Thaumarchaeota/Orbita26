import {
  productivityCreateTask,
  productivityGetProject,
  productivityListActions,
  productivityMoveTaskWithinProject,
  productivityUpdateAction,
} from "../../productivity/client";
import type { ActionSnapshot, ProjectSnapshot, TaskSnapshot } from "../../productivity/types";
import { getDirtyStatus, setDirtyStatus } from "../tab-host/dirty";
import type { InsightDestination, InsightDestinationHandle, InsightHostContext } from "../types";
import { createProjectRail } from "./project-rail";
import { projectPageDestination } from "./project/project-page";
import {
  invokeErrorText,
  isRevisionConflict,
  mountActionExecButtons,
} from "./item-compose";
import "./item-compose.css";

type ProjectState = { projectId?: string };

type TreeNode = { task: TaskSnapshot; depth: number; children: TreeNode[] };

function liveTasks(project: ProjectSnapshot): TaskSnapshot[] {
  return project.tasks.filter((t) => !t.deletedAtUtc);
}

function buildTree(tasks: TaskSnapshot[]): TreeNode[] {
  const byParent = new Map<string | null, TaskSnapshot[]>();
  for (const t of tasks) {
    const pid = t.parentTaskId ?? null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(t);
  }
  const walk = (parentId: string | null, depth: number): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((task) => ({
      task,
      depth,
      children: walk(task.id, depth + 1),
    }));
  return walk(null, 0);
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function siblingIds(tasks: TaskSnapshot[], parentId: string | null, exceptId?: string): string[] {
  return tasks
    .filter((t) => (t.parentTaskId ?? null) === parentId && t.id !== exceptId)
    .map((t) => t.id);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const legacyProjectDestination: InsightDestination = {
  id: "project",
  kind: "workspace",
  label: "项目",
  icon: "work",
  showInNav: false,
  mount(root, ctx: InsightHostContext) {
    const projectRail = createProjectRail(ctx);
    let projectId: string | null = null;
    let project: ProjectSnapshot | null = null;
    let actions: ActionSnapshot[] = [];
    let selectedTaskId: string | null = null;
    let isDeleted = false;
    let disposed = false;
    let dragTaskId: string | null = null;
    let dropMode: "before" | "child" | null = null;
    let dropTargetId: string | null = null;

    root.innerHTML = `
      <div class="insight-chat-page insight-project-tab">
        <aside class="insight-chat-rail"></aside>
        <div class="insight-chat-main">
          <div class="admin-placeholder-hint insight-project-placeholder">待设计</div>
          <div class="project-page" hidden>
        <h1 class="project-page-title" data-region="title">项目</h1>
        <p class="admin-placeholder-hint project-deleted-msg" data-region="deleted-msg" hidden>此项目已删除，标签页为只读。</p>
        <div class="project-tree" data-region="tasks"></div>
        <div class="project-task-actions" data-region="task-actions" hidden></div>
        <form class="project-create-row" data-region="create-form">
          <input type="text" placeholder="新建任务" data-region="task-input" autocomplete="off">
          <button type="submit">添加</button>
        </form>
        <p class="admin-placeholder-hint" data-region="error" hidden></p>
          </div>
        </div>
      </div>`;

    const titleEl = root.querySelector<HTMLElement>('[data-region="title"]')!;
    const deletedMsgEl = root.querySelector<HTMLElement>('[data-region="deleted-msg"]')!;
    const tasksEl = root.querySelector<HTMLElement>('[data-region="tasks"]')!;
    const actionsEl = root.querySelector<HTMLElement>('[data-region="task-actions"]')!;
    const form = root.querySelector<HTMLFormElement>('[data-region="create-form"]')!;
    const input = root.querySelector<HTMLInputElement>('[data-region="task-input"]')!;
    const errorEl = root.querySelector<HTMLElement>('[data-region="error"]')!;

    function setError(msg: string): void {
      errorEl.hidden = !msg;
      errorEl.textContent = msg;
    }

    function syncDirtyFromInput(): void {
      const key = root.dataset.surface;
      if (!key) return;
      if (isDeleted) {
        setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
        return;
      }
      const prev = getDirtyStatus(key);
      setDirtyStatus(key, { ...prev, dirty: input.value.trim().length > 0 });
    }

    function updateFormVisibility(): void {
      const readonly = isDeleted || !project;
      form.hidden = readonly;
      deletedMsgEl.hidden = !isDeleted;
      input.disabled = readonly;
      form.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = readonly;
    }

    function taskActions(taskId: string): ActionSnapshot[] {
      return actions.filter((a) => !a.deletedAtUtc && a.targetKind === "task" && a.targetId === taskId);
    }

    function renderTaskActions(): void {
      if (!selectedTaskId || !project) {
        actionsEl.hidden = true;
        return;
      }
      const task = project.tasks.find((t) => t.id === selectedTaskId);
      if (!task) {
        actionsEl.hidden = true;
        return;
      }
      actionsEl.hidden = false;
      const related = taskActions(selectedTaskId);
      actionsEl.innerHTML = `
        <h2 class="admin-section-title">${escapeHtml(task.title)} · 安排</h2>
        <div data-region="action-list"></div>`;
      const listEl = actionsEl.querySelector<HTMLElement>('[data-region="action-list"]')!;
      if (!related.length) {
        listEl.innerHTML = `<p class="admin-placeholder-hint">暂无安排</p>`;
        return;
      }
      for (const action of related) {
        const row = document.createElement("div");
        row.className = "item-compose-action-row";
        if (action.executionState === "进行中") row.classList.add("is-running");
        if (action.executionState === "暂停") row.classList.add("is-paused");
        row.innerHTML = `
          <div class="item-compose-action-head">
            <input type="text" data-field="title" value="${escapeHtml(action.title)}">
          </div>
          <div class="item-compose-plan-row">
            <input type="datetime-local" data-field="start" value="${action.plannedStartAt ? toLocalInput(action.plannedStartAt) : ""}">
            <input type="datetime-local" data-field="end" value="${action.plannedEndAt ? toLocalInput(action.plannedEndAt) : ""}">
            <button type="button" class="dialog-btn" data-action="save-plan">保存计划</button>
          </div>
          <div class="item-compose-exec" data-region="exec"></div>`;
        const titleInput = row.querySelector<HTMLInputElement>('[data-field="title"]')!;
        const startInput = row.querySelector<HTMLInputElement>('[data-field="start"]')!;
        const endInput = row.querySelector<HTMLInputElement>('[data-field="end"]')!;
        const locked = action.intervals.length > 0;
        if (locked) {
          startInput.disabled = true;
          endInput.disabled = true;
        }
        row.querySelector<HTMLButtonElement>('[data-action="save-plan"]')?.addEventListener("click", () => {
          void saveActionPlan(action, titleInput.value, startInput.value, endInput.value);
        });
        mountActionExecButtons(
          row.querySelector<HTMLElement>('[data-region="exec"]')!,
          { kind: "saved", action, baseline: action },
          () => {
            const start = startInput.value ? fromLocalInput(startInput.value) : "";
            const end = endInput.value ? fromLocalInput(endInput.value) : "";
            return start !== (action.plannedStartAt ?? "") || end !== (action.plannedEndAt ?? "");
          },
          (updated) => {
            actions = actions.map((a) => (a.id === updated.id ? updated : a));
            renderTaskActions();
          },
          setError,
        );
        listEl.appendChild(row);
      }
    }

    function toLocalInput(iso: string): string {
      const d = new Date(iso);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function fromLocalInput(value: string): string {
      return new Date(value).toISOString();
    }

    async function saveActionPlan(
      action: ActionSnapshot,
      title: string,
      startLocal: string,
      endLocal: string,
    ): Promise<void> {
      return;
      if (action.intervals.length > 0) return;
      try {
        const res = await productivityUpdateAction({
          action: { id: action.id, expectedRevision: action.revision },
          patch: {
            title: title.trim() || action.title,
            plannedStartAt: startLocal ? fromLocalInput(startLocal) : null,
            plannedEndAt: endLocal ? fromLocalInput(endLocal) : null,
          },
        });
        actions = actions.map((a) => (a.id === res.action.id ? res.action : a));
        renderTaskActions();
        setError("");
      } catch (err) {
        if (isRevisionConflict(err)) {
          setError("任务内容已变化");
          await loadProject();
        } else {
          setError(invokeErrorText(err));
        }
      }
    }

    function renderTasks(): void {
      if (isDeleted || !project) {
        tasksEl.innerHTML = `<p class="admin-placeholder-hint">${isDeleted ? "暂无任务" : "选择或创建项目"}</p>`;
        return;
      }
      const tree = buildTree(liveTasks(project));
      const flat = flattenTree(tree);
      if (!flat.length) {
        tasksEl.innerHTML = `<p class="admin-placeholder-hint">暂无任务</p>`;
        return;
      }
      tasksEl.innerHTML = flat
        .map(({ task, depth }) => {
          const cls = [
            "project-tree-row",
            selectedTaskId === task.id ? "is-selected" : "",
            dropMode === "before" && dropTargetId === task.id ? "is-drop-before" : "",
            dropMode === "child" && dropTargetId === task.id ? "is-drop-child" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<div class="${cls}" draggable="true" data-task-id="${escapeHtml(task.id)}" style="padding-left:${12 + depth * 16}px">${escapeHtml(task.title)}</div>`;
        })
        .join("");
    }

    async function loadProject(): Promise<void> {
      if (!projectId) {
        project = null;
        isDeleted = false;
        titleEl.textContent = "项目";
        updateFormVisibility();
        renderTasks();
        renderTaskActions();
        return;
      }
      try {
        const [pRes, aRes] = await Promise.all([
          productivityGetProject({ id: projectId }),
          productivityListActions(),
        ]);
        if (disposed) return;
        actions = aRes.actions;
        const p = pRes.project;
        if (p.deletedAtUtc) {
          isDeleted = true;
          project = null;
          titleEl.textContent = `${p.title}（已删除）`;
        } else {
          isDeleted = false;
          project = p;
          titleEl.textContent = p.title;
        }
        const key = root.dataset.surface;
        if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
        input.value = "";
        updateFormVisibility();
        renderTasks();
        renderTaskActions();
        setError("");
      } catch {
        if (disposed) return;
        isDeleted = true;
        project = null;
        titleEl.textContent = "项目（已删除）";
        updateFormVisibility();
        renderTasks();
        renderTaskActions();
      }
    }

    async function moveTask(
      taskId: string,
      parentTaskId: string | null,
      insertIndex: number,
    ): Promise<void> {
      return;
      if (!project) return;
      const tasks = liveTasks(project!);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const expectedSiblings = siblingIds(tasks, parentTaskId, taskId);
      try {
        const res = await productivityMoveTaskWithinProject({
          project: { id: project!.id, expectedRevision: project!.revision },
          taskId,
          parentTaskId,
          insertIndex,
          expectedSiblings,
        });
        project = res.project;
        renderTasks();
        setError("");
      } catch (err) {
        if (isRevisionConflict(err)) {
          setError("任务内容已变化");
          await loadProject();
        } else {
          setError(invokeErrorText(err));
        }
      }
    }

    input.addEventListener("input", () => syncDirtyFromInput());

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      return;
      const title = input.value.trim();
      if (!title || !project || isDeleted) return;
      const key = root.dataset.surface;
      if (!key) return;
      setDirtyStatus(key!, { dirty: true, inFlight: true, failed: false });
      try {
        const res = await productivityCreateTask({
          project: { id: project!.id, expectedRevision: project!.revision },
          title,
          status: "未做",
        });
        if (disposed) return;
        project = res.project;
        input.value = "";
        setDirtyStatus(key!, { dirty: false, inFlight: false, failed: false });
        renderTasks();
      } catch {
        if (disposed) return;
        setDirtyStatus(key!, { dirty: true, inFlight: false, failed: true });
      }
    });

    tasksEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".project-tree-row");
      if (!row?.dataset.taskId) return;
      selectedTaskId = row.dataset.taskId;
      renderTasks();
      renderTaskActions();
    });

    tasksEl.addEventListener("dragstart", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".project-tree-row");
      if (!row?.dataset.taskId) return;
      dragTaskId = row.dataset.taskId;
      e.dataTransfer?.setData("text/plain", dragTaskId);
    });

    tasksEl.addEventListener("dragend", () => {
      dragTaskId = null;
      dropMode = null;
      dropTargetId = null;
      renderTasks();
    });

    tasksEl.addEventListener("dragover", (e) => {
      if (!dragTaskId || !project) return;
      e.preventDefault();
      const row = (e.target as HTMLElement).closest<HTMLElement>(".project-tree-row");
      if (!row?.dataset.taskId || row.dataset.taskId === dragTaskId) return;
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      dropTargetId = row.dataset.taskId;
      dropMode = y > rect.height * 0.65 ? "child" : "before";
      renderTasks();
    });

    tasksEl.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragTaskId || !dropTargetId || !dropMode || !project) return;
      const tasks = liveTasks(project);
      const target = tasks.find((t) => t.id === dropTargetId);
      if (!target) return;
      if (dropMode === "child") {
        const childCount = tasks.filter((t) => t.parentTaskId === target.id && t.id !== dragTaskId).length;
        void moveTask(dragTaskId, target.id, childCount);
      } else {
        const parentId = target.parentTaskId ?? null;
        const siblings = tasks.filter((t) => (t.parentTaskId ?? null) === parentId && t.id !== dragTaskId);
        const idx = siblings.findIndex((t) => t.id === dropTargetId);
        void moveTask(dragTaskId, parentId, Math.max(0, idx));
      }
      dragTaskId = null;
      dropMode = null;
      dropTargetId = null;
    });

    const handle: InsightDestinationHandle = {
      activate() {
        if (projectId) projectRail.setSelectedProject(projectId);
      },
      deactivate() {},
      getSecondaryRailDescriptor: () => projectRail.getSecondaryRailDescriptor(),
      getRestoreState() {
        return projectId ? { projectId } : undefined;
      },
      restoreState(state: unknown) {
        const s = state as ProjectState;
        projectId = s?.projectId ?? null;
        if (projectId) projectRail.setSelectedProject(projectId);
      },
      dispose() {
        disposed = true;
        projectRail.dispose();
        const key = root.dataset.surface;
        if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
        root.innerHTML = "";
      },
    };

    return handle;
  },
};
void legacyProjectDestination;

/** The Project surface is implemented by the private three-layer page module. */
export const projectDestination: InsightDestination = projectPageDestination;
