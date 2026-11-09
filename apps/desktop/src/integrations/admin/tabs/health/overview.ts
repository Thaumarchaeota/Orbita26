import {
  garminSync,
  healthOverviewQuery,
  healthSyncStatus,
} from "../../../journal/client";
import type { InsightDestinationHandle, InsightHostContext } from "../../types";
import { mountHealthTracksView, type HealthTracksViewHandle } from "../../timeline/health-tracks-view";
import { loadLegendState } from "./legend";
import { addDays, beijingToday, trackBufferWindow } from "./format";
import { createActivityPageHost, mountActivityListSection } from "./activity-page";
import { mountMealHistorySection } from "./meal-history";
import { renderSummary } from "./summary";
import { renderTrends } from "./trends";
import type {
  HealthOverviewResponse,
  HealthSyncStatus,
  TrendWindow,
} from "./types";
import "./health.css";
import "./activity-page.css";

function formatLoadError(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "无法加载 Health 数据";
}

function emptyOverview(date: string): HealthOverviewResponse {
  return {
    track: { sleepBlocks: [], series: [], activities: [], meals: [] },
    trends: [],
    daySummary: {
      date,
      cards: [],
      energy: {
        mealCount: 0,
        intakeKcal: null,
        burnKcal: null,
        deltaKcal: null,
        daysWithMeals: 0,
        daysInWindow: 7,
      },
    },
    localDateRange: null,
  };
}

