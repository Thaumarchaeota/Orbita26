import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import {
  healthOverviewQuery,
  healthSyncStatus,
  bindJournalChanged,
} from "../../journal/client";
import { bindGarminSyncButton, garminSyncButtonMarkup } from "../../journal/garmin-sync-button";
import {
  addDays,
  beijingNowUnix,
  beijingToday,
  centerDateOfWindow,
  defaultTrackWindow,
  earliestTrackUtc,
  TRACK_FUTURE_HORIZON_SEC,
  trackBufferWindow,
} from "../tabs/health/format";
import { loadLegendState, type LegendState } from "../tabs/health/legend";
import { mergeTrackData, normalizeTrackData } from "../tabs/health/track-merge";
import { activityEndUtc, mountTracks } from "../tabs/health/tracks";
import type { HealthSyncStatus, HealthTrackData } from "../tabs/health/types";
import type { TimelineClock } from "./sources";
import { getConfirmDialog } from "../../shell/dialog";

const EMPTY_TRACK: HealthTrackData = {
  sleepBlocks: [],
  series: [],
  activities: [],
  meals: [],
};

export type HealthTracksViewOpts = {
  signal: AbortSignal;
  legend?: LegendState;
  trendDays?: number;
  showSyncButton?: boolean;
  earliestLocalDate?: string | null;
  onDateChange?: (date: string) => void;
  onActivityClick?: (activityId: string) => void;
  clock?: TimelineClock;
};

export type HealthTracksViewHandle = {
  activate: () => void | Promise<void>;
  deactivate: () => void;
  dispose: () => void;
  reload: (opts?: { full?: boolean }) => Promise<void>;
  resetCache: () => void;
  setTrendDays: (days: number) => void;
  setEarliestLocalDate: (date: string | null) => void;
  getSelectedDate: () => string;
  getTrackWindow: () => { fromUtc: number; toUtc: number };
  getLoadedBounds: () => { fromUtc: number; toUtc: number };
};

