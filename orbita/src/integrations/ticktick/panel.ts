import { getSettings, loadSettings, patchSettings } from "../../core/settings";
import { escAttr, escHtml } from "../../core/html";
import { closePopover, crossfadeSwap, isPopoverOpen, openPopover, type MotionTrigger } from "../../ui/motion";
import { mountContextMenu } from "../../ui/context-menu";
import { CHEVRON_SVG } from "../ai/icons";
import {
  didaAuthStatus,
  didaCompleteTask,
  didaConnect,
  didaCreateTask,
  didaDeleteTask,
  didaFilterTasks,
  didaListProjects,
  didaUpdateTask,
  filterTasks,
  formatTaskDue,
  invokeError,
} from "./client";
import { buildCalendarDays, monthLabel, WEEKDAYS } from "./calendar";
import {
  dialogToCreatePayload,
  dialogToUpdatePayload,
  mountTaskDetailDialog,
  mountTaskDialog,
} from "./dialog";
import { mountSuccessToast } from "./success-toast";
import { registerTicktickProjectsProvider } from "../settings";
import type { DidaProject, DidaTask } from "./types";

const TASK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const REFRESH_DONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path class="ticktick-check-path" d="M7.5 12.2l2.6 2.6 5.4-5.4"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const CHECK_MARK_SVG = `<svg class="ticktick-task-check-mark" viewBox="0 0 12 10" aria-hidden="true"><polyline points="1.8 5.2 4.6 7.8 10.2 1.8"/></svg>`;

const COMPLETE_DELAY_MS = 5000;

const CAL_SPRING: KeyframeAnimationOptions = {
  duration: 580,
  easing: "cubic-bezier(0.22, 1.18, 0.36, 1)",
  fill: "forwards",
};

const CAL_HEIGHT_SPRING: KeyframeAnimationOptions = {
  duration: 360,
  easing: "cubic-bezier(0.22, 1.18, 0.36, 1)",
  fill: "forwards",
};

function priorityClass(p?: number): string {
  if (p === 5) return "is-high";
  if (p === 3) return "is-medium";
  if (p === 1) return "is-low";
  return "";
}

function taskKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

