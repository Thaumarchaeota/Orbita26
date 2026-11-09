import { loadLegendState } from "../tabs/health/legend";
import { mountActionTracksView } from "./action-tracks-view";
import { mountHealthTracksView } from "./health-tracks-view";
import { mountJournalTracksView } from "./journal-tracks-view";

export type TimelineClockState = {
  fromUtc: number;
  toUtc: number;
  selectedDate: string;
};

export type TimelineClock = {
  get: () => TimelineClockState;
  subscribe: (fn: () => void) => () => void;
  set: (next: TimelineClockState) => void;
};

export function createTimelineClock(initial: TimelineClockState): TimelineClock {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next) {
      if (
        next.fromUtc === state.fromUtc &&
        next.toUtc === state.toUtc &&
        next.selectedDate === state.selectedDate
      ) {
        return;
      }
      state = next;
      for (const fn of listeners) fn();
    },
  };
}

export type TimelineSourceId = "health" | "productivity" | "journal";

export type TimelineLayerHandle = {
  activate: () => void | Promise<void>;
  deactivate: () => void;
  dispose: () => void;
};

export type TimelineSourceMountCtx = {
  signal: AbortSignal;
  clock?: TimelineClock;
  detailHost?: HTMLElement;
};

export type TimelineSource = {
  id: TimelineSourceId;
  label: string;
  mount: (root: HTMLElement, ctx: TimelineSourceMountCtx) => TimelineLayerHandle;
};

const registry = new Map<TimelineSourceId, TimelineSource>();

export function registerTimelineSource(source: TimelineSource): void {
  registry.set(source.id, source);
}

export function getTimelineSource(id: TimelineSourceId): TimelineSource | undefined {
  return registry.get(id);
}

export function getTimelineSources(): TimelineSource[] {
  return [...registry.values()];
}

registerTimelineSource({
  id: "health",
  label: "健康",
  mount(root, ctx) {
    return mountHealthTracksView(root, {
      signal: ctx.signal,
      legend: loadLegendState(),
      showSyncButton: true,
      trendDays: 7,
      clock: ctx.clock,
    });
  },
});

registerTimelineSource({
  id: "productivity",
  label: "安排",
  mount(root, ctx) {
    return mountActionTracksView(root, { signal: ctx.signal, clock: ctx.clock, detailHost: ctx.detailHost });
  },
});

registerTimelineSource({
  id: "journal",
  label: "随记",
  mount(root, ctx) {
    return mountJournalTracksView(root, { signal: ctx.signal, clock: ctx.clock });
  },
});
