import { loadLegendState } from "../tabs/health/legend";
import { mountHealthTracksView, type HealthTracksViewHandle } from "./health-tracks-view";

export type TimelineSourceId = "health";

export type TimelineSourceMountCtx = {
  signal: AbortSignal;
};

export type TimelineSource = {
  id: TimelineSourceId;
  label: string;
  mount: (root: HTMLElement, ctx: TimelineSourceMountCtx) => HealthTracksViewHandle;
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
      showSyncButton: false,
      trendDays: 7,
    });
  },
});
