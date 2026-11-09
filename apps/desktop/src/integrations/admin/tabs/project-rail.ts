import { createInsightDialog } from "../../../ui/insight-dialog";
import "./project/project-page.css";
import { mountSelectField, type SelectFieldHandle } from "../../../ui/select-field";
import { escAttr, escHtml } from "../../../core/html";
import { getSettings } from "../../../core/settings";
import {
  productivityCreateProject,
  productivityListProjects,
} from "../../productivity/client";
import type { ProjectSnapshot } from "../../productivity/types";
import { attachIdentityDragSource } from "../tab-host/drag-session";
import { openInsightContentTab } from "../tab-host/host-api";
import type { RailDescriptor } from "../secondary-rail";
import type { InsightHostContext } from "../types";

const PROJECT_STATUSES = ["规划中", "进行中", "已归档", "已完成", "已取消"] as const;

function liveProjects(projects: ProjectSnapshot[]): ProjectSnapshot[] {
  return projects.filter((p) => !p.deletedAtUtc);
}

function openCreateProjectDialog(expectedDataDir: string, canWrite: () => boolean, registerDispose?: (dispose: () => void) => void): Promise<ProjectSnapshot | null> {
  return new Promise((resolve) => {
    let statusSelect: SelectFieldHandle | null = null;
    let selectedStatus = "规划中";
    let settled = false;
    let inFlight = false;
    let resultOnDispose: ProjectSnapshot | null = null;
    const finish = (project: ProjectSnapshot | null) => {
      if (settled) return;
      settled = true;
      statusSelect?.dispose();
      resolve(project);
    };
    const dialog = createInsightDialog({
      title: "新建项目",
      panelClass: "project-page-v2__dialog",
      bodyHtml: `<label class="insight-dialog-field"><span class="insight-dialog-label">名称</span><input type="text" name="title" required autocomplete="off" autofocus></label><div class="insight-dialog-field" data-project-status></div>`,
      submitLabel: "创建",
      cancelLabel: "取消",
      onDispose: () => finish(resultOnDispose),
    });
    registerDispose?.(() => dialog.dispose());
    const form = dialog.panel;
    const titleInput = form.querySelector<HTMLInputElement>('[name="title"]')!;
    const statusHost = dialog.body.querySelector<HTMLElement>("[data-project-status]")!;
    statusSelect = mountSelectField(statusHost, {
      label: "项目状态",
      options: PROJECT_STATUSES.map((status) => ({ value: status, label: status })),
      search: false,
      multiple: false,
      value: selectedStatus,
      onChange: (value) => { if (value) selectedStatus = value; },
    });
    const close = async (project: ProjectSnapshot | null) => {
      if (inFlight) return;
      resultOnDispose = project;
      await dialog.close();
      dialog.dispose();
    };
    dialog.bindChrome(() => { void close(null); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (inFlight || settled) return;
      if (!canWrite()) {
        dialog.setError("应用数据目录已变化；请关闭此窗口并重新打开后再创建项目。");
        return;
      }
      const title = titleInput.value.trim();
      if (!title) {
        dialog.setError("请输入项目名称。");
        titleInput.focus();
        return;
      }
      inFlight = true;
      dialog.setBusy(true);
      dialog.setError("");
      void productivityCreateProject({ title, status: selectedStatus, expectedDataDir })
        .then((created) => {
          inFlight = false;
          if (!canWrite()) {
            dialog.setBusy(false);
            dialog.setError("项目创建请求返回时应用数据目录已变化。请先核对当前项目列表，再关闭此窗口。");
            return;
          }
          return close(created.project);
        })
        .catch((error) => {
          inFlight = false;
          dialog.setBusy(false);
          dialog.setError(`创建失败：${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => { if (!settled) inFlight = false; });
    });
    void dialog.open();
  });
}

export type ProjectRailBinding = {
  getSecondaryRailDescriptor: (taskSection?: HTMLElement, onTaskSectionUnmount?: () => void) => RailDescriptor;
  setSelectedProject: (projectId: string) => void;
  getProjects: () => readonly ProjectSnapshot[];
  createProject: () => Promise<ProjectSnapshot | null>;
  refresh: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

export function createProjectRail(_ctx: InsightHostContext): ProjectRailBinding {
  const mountedDataDir = _ctx.dataDirKey === "_default" ? getSettings().dataDir.trim() : _ctx.dataDirKey;
  let selectedKey = "";
  let projects: ProjectSnapshot[] = [];
  let listHost: HTMLElement | null = null;
  let disposed = false;
  let refreshGeneration = 0;
  const listeners = new Set<() => void>();
  let activeCreateDispose: (() => void) | null = null;
  const onProjectListRefresh = (event: Event) => {
    const dataDir = (event as CustomEvent<{ dataDir: string }>).detail?.dataDir;
    if (!disposed && dataDir === mountedDataDir && dataDir === getSettings().dataDir.trim()) {
      void refreshProjects().catch((error: unknown) => {
        if (!disposed && listHost) listHost.textContent = `读取项目失败：${error instanceof Error ? error.message : String(error)}`;
      });
    }
  };
  window.addEventListener("orbita-project-list-refresh", onProjectListRefresh);
  async function createProject(): Promise<ProjectSnapshot | null> {
    if (disposed || activeCreateDispose) return null;
    const requestGeneration = _ctx.generation;
    const expectedDataDir = _ctx.dataDirKey === "_default" ? getSettings().dataDir.trim() : _ctx.dataDirKey;
    const canCreateInCapturedContext = () => !disposed && _ctx.generation === requestGeneration && getSettings().dataDir.trim() === expectedDataDir;
    const created = await openCreateProjectDialog(expectedDataDir, canCreateInCapturedContext, (disposeDialog) => { activeCreateDispose = disposeDialog; });
    activeCreateDispose = null;
    return canCreateInCapturedContext() ? created : null;
  }

  async function refreshProjects(): Promise<void> {
    const request = ++refreshGeneration;
    const dataDir = getSettings().dataDir.trim();
    const generation = _ctx.generation;
    const current = () => !disposed && request === refreshGeneration && generation === _ctx.generation && dataDir === mountedDataDir && dataDir === getSettings().dataDir.trim();
    let resp: Awaited<ReturnType<typeof productivityListProjects>>;
    try { resp = await productivityListProjects(); }
    catch (error) { if (current()) throw error; return; }
    if (!current()) return;
    projects = liveProjects(resp.projects);
    paintList();
    for (const listener of listeners) listener();
  }

  function paintList(): void {
    if (!listHost) return;
    listHost.innerHTML = projects
      .map(
        (p) =>
          `<div class="insight-chat-rail-row">
            <button type="button" class="insight-chat-rail-item project-rail-entry${p.id === selectedKey ? " is-active" : ""}" data-id="${escAttr(p.id)}" title="${escAttr(p.title)}">${escHtml(p.title)}</button>
          </div>`,
      )
      .join("");
    listHost.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((btn) => {
      if (btn.dataset.dragWired) return;
      btn.dataset.dragWired = "1";
      attachIdentityDragSource(btn, () => {
        const id = btn.dataset.id;
        if (!id) return null;
        const project = projects.find((p) => p.id === id);
        return { identity: { kind: "project", id }, title: project?.title ?? "项目" };
      });
    });
  }

  function getSecondaryRailDescriptor(taskSection?: HTMLElement, onTaskSectionUnmount?: () => void): RailDescriptor {
    return {
      kind: "project",
      title: "Project",
      selectedKey,
      onSelect: (key) => {
        selectedKey = key;
        paintList();
        const project = projects.find((p) => p.id === key);
        openInsightContentTab({ kind: "project", id: key }, project?.title ?? "项目");
      },
      onCreate: () => {
        void createAndOpenProject();
      },
      renderContent(host) {
        const split = document.createElement("div");
        split.className = "project-rail-split";
        const projectList = document.createElement("div");
        projectList.className = "project-rail-projects";
        projectList.setAttribute("aria-label", "Project 列表");
        const tasks = document.createElement("div");
        tasks.className = "project-rail-tasks";
        if (taskSection) tasks.append(taskSection);
        else tasks.innerHTML = `<div class="project-rail-tasks-heading">一级任务</div><p class="project-rail-empty">选择一个 Project 后查看任务</p>`;
        split.append(projectList, tasks);
        host.append(split);
        listHost = projectList;
        projectList.addEventListener("click", onListClick);
        paintList();
        void refreshProjects().catch((error: unknown) => {
          if (!disposed && listHost === projectList) projectList.textContent = `读取项目失败：${error instanceof Error ? error.message : String(error)}`;
        });
        return () => {
          projectList.removeEventListener("click", onListClick);
          onTaskSectionUnmount?.();
          taskSection?.remove();
          split.remove();
          if (listHost === projectList) listHost = null;
        };
      },
    };
  }

  async function createAndOpenProject(): Promise<void> {
    const requestGeneration = _ctx.generation;
    const requestDataDir = _ctx.dataDirKey === "_default" ? getSettings().dataDir.trim() : _ctx.dataDirKey;
    const isCurrent = () => !disposed && _ctx.generation === requestGeneration && getSettings().dataDir.trim() === requestDataDir;
    const created = await createProject();
    if (!created || !isCurrent()) return;
    selectedKey = created.id;
    try { await refreshProjects(); } catch { /* The created Project can still be opened if the rail refresh fails. */ }
    if (!isCurrent()) return;
    openInsightContentTab({ kind: "project", id: created.id }, created.title);
  }

  function onListClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
    if (!btn?.dataset.id) return;
    getSecondaryRailDescriptor().onSelect(btn.dataset.id);
  }

  return {
    getSecondaryRailDescriptor,
    getProjects: () => projects.slice(),
    createProject,
    setSelectedProject(projectId: string) {
      selectedKey = projectId;
      paintList();
    },
    refresh: refreshProjects,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      disposed = true;
      refreshGeneration++;
      listeners.clear();
      window.removeEventListener("orbita-project-list-refresh", onProjectListRefresh);
      activeCreateDispose?.();
      activeCreateDispose = null;
      listHost = null;
    },
  };
}
