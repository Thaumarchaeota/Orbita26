import type { LedgerRouter, LedgerViewHandle } from "../../shell";
import { onDetailMutated } from "../../state/ledger";
import { mountFinancePage } from "../../ui/page-shell";
import { renderRecentTransactions } from "./recent";

const DASHBOARD_BODY_HTML = `
  <div class="dashboard-view">
    <button type="button" class="dashboard-import-btn" id="dashboard-import">导入</button>
    <div class="dashboard-metrics">
      <button type="button" class="dashboard-metric-card" data-nav="stats">
        <span class="dashboard-metric-label">总资产</span>
        <span class="dashboard-metric-value">—</span>
      </button>
      <button type="button" class="dashboard-metric-card" data-nav="stats">
        <span class="dashboard-metric-label">本月支出</span>
        <span class="dashboard-metric-value">—</span>
      </button>
      <button type="button" class="dashboard-metric-card" data-nav="stats">
        <span class="dashboard-metric-label">本月收入</span>
        <span class="dashboard-metric-value">—</span>
      </button>
    </div>
    <section class="dashboard-recent">
      <div class="dashboard-recent-header">
        <h2 class="dashboard-recent-title">最近交易</h2>
        <button type="button" class="dashboard-recent-all" id="dashboard-all">全部</button>
      </div>
      <div class="dashboard-recent-list" id="dashboard-recent-list"></div>
    </section>
  </div>`;

/** Finance Hub：无返回键，仅顶栏标题「资产」 */
export function mountDashboardView(panel: HTMLElement, router: LedgerRouter): LedgerViewHandle {
  const page = mountFinancePage(panel, {
    title: "资产",
    showBack: false,
    showManage: true,
    onManage: () => router.navigate("structure"),
    renderBody(bodyEl) {
      const ac = new AbortController();
      const { signal } = ac;

      bodyEl.innerHTML = DASHBOARD_BODY_HTML;
      const recentList = bodyEl.querySelector<HTMLElement>("#dashboard-recent-list")!;
      renderRecentTransactions(recentList);
      const unsubRecent = onDetailMutated(() => renderRecentTransactions(recentList));

      bodyEl.querySelector("#dashboard-import")!.addEventListener(
        "click",
        (event) => {
          router.navigate("detail", {
            onReady: (detail) => detail.openImport?.(event.currentTarget as HTMLElement),
          });
        },
        { signal },
      );
      bodyEl.querySelector("#dashboard-all")!.addEventListener(
        "click",
        () => router.navigate("detail"),
        { signal },
      );
      bodyEl.querySelectorAll<HTMLButtonElement>(".dashboard-metric-card").forEach((btn) => {
        btn.addEventListener("click", () => router.navigate("stats"), { signal });
      });

      return () => {
        unsubRecent();
        ac.abort();
      };
    },
  });

  return {
    getScrollEl: () => page.getScrollEl(),
    dispose() {
      page.unmount();
    },
  };
}
