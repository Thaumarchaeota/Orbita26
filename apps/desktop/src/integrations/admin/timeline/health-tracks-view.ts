import {
  healthOverviewQuery,
  healthSyncStatus,
  bindJournalChanged,
} from "../../journal/client";
import { bindGarminSyncButton, garminSyncButtonMarkup } from "../../journal/garmin-sync-button";
import { mountDatePicker, type DatePickerHandle } from "../../../ui/date-picker";
import {
  addDays,
  beijingToday,
  centerDateOfWindow,
  defaultTrackWindow,
  earliestTrackUtc,
  trackBufferWindow,
} from "../tabs/health/format";
import { loadLegendState, type LegendState } from "../tabs/health/legend";
import { mergeTrackData, normalizeTrackData } from "../tabs/health/track-merge";
import { mountTracks } from "../tabs/health/tracks";
import type { HealthSyncStatus, HealthTrackData } from "../tabs/health/types";

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
  let trendDays = opts.trendDays ?? 7;
  const showSyncButton = opts.showSyncButton !== false;
  let earliestLocalDate = opts.earliestLocalDate ?? null;

  let selectedDate = beijingToday();
  let trackFrom = 0;
  let trackTo = 0;
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

  root.innerHTML = `
    <section class="health-section health-section-tracks">
      <div class="health-tracks-toolbar">
        <div class="health-tracks-toolbar-spacer" aria-hidden="true"></div>
        <div class="health-tracks-date-rail">
          <button type="button" class="health-date-nav" data-action="jump-prev-day" aria-label="前一天">«</button>
          <button type="button" class="health-date-nav" data-action="pan-prev" aria-label="向左滚动">‹</button>
          <div class="health-date-picker-mount" data-region="date-picker"></div>
          <button type="button" class="health-date-nav" data-action="pan-next" aria-label="向右滚动">›</button>
          <button type="button" class="health-date-nav" data-action="jump-next-day" aria-label="后一天">»</button>
        </div>
        <div class="health-tracks-toolbar-actions"${showSyncButton ? "" : ' hidden'}>
          ${garminSyncButtonMarkup({ region: "sync-btn" })}
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
    return Math.floor(Date.now() / 1000);
  }

  if (showSyncButton && syncBtn) {
    unbindSync = bindGarminSyncButton(syncBtn, {
      from: addDays(beijingToday(), -6),
      to: beijingToday(),
      signal,
      onSuccess: async () => {
        resetCache();
        await refreshSyncStatus();
        await reload({ full: true });
      },
    });
  }

  const datePicker: DatePickerHandle = mountDatePicker(datePickerMount, {
    compact: true,
    showChevron: false,
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
    if (nextBtn) nextBtn.disabled = selectedDate >= beijingToday();
  }

  function onViewMoved(from: number, to: number): void {
    trackFrom = from;
    trackTo = to;
    const center = centerDateOfWindow(from, to);
    if (center !== selectedDate) {
      selectedDate = center > beijingToday() ? beijingToday() : center;
      datePicker.setValue(selectedDate);
      const nextBtn = root.querySelector<HTMLButtonElement>('[data-action="jump-next-day"]');
      if (nextBtn) nextBtn.disabled = selectedDate >= beijingToday();
      opts.onDateChange?.(selectedDate);
    }
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
    selectedDate = date > today ? today : date;
    const w = defaultTrackWindow(selectedDate);
    trackFrom = w.fromUtc;
    trackTo = w.toUtc;
    resetCache();
    opts.onDateChange?.(selectedDate);
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

  const w = defaultTrackWindow(selectedDate);
  trackFrom = w.fromUtc;
  trackTo = w.toUtc;
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
        if (next <= beijingToday()) snapToDate(next);
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
