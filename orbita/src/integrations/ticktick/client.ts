import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { openUrl } from "../shell/adapter";
import type {
  DidaAuthStatus,
  DidaCreateTaskInput,
  DidaProject,
  DidaTask,
  DidaUpdateTaskInput,
} from "./types";

export function invokeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}

export async function didaAuthStatus(): Promise<DidaAuthStatus> {
  if (!isTauri()) return { connected: false };
  return invoke<DidaAuthStatus>("dida_auth_status");
}

export async function didaConnect(): Promise<DidaAuthStatus> {
  if (!isTauri()) throw new Error("需完整 App");
  const authUrl = await invoke<string>("dida_begin_oauth");
  await openUrl(authUrl);
  return invoke<DidaAuthStatus>("dida_finish_oauth");
}

export async function didaDisconnect(): Promise<DidaAuthStatus> {
  if (!isTauri()) return { connected: false };
  return invoke<DidaAuthStatus>("dida_disconnect");
}

export async function didaListProjects(): Promise<DidaProject[]> {
  if (!isTauri()) return [];
  return invoke<DidaProject[]>("dida_list_projects");
}

export async function didaFilterTasks(opts: {
  projectIds?: string[];
}): Promise<DidaTask[]> {
  if (!isTauri()) return [];
  return invoke<DidaTask[]>("dida_filter_tasks", {
    req: {
      projectIds: opts.projectIds,
    },
  });
}

export async function didaCreateTask(input: DidaCreateTaskInput): Promise<DidaTask> {
  if (!isTauri()) throw new Error("需完整 App");
  return invoke<DidaTask>("dida_create_task", { req: input });
}

export async function didaUpdateTask(taskId: string, input: DidaUpdateTaskInput): Promise<DidaTask> {
  if (!isTauri()) throw new Error("需完整 App");
  return invoke<DidaTask>("dida_update_task", { taskId, req: input });
}

export async function didaCompleteTask(projectId: string, taskId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("dida_complete_task", { projectId, taskId });
}

export async function didaReopenTask(projectId: string, taskId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("dida_reopen_task", { projectId, taskId });
}

export async function didaDeleteTask(projectId: string, taskId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("dida_delete_task", { projectId, taskId });
}

export function parseDidaDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function sortTasks(tasks: DidaTask[]): DidaTask[] {
  const withDate: DidaTask[] = [];
  const noDate: DidaTask[] = [];
  for (const t of tasks) {
    if (parseDidaDate(t.dueDate)) withDate.push(t);
    else noDate.push(t);
  }
  withDate.sort((a, b) => {
    const da = parseDidaDate(a.dueDate)!.getTime();
    const db = parseDidaDate(b.dueDate)!.getTime();
    return da - db;
  });
  return [...withDate, ...noDate];
}

export function filterTasks(
  tasks: DidaTask[],
  projectId: string | null,
  day: Date | null,
): DidaTask[] {
  let list = tasks.filter((t) => (t.status ?? 0) === 0);
  if (projectId) list = list.filter((t) => t.projectId === projectId);
  if (day) {
    list = list.filter((t) => {
      const d = parseDidaDate(t.dueDate);
      return d ? sameCalendarDay(d, day) : false;
    });
  }
  return sortTasks(list);
}

export function formatTaskDue(value?: string): string {
  const d = parseDidaDate(value);
  if (!d) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "已过期";
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function toDidaDateTime(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

export function fromDidaDateParts(value?: string): { date: string; time: string } | null {
  const d = parseDidaDate(value);
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function priorityLabel(p?: number): string {
  if (p === 5) return "高";
  if (p === 3) return "中";
  if (p === 1) return "低";
  return "无";
}