export function mountHealthTracksView(
  root: HTMLElement,
  opts: HealthTracksViewOpts,
): HealthTracksViewHandle {
  const legend = opts.legend ?? loadLegendState();
  const signal = opts.signal;
  const clock = opts.clock;
  const allowFuture = Boolean(clock);
  const timelineSurface = Boolean(root.closest(".timeline-app"));
  let trendDays = opts.trendDays ?? 7;
  const showSyncButton = opts.showSyncButton !== false;
  let earliestLocalDate = opts.earliestLocalDate ?? null;

  const initialClock = clock?.get();
  let selectedDate = initialClock?.selectedDate ?? beijingToday();
  let trackFrom = initialClock?.fromUtc ?? 0;
  let trackTo = initialClock?.toUtc ?? 0;
  let loadedFrom = 0;
  let loadedTo = 0;
  let trackCache = EMPTY_TRACK;
  let prefetching = false;
  let syncStatus: HealthSyncStatus = {
    lastSuccessAt: null,
    syncing: false,
    lastError: null,
    earliestLocalDate: null,
    latestLocalDate: null,
  };
  let tracksHandle: ReturnType<typeof mountTracks> | null = null;
  let loading = false;
  let panTimer = 0;
  let unbindSync: (() => void) | null = null;
  let applyingClock = false;

  function publishClock(): void {
    if (applyingClock || !clock) return;
    clock.set({ fromUtc: trackFrom, toUtc: trackTo, selectedDate });
  }

  function applyClock(next: { fromUtc: number; toUtc: number; selectedDate: string }): void {
    if (trackFrom === next.fromUtc && trackTo === next.toUtc && selectedDate === next.selectedDate) {
      return;
    }
    const dateChanged = selectedDate !== next.selectedDate;
    applyingClock = true;
    trackFrom = next.fromUtc;
    trackTo = next.toUtc;
    selectedDate = next.selectedDate;
    paintChrome();
    if (dateChanged) {
      resetCache();
      void reload({ full: true });
    } else {
      paintTracksOnly();
      void ensureTrackBuffer(trackFrom, trackTo);
    }
    applyingClock = false;
  }

  root.innerHTML = `
    <section class="health-section health-section-tracks">
      <div class="health-tracks-toolbar">
        <div class="health-tracks-toolbar-spacer" aria-hidden="true"></div>
        <div class="health-tracks-date-rail">
          <button type="button" class="health-date-nav${timelineSurface ? " orbita-picker-nav-arrow" : ""}" data-action="jump-prev-day" aria-label="前一天">${timelineSurface ? "‹‹" : "«"}</button>
          <button type="button" class="health-date-nav${timelineSurface ? " orbita-picker-nav-arrow" : ""}" data-action="pan-prev" aria-label="向左滚动">‹</button>
          <div class="health-date-picker-mount" data-region="date-picker"></div>
          <button type="button" class="health-date-nav${timelineSurface ? " orbita-picker-nav-arrow" : ""}" data-action="pan-next" aria-label="向右滚动">›</button>
          <button type="button" class="health-date-nav${timelineSurface ? " orbita-picker-nav-arrow" : ""}" data-action="jump-next-day" aria-label="后一天">${timelineSurface ? "››" : "»"}</button>
        </div>
        <div class="health-tracks-toolbar-actions"${showSyncButton ? "" : ' hidden'}>
          ${garminSyncButtonMarkup({ region: "sync-btn", accent: true })}
        </div>
      </div>
      <div data-region="tracks"></div>
    </section>`;

  const datePickerMount = root.querySelector<HTMLElement>('[data-region="date-picker"]')!;
  const syncBtn = root.querySelector<HTMLButtonElement>('[data-region="sync-btn"]');
  const tracksRegion = root.querySelector<HTMLElement>('[data-region="tracks"]')!;

  function minFromUtc(): number {
    return earliestTrackUtc(earliestLocalDate ?? syncStatus.earliestLocalDate);
  }

  function maxToUtc(): number {
    const now = Math.floor(Date.now() / 1000);
    return allowFuture ? now + TRACK_FUTURE_HORIZON_SEC : now;
  }

  if (showSyncButton && syncBtn) {
    const confirmDialog = getConfirmDialog();
    unbindSync = bindGarminSyncButton(syncBtn, {
      from: addDays(beijingToday(), -6),
      to: beijingToday(),
      signal,
      onSuccess: async () => {
        resetCache();
        await refreshSyncStatus();
        await reload({ full: true });
      },
      onError: async (message) => {
        await confirmDialog("佳明同步失败", message, syncBtn, {
          confirmLabel: "确定",
          danger: false,
          info: true,
        });
      },
    });
  }

  const datePicker = mountDecoupledDatePicker({
    defaultTrigger: { container: datePickerMount },
    value: selectedDate,
    onChange: (v) => {
      if (v) snapToDate(v);
    },
  });

  function paintTracksOnly(): void {
    if (!tracksHandle) return;
    tracksHandle.setLimits(minFromUtc(), maxToUtc());
    tracksHandle.setLoadedBounds(loadedFrom, loadedTo);
    tracksHandle.setWindow(trackFrom, trackTo);
    tracksHandle.setData(trackCache);
  }

  function paintChrome(): void {
    datePicker.setValue(selectedDate);
    const nextBtn = root.querySelector<HTMLButtonElement>('[data-action="jump-next-day"]');
    if (nextBtn) nextBtn.disabled = !allowFuture && selectedDate >= beijingToday();
  }

  function onViewMoved(from: number, to: number): void {
    trackFrom = from;
    trackTo = to;
    const center = centerDateOfWindow(from, to);
    if (center !== selectedDate) {
      selectedDate = !allowFuture && center > beijingToday() ? beijingToday() : center;
      datePicker.setValue(selectedDate);
      const nextBtn = root.querySelector<HTMLButtonElement>('[data-action="jump-next-day"]');
      if (nextBtn) nextBtn.disabled = !allowFuture && selectedDate >= beijingToday();
      opts.onDateChange?.(selectedDate);
    }
    publishClock();
    void ensureTrackBuffer(from, to);
  }

  async function ensureTrackBuffer(viewFrom: number, viewTo: number): Promise<void> {
    const need = trackBufferWindow(viewFrom, viewTo);
    const covered =
      loadedFrom > 0 && loadedTo > 0 && need.fromUtc >= loadedFrom && need.toUtc <= loadedTo;
    if (covered || prefetching) return;
    prefetching = true;
    try {
      const fetchFrom = loadedFrom > 0 ? Math.min(loadedFrom, need.fromUtc) : need.fromUtc;
      const fetchTo = loadedTo > 0 ? Math.max(loadedTo, need.toUtc) : need.toUtc;
      const res = await healthOverviewQuery({
        selectedDate,
        trackFromUtc: fetchFrom,
        trackToUtc: fetchTo,
        trendDays,
      });
      trackCache = loadedFrom > 0 ? mergeTrackData(trackCache, res.track) : normalizeTrackData(res.track);
      loadedFrom = fetchFrom;
      loadedTo = fetchTo;
      if (res.localDateRange?.earliest) {
        earliestLocalDate = res.localDateRange.earliest;
      }
      tracksHandle?.setLoadedBounds(loadedFrom, loadedTo);
      tracksHandle?.setData(trackCache);
      tracksHandle?.setLimits(minFromUtc(), maxToUtc());
    } catch {
      /* keep scrolling on cached data */
    } finally {
      prefetching = false;
    }
  }

  async function refreshSyncStatus(): Promise<void> {
    try {
      syncStatus = await healthSyncStatus();
    } catch {
      syncStatus = { ...syncStatus, lastError: "无法读取同步状态" };
    }
    tracksHandle?.setLimits(minFromUtc(), maxToUtc());
  }

  async function reload(reloadOpts: { full?: boolean } = {}): Promise<void> {
    if (loading) return;
    loading = true;
    const shell = tracksRegion.querySelector<HTMLElement>(".health-tracks-shell");
    if (reloadOpts.full) shell?.classList.add("is-loading");
    try {
      const need = trackBufferWindow(trackFrom, trackTo);
      loadedFrom = need.fromUtc;
      loadedTo = need.toUtc;
      const res = await healthOverviewQuery({
        selectedDate,
        trackFromUtc: loadedFrom,
        trackToUtc: loadedTo,
        trendDays,
      });
      trackCache = normalizeTrackData(res.track);
      if (res.localDateRange?.earliest) {
        earliestLocalDate = res.localDateRange.earliest;
      }
    } catch {
      trackCache = EMPTY_TRACK;
    } finally {
      loading = false;
      shell?.classList.remove("is-loading");
      paintChrome();
      paintTracksOnly();
    }
  }

  function resetCache(): void {
    loadedFrom = 0;
    loadedTo = 0;
    trackCache = EMPTY_TRACK;
  }

  function snapToDate(date: string): void {
    const today = beijingToday();
    selectedDate = !allowFuture && date > today ? today : date;
    const w = defaultTrackWindow(selectedDate);
    trackFrom = w.fromUtc;
    trackTo = w.toUtc;
    resetCache();
    opts.onDateChange?.(selectedDate);
    publishClock();
    void reload({ full: true });
  }

  function startHoldPan(dir: -1 | 1): void {
    stopHoldPan();
    const tick = () => {
      tracksHandle?.panByPx(dir * 10);
    };
    tick();
    panTimer = window.setInterval(tick, 16);
  }

  function stopHoldPan(): void {
    if (panTimer) window.clearInterval(panTimer);
    panTimer = 0;
  }

  if (!initialClock) {
    const w = defaultTrackWindow(selectedDate);
    trackFrom = w.fromUtc;
    trackTo = w.toUtc;
  }
  const buf = trackBufferWindow(trackFrom, trackTo);

  tracksHandle = mountTracks(
    tracksRegion,
    {
      fromUtc: trackFrom,
      toUtc: trackTo,
      loadedFromUtc: buf.fromUtc,
      loadedToUtc: buf.toUtc,
      minFromUtc: 0,
      maxToUtc: maxToUtc(),
      data: trackCache,
      legend,
    },
    () => {},
    onViewMoved,
    () => {
      void ensureTrackBuffer(trackFrom, trackTo);
    },
    signal,
  );

  const TRACK_PAD_LEFT = 70;
  const TRACK_PAD_RIGHT = 4;
  const TRACK3_PAD_BOTTOM = 8;

  function hitActivity(clientX: number, clientY: number): string | null {
    if (!opts.onActivityClick || !legend.activity) return null;
    const canvas = tracksRegion.querySelector<HTMLCanvasElement>(".health-track-canvas[data-track='3']");
    const plot = canvas?.closest<HTMLElement>(".health-track-card-plot");
    if (!plot) return null;
    const rect = plot.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const h = rect.height;
    const w = rect.width;
    const plotH = Math.max(1, h - TRACK3_PAD_BOTTOM);
    const activityBottom = plotH / 3;
    if (y < 0 || y > activityBottom) return null;
    const innerW = Math.max(1, w - TRACK_PAD_LEFT - TRACK_PAD_RIGHT);
    const localX = x - TRACK_PAD_LEFT;
    if (localX < 0 || localX > innerW) return null;
    const ts = trackFrom + (localX / innerW) * (trackTo - trackFrom);
    for (const a of trackCache.activities) {
      const end = activityEndUtc(a);
      if (end != null && ts >= a.startUtc && ts < end) return a.id;
    }
    return null;
  }

  tracksRegion.addEventListener(
    "click",
    (e) => {
      if (!opts.onActivityClick) return;
      const id = hitActivity(e.clientX, e.clientY);
      if (id) opts.onActivityClick(id);
    },
    { signal },
  );

  root.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "jump-prev-day") {
        snapToDate(addDays(centerDateOfWindow(trackFrom, trackTo), -1));
        return;
      }
      if (btn.dataset.action === "jump-next-day") {
        const next = addDays(centerDateOfWindow(trackFrom, trackTo), 1);
        if (allowFuture || next <= beijingToday()) snapToDate(next);
      }
    },
    { signal },
  );

  for (const action of ["pan-prev", "pan-next"] as const) {
    const btn = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (!btn) continue;
    const dir = action === "pan-prev" ? 1 : -1;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startHoldPan(dir as -1 | 1);
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener("pointerup", stopHoldPan);
    btn.addEventListener("pointerleave", stopHoldPan);
    btn.addEventListener("pointercancel", stopHoldPan);
  }

  const unbindJournal = bindJournalChanged(() => {
    void refreshSyncStatus();
    resetCache();
    void reload({ full: true });
  });

  const unbindClock = clock?.subscribe(() => applyClock(clock.get())) ?? (() => {});

  return {
    activate() {
      void refreshSyncStatus();
      void reload({ full: true });
    },
    deactivate() {
      stopHoldPan();
    },
    dispose() {
      stopHoldPan();
      unbindSync?.();
      unbindJournal();
      unbindClock();
      datePicker.dispose();
      root.innerHTML = "";
    },
    reload,
    resetCache,
    setTrendDays(days: number) {
      trendDays = days;
    },
    setEarliestLocalDate(date: string | null) {
      earliestLocalDate = date;
      tracksHandle?.setLimits(minFromUtc(), maxToUtc());
    },
    getSelectedDate: () => selectedDate,
    getTrackWindow: () => ({ fromUtc: trackFrom, toUtc: trackTo }),
    getLoadedBounds: () => ({ fromUtc: loadedFrom, toUtc: loadedTo }),
  };
}
