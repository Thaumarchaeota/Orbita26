import { invoke } from "@tauri-apps/api/core";
import type {
  AccountsResponse,
  AccountDeleteScanResponse,
  AccountMigrateScanResponse,
  AccountMigrateValidateResponse,
  AccountLabelCommitPayload,
  CategoryCommitPayload,
  CommitPayload,
  CommitResponse,
  DetailItem,
  EntriesQuery,
  EntriesResponse,
  Entry,
  SettingsResponse,
  StatsResponse,
  AccountPeriodStatsResponse,
  ValidateResponse,
} from "../types";
import { normalizeDetailItem } from "../domain/detail-item";
import { detailItemForApi } from "../domain/detail-item-api";

let cachedBase: string | null = null;

declare global {
  interface Window {
    __ORBITA_LEDGER_BASE__?: string;
  }
}

export class LedgerApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "LedgerApiError";
    this.status = status;
    this.body = body;
  }
}

export const EXPECTED_LEDGER_PARSER_REV = "1";

type LedgerHealth = { ok?: boolean; parser_rev?: string; beancount_ok?: boolean; error?: string };

export class LedgerConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerConnectError";
  }
}

function invokeErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function resolveLedgerApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (window.__ORBITA_LEDGER_BASE__) {
    cachedBase = window.__ORBITA_LEDGER_BASE__.replace(/\/$/, "");
    return cachedBase;
  }
  try {
    const base = await invoke<string>("ledger_api_base");
    cachedBase = base.replace(/\/$/, "");
    return cachedBase;
  } catch (err) {
    throw new LedgerConnectError(invokeErrorMessage(err));
  }
}

export function resetLedgerApiBase(): void {
  cachedBase = null;
}

async function ledgerFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await resolveLedgerApiBase();
  try {
    return await fetch(`${base}${path}`, init);
  } catch (err) {
    throw new LedgerConnectError(formatLedgerNetworkError(err, path));
  }
}

export function formatLedgerNetworkError(err: unknown, path = ""): string {
  if (err instanceof LedgerConnectError) return err.message;
  if (err instanceof LedgerApiError) return err.message;
  const failedFetch =
    err instanceof TypeError &&
    (err.message === "Failed to fetch" || err.message.includes("NetworkError"));
  if (failedFetch) {
    const suffix = path ? `（${path}）` : "";
    return `无法连接财务服务${suffix}。请确认 Insight 已打开且 Finance sidecar 已启动；开发模式可查看 %TEMP%\\orbita-ledger.log，或点击重试。`;
  }
  if (err instanceof Error) return err.message;
  return path ? `请求 ${path} 失败` : "财务服务请求失败";
}

export async function fetchLedgerHealth(): Promise<LedgerHealth | null> {
  const base = await resolveLedgerApiBase();
  return fetchHealth(base);
}

async function fetchHealth(base: string): Promise<LedgerHealth | null> {
  try {
    const res = await fetch(`${base}/health`);
    if (!res.ok) return null;
    return (await res.json()) as LedgerHealth;
  } catch {
    return null;
  }
}

export function isLedgerParserCurrent(health: LedgerHealth | null): boolean {
  return (
    health?.ok === true &&
    health.parser_rev === EXPECTED_LEDGER_PARSER_REV &&
    health.beancount_ok !== false
  );
}

