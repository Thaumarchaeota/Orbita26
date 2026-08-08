import type { LedgerRouter } from "../../shell";

export function mountDashboardView(panel: HTMLElement, router: LedgerRouter): () => void {
  const ac = new AbortController();
  const { signal } = ac;

  panel.innerHTML = `
    <div class="dashboard-view">
      <div class="dashboard-header">
        <button type="button" class="dashboard-import-btn" id="dashboard-import">导入</button>
      </div>
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
        <div class="dashboard-recent-list">
          <div class="dashboard-recent-row"><span class="dashboard-recent-date">—</span><span class="dashboard-recent-desc">暂无数据</span><span class="dashboard-recent-amount">—</span></div>
          <div class="dashboard-recent-row"><span class="dashboard-recent-date">—</span><span class="dashboard-recent-desc">—</span><span class="dashboard-recent-amount">—</span></div>
          <div class="dashboard-recent-row"><span class="dashboard-recent-date">—</span><span class="dashboard-recent-desc">—</span><span class="dashboard-recent-amount">—</span></div>
        </div>
      </section>
    </div>`;

  panel.querySelector("#dashboard-import")!.addEventListener(
    "click",
    () => router.navigate("import"),
    { signal },
  );
  panel.querySelector("#dashboard-all")!.addEventListener(
    "click",
    () => router.navigate("detail"),
    { signal },
  );
  panel.querySelectorAll<HTMLButtonElement>(".dashboard-metric-card").forEach((btn) => {
    btn.addEventListener("click", () => router.navigate("stats"), { signal });
  });

  return () => ac.abort();
}
