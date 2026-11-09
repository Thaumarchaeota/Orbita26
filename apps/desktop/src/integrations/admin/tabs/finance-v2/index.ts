import type { InsightDestination, InsightDestinationHandle, InsightHostContext } from "../../types";
import { getSettings } from "../../../../core/data/settings";
import { waitInFlight, setDirtyStatus } from "../../tab-host/dirty";
import { createSessionGuardedBackend, getFinanceV2Backend, installFinanceV2Backend } from "../../../finance-v2/client";
import { financeV2TauriBackend } from "../../../finance-v2/tauri-backend";
import type { FinanceImportBatchView, FinancePage, IsolatedFinanceSession } from "../../../finance-v2/types";
import { action, el, section, setStatus, statusNode } from "./dom";
import { mountEnvironment } from "./environment";
import { mountManagement } from "./management";
import { mountImportWorkflow } from "./import-workflow";
import { mountHistory } from "./history";
import { mountRules } from "./rules";
import { mountRecovery } from "./recovery";
import { mountReports } from "./reports";
import { mountReconciliationWorkspace } from "./reconciliation-workspace";
import "./finance-v2.css";

installFinanceV2Backend(financeV2TauriBackend);

const pages: Array<{ id: FinancePage; label: string }> = [
  { id: "overview", label: "总览" }, { id: "management", label: "账户与来源" },
  { id: "import", label: "导入" }, { id: "workspace", label: "核对工作区" },
  { id: "history", label: "历史" }, { id: "rules", label: "分类规则" },
  { id: "recovery", label: "提交与恢复" }, { id: "reports", label: "报表" },
];

