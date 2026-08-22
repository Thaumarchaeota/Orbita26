import { invoke } from "@tauri-apps/api/core";
import type { JournalEntry } from "../../core/data/types";
import type { AppSettings } from "../../core/data/types";

export function resolveJournalRoot(settings: AppSettings): string {
  const custom = settings.integrations.journal.dataRoot.trim();
  return custom || settings.dataDir;
}

export function journalConfigured(settings: AppSettings): boolean {
  return !!settings.dataDir;
}

export type JournalListParams = { date?: string; from?: string; to?: string };

export async function journalList(params: JournalListParams = {}) {
  return invoke<{ entries: JournalEntry[] }>("journal_list", { req: params });
}

export async function journalUpsert(entry: JournalEntry) {
  return invoke<{ entry: JournalEntry }>("journal_upsert", { req: { entry } });
}

export async function journalDelete(id: string) {
  return invoke<void>("journal_delete", { req: { id } });
}

export type GarminSyncReason =
  | "no_token"
  | "token_invalid"
  | "network_proxy"
  | "network_error"
  | "sync_timeout"
  | "fetch_failed"
  | "rate_limited"
  | "deps_missing"
  | "bad_credentials"
  | "mfa"
  | "internal";

export type GarminSyncResult = {
  ok: boolean;
  message?: string;
  reason?: GarminSyncReason | string;
  dailyCount?: number;
  exerciseCount?: number;
  routineCount?: number;
};

export type GarminLoginResult = {
  ok: boolean;
  message?: string;
  reason?: string;
};

export type GarminStatusResult = {
  configured: boolean;
  loggedIn: boolean;
  rateLimited: boolean;
};

export function formatGarminError(reason?: string | null, message?: string | null): string {
  switch (reason) {
    case "no_token":
      return "尚未登录佳明。请到 设置 → 今日，填写邮箱密码，点击「重新登录佳明」。";
    case "token_invalid":
      return "佳明 token 已失效。请到 设置 → 今日，点击「重新登录佳明」获取新 token。";
    case "network_proxy":
      return "代理异常。请开启 v2rayN（HTTP 10808）或关闭 Windows 系统代理。";
    case "network_error":
      return "网络连接失败，请检查网络后重试。";
    case "sync_timeout":
      return "同步超时。可稍后重试或减少同步天数。";
    case "fetch_failed":
      return message ? `已连接佳明但拉取数据失败：${message}` : "已连接佳明但拉取数据失败。";
    case "rate_limited":
      return message ?? "佳明请求频率限制，请稍后再试。";
    case "deps_missing":
      return "未安装 garminconnect，请运行 orbita/python/setup.ps1。";
    case "bad_credentials":
      return message ?? "佳明邮箱或密码错误，请检查生活区凭据。";
    case "mfa":
      return "佳明账号开启 MFA，本期不支持应用内登录。";
    default:
      return message ?? "佳明同步失败";
  }
}

export function formatGarminLoginError(reason?: string | null, message?: string | null): string {
  if (reason === "rate_limited") {
    return message ?? "佳明登录频率限制，请等待 24h+ 后再试（删本地冷却文件不能解佳明封禁）。";
  }
  if (reason === "network_proxy") {
    return message ?? "代理异常。请开启 v2rayN（HTTP 10808）或关闭 Windows 系统代理。";
  }
  return formatGarminError(reason, message);
}

export async function garminStatus() {
  return invoke<GarminStatusResult>("garmin_status");
}

export async function garminSync(params?: { from?: string; to?: string }) {
  const req = params ?? {};
  const SYNC_TIMEOUT_MS = 5 * 60 * 1000;
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("佳明同步超时（超过 5 分钟），请稍后重试")),
      SYNC_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      invoke<GarminSyncResult>("garmin_sync", { req }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export async function garminLogin(params?: { email?: string; password?: string }) {
  const LOGIN_TIMEOUT_MS = 120 * 1000;
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("佳明登录超时（120 秒），请稍后重试")),
      LOGIN_TIMEOUT_MS,
    );
  });
  const req = params ?? {};
  try {
    return await Promise.race([
      invoke<GarminLoginResult>("garmin_login", { req }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export async function bkeasySummary() {
  return invoke<{ today: number; month: number }>("bkeasy_summary");
}

export function beijingToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export function syncFromDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export function dateTimeToUnix(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const utc = Date.UTC(y, m - 1, d, hh - 8, mm, 0);
  return Math.floor(utc / 1000);
}

export function unixToTimeParts(ts: number): { date: string; time: string } {
  const dt = new Date(ts * 1000 + 8 * 3600 * 1000);
  const date = dt.toISOString().slice(0, 10);
  const time = `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`;
  return { date, time };
}
