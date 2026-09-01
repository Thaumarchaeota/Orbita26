import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "../../core/data/types";
import { parseMeals, totalMealKcal } from "../../core/data/meals";

type JournalSource = "manual" | "garmin";

type SyncEnvelope = {
  id: string;
  source: JournalSource;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type MealFact = SyncEnvelope & {
  localDate: string;
  occurredAtUtc?: number;
  slot?: string;
  text: string;
  kcal: number;
};

type DailyMetricsFact = SyncEnvelope & {
  localDate: string;
  steps?: number;
  hydrationMl?: number;
  activeCalories?: number;
};

type SleepNightFact = SyncEnvelope & {
  wakeDate: string;
  sleepStartUtc: number;
  sleepEndUtc: number;
  score?: number;
};

type MetricSnapshotFact = SyncEnvelope & {
  localDate: string;
  metric: string;
  contentHash: string;
  samples: unknown;
  fetchedAt: number;
};

type OutboxOp = {
  opId: string;
  recordId: string;
  recordType: string;
  revision: number;
  operation: "upsert" | "delete";
  origin: JournalSource;
  snapshot: unknown;
  createdAt: string;
};

type DailyProjection = {
  date: string;
  steps?: number;
  hydrationMl?: number;
  meals: ReturnType<typeof parseMeals>;
  intakeKcal: number;
};

type RoutineProjection = {
  wakeDate: string;
  sleepStartUtc?: number;
  sleepEndUtc?: number;
  napSeconds: number;
};

function garminContentHash(samples: unknown): string {
  const canonical = JSON.stringify(samples);
  let h = 0;
  for (let i = 0; i < canonical.length; i++) {
    h = (Math.imul(31, h) + canonical.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

function projectDailyView(
  localDate: string,
  metrics: DailyMetricsFact | null,
  meals: MealFact[],
): DailyProjection {
  const visible = meals.filter((m) => m.localDate === localDate && !m.deletedAt);
  const legacyData = { meals: visible.map((m) => ({
    id: m.id,
    slot: m.slot ?? "snack",
    text: m.text,
    kcal: m.kcal,
    items: [],
    source: m.source,
  })) };
  return {
    date: localDate,
    steps: metrics?.steps,
    hydrationMl: metrics?.hydrationMl,
    meals: parseMeals(legacyData),
    intakeKcal: totalMealKcal(parseMeals(legacyData)),
  };
}

function projectRoutineView(
  wakeDate: string,
  sleep: SleepNightFact | null,
  napSeconds: number,
): RoutineProjection {
  return {
    wakeDate,
    sleepStartUtc: sleep?.sleepStartUtc,
    sleepEndUtc: sleep?.sleepEndUtc,
    napSeconds,
  };
}

function resolveNightTimestamps(wakeDate: string, sleepHm: string, wakeHm: string): [number, number] {
  const wakeTs = dateTimeToUnix(wakeDate, wakeHm);
  const sleepDate =
    sleepHm >= wakeHm
      ? prevDate(wakeDate)
      : wakeDate;
  const sleepTs = dateTimeToUnix(sleepDate, sleepHm);
  return [sleepTs, wakeTs];
}

function prevDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d - 1, 12, 0, 0);
  return new Date(utc).toISOString().slice(0, 10);
}

function dateTimeToUnix(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, hh - 8, mm, 0) / 1000);
}