export async function checkHealth(): Promise<boolean> {
  const base = await resolveLedgerApiBase();
  for (let i = 0; i < 10; i++) {
    const data = await fetchHealth(base);
    if (isLedgerParserCurrent(data)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export async function fetchAccounts(): Promise<AccountsResponse> {
  const res = await ledgerFetch("/api/accounts");
  if (!res.ok) throw new LedgerApiError("加载账户失败", res.status);
  return res.json();
}

export async function fetchSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  const res = await ledgerFetch("/api/settings", { signal });
  if (!res.ok) throw new LedgerApiError("加载设置失败", res.status);
  return res.json();
}

/** Changes only Finance display settings; it never enters the ledger Commit path. */
export async function updateSettings(
  payload: SettingsResponse,
  signal?: AbortSignal,
): Promise<SettingsResponse> {
  const res = await ledgerFetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const data = (await res.json()) as SettingsResponse & { error?: string };
  if (res.status === 409) {
    throw new LedgerApiError(data.error || "设置已被其他会话更新，请重试", res.status, data);
  }
  if (!res.ok) throw new LedgerApiError(data.error || "保存设置失败", res.status, data);
  return data;
}

export async function fetchStats(signal?: AbortSignal): Promise<StatsResponse> {
  const res = await ledgerFetch("/api/stats", { signal });
  const data = (await res.json()) as StatsResponse;
  if (!res.ok || !data.ok) {
    throw new LedgerApiError(data.error || "加载统计失败", res.status, data);
  }
  return data;
}

export async function fetchAccountPeriodStats(
  params: { account: string; date_from?: string; date_to?: string },
  signal?: AbortSignal,
): Promise<AccountPeriodStatsResponse> {
  const q = new URLSearchParams({ account: params.account });
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  const res = await ledgerFetch(`/api/stats/account-period?${q.toString()}`, { signal });
  const data = (await res.json()) as AccountPeriodStatsResponse;
  if (!res.ok || !data.ok) {
    throw new LedgerApiError(data.error || "加载账户期间统计失败", res.status, data);
  }
  return data;
}

export async function fetchEntries(
  params: EntriesQuery = {},
  signal?: AbortSignal,
): Promise<EntriesResponse> {
  const q = new URLSearchParams();
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  const res = await ledgerFetch(`/api/entries${qs ? `?${qs}` : ""}`, { signal });
  if (!res.ok) throw new LedgerApiError("加载明细失败", res.status);
  const data = (await res.json()) as EntriesResponse;
  return {
    ...data,
    entries: (data.entries || []).map((raw) => normalizeDetailItem(raw as DetailItem)),
  };
}

export async function postCommit(payload: CommitPayload): Promise<{ res: Response; data: CommitResponse }> {
  const res = await ledgerFetch("/api/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as CommitResponse;
  if (!res.ok) {
    throw new LedgerApiError(data.error || "保存失败", res.status, data);
  }
  return { res, data };
}

export async function postValidate(
  items: DetailItem[],
): Promise<{ res: Response; data: ValidateResponse }> {
  const res = await ledgerFetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: items.map(detailItemForApi) }),
  });
  const data = (await res.json()) as ValidateResponse;
  if (!res.ok && res.status !== 400) {
    throw new LedgerApiError("校验失败", res.status, data);
  }
  return { res, data };
}

export async function postAccountDeleteScan(name: string): Promise<AccountDeleteScanResponse> {
  const res = await ledgerFetch("/api/accounts/delete-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await res.json()) as AccountDeleteScanResponse;
  if (!res.ok) {
    throw new LedgerApiError(data.error || "删除扫描失败", res.status, data);
  }
  return data;
}

export async function postAccountDelete(
  name: string,
): Promise<{ res: Response; data: { ok: boolean; error?: string } }> {
  const res = await ledgerFetch("/api/accounts/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok) {
    throw new LedgerApiError(data.error || "删除失败", res.status, data);
  }
  return { res, data };
}

export async function postAccountCreate(payload: {
  name: string;
  open_date?: string;
  extra?: string;
  label?: string;
}): Promise<{ res: Response; data: { ok: boolean; error?: string } }> {
  const res = await ledgerFetch("/api/accounts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok) {
    throw new LedgerApiError(data.error || "创建失败", res.status, data);
  }
  return { res, data };
}

export async function postAccountMigrateScan(
  old_name: string,
  new_name: string,
): Promise<AccountMigrateScanResponse> {
  const res = await ledgerFetch("/api/accounts/migrate/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_name, new_name }),
  });
  const data = (await res.json()) as AccountMigrateScanResponse;
  if (!res.ok) {
    throw new LedgerApiError(data.error || "迁移扫描失败", res.status, data);
  }
  return data;
}

export async function postAccountMigrateValidate(
  old_name: string,
  new_name: string,
): Promise<AccountMigrateValidateResponse> {
  const res = await ledgerFetch("/api/accounts/migrate/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_name, new_name }),
  });
  const data = (await res.json()) as AccountMigrateValidateResponse;
  if (!res.ok && res.status !== 400) {
    throw new LedgerApiError(data.error || "迁移校验失败", res.status, data);
  }
  return data;
}

export async function postAccountMigrateCommit(payload: {
  old_name: string;
  new_name: string;
  validation_token: string;
  candidate_hash: string;
}): Promise<{ res: Response; data: { ok: boolean; error?: string } }> {
  const res = await ledgerFetch("/api/accounts/migrate/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok) {
    throw new LedgerApiError(data.error || "迁移失败", res.status, data);
  }
  return { res, data };
}

export async function postAccountLabelCommit(
  payload: AccountLabelCommitPayload,
): Promise<{ res: Response; data: { ok: boolean; error?: string } }> {
  const res = await ledgerFetch("/api/accounts/label", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok) {
    throw new LedgerApiError(data.error || "标签保存失败", res.status, data);
  }
  return { res, data };
}

export async function postCategoriesCommit(
  payload: CategoryCommitPayload,
): Promise<{ res: Response; data: { ok: boolean; error?: string } }> {
  const res = await ledgerFetch("/api/categories/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok) {
    throw new LedgerApiError(data.error || "分类保存失败", res.status, data);
  }
  return { res, data };
}
