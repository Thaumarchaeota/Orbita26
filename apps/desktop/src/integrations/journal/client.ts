import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../admin/domain-write-guard";
import { isTauri } from "../../core/data/client";
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
  const res = await invokeDomainWrite<{ entry: JournalEntry }>("journal_upsert", { req: { entry } });
  notifyJournalChanged();
  return res;
}

export async function journalDelete(id: string) {
  await invokeDomainWrite<void>("journal_delete", { req: { id } });
  notifyJournalChanged();
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
  resumeJob?: ResumeContext;
};

export type ResumeContext = {
  requestId: string;
  expectedDataDirKey: string;
  jobId: string;
  expectedRevision: number;
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
      return "未安装 garminconnect，请运行 apps/desktop/python/setup.ps1。";
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

const GARMIN_SYNCING_EVT = "orbita:garmin-syncing";
let garminSyncBusy = 0;
let garminHostBusy = false;
let garminBusyPollId = 0;

export function isGarminSyncing(): boolean {
  return garminSyncBusy > 0 || garminHostBusy;
}

export function subscribeGarminSyncing(fn: (busy: boolean) => void): () => void {
  initGarminSyncing();
  const handler = () => fn(isGarminSyncing());
  window.addEventListener(GARMIN_SYNCING_EVT, handler);
  fn(isGarminSyncing());
  return () => window.removeEventListener(GARMIN_SYNCING_EVT, handler);
}

function emitGarminSyncing() {
  window.dispatchEvent(new CustomEvent(GARMIN_SYNCING_EVT));
}

function startGarminBusyPoll() {
  if (garminBusyPollId || !isTauri()) return;
  const tick = () => {
    void invoke<boolean>("garmin_sync_busy")
      .then((busy) => {
        if (busy === garminHostBusy) return;
        garminHostBusy = busy;
        emitGarminSyncing();
      })
      .catch(() => {});
  };
  garminBusyPollId = window.setInterval(tick, 250);
  tick();
}

export function initGarminSyncing(): void {
  startGarminBusyPoll();
}

export async function garminSync(params?: { from?: string; to?: string; entryPoint?: "manual" | "auto" }) {
  const req = {
    from: params?.from,
    to: params?.to,
    entryPoint: params?.entryPoint ?? "manual",
  };
  const SYNC_TIMEOUT_MS = 5 * 60 * 1000;
  const invokeOnce = async (resumeJob?: ResumeContext): Promise<GarminSyncResult> => {
    let timer: number | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("佳明同步超时（超过 5 分钟），请稍后重试")),
          SYNC_TIMEOUT_MS,
        );
      });
      return await Promise.race([
        invokeDomainWrite<GarminSyncResult>("garmin_sync", { req: { ...req, ...(resumeJob ? { resumeJob } : {}) } }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  };
  garminSyncBusy += 1;
  emitGarminSyncing();
  try {
    let result = await invokeOnce();
    const context = result.resumeJob;
    const validContext = context
      && typeof context.requestId === "string" && context.requestId.length > 0
      && typeof context.expectedDataDirKey === "string" && context.expectedDataDirKey.length > 0
      && typeof context.jobId === "string" && context.jobId.length > 0
      && Number.isSafeInteger(context.expectedRevision) && context.expectedRevision > 0;
    if (req.entryPoint === "manual" && result.reason === "GARMIN_DAILY_PAUSED" && validContext) {
      const { getConfirmDialog } = await import("../shell/dialog");
      const confirmed = await getConfirmDialog()(
        "继续佳明日常同步",
        result.message ?? "日常同步已暂停。继续后会重试未成功项。",
        undefined,
        { confirmLabel: "继续同步并重试未成功项", danger: false },
      );
      if (!confirmed) {
        return { ok: false, reason: "GARMIN_SYNC_CANCELLED" };
      }
      result = await invokeOnce(context);
    }
    if (result.ok) notifyJournalChanged();
    return result;
  } finally {
    garminSyncBusy = Math.max(0, garminSyncBusy - 1);
    emitGarminSyncing();
  }
}

export function notifyJournalChanged(): void {
  window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ emit }) => emit("orbita:journal-changed"));
  }
}

export function bindJournalChanged(handler: () => void): () => void {
  window.addEventListener("orbita:journal-changed", handler);
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen("orbita:journal-changed", handler).then((fn) => {
        unlisten = fn;
      });
    });
  }
  return () => {
    window.removeEventListener("orbita:journal-changed", handler);
    unlisten?.();
  };
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

