import { escAttr, escHtml } from "../../../core/html";
import { getSettings } from "../../../core/settings";
import type { InsightDestination, InsightDestinationHandle, InsightHostContext } from "../types";
import { createProjectRail } from "./project-rail";
import { showCommandMenuAt } from "../../../ui/command-menu-popover";
import { getConfirmDialog } from "../../shell/dialog";
import { productivityDeleteProject } from "../../productivity/client";
import "./project/project-page.css";

function projectIndexMarkup(): string {
  return `<div class="insight-chat-page insight-project-index">
    <main class="insight-chat-main project-index-main">
      <div class="insight-chat-main-bar"><div class="insight-chat-heading">项目</div><button type="button" class="insight-chat-rail-new" data-project-index-create aria-label="新建项目" title="新建项目"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
      <div class="project-index-message" data-project-index-message role="status" aria-live="polite">正在读取项目…</div>
      <div class="project-index-list" data-project-index-list></div>
    </main>
  </div>`;
}

export const projectIndexDestination: InsightDestination = {
  id: "project-index",
  kind: "workspace",
  label: "项目",
  icon: "work",
  showInNav: false,
  mount(root, ctx: InsightHostContext): InsightDestinationHandle {
    const projectRail = createProjectRail(ctx);
    root.innerHTML = projectIndexMarkup();
    const list = root.querySelector<HTMLElement>("[data-project-index-list]")!;
    const message = root.querySelector<HTMLElement>("[data-project-index-message]")!;
    const createButton = root.querySelector<HTMLButtonElement>("[data-project-index-create]")!;
    let disposed = false;
    let requestGeneration = 0;
    let lifecycleGeneration = 0;
    let deleting = false;
    let menuGeneration = 0;
    let projectMenu: ReturnType<typeof showCommandMenuAt> | null = null;
    const hostGeneration = ctx.generation;

    function renderProjects(): void {
      const projects = projectRail.getProjects();
      menuGeneration++;
      const previousMenu = projectMenu; projectMenu = null; if (previousMenu) void previousMenu.close();
      list.innerHTML = projects.map((project, index) => `<button type="button" class="project-index-card" data-project-id="${escAttr(project.id)}">
        <span class="project-index-card__top"><span class="project-index-card__number">项目 ${String(index + 1).padStart(2, "0")}</span><span class="project-index-card__meta"><span class="project-index-card__status-dot" aria-hidden="true"></span>${escHtml(project.status)}</span></span>
        <span class="project-index-card__title">${escHtml(project.title)}</span>
        <span class="project-index-card__bottom"><span>查看任务与路径图</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span>
      </button>`).join("");
      message.textContent = projects.length ? `${projects.length} 个项目` : "还没有项目。创建第一个项目，或从左侧项目列表打开已有项目。";
      message.dataset.state = projects.length ? "ready" : "empty";
    }

    async function deleteProject(project: import("../../productivity/types").ProjectSnapshot): Promise<void> {
      if (deleting || disposed) return;
      deleting = true;
      const generation = lifecycleGeneration;
      const dataDir = ctx.dataDirKey === "_default" ? getSettings().dataDir.trim() : ctx.dataDirKey;
      const isCurrent = () => !disposed && generation === lifecycleGeneration && hostGeneration === ctx.generation && getSettings().dataDir.trim() === dataDir;
      try {
        const projectHasDraft = () => {
          const detail = { dataDir, projectId: project.id, blocked: false };
          window.dispatchEvent(new CustomEvent("orbita-project-query-blockers", { detail }));
          return detail.blocked;
        };
        if (projectHasDraft()) throw new Error("该项目还有未保存或正在保存的修改，请先处理后再删除。");
        const taskCount = project.tasks.filter((task) => !task.deletedAtUtc).length;
        const confirmed = await getConfirmDialog()("删除项目", `将删除项目“${project.title}”及其 ${taskCount} 个任务，并从工作区隐藏。关联安排和检查点会保留；进行中或暂停中的安排会阻止删除。`, undefined, { confirmLabel: "删除项目", danger: true });
        if (!confirmed || !isCurrent()) return;
        if (projectHasDraft()) throw new Error("该项目还有未保存或正在保存的修改，请先处理后再删除。");
        const result = await productivityDeleteProject({ expectedDataDir: dataDir, project: { id: project.id, expectedRevision: project.revision } });
        // The write belongs to the captured data root even if this page was closed during the request.
        if (getSettings().dataDir.trim() === dataDir) {
          window.dispatchEvent(new CustomEvent("orbita-project-deleted", { detail: { dataDir, project: result.project } }));
          window.dispatchEvent(new Event("orbita-workspace-refresh"));
          window.dispatchEvent(new CustomEvent("orbita-project-list-refresh", { detail: { dataDir } }));
        }
      } catch (error) {
        if (isCurrent()) {
          const raw = error instanceof Error ? error.message : String(error);
          message.textContent = raw.includes("ACTIVE_ACTION_BLOCKS_THING") ? "删除失败：项目或任务中有进行中或暂停的安排，请先结束。" : `删除失败：${raw}`;
          message.dataset.state = "error";
        }
      } finally { deleting = false; }
    }

    async function refresh(): Promise<void> {
      const current = ++requestGeneration;
      message.textContent = "正在读取项目…";
      message.dataset.state = "loading";
      try {
        await projectRail.refresh();
        if (disposed || current !== requestGeneration) return;
        renderProjects();
      } catch (error) {
        if (disposed || current !== requestGeneration) return;
        list.replaceChildren();
        message.textContent = `读取项目失败：${error instanceof Error ? error.message : String(error)}`;
        message.dataset.state = "error";
      }
    }

    const unsubscribeProjects = projectRail.subscribe(() => { if (!disposed) renderProjects(); });

    list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-project-id]");
      const projectId = button?.dataset.projectId;
      if (!projectId || !projectRail.getProjects().some((project) => project.id === projectId)) return;
      projectRail.getSecondaryRailDescriptor().onSelect(projectId);
    });
    async function openProjectMenu(card: HTMLButtonElement, x: number, y: number): Promise<void> {
      const project = projectRail.getProjects().find((entry) => entry.id === card.dataset.projectId);
      if (!project || deleting) return;
      const request = ++menuGeneration;
      const generation = lifecycleGeneration;
      const previous = projectMenu; projectMenu = null; if (previous) await previous.close();
      if (disposed || deleting || request !== menuGeneration || generation !== lifecycleGeneration || !card.isConnected) return;
      const next = showCommandMenuAt(x, y, [{ value: "delete", label: "删除项目", danger: true }], (value) => {
        if (value === "delete") void deleteProject(project);
      }, { returnFocus: card, onClose: () => { if (projectMenu === next) projectMenu = null; } });
      projectMenu = next;
    }
    list.addEventListener("contextmenu", (event) => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-project-id]");
      if (!card) return;
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      void openProjectMenu(card, event.clientX || rect.left, event.clientY || rect.bottom);
    });
    list.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-project-id]");
      if (!card) return;
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      void openProjectMenu(card, rect.left, rect.bottom);
    });
    createButton.addEventListener("click", () => {
      void (async () => {
        const clickGeneration = lifecycleGeneration;
        const expectedDataDir = ctx.dataDirKey === "_default" ? getSettings().dataDir.trim() : ctx.dataDirKey;
        const current = () => !disposed && clickGeneration === lifecycleGeneration && hostGeneration === ctx.generation && expectedDataDir === getSettings().dataDir.trim();
        createButton.disabled = true;
        try {
          const created = await projectRail.createProject();
          if (!created || !current()) return;
          await refresh();
          if (!current()) return;
          projectRail.setSelectedProject(created.id);
          projectRail.getSecondaryRailDescriptor().onSelect(created.id);
        } finally {
          createButton.disabled = false;
        }
      })();
    });

    return {
      activate: refresh,
      deactivate() { requestGeneration += 1; lifecycleGeneration += 1; menuGeneration += 1; const menu = projectMenu; projectMenu = null; if (menu) void menu.close(); },
      getSecondaryRailDescriptor: () => projectRail.getSecondaryRailDescriptor(),
      dispose() {
        disposed = true;
        menuGeneration += 1;
        unsubscribeProjects();
        const menu = projectMenu; projectMenu = null; if (menu) void menu.close();
        requestGeneration += 1;
        lifecycleGeneration += 1;
        projectRail.dispose();
        root.replaceChildren();
      },
    };
  },
};