export function mountTicktickPanel(shellBody: HTMLElement, dialogRoot: HTMLElement) {
  const aside = shellBody.querySelector<HTMLElement>(".shell-aside");
  if (!aside) return;

  const section = document.createElement("section");
  section.className = "ticktick-section";
  section.innerHTML = `
    <div class="launcher-head">
      <span class="launcher-title">${TASK_SVG}任务</span>
    </div>
    <div class="ticktick-body" id="ticktickBody">
      <div class="ticktick-connect" id="ticktickConnect">
        <p>未连接滴答清单</p>
        <button type="button" class="dialog-btn dialog-btn-primary" id="ticktickConnectBtn">连接</button>
      </div>
      <div class="ticktick-main" id="ticktickMain">
        <div class="ticktick-calendar" id="ticktickCalendar">
          <div class="ticktick-cal-head">
            <button type="button" class="ticktick-cal-nav" data-dir="-1">‹</button>
            <span class="ticktick-cal-title" id="ticktickCalTitle"></span>
            <button type="button" class="ticktick-cal-nav" data-dir="1">›</button>
          </div>
          <div class="ticktick-cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
          <div class="ticktick-cal-viewport" id="ticktickCalViewport"></div>
        </div>
        <div class="ticktick-todo">
          <div class="ticktick-todo-head">
            <div class="ticktick-project-picker">
              <button type="button" class="ticktick-project-select" id="ticktickProjectSelect">
                <span id="ticktickProjectLabel">全部清单</span>
                <span class="ticktick-project-chevron">${CHEVRON_SVG}</span>
              </button>
              <div class="ticktick-project-menu scroll-slim motion-popover" id="ticktickProjectMenu"></div>
            </div>
            <div class="ticktick-todo-actions">
              <button type="button" class="ticktick-icon-btn" id="ticktickRefresh" data-tip="刷新">
                <span class="ticktick-refresh-icon">${REFRESH_SVG}</span>
                <span class="ticktick-refresh-done">${REFRESH_DONE_SVG}</span>
              </button>
              <button type="button" class="ticktick-icon-btn" id="ticktickAdd" data-tip="新建任务">${PLUS_SVG}</button>
            </div>
          </div>
          <div class="ticktick-task-list scroll-slim" id="ticktickTaskList"></div>
        </div>
      </div>
    </div>
  `;
  aside.appendChild(section);

  const connectBtn = section.querySelector<HTMLButtonElement>("#ticktickConnectBtn")!;
  const calTitleEl = section.querySelector<HTMLElement>("#ticktickCalTitle")!;
  const calViewport = section.querySelector<HTMLElement>("#ticktickCalViewport")!;
  const calendarEl = section.querySelector<HTMLElement>("#ticktickCalendar")!;
  const projectSelect = section.querySelector<HTMLButtonElement>("#ticktickProjectSelect")!;
  const projectLabel = section.querySelector<HTMLElement>("#ticktickProjectLabel")!;
  const projectMenu = section.querySelector<HTMLElement>("#ticktickProjectMenu")!;
  const taskListEl = section.querySelector<HTMLElement>("#ticktickTaskList")!;
  const refreshBtn = section.querySelector<HTMLButtonElement>("#ticktickRefresh")!;
  const addBtn = section.querySelector<HTMLButtonElement>("#ticktickAdd")!;
  const todoEl = section.querySelector<HTMLElement>(".ticktick-todo")!;

  const taskDialog = mountTaskDialog(dialogRoot);
  const taskDetailDialog = mountTaskDetailDialog(dialogRoot);
  const playSuccess = mountSuccessToast(section);
  const ctxAc = new AbortController();
  const taskCtxMenu = mountContextMenu(ctxAc.signal);
  registerTicktickProjectsProvider(() => projects);

  let projects: DidaProject[] = [];
  let allTasks: DidaTask[] = [];
  let selectedProjectId: string | null = null;
  let selectedDay: Date | null = null;
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth();
  let loading = false;
  let calAnimating = false;
  let taskListReady = false;
  const pendingComplete = new Map<string, number>();

  const setConnectedUi = (connected: boolean) => {
    section.classList.toggle("is-authed", connected);
  };

  const projectName = (id: string | null) => {
    if (!id) return "全部清单";
    return projects.find((p) => p.id === id)?.name ?? id;
  };

  const defaultCreateProject = () => {
    if (selectedProjectId) return selectedProjectId;
    const configured = getSettings().integrations.ticktick.defaultProjectId.trim();
    if (configured && projects.some((p) => p.id === configured)) return configured;
    return projects.find((p) => p.id === "inbox")?.id ?? projects[0]?.id ?? "inbox";
  };

  const syncProjectLabel = () => {
    projectLabel.textContent = projectName(selectedProjectId);
  };

  const paintProjectMenu = () => {
    const items = [{ id: "", name: "全部清单" }, ...projects];
    projectMenu.innerHTML = items
      .map(
        (p) =>
          `<button type="button" class="ticktick-project-item${selectedProjectId === (p.id || null) ? " active" : ""}" data-id="${escAttr(p.id)}">${escHtml(p.name)}</button>`,
      )
      .join("");
  };

  const closeProjectMenu = async () => {
    if (!isPopoverOpen(projectMenu)) return;
    await closePopover(projectMenu);
    todoEl.classList.remove("is-menu-open");
  };

  const openProjectMenu = (trigger: MotionTrigger) => {
    if (isPopoverOpen(projectMenu)) {
      void closeProjectMenu();
      return;
    }
    paintProjectMenu();
    todoEl.classList.add("is-menu-open");
    void openPopover(projectMenu, trigger);
  };

  const buildMonthGridHtml = () => {
    const today = new Date();
    const cells = buildCalendarDays(calYear, calMonth);
    return cells
      .map((d) => {
        if (!d) return `<span class="ticktick-cal-cell is-empty"></span>`;
        const active = selectedDay && d.toDateString() === selectedDay.toDateString();
        const isToday = d.toDateString() === today.toDateString();
        return `<button type="button" class="ticktick-cal-cell${active ? " is-active" : ""}${isToday ? " is-today" : ""}" data-date="${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}">${d.getDate()}</button>`;
      })
      .join("");
  };

  const createMonthEl = () => {
    const el = document.createElement("div");
    el.className = "ticktick-cal-month";
    el.innerHTML = buildMonthGridHtml();
    return el;
  };

  const syncCalTitle = () => {
    calTitleEl.textContent = monthLabel(calYear, calMonth);
  };

  const paintCalendar = (animate?: -1 | 1) => {
    syncCalTitle();
    if (!animate || calAnimating) {
      calViewport.innerHTML = "";
      calViewport.appendChild(createMonthEl());
      return;
    }
    void shiftCalendar(animate);
  };

  const shiftCalendar = async (dir: -1 | 1) => {
    const current = calViewport.querySelector<HTMLElement>(".ticktick-cal-month");
    if (!current || calAnimating) return;
    calAnimating = true;
    calViewport.style.height = `${current.offsetHeight}px`;
    calViewport.classList.add("is-animating");
    const next = createMonthEl();
    const enterFrom = dir > 0 ? "68%" : "-68%";
    const exitTo = dir > 0 ? "-52%" : "52%";
    next.style.transform = `translateX(${enterFrom}) scale(0.92)`;
    next.style.opacity = "0.2";
    next.style.filter = "blur(3px)";
    calViewport.appendChild(next);
    const out = current.animate(
      [
        { transform: "translateX(0) scale(1)", opacity: 1, filter: "blur(0px)" },
        { transform: `translateX(${exitTo}) scale(0.92)`, opacity: 0, filter: "blur(3px)" },
      ],
      CAL_SPRING,
    );
    const inn = next.animate(
      [
        { transform: `translateX(${enterFrom}) scale(0.92)`, opacity: 0.2, filter: "blur(3px)" },
        { transform: "translateX(0) scale(1)", opacity: 1, filter: "blur(0px)" },
      ],
      CAL_SPRING,
    );
    await Promise.all([out.finished, inn.finished]);
    const lockedHeight = calViewport.offsetHeight;
    const targetHeight = next.offsetHeight;
    current.remove();
    next.style.transform = "";
    next.style.opacity = "";
    next.style.filter = "";
    calViewport.classList.remove("is-animating");
    if (Math.abs(targetHeight - lockedHeight) > 1) {
      calViewport.style.height = `${lockedHeight}px`;
      await calViewport
        .animate(
          [{ height: `${lockedHeight}px` }, { height: `${targetHeight}px` }],
          CAL_HEIGHT_SPRING,
        )
        .finished;
    }
    calViewport.style.height = "";
    calAnimating = false;
  };

  const visibleTasks = () => filterTasks(allTasks, selectedProjectId, selectedDay);

  const taskRowHtml = (t: DidaTask) => {
    const due = formatTaskDue(t.dueDate);
    const overdue = due === "已过期";
    const key = taskKey(t.projectId, t.id);
    const completing = pendingComplete.has(key);
    return `
          <div class="ticktick-task-row ${priorityClass(t.priority)}${overdue ? " is-overdue" : ""}${completing ? " is-completing" : ""}" data-project="${escAttr(t.projectId)}" data-id="${escAttr(t.id)}">
            <button type="button" class="ticktick-task-check" aria-label="完成" data-action="complete">
              <span class="ticktick-task-check-box">${CHECK_MARK_SVG}</span>
            </button>
            <button type="button" class="ticktick-task-title" data-action="detail">${escHtml(t.title)}</button>
            <span class="ticktick-task-due">${escHtml(due)}</span>
          </div>
        `;
  };

  const rowMatchesTask = (row: HTMLElement, t: DidaTask) => {
    const due = formatTaskDue(t.dueDate);
    const overdue = due === "已过期";
    const key = taskKey(t.projectId, t.id);
    const completing = pendingComplete.has(key);
    const title = row.querySelector(".ticktick-task-title");
    const dueEl = row.querySelector(".ticktick-task-due");
    return (
      row.classList.contains("is-completing") === completing &&
      row.classList.contains("is-overdue") === overdue &&
      title?.textContent === t.title &&
      dueEl?.textContent === due
    );
  };

  const syncTaskRows = (list: DidaTask[]) => {
    if (!list.length) {
      taskListEl.innerHTML = `<div class="ticktick-empty">暂无任务</div>`;
      return;
    }
    taskListEl.querySelector(".ticktick-empty")?.remove();

    let cursor = taskListEl.firstElementChild as HTMLElement | null;
    for (const t of list) {
      const html = taskRowHtml(t);
      const key = taskKey(t.projectId, t.id);
      while (cursor && !cursor.classList.contains("ticktick-task-row")) {
        cursor.remove();
        cursor = taskListEl.firstElementChild as HTMLElement | null;
      }
      if (!cursor) {
        taskListEl.insertAdjacentHTML("beforeend", html);
        continue;
      }
      const curKey = taskKey(cursor.dataset.project!, cursor.dataset.id!);
      if (curKey === key) {
        if (!rowMatchesTask(cursor, t)) cursor.outerHTML = html;
        cursor = cursor.nextElementSibling as HTMLElement | null;
        continue;
      }
      const existing = taskListEl.querySelector<HTMLElement>(
        `.ticktick-task-row[data-project="${escAttr(t.projectId)}"][data-id="${escAttr(t.id)}"]`,
      );
      if (existing) {
        if (!rowMatchesTask(existing, t)) existing.outerHTML = html;
        taskListEl.insertBefore(existing, cursor);
      } else {
        cursor.insertAdjacentHTML("beforebegin", html);
      }
      cursor = cursor.nextElementSibling as HTMLElement | null;
    }
    while (cursor) {
      const next = cursor.nextElementSibling as HTMLElement | null;
      if (cursor.classList.contains("ticktick-task-row")) cursor.remove();
      cursor = next;
    }
  };

  const paintTasks = () => {
    const update = () => syncTaskRows(visibleTasks());
    if (!taskListReady) {
      update();
      taskListReady = true;
      return;
    }
    void crossfadeSwap(taskListEl, update);
  };

  const clearPending = (key: string) => {
    const timer = pendingComplete.get(key);
    if (timer) window.clearTimeout(timer);
    pendingComplete.delete(key);
  };

  const toggleComplete = (row: HTMLElement, projectId: string, taskId: string) => {
    const key = taskKey(projectId, taskId);
    if (pendingComplete.has(key)) {
      clearPending(key);
      row.classList.remove("is-completing");
      return;
    }
    row.classList.add("is-completing");
    const timer = window.setTimeout(async () => {
      pendingComplete.delete(key);
      row.classList.add("is-removing");
      try {
        await didaCompleteTask(projectId, taskId);
        window.setTimeout(() => {
          allTasks = allTasks.filter((t) => !(t.projectId === projectId && t.id === taskId));
          paintTasks();
        }, 280);
      } catch (err) {
        row.classList.remove("is-completing", "is-removing");
        alert(invokeError(err));
      }
    }, COMPLETE_DELAY_MS);
    pendingComplete.set(key, timer);
  };

  const playRefreshSuccess = () => {
    refreshBtn.classList.remove("is-spinning");
    refreshBtn.classList.add("is-success");
    window.setTimeout(() => refreshBtn.classList.remove("is-success"), 1600);
  };

  const refresh = async () => {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.classList.remove("is-success");
    refreshBtn.classList.add("is-spinning");
    try {
      projects = await didaListProjects();
      const ids = projects.map((p) => p.id);
      allTasks = await didaFilterTasks({ projectIds: ids.length ? ids : undefined });
      paintCalendar();
      paintTasks();
      syncProjectLabel();
      playRefreshSuccess();
    } catch (e) {
      refreshBtn.classList.remove("is-spinning");
      taskListEl.innerHTML = `<div class="ticktick-empty">${escHtml(invokeError(e))}</div>`;
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  };

  const syncAuth = async () => {
    const { connected } = await didaAuthStatus();
    setConnectedUi(connected);
    if (connected) void refresh();
  };

  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    try {
      const current = getSettings();
      const ticktick = current.integrations.ticktick;
      await patchSettings({
        integrations: {
          ...current.integrations,
          ticktick: {
            clientId: ticktick.clientId.trim(),
            clientSecret: ticktick.clientSecret.trim(),
            redirectUri: ticktick.redirectUri.trim() || "http://127.0.0.1:8765/callback",
            accessToken: ticktick.accessToken,
            defaultProjectId: ticktick.defaultProjectId || "inbox",
          },
        },
      });
      const status = await didaConnect();
      await loadSettings();
      setConnectedUi(status.connected);
      if (status.connected) void refresh();
      else await syncAuth();
    } catch (e) {
      alert(invokeError(e));
    } finally {
      connectBtn.disabled = false;
    }
  });

  projectSelect.addEventListener("click", (e) => openProjectMenu(e.currentTarget as HTMLElement));
  projectMenu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-project-item");
    if (!btn) return;
    selectedProjectId = btn.dataset.id || null;
    syncProjectLabel();
    paintProjectMenu();
    paintTasks();
    await closeProjectMenu();
  });

  calendarEl.addEventListener("click", (e) => {
    const nav = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-cal-nav");
    if (nav) {
      const dir = Number(nav.dataset.dir) as -1 | 1;
      calMonth += dir;
      if (calMonth < 0) {
        calMonth = 11;
        calYear -= 1;
      } else if (calMonth > 11) {
        calMonth = 0;
        calYear += 1;
      }
      paintCalendar(dir);
      return;
    }
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(".ticktick-cal-cell");
    if (!cell?.dataset.date) return;
    const [y, m, d] = cell.dataset.date.split("-").map(Number);
    const next = new Date(y, m - 1, d);
    if (selectedDay && selectedDay.toDateString() === next.toDateString()) selectedDay = null;
    else selectedDay = next;
    paintCalendar();
    paintTasks();
  });

  taskListEl.addEventListener("contextmenu", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".ticktick-task-row");
    if (!row) return;
    e.preventDefault();
    const projectId = row.dataset.project;
    const taskId = row.dataset.id;
    if (!projectId || !taskId) return;
    const task = allTasks.find((t) => t.projectId === projectId && t.id === taskId);
    if (!task) return;
    taskCtxMenu.show(
      e.clientX,
      e.clientY,
      [
        { action: "edit", label: "编辑" },
        { action: "delete", label: "删除任务", danger: true, confirm: true },
      ],
      (action, trigger) => {
        if (action === "edit") {
          void taskDialog(
            {
              mode: "edit",
              task,
              projects,
              defaultProjectId: task.projectId,
              onSave: async (result) => {
                await didaUpdateTask(taskId, dialogToUpdatePayload(result));
                playSuccess();
                await refresh();
              },
            },
            trigger,
          );
          return;
        }
        if (action === "delete") {
          void (async () => {
            try {
              clearPending(taskKey(projectId, taskId));
              row.classList.remove("is-completing", "is-removing");
              await didaDeleteTask(projectId, taskId);
              await refresh();
            } catch (err) {
              alert(invokeError(err));
            }
          })();
        }
      },
    );
    e.stopPropagation();
  });

  taskListEl.addEventListener("click", async (e) => {
    const actionBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const row = (e.target as HTMLElement).closest<HTMLElement>(".ticktick-task-row");
    if (!actionBtn || !row) return;
    const projectId = row.dataset.project;
    const taskId = row.dataset.id;
    if (!projectId || !taskId) return;
    const task = allTasks.find((t) => t.projectId === projectId && t.id === taskId);
    if (!task) return;
    const action = actionBtn.dataset.action;
    if (action === "complete") {
      toggleComplete(row, projectId, taskId);
      return;
    }
    if (action === "detail") {
      taskDetailDialog(task, projectName(task.projectId), actionBtn);
      return;
    }
  });

  refreshBtn.addEventListener("click", () => void refresh());

  addBtn.addEventListener("click", async () => {
    await taskDialog(
      {
        mode: "create",
        projects,
        defaultProjectId: defaultCreateProject(),
        onSave: async (result) => {
          await didaCreateTask(dialogToCreatePayload(result));
          playSuccess();
          await refresh();
        },
      },
      addBtn,
    );
  });

  document.addEventListener("click", (e) => {
    if (!section.contains(e.target as Node)) void closeProjectMenu();
  });

  window.addEventListener("orbita:ticktick-auth", () => void syncAuth());

  paintCalendar();
  void syncAuth();
}