export function mountHealthOverview(root: HTMLElement, _ctx: InsightHostContext): InsightDestinationHandle {
  const ac = new AbortController();
  const legend = loadLegendState();

  let trendDays: TrendWindow = 7;
  let overview = emptyOverview(beijingToday());
  let syncStatus: HealthSyncStatus = {
    lastSuccessAt: null,
    syncing: false,
    lastError: null,
    earliestLocalDate: null,
    latestLocalDate: null,
  };
  let tracksView: HealthTracksViewHandle | null = null;
  let activityList: { reload: () => Promise<void> } | null = null;
  let mealHistory: { reload: () => Promise<void> } | null = null;
  let loading = false;
  let loadError: string | null = null;
  let summaryTimer = 0;

  root.innerHTML = `
    <div class="health-app">
      <div class="health-scroll">
        <div data-region="tracks-view"></div>
        <div data-region="activity-list"></div>
        <div data-region="meal-history"></div>
        <section class="health-section">
          <div class="health-section-head">
            <h3 class="health-section-title">长期趋势</h3>
            <div class="health-section-head-actions">
              <div class="health-trend-tabs" role="tablist">
                <button type="button" class="health-trend-tab is-active" data-days="7">7D</button>
                <button type="button" class="health-trend-tab" data-days="30">30D</button>
                <button type="button" class="health-trend-tab" data-days="90">90D</button>
                <button type="button" class="health-trend-tab" data-days="365">1Y</button>
              </div>
              <button type="button" class="health-btn health-btn-subtle" data-action="fetch-history" hidden>获取更多历史</button>
            </div>
          </div>
          <div data-region="trends"></div>
        </section>
        <div data-region="summary"></div>
      </div>
    </div>`;

  const healthApp = root.querySelector<HTMLElement>(".health-app")!;
  const tracksMount = root.querySelector<HTMLElement>('[data-region="tracks-view"]')!;
  const activityListMount = root.querySelector<HTMLElement>('[data-region="activity-list"]')!;
  const mealHistoryMount = root.querySelector<HTMLElement>('[data-region="meal-history"]')!;
  const trendsRegion = root.querySelector<HTMLElement>('[data-region="trends"]')!;
  const summaryRegion = root.querySelector<HTMLElement>('[data-region="summary"]')!;
  const fetchHistoryBtn = root.querySelector<HTMLButtonElement>('[data-action="fetch-history"]')!;

  const activityHost = createActivityPageHost(healthApp, ac.signal);
  activityList = mountActivityListSection(activityListMount, activityHost, ac.signal);
  mealHistory = mountMealHistorySection(mealHistoryMount, ac.signal);

  tracksView = mountHealthTracksView(tracksMount, {
    signal: ac.signal,
    legend,
    trendDays,
    showSyncButton: true,
    onDateChange: () => {
      scheduleSummaryReload();
    },
    onActivityClick: (id) => activityHost.openDetail(id),
  });

  function updateFetchHistory(): void {
    const selectedDate = tracksView!.getSelectedDate();
    const needsMore =
      trendDays > 7 &&
      overview.localDateRange &&
      selectedDate < addDays(overview.localDateRange.earliest, trendDays - 7);
    fetchHistoryBtn.hidden = !needsMore;
  }

  function renderLoadError(): void {
    const existing = root.querySelector<HTMLElement>("[data-region=load-error]");
    existing?.remove();
    if (!loadError) return;
    const el = document.createElement("div");
    el.className = "health-load-error";
    el.dataset.region = "load-error";
    el.textContent = loadError;
    root.querySelector(".health-scroll")?.prepend(el);
  }

  function paintSummaryAndTrends(): void {
    renderTrends(trendsRegion, overview.trends);
    renderSummary(summaryRegion, overview.daySummary);
    updateFetchHistory();
    renderLoadError();
    root.querySelectorAll<HTMLButtonElement>(".health-trend-tab").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.days) === trendDays);
    });
  }

  function scheduleSummaryReload(): void {
    window.clearTimeout(summaryTimer);
    summaryTimer = window.setTimeout(() => {
      void reloadSummary();
    }, 280);
  }

  async function reloadSummary(): Promise<void> {
    const selectedDate = tracksView!.getSelectedDate();
    const trackWindow = tracksView!.getTrackWindow();
    const loaded = tracksView!.getLoadedBounds();
    try {
      const res = await healthOverviewQuery({
        selectedDate,
        trackFromUtc: loaded.fromUtc || trackBufferWindow(trackWindow.fromUtc, trackWindow.toUtc).fromUtc,
        trackToUtc: loaded.toUtc || trackBufferWindow(trackWindow.fromUtc, trackWindow.toUtc).toUtc,
        trendDays,
      });
      overview = {
        ...overview,
        daySummary: res.daySummary,
        trends: res.trends,
        localDateRange: res.localDateRange ?? overview.localDateRange,
      };
      if (res.localDateRange?.earliest) {
        tracksView!.setEarliestLocalDate(res.localDateRange.earliest);
      }
      paintSummaryAndTrends();
    } catch {
      /* keep current summary on transient errors */
    }
  }

  async function refreshSyncStatus(): Promise<void> {
    try {
      syncStatus = await healthSyncStatus();
    } catch {
      syncStatus = { ...syncStatus, lastError: "无法读取同步状态" };
    }
    if (syncStatus.earliestLocalDate) {
      tracksView!.setEarliestLocalDate(syncStatus.earliestLocalDate);
    }
  }

  async function loadOverview(opts: { full?: boolean } = {}): Promise<void> {
    if (loading) return;
    loading = true;
    loadError = null;
    try {
      const selectedDate = tracksView!.getSelectedDate();
      const trackWindow = tracksView!.getTrackWindow();
      const loaded = tracksView!.getLoadedBounds();
      overview = await healthOverviewQuery({
        selectedDate,
        trackFromUtc: loaded.fromUtc || trackBufferWindow(trackWindow.fromUtc, trackWindow.toUtc).fromUtc,
        trackToUtc: loaded.toUtc || trackBufferWindow(trackWindow.fromUtc, trackWindow.toUtc).toUtc,
        trendDays,
      });
      if (overview.localDateRange?.earliest) {
        tracksView!.setEarliestLocalDate(overview.localDateRange.earliest);
      }
    } catch (err) {
      loadError = formatLoadError(err);
      overview = emptyOverview(tracksView!.getSelectedDate());
    } finally {
      loading = false;
      paintSummaryAndTrends();
      if (opts.full) {
        await tracksView!.reload({ full: true });
      }
    }
  }

  root.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action],[data-days]");
      if (!btn) return;
      if (btn.dataset.action === "fetch-history") {
        void (async () => {
          syncStatus = { ...syncStatus, syncing: true };
          try {
            const to = beijingToday();
            const from = addDays(to, -(trendDays - 1));
            await garminSync({ from, to });
            tracksView!.resetCache();
            await loadOverview({ full: true });
            await refreshSyncStatus();
          } catch (err) {
            syncStatus = {
              ...syncStatus,
              lastError: err instanceof Error ? err.message : "获取历史失败",
            };
          } finally {
            syncStatus = { ...syncStatus, syncing: false };
          }
        })();
        return;
      }
      const days = btn.dataset.days;
      if (days) {
        trendDays = Number(days) as TrendWindow;
        tracksView!.setTrendDays(trendDays);
        void loadOverview({ full: true });
      }
    },
    { signal: ac.signal },
  );

  return {
    activate() {
      void refreshSyncStatus();
      void tracksView!.activate();
      void loadOverview();
      void activityList!.reload();
      void mealHistory!.reload();
    },
    deactivate() {
      tracksView!.deactivate();
    },
    dispose() {
      window.clearTimeout(summaryTimer);
      tracksView!.dispose();
      ac.abort();
      root.innerHTML = "";
    },
  };
}
