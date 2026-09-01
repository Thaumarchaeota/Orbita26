import type { ActivityEvent, HealthTrackData, TimeSample, TrackSeries } from "./types";

type LooseActivity = ActivityEvent & {
  start_utc?: number;
  end_utc?: number | null;
  activity_type?: string | null;
  distance_m?: number | null;
  duration_sec?: number | null;
};

function normalizeActivity(raw: LooseActivity): ActivityEvent {
  return {
    id: raw.id,
    startUtc: raw.startUtc ?? raw.start_utc ?? 0,
    endUtc: raw.endUtc ?? raw.end_utc ?? null,
    activityType: raw.activityType ?? raw.activity_type ?? null,
    name: raw.name ?? null,
    distanceM: raw.distanceM ?? raw.distance_m ?? null,
    durationSec: raw.durationSec ?? raw.duration_sec ?? null,
  };
}

function mergeSamples(a: TimeSample[], b: TimeSample[]): TimeSample[] {
  const byT = new Map<number, number | null>();
  for (const s of a) byT.set(s.t, s.v);
  for (const s of b) byT.set(s.t, s.v);
  return [...byT.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([t, v]) => ({ t, v }));
}

function mergeSeries(a: TrackSeries[], b: TrackSeries[]): TrackSeries[] {
  const byMetric = new Map<string, TimeSample[]>();
  for (const s of a) byMetric.set(s.metric, [...s.samples]);
  for (const s of b) {
    const prev = byMetric.get(s.metric) ?? [];
    byMetric.set(s.metric, mergeSamples(prev, s.samples));
  }
  return [...byMetric.entries()].map(([metric, samples]) => ({ metric, samples }));
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function normalizeTrackData(track: HealthTrackData): HealthTrackData {
  return {
    ...track,
    activities: (track.activities ?? []).map((a) => normalizeActivity(a as LooseActivity)),
  };
}

export function mergeTrackData(a: HealthTrackData, b: HealthTrackData): HealthTrackData {
  const left = normalizeTrackData(a);
  const right = normalizeTrackData(b);
  return {
    sleepBlocks: dedupeById([...left.sleepBlocks, ...right.sleepBlocks]),
    series: mergeSeries(left.series, right.series),
    activities: dedupeById([...left.activities, ...right.activities]),
    meals: dedupeById([...left.meals, ...right.meals]),
  };
}