export type HealthOverviewRequest = {
  selectedDate: string;
  trackFromUtc: number;
  trackToUtc: number;
  trendDays: number;
};

export type HealthOverviewResponse = {
  track: {
    sleepBlocks: Array<{
      id: string;
      startUtc: number;
      endUtc: number;
      isNap: boolean;
      score: number | null;
      source: string;
      stageTotals?: { deep: number; light: number; rem: number; awake: number } | null;
    }>;
    series: Array<{ metric: string; samples: Array<{ t: number; v: number | null }> }>;
    activities: Array<{
      id: string;
      startUtc: number;
      endUtc: number | null;
      activityType: string | null;
      name: string | null;
      distanceM: number | null;
      durationSec: number | null;
    }>;
    meals: Array<{
      id: string;
      occurredAtUtc: number;
      mealType: string | null;
      description: string | null;
      kcal: number | null;
    }>;
  };
  trends: Array<{
    id: string;
    title: string;
    series: Array<{
      metric: string;
      label: string;
      unit: string;
      chartType: string;
      points: Array<{ date: string; value: number | null }>;
      windowAvg: number | null;
      prevWindowAvg: number | null;
    }>;
  }>;
  daySummary: {
    date: string;
    cards: Array<{
      id: string;
      label: string;
      value: string | null;
      unit: string | null;
      everSeen: boolean;
    }>;
    energy: {
      mealCount: number;
      intakeKcal: number | null;
      burnKcal: number | null;
      deltaKcal: number | null;
      daysWithMeals: number;
      daysInWindow: number;
    };
  };
  localDateRange: { earliest: string; latest: string } | null;
};

export type HealthSyncStatus = {
  lastSuccessAt: string | null;
  syncing: boolean;
  lastError: string | null;
  earliestLocalDate: string | null;
  latestLocalDate: string | null;
};

export async function healthOverviewQuery(req: HealthOverviewRequest) {
  return invoke<HealthOverviewResponse>("health_overview_query", {
    req: {
      ...req,
      trackFromUtc: Math.floor(req.trackFromUtc),
      trackToUtc: Math.ceil(req.trackToUtc),
    },
  });
}

export async function healthSyncStatus() {
  return invoke<HealthSyncStatus>("health_sync_status");
}

export type HealthMealFoodSnapshot = {
  id: string;
  position: number;
  text: string;
  kcal: number;
  kcalEstimated: boolean;
  servingText: string | null;
  servingEstimated: boolean | null;
  carbsGrams: number | null;
  proteinGrams: number | null;
  fatGrams: number | null;
  sugarGrams: number | null;
  fiberGrams: number | null;
  sodiumMilligrams: number | null;
  vitaminCMilligrams: number | null;
  nutrientsEstimated: boolean | null;
};

export type HealthMealSnapshot = {
  id: string;
  revision: number;
  title: string | null;
  startedAt: string;
  slot: string | null;
  iconKey?: string | null;
  text: string | null;
  source: string;
  atHm: string | null;
  recordShape: "foods" | "legacy";
  foods: HealthMealFoodSnapshot[];
  mealKcal: number | null;
  kcal?: number | null;
  items?: string[] | null;
  deletedAt: string | null;
};

export async function healthListMeals(req: {
  localDateFrom?: string;
  localDateTo?: string;
  includeDeleted?: boolean;
}) {
  return invoke<{ meals: HealthMealSnapshot[] }>("health_list_meals", { req });
}

export async function healthCreateMeal(req: {
  expectedDataDir?: string;
  title: string;
  startedAt: string;
  slot: string | null;
  iconKey?: string | null;
  text?: string | null;
  foods?: Record<string, unknown>[];
  source?: string;
  atHm?: string | null;
}) {
  const res = await invokeDomainWrite<{ meal: HealthMealSnapshot }>("health_create_meal", { req });
  notifyJournalChanged();
  return res;
}

export async function healthUpdateMeal(req: {
  expectedDataDir?: string;
  meal: { id: string; expectedRevision: number };
  title: string;
  startedAt: string;
  slot: string | null;
  iconKey?: string | null;
  text?: string | null;
  foods: Record<string, unknown>[];
  atHm?: string | null;
}) {
  const res = await invokeDomainWrite<{ meal: HealthMealSnapshot }>("health_update_meal", { req });
  notifyJournalChanged();
  return res;
}

export async function healthDeleteMeal(req: { meal: { id: string; expectedRevision: number } }) {
  const res = await invokeDomainWrite<{ meal: HealthMealSnapshot }>("health_delete_meal", { req });
  notifyJournalChanged();
  return res;
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
