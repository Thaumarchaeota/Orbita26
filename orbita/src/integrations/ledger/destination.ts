import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { getConfirmDialog } from "../shell/dialog";
import { getSettings } from "../../core/settings";
import type { InsightDestinationHandle, InsightHostContext } from "../admin/types";
import "../../ui/theme-action-motion.css";
import "./ui/ledger.css";
import {
  checkHealth,
  fetchAccounts,
  fetchSettings,
  fetchLedgerHealth,
  isLedgerParserCurrent,
  LedgerConnectError,
  resetLedgerApiBase,
} from "./api/client";
import { syncFinanceCardStripes } from "./ui/card-stripe-tokens";
import { mountLedgerShell, type LedgerRouter, type LedgerShellHandle, type LedgerShellState, type LedgerView, type LedgerViewHandle } from "./shell";
import { setAccounts } from "./state/accounts";
import { loadCategoriesFromAccounts } from "./state/categories";
import { invalidateLedgerLoads, isLedgerDirty, loadDetail, loadSettings } from "./state/ledger";
import { mountDashboardView } from "./views/dashboard";
import { mountDetailView } from "./views/detail";
import { mountStatsView } from "./views/stats";
import { mountStructureManagerView } from "./views/structure-manager";

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
      <p class="ledger-error-title">财务服务未就绪</p>
      <p class="ledger-error-msg">需要存在账本文件：account.bean、category.bean、ledger/*.bean</p>
      <div class="ledger-error-actions">
        <button type="button" class="${initClass}" id="ledger-init"${tooltipAttr}>${initLabel}</button>
        <button type="button" class="ledger-error-btn" id="ledger-retry">重试</button>
      </div>
    </div>`;
  panel.querySelector<HTMLButtonElement>("#ledger-init")?.addEventListener(
    "click",
    async () => {
      if (overwrite && !(await getConfirmDialog()("新建账本", OVERWRITE_TOOLTIP, undefined, { confirmLabel: "新建（覆写）", danger: true }))) return;
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
      <p class="ledger-error-title">无法连接财务服务</p>
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

export function mountLedgerDestination(
  panel: HTMLElement,
  ctx: InsightHostContext,
): InsightDestinationHandle {
  const ac = new AbortController();
  let shell: LedgerShellHandle | null = null;
  let pendingRestore: LedgerShellState | null = null;
  let connectGen = 0;
  let beforeUnloadBound = false;
  const mountDataDirKey = ctx.dataDirKey;
  let inactive = true;
  let boundGeneration = ctx.generation;

  function isStale(gen: number): boolean {
    return (
      ac.signal.aborted ||
      gen !== connectGen ||
      inactive ||
      ctx.generation !== boundGeneration ||
      (getSettings().dataDir || "_default") !== mountDataDirKey
    );
  }

  async function connect(): Promise<void> {
    const gen = ++connectGen;
    invalidateLedgerLoads();
    panel.innerHTML = `<div class="ledger-loading"><span class="ledger-loading-spinner" aria-hidden="true"></span><p>正在连接财务服务…</p></div>`;
    resetLedgerApiBase();
    try {
      if (isTauri()) {
        const health = await fetchLedgerHealth();
        if (health?.ok && !isLedgerParserCurrent(health)) {
          await invoke("restart_ledger_sidecar");
          resetLedgerApiBase();
        }
      }
      const ok = await checkHealth();
      if (!ok) throw new Error("财务服务健康检查未通过");
      await loadSettings();
      if (isStale(gen)) return;
      const accounts = await fetchAccounts();
      const accountCount = Object.values(accounts).reduce((n, g) => n + g.length, 0);
      if (accountCount === 0) throw new LedgerNotReadyError();
      setAccounts(accounts);
      loadCategoriesFromAccounts(accounts);
      if (isStale(gen)) return;
      panel.innerHTML = "";
      shell = mountLedgerShell(panel, (view, viewPanel, router) => {
        switch (view) {
          case "dashboard":
            return mountDashboardView(viewPanel, router);
          case "detail":
            return mountDetailView(viewPanel, router);
          case "stats":
            return mountStatsView(viewPanel, router);
          case "structure":
            return mountStructureManagerView(viewPanel, router);
        }
      });
      const ledgerApp = panel.querySelector<HTMLElement>(".ledger-app");
      if (ledgerApp) {
        try {
          const displaySettings = await fetchSettings();
          if (!isStale(gen)) syncFinanceCardStripes(ledgerApp, displaySettings.card_stripes);
        } catch {
          if (!isStale(gen)) syncFinanceCardStripes(ledgerApp);
        }
      }
      if (import.meta.env.DEV && window.location.hash === "#dev-finance-detail") {
        shell.restoreState({ activeView: "detail", scrollByView: {} });
      } else if (pendingRestore) {
        shell.restoreState(pendingRestore);
        pendingRestore = null;
      }
      if (!beforeUnloadBound) {
        window.addEventListener("beforeunload", onBeforeUnload, { signal: ac.signal });
        beforeUnloadBound = true;
      }
      if (isStale(gen)) return;
      void loadDetail();
    } catch (err) {
      if (isStale(gen)) return;
      if (err instanceof LedgerNotReadyError) {
        void showNotReadyPanel(panel, ac, connect);
        return;
      }
      const msg =
        err instanceof LedgerConnectError || err instanceof Error ? err.message : "连接失败";
      showConnectErrorPanel(panel, ac, msg, connect);
    }
  }

  return {
    activate() {
      inactive = false;
      boundGeneration = ctx.generation;
      if (!shell && !ac.signal.aborted) void connect();
    },
    deactivate() {
      inactive = true;
    },
    getRestoreState() {
      return shell?.getRestoreState() ?? pendingRestore ?? undefined;
    },
    restoreState(state) {
      const s = state as LedgerShellState;
      if (shell) shell.restoreState(s);
      else pendingRestore = s;
    },
    canDispose(reason) {
      if (reason === "data-dir-change" && isLedgerDirty()) {
        return getConfirmDialog()(
          "切换数据目录",
          "有未保存的账本更改。切换数据目录将丢弃这些更改。是否继续？",
          undefined,
          { confirmLabel: "继续", danger: true },
        );
      }
      return true;
    },
    dispose() {
      ac.abort();
      invalidateLedgerLoads();
      shell?.dispose();
      shell = null;
      pendingRestore = null;
      beforeUnloadBound = false;
      panel.innerHTML = "";
    },
  };
}

/** @deprecated use mountLedgerDestination via Insight Host */
export function mountLedgerApp(panel: HTMLElement): () => void {
  const handle = mountLedgerDestination(panel, { generation: 0, dataDirKey: "" });
  return () => handle.dispose("host-dispose");
}

export type { LedgerView, LedgerRouter, LedgerViewHandle };