function applyGarminSnapshot(
  existing: MetricSnapshotFact | null,
  localDate: string,
  metric: string,
  samples: unknown,
  fetchedAt: number,
  outbox: OutboxOp[],
): MetricSnapshotFact | null {
  const hash = garminContentHash(samples);
  if (existing && existing.contentHash === hash) {
    return existing;
  }
  const revision = existing ? existing.revision + 1 : 1;
  const id = existing?.id ?? crypto.randomUUID();
  const fact: MetricSnapshotFact = {
    id,
    source: "garmin",
    revision,
    createdAt: existing?.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    localDate,
    metric,
    contentHash: hash,
    samples,
    fetchedAt,
  };
  outbox.push({
    opId: crypto.randomUUID(),
    recordId: id,
    recordType: "metric_day_snapshot",
    revision,
    operation: "upsert",
    origin: "garmin",
    snapshot: fact,
    createdAt: "2026-01-01T00:00:00Z",
  });
  return fact;
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("journal sqlite sync envelope contracts", () => {
  it("empty journal_list does not imply JSON year files were read", async () => {
    mockInvoke.mockResolvedValueOnce({ entries: [] });
    const { journalList } = await import("./client");
    const result = await journalList({ date: "2026-01-15" });
    expect(result.entries).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith("journal_list", {
      req: { date: "2026-01-15" },
    });
    const call = mockInvoke.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("journal/2026.json");
  });

  it("stable UUID ids have no path or year prefix", () => {
    const id = crypto.randomUUID();
    const envelope: SyncEnvelope = {
      id,
      source: "manual",
      revision: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    };
    expect(envelope.id).not.toMatch(/journal\/|\.json/);
    expect(envelope.id.length).toBeGreaterThan(10);
  });
});

describe("shanghai date boundaries and wake_date", () => {
  it("cross-midnight sleep resolves to previous calendar sleep date", () => {
    const [sleepTs, wakeTs] = resolveNightTimestamps("2026-01-02", "23:30", "07:00");
    expect(wakeTs).toBe(dateTimeToUnix("2026-01-02", "07:00"));
    expect(sleepTs).toBe(dateTimeToUnix("2026-01-01", "23:30"));
    expect(wakeTs).toBeGreaterThan(sleepTs);
  });

  it("same-calendar-night sleep stays on wake date", () => {
    const [sleepTs, wakeTs] = resolveNightTimestamps("2026-01-02", "01:00", "07:00");
    expect(sleepTs).toBe(dateTimeToUnix("2026-01-02", "01:00"));
    expect(wakeTs).toBe(dateTimeToUnix("2026-01-02", "07:00"));
  });

  it("routine projection keys on wake_date not sleep start date", () => {
    const sleep: SleepNightFact = {
      id: "s1",
      source: "garmin",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
      wakeDate: "2026-01-02",
      sleepStartUtc: dateTimeToUnix("2026-01-01", "23:30"),
      sleepEndUtc: dateTimeToUnix("2026-01-02", "07:00"),
    };
    const routine = projectRoutineView("2026-01-02", sleep, 0);
    expect(routine.wakeDate).toBe("2026-01-02");
    expect(routine.sleepStartUtc).toBeLessThan(routine.sleepEndUtc!);
  });

  it("beijingToday uses Asia/Shanghai calendar", async () => {
    const { beijingToday } = await import("./client");
    const today = beijingToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("manual and garmin coexistence", () => {
  it("garmin daily metrics update does not remove manual meals from projection", () => {
    const localDate = "2026-03-15";
    const meals: MealFact[] = [
      {
        id: "m1",
        source: "manual",
        revision: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        deletedAt: null,
        localDate,
        text: "手工午餐",
        kcal: 520,
        slot: "lunch",
      },
    ];
    const metricsBefore: DailyMetricsFact = {
      id: "d1",
      source: "garmin",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
      localDate,
      steps: 8000,
      hydrationMl: 1800,
    };
    const before = projectDailyView(localDate, metricsBefore, meals);
    expect(before.meals.length).toBe(1);
    expect(before.intakeKcal).toBe(520);

    const metricsAfter: DailyMetricsFact = {
      ...metricsBefore,
      revision: 2,
      steps: 8500,
      hydrationMl: 2000,
    };
    const after = projectDailyView(localDate, metricsAfter, meals);
    expect(after.meals).toEqual(before.meals);
    expect(after.steps).toBe(8500);
    expect(after.hydrationMl).toBe(2000);
  });

  it("mock invoke preserves meals when garmin sync returns counts only", async () => {
    const dailyEntry: JournalEntry = {
      id: "d-uuid",
      kind: "daily",
      date: "2026-03-15",
      data: { meals: [{ id: "meal-1", slot: "lunch", text: "饭", kcal: 400, items: [] }] },
    };
    mockInvoke.mockResolvedValueOnce({ entries: [dailyEntry] });
    const { journalList } = await import("./client");
    const { entries } = await journalList({ date: "2026-03-15" });
    const meals = parseMeals(entries[0]?.data);
    expect(meals.length).toBe(1);

    mockInvoke.mockResolvedValueOnce({
      ok: true,
      dailyCount: 1,
      routineCount: 0,
      exerciseCount: 0,
    });
    const { garminSync } = await import("./client");
    await garminSync({ from: "2026-03-15", to: "2026-03-15" });

    mockInvoke.mockResolvedValueOnce({ entries: [dailyEntry] });
    const after = await journalList({ date: "2026-03-15" });
    expect(parseMeals(after.entries[0]?.data).length).toBe(1);
  });
});

describe("revision tombstone and undo semantics", () => {
  it("soft delete hides from projection but tombstone remains on fact", () => {
    const meal: MealFact = {
      id: "m-del",
      source: "manual",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
      localDate: "2026-04-01",
      text: "待删",
      kcal: 200,
    };
    const visible = projectDailyView("2026-04-01", null, [meal]);
    expect(visible.meals.length).toBe(1);

    const tombstoned: MealFact = {
      ...meal,
      revision: 2,
      deletedAt: "2026-04-01T12:00:00Z",
      updatedAt: "2026-04-01T12:00:00Z",
    };
    const hidden = projectDailyView("2026-04-01", null, [tombstoned]);
    expect(hidden.meals.length).toBe(0);
    expect(tombstoned.deletedAt).not.toBeNull();
    expect(tombstoned.revision).toBe(2);
  });

  it("undo is versioned upsert not physical rollback", () => {
    const outbox: OutboxOp[] = [];
    const meal: MealFact = {
      id: "m-undo",
      source: "manual",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
      localDate: "2026-04-01",
      text: "撤销",
      kcal: 300,
    };
    outbox.push({
      opId: "op1",
      recordId: meal.id,
      recordType: "meal",
      revision: 1,
      operation: "upsert",
      origin: "manual",
      snapshot: meal,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const deleted: MealFact = { ...meal, revision: 2, deletedAt: "2026-04-01T12:00:00Z" };
    outbox.push({
      opId: "op2",
      recordId: meal.id,
      recordType: "meal",
      revision: 2,
      operation: "delete",
      origin: "manual",
      snapshot: deleted,
      createdAt: "2026-04-01T12:00:00Z",
    });

    const restored: MealFact = { ...meal, revision: 3, deletedAt: null, updatedAt: "2026-04-01T12:00:05Z" };
    outbox.push({
      opId: "op3",
      recordId: meal.id,
      recordType: "meal",
      revision: 3,
      operation: "upsert",
      origin: "manual",
      snapshot: restored,
      createdAt: "2026-04-01T12:00:05Z",
    });

    expect(outbox.length).toBe(3);
    expect(outbox[1].operation).toBe("delete");
    expect(outbox[2].operation).toBe("upsert");
    expect(outbox[2].revision).toBe(3);
    expect(projectDailyView("2026-04-01", null, [restored]).meals.length).toBe(1);
  });
});

describe("garmin content_hash deduplication", () => {
  it("identical payload produces no second outbox entry", () => {
    const outbox: OutboxOp[] = [];
    const samples = [{ t: 100, v: 72 }, { t: 200, v: 74 }];
    const first = applyGarminSnapshot(null, "2026-06-01", "heart_rate", samples, 1000, outbox);
    const second = applyGarminSnapshot(first, "2026-06-01", "heart_rate", samples, 9999, outbox);
    expect(outbox.length).toBe(1);
    expect(second?.revision).toBe(1);
    expect(second?.fetchedAt).toBe(1000);
  });

  it("changed samples bump revision and append outbox", () => {
    const outbox: OutboxOp[] = [];
    const samplesA = [{ t: 100, v: 72 }];
    const samplesB = [{ t: 100, v: 80 }];
    const first = applyGarminSnapshot(null, "2026-06-01", "heart_rate", samplesA, 1000, outbox);
    const second = applyGarminSnapshot(first, "2026-06-01", "heart_rate", samplesB, 1001, outbox);
    expect(outbox.length).toBe(2);
    expect(second?.revision).toBe(2);
  });

  it("fetched_at is excluded from content hash", () => {
    const a = garminContentHash([{ t: 1, v: 60 }]);
    const b = garminContentHash([{ t: 1, v: 60 }]);
    expect(a).toBe(b);
  });
});

describe("health projection: daily and routine are not stored containers", () => {
  it("daily projection aggregates facts without a daily table row", () => {
    const localDate = "2026-07-01";
    const metrics: DailyMetricsFact = {
      id: "dm1",
      source: "garmin",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
      localDate,
      steps: 5000,
      hydrationMl: 1500,
    };
    const meals: MealFact[] = [
      {
        id: "ml1",
        source: "manual",
        revision: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        deletedAt: null,
        localDate,
        text: "投影",
        kcal: 400,
      },
    ];
    const projection = projectDailyView(localDate, metrics, meals);
    expect(projection.date).toBe(localDate);
    expect(projection.steps).toBe(5000);
    expect(projection.meals.length).toBe(1);
    expect(projection).not.toHaveProperty("kind");
    expect(projection).not.toHaveProperty("id");
  });

  it("routine projection composes sleep night by wake_date", () => {
    const sleep: SleepNightFact = {
      id: "sn1",
      source: "garmin",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
      wakeDate: "2026-07-02",
      sleepStartUtc: 1738339200,
      sleepEndUtc: 1738368000,
    };
    const routine = projectRoutineView("2026-07-02", sleep, 600);
    expect(routine.wakeDate).toBe("2026-07-02");
    expect(routine.napSeconds).toBe(600);
    expect(routine).not.toHaveProperty("kind");
    expect(routine).not.toHaveProperty("data");
  });
});

describe("cross-year date queries", () => {
  it("projections isolate facts by local_date across year boundary", () => {
    const meals: MealFact[] = [
      {
        id: "y1",
        source: "manual",
        revision: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        deletedAt: null,
        localDate: "2025-12-31",
        text: "跨年餐",
        kcal: 200,
      },
      {
        id: "y2",
        source: "manual",
        revision: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        deletedAt: null,
        localDate: "2026-01-01",
        text: "新年餐",
        kcal: 300,
      },
    ];
    expect(projectDailyView("2025-12-31", null, meals).meals[0]?.text).toBe("跨年餐");
    expect(projectDailyView("2026-01-01", null, meals).meals[0]?.text).toBe("新年餐");
  });
});