function mountFinanceV2(root: HTMLElement, ctx: InsightHostContext): InsightDestinationHandle {
  const backend = getFinanceV2Backend();
  const ac = new AbortController();
  const surfaceKey = root.dataset.surface ? `${root.dataset.surface}:finance-v2` : `finance-v2:${ctx.generation}`;
  let session: IsolatedFinanceSession | null = null;
  let batch: FinanceImportBatchView | null = null;
  let workspaceWatermark: { revision: number; durableRevision: number } | null = null;
  let activePage: FinancePage = "overview";
  let pageDispose: (() => void) | null = null;
  let busy = 0;
  const draftDirty = () => workspaceWatermark
    ? workspaceWatermark.durableRevision < workspaceWatermark.revision
    : Boolean(batch && batch.durableRevision < batch.draftRevision);
  const trackedBackend = backend ? trackBackendCalls(backend, () => {
    setDirtyStatus(surfaceKey, { dirty: draftDirty(), inFlight: busy > 0, failed: false });
  }, (delta) => { busy = Math.max(0, busy + delta); }) : null;

  const shell = el("div", "finance-v2-app");
  const gate = el("div", "finance-v2-gate");
  const nav = el("nav", "finance-v2-nav");
  nav.setAttribute("aria-label", "Finance v2 页面");
  const main = el("main", "finance-v2-main");
  const status = statusNode();
  shell.append(gate, nav, main, status);
  root.replaceChildren(shell);

  const setSession = (next: IsolatedFinanceSession | null) => {
    pageDispose?.(); pageDispose = null;
    session = next;
    batch = null;
    workspaceWatermark = null;
    if (!session) {
      nav.hidden = true; main.replaceChildren();
      setDirtyStatus(surfaceKey, { dirty: false, inFlight: busy > 0, failed: false });
      return;
    }
    nav.hidden = false;
    renderNav();
    show(activePage);
  };

  const environment = mountEnvironment(gate, trackedBackend, setSession, environmentPreferenceScope(ctx));
  const renderNav = () => {
    nav.replaceChildren();
    for (const page of pages) {
      const button = action(page.label, () => show(page.id));
      button.setAttribute("aria-current", activePage === page.id ? "page" : "false");
      nav.append(button);
    }
  };
  const runPage = (mount: (target: HTMLElement) => { dispose(): void }) => {
    pageDispose?.(); pageDispose = null; main.replaceChildren();
    const guarded = trackedBackend && session ? createSessionGuardedBackend(trackedBackend, session) : null;
    if (!guarded || !session) {
      main.append(section("尚未接线", "隔离 Finance v2 后端尚未安装。页面保持空白，不读取账本数据。"));
      return;
    }
    let handle: { dispose(): void };
    try { handle = mount(main); }
    catch (error) { setStatus(status, errorText(error), "error"); setDirtyStatus(surfaceKey, { dirty: draftDirty(), inFlight: busy > 0, failed: true }); return; }
    pageDispose = () => { handle.dispose(); };
  };
  function show(page: FinancePage): void {
    if (!session) { setStatus(status, "请先显式验证隔离环境。", "info"); return; }
    activePage = page; renderNav();
    switch (page) {
      case "overview":
        runPage((target) => {
          const overview = section("Finance v2", "所有数据操作都绑定当前已验证的隔离环境。真实账本与 Archive 不会自动选择或读取。");
          const info = el("pre", "finance-v2-identity", `隔离账本 ${session!.workspaceId}\nGeneration ${session!.generation}\n草稿 ${batch ? `r${batch.draftRevision}（持久 r${batch.durableRevision}）` : "无已确认导入批次"}`);
          overview.append(info); target.append(overview);
          return { dispose() { target.replaceChildren(); } };
        });
        break;
      case "management": runPage((target) => mountManagement(target, createSessionGuardedBackend(trackedBackend!, session!), session!)); break;
      case "import": runPage((target) => mountImportWorkflow(target, createSessionGuardedBackend(trackedBackend!, session!), session!, (next) => {
        batch = next;
        setDirtyStatus(surfaceKey, { dirty: draftDirty(), inFlight: busy > 0, failed: false });
      }, batch)); break;
      case "workspace":
        runPage((target) => mountReconciliationWorkspace(target, createSessionGuardedBackend(trackedBackend!, session!), session!, {
          draftId: batch?.draftId,
          batch,
          onStatus: (revision, durableRevision) => {
            workspaceWatermark = { revision, durableRevision };
            if (batch) batch = { ...batch, draftRevision: revision, durableRevision };
            setDirtyStatus(surfaceKey, { dirty: Boolean(batch && batch.durableRevision < batch.draftRevision), inFlight: busy > 0, failed: false });
          },
          onBatch: (nextBatch) => { batch = nextBatch; workspaceWatermark = { revision: nextBatch.draftRevision, durableRevision: nextBatch.durableRevision }; setDirtyStatus(surfaceKey, { dirty: nextBatch.durableRevision < nextBatch.draftRevision, inFlight: busy > 0, failed: false }); },
        }));
        break;
      case "history": runPage((target) => mountHistory(target, createSessionGuardedBackend(trackedBackend!, session!), session!)); break;
      case "rules": runPage((target) => mountRules(target, createSessionGuardedBackend(trackedBackend!, session!), session!)); break;
      case "recovery": runPage((target) => mountRecovery(target, createSessionGuardedBackend(trackedBackend!, session!), session!, batch, () => {
        batch = null;
        workspaceWatermark = null;
        setDirtyStatus(surfaceKey, { dirty: false, inFlight: busy > 0, failed: false });
      })); break;
      case "reports": runPage((target) => mountReports(target, createSessionGuardedBackend(trackedBackend!, session!), session!)); break;
    }
  }

  setDirtyStatus(surfaceKey, { dirty: false, inFlight: false, failed: false });
  return {
    activate() {},
    deactivate() {},
    async canDispose() {
      if (busy > 0) return await waitInFlight(surfaceKey, 15000);
      return true;
    },
    dispose() {
      ac.abort(); pageDispose?.(); pageDispose = null;
      environment.dispose();
      setDirtyStatus(surfaceKey, { dirty: false, inFlight: false, failed: false });
      root.replaceChildren();
    },
  };
}

export const financeV2Destination: InsightDestination = {
  id: "finance1", kind: "domain", label: "记账1", icon: "finance",
  mount(root, ctx) { return mountFinanceV2(root, ctx); },
};

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function environmentPreferenceScope(ctx: InsightHostContext): string {
  try { return getSettings().dataDir.trim() || ctx.dataDirKey; }
  catch { return ctx.dataDirKey; }
}

function trackBackendCalls(
  backend: NonNullable<ReturnType<typeof getFinanceV2Backend>>,
  update: () => void,
  change: (delta: number) => void,
): NonNullable<ReturnType<typeof getFinanceV2Backend>> {
  return new Proxy(backend, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        change(1); update();
        try {
          return Promise.resolve(value.apply(target, args)).finally(() => { change(-1); update(); });
        } catch (error) {
          change(-1); update(); throw error;
        }
      };
    },
  });
}
