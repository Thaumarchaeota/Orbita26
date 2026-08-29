import { escHtml } from "../../core/html";
import { getSettings } from "../../core/settings";
import { formatNoteTime, listObsidianNotes, openObsidianNote } from "../shell/obsidian";
import {
  didaAuthStatus,
  didaCompleteTask,
  didaFilterTasks,
  formatTaskDue,
  invokeError,
  parseDidaDate,
  sortTasks,
} from "../ticktick/client";
import type { DidaTask } from "../ticktick/types";

const WORK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const REFRESH_DONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path class="ticktick-check-path" d="M7.5 12.2l2.6 2.6 5.4-5.4"/></svg>`;
const CHECK_MARK_SVG = `<svg class="ticktick-task-check-mark" viewBox="0 0 12 10" aria-hidden="true"><polyline points="1.8 5.2 4.6 7.8 10.2 1.8"/></svg>`;
const NOTE_ICON = "📄";

function priorityClass(p?: number): string {
  if (p === 5) return "is-high";
  if (p === 3) return "is-medium";
  if (p === 1) return "is-low";
  return "";
}

function isOverdue(due?: string): boolean {
  const d = parseDidaDate(due);
  if (!d) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dueDay < today;
}

function pickWorkTasks(tasks: DidaTask[], projectId: string): DidaTask[] {
  const incomplete = tasks.filter((t) => (t.status ?? 0) === 0 && t.projectId === projectId);
  return sortTasks(incomplete).slice(0, 8);
}

function taskRowHtml(t: DidaTask): string {
  const overdue = isOverdue(t.dueDate);
  const due = formatTaskDue(t.dueDate);
  return `
    <div class="ticktick-task-row ${priorityClass(t.priority)}${overdue ? " is-overdue" : ""}" data-project-id="${escHtml(t.projectId)}" data-task-id="${escHtml(t.id)}">
      <button type="button" class="ticktick-task-check" aria-label="完成">
        <span class="ticktick-task-check-box">${CHECK_MARK_SVG}</span>
      </button>
      <span class="ticktick-task-title">${escHtml(t.title)}</span>
      ${due ? `<span class="ticktick-task-due">${escHtml(due)}</span>` : ""}
    </div>`;
}

export function mountWorkPanel(container: HTMLElement) {
  container.className = "work-section";
  container.innerHTML = `
    <div class="launcher-head">
      <span class="launcher-title">${WORK_SVG}工作</span>
      <div class="launcher-head-actions">
        <button type="button" class="ticktick-icon-btn" id="workRefresh" data-tip="刷新">
          <span class="ticktick-refresh-icon">${REFRESH_SVG}</span>
          <span class="ticktick-refresh-done">${REFRESH_DONE_SVG}</span>
        </button>
      </div>
    </div>
    <div class="work-panel">
      <div class="work-block work-tasks-block">
        <span class="today-section-title">清单</span>
        <div class="work-task-list scroll-slim" id="workTaskList"></div>
      </div>
      <div class="work-block work-notes-block">
        <span class="today-section-title">项目笔记</span>
        <div class="work-note-list scroll-slim" id="workNoteList"></div>
      </div>
    </div>
  `;

  const taskListEl = container.querySelector<HTMLElement>("#workTaskList")!;
  const noteListEl = container.querySelector<HTMLElement>("#workNoteList")!;
  const refreshBtn = container.querySelector<HTMLButtonElement>("#workRefresh")!;
  let painting = false;

  const flashRefresh = () => {
    refreshBtn.classList.add("is-done");
    window.setTimeout(() => refreshBtn.classList.remove("is-done"), 900);
  };

  const repaint = async () => {
    if (painting) return;
    painting = true;
    const settings = getSettings();
    const work = settings.integrations.work;
    const projectId =
      work.ticktickProjectId.trim() || settings.integrations.ticktick.defaultProjectId || "inbox";

    taskListEl.innerHTML = "";
    try {
      const auth = await didaAuthStatus();
      if (!auth.connected) {
        taskListEl.innerHTML = `<p class="work-empty">未连接滴答 → 设置 → 任务</p>`;
      } else {
        const tasks = await didaFilterTasks({ projectIds: [projectId] });
        const list = pickWorkTasks(tasks, projectId);
        taskListEl.innerHTML = list.length
          ? list.map(taskRowHtml).join("")
          : `<p class="work-empty">清单暂无待办</p>`;
      }
    } catch (err) {
      taskListEl.innerHTML = `<p class="work-empty">${escHtml(invokeError(err))}</p>`;
    }

    noteListEl.innerHTML = "";
    const vaultDir = settings.integrations.obsidian.vaultDir.trim();
    if (!vaultDir) {
      noteListEl.innerHTML = `<p class="work-empty">设置 → 导航 → Obsidian 库目录</p>`;
    } else {
      try {
        const notes = await listObsidianNotes(24, work.projectNotesDir);
        noteListEl.innerHTML = notes.length
          ? notes
              .map(
                (n) =>
                  `<button type="button" class="work-note-row today-feed-item" data-path="${escHtml(n.path)}">
                    <span class="today-feed-icon">${NOTE_ICON}</span>
                    <span class="today-feed-text">${escHtml(n.name)}</span>
                    <span class="work-note-time">${escHtml(formatNoteTime(n.modified))}</span>
                  </button>`,
              )
              .join("")
          : `<p class="work-empty">「${escHtml(work.projectNotesDir)}」暂无笔记</p>`;
      } catch (err) {
        noteListEl.innerHTML = `<p class="work-empty">${escHtml(invokeError(err))}</p>`;
      }
    }
    painting = false;
  };

  taskListEl.addEventListener("click", async (e) => {
    const check = (e.target as HTMLElement).closest(".ticktick-task-check");
    if (!check) return;
    const row = check.closest<HTMLElement>(".ticktick-task-row");
    if (!row) return;
    const projectId = row.dataset.projectId!;
    const taskId = row.dataset.taskId!;
    row.classList.add("is-completing");
    try {
      await didaCompleteTask(projectId, taskId);
      window.setTimeout(() => {
        row.classList.add("is-removing");
        window.setTimeout(() => {
          row.remove();
          if (!taskListEl.querySelector(".ticktick-task-row")) {
            taskListEl.innerHTML = `<p class="work-empty">清单暂无待办</p>`;
          }
        }, 220);
      }, 280);
    } catch (err) {
      row.classList.remove("is-completing");
      alert(invokeError(err));
    }
  });

  noteListEl.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".work-note-row");
    if (!row?.dataset.path) return;
    void openObsidianNote(row.dataset.path);
  });

  refreshBtn.addEventListener("click", () => {
    flashRefresh();
    void repaint();
  });

  window.addEventListener("orbita:ui-prefs", () => void repaint());
  void repaint();
}
