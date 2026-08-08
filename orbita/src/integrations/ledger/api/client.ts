import { invoke } from "@tauri-apps/api/core";
import type {
  AccountsResponse,
  CategoryCommitPayload,
  CommitPayload,
  CommitResponse,
  EntriesQuery,
  EntriesResponse,
  Entry,
  SettingsResponse,
  ValidateResponse,
} from "../types";
import { entryForApi } from "../domain/entry";

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
  return fetch(`${base}${path}`, init);
}

export async function checkHealth(): Promise<boolean> {
  const base = await resolveLedgerApiBase();
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (!res.ok) continue;
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok === true) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export async function fetchAccounts(): Promise<AccountsResponse> {
  const res = await ledgerFetch("/api/accounts");
  if (!res.ok) throw new LedgerApiError("加载账户失败", res.status);
  return res.json();
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await ledgerFetch("/api/settings");
  if (!res.ok) throw new LedgerApiError("加载设置失败", res.status);
  return res.json();
}

export async function fetchEntries(params: EntriesQuery = {}): Promise<EntriesResponse> {
  const q = new URLSearchParams();
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  const res = await ledgerFetch(`/api/entries${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new LedgerApiError("加载明细失败", res.status);
  return res.json();
}

export async function postCommit(payload: CommitPayload): Promise<{ res: Response; data: CommitResponse }> {
  const res = await ledgerFetch("/api/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as CommitResponse;
  if (!res.ok && res.status !== 207) {
    throw new LedgerApiError("保存失败", res.status, data);
  }
  return { res, data };
}

export async function postValidate(
  entries: Entry[],
): Promise<{ res: Response; data: ValidateResponse }> {
  const res = await ledgerFetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries: entries.map(entryForApi) }),
  });
  const data = (await res.json()) as ValidateResponse;
  if (!res.ok) {
    throw new LedgerApiError("校验失败", res.status, data);
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
