import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { checkHealth, fetchAccounts, LedgerConnectError, resetLedgerApiBase } from "./api/client";
import { mountLedgerShell, type LedgerRouter, type LedgerView } from "./shell";
import { setAccounts } from "./state/accounts";
import { loadCategoriesFromAccounts } from "./state/categories";
import { isLedgerDirty, loadDetail, loadSettings } from "./state/ledger";
import { mountDashboardView } from "./views/dashboard";
import { mountDetailView } from "./views/detail";
import { mountImportView } from "./views/import";
import { mountStatsView } from "./views/stats";
import "./ui/ledger.css";

export { getWriteTarget } from "./state/write-target";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (isLedgerDirty()) e.preventDefault();
}

class LedgerNotReadyError extends Error {
  constructor() {
    super("not-ready");
    this.name = "LedgerNotReadyError";
  }
}

const OVERWRITE_TOOLTIP = "目录已存在且不为空，确认后会覆写所有文件";

async function retryLedger(connect: () => Promise<void>): Promise<void> {
  if (isTauri()) {
    resetLedgerApiBase();
    await invoke("restart_ledger_sidecar");
  }
  void connect();
}

async function showNotReadyPanel(
  panel: HTMLElement,
  ac: AbortController,
  connect: () => Promise<void>,
): Promise<void> {
  let overwrite = false;
  if (isTauri()) {
    try {
      overwrite = await invoke<boolean>("ledger_bill_nonempty");
    } catch {
      overwrite = false;
    }
  }

  const initLabel = overwrite ? "新建（覆写）" : "新建";
  const initClass = overwrite
    ? "ledger-error-btn ledger-error-btn-overwrite"
    : "ledger-error-btn ledger-error-btn-primary";
  const tooltipAttr = overwrite ? ` data-tooltip="${OVERWRITE_TOOLTIP}"` : "";

  panel.innerHTML = `
    <div class="ledger-error">
      <p class="ledger-error-title">资产管理服务未就绪</p>
      <p class="ledger-error-msg">需要存在账本文件：account.bean、category.bean、ledger/*.bean</p>
      <div class="ledger-error-actions">
        <button type="button" class="${initClass}" id="ledger-init"${tooltipAttr}>${initLabel}</button>
        <button type="button" class="ledger-error-btn" id="ledger-retry">重试</button>
      </div>
    </div>`;
  panel.querySelector<HTMLButtonElement>("#ledger-init")?.addEventListener(
    "click",
    async () => {
      if (overwrite && !window.confirm(OVERWRITE_TOOLTIP)) return;
      if (isTauri()) {
        await invoke("init_ledger_bill", { overwrite });
        await invoke("restart_ledger_sidecar");
      }
      void connect();
    },
    { signal: ac.signal },
  );
  panel.querySelector<HTMLButtonElement>("#ledger-retry")?.addEventListener(
    "click",
    () => void retryLedger(connect),
    { signal: ac.signal },
  );
}

function showConnectErrorPanel(
  panel: HTMLElement,
  ac: AbortController,
  msg: string,
  connect: () => Promise<void>,
): void {
  panel.innerHTML = `
    <div class="ledger-error">
      <p class="ledger-error-title">无法连接记账服务</p>
      <p class="ledger-error-msg">${escapeHtml(msg)}</p>
      <div class="ledger-error-actions">
        <button type="button" class="ledger-error-btn" id="ledger-retry">重试</button>
      </div>
    </div>`;
  panel.querySelector<HTMLButtonElement>("#ledger-retry")?.addEventListener(
    "click",
    () => void retryLedger(connect),
    { signal: ac.signal },
  );
}

export function mountLedgerApp(panel: HTMLElement): () => void {
  const ac = new AbortController();
  let unmountShell: (() => void) | null = null;

  async function connect(): Promise<void> {
    panel.innerHTML = `<div class="ledger-loading"><span class="ledger-loading-spinner" aria-hidden="true"></span><p>正在连接记账服务…</p></div>`;
    resetLedgerApiBase();
    try {
      const ok = await checkHealth();
      if (!ok) throw new Error("记账服务健康检查未通过");
      await loadSettings();
      const accounts = await fetchAccounts();
      const accountCount = Object.values(accounts).reduce((n, g) => n + g.length, 0);
      if (accountCount === 0) throw new LedgerNotReadyError();
      setAccounts(accounts);
      loadCategoriesFromAccounts(accounts);
      if (ac.signal.aborted) return;
      panel.innerHTML = "";
      unmountShell = mountLedgerShell(panel, (view, viewPanel, router) => {
        switch (view) {
          case "dashboard":
            return mountDashboardView(viewPanel, router);
          case "detail":
            return mountDetailView(viewPanel, router);
          case "stats":
            return mountStatsView(viewPanel);
          case "import":
            return mountImportView(viewPanel, router);
        }
      });
      window.addEventListener("beforeunload", onBeforeUnload, { signal: ac.signal });
      window.addEventListener(
        "orbita:ledger-settings-changed",
        () => {
          unmountShell?.();
          unmountShell = null;
          void connect();
        },
        { signal: ac.signal },
      );
      void loadDetail();
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err instanceof LedgerNotReadyError) {
        void showNotReadyPanel(panel, ac, connect);
        return;
      }
      const msg =
        err instanceof LedgerConnectError || err instanceof Error
          ? err.message
          : "连接失败";
      showConnectErrorPanel(panel, ac, msg, connect);
    }
  }

  void connect();

  return () => {
    ac.abort();
    unmountShell?.();
  };
}

export type { LedgerView, LedgerRouter };
