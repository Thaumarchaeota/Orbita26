import { MOOD_EMOJI_PRESETS } from "../../core/data/mood-emojis";
import { parseDailyData } from "../../core/data/life-ring-metrics";
import {
  mealSlotLabel,
  parseMeals,
  sumMealsBySlot,
  totalMealKcal,
  type MealEntry,
} from "../../core/data/meals";
import { getSettings } from "../../core/settings";
import { isPrivacyMode, PRIVACY_MODE_EVT, togglePrivacyMode } from "../../core/privacy-mode";
import { escHtml } from "../../core/html";
import { bindDialog } from "../../ui/motion";
import { beijingToday, dateTimeToUnix, formatGarminError, garminSync, journalConfigured, journalDelete, journalList, journalUpsert, syncFromDate, unixToTimeParts } from "./client";
import {
  buildSleepTip,
  calorieRingHtml,
  formatSleepCenter,
  hydrationRingHtml,
  lifeRingHtml,
  sleepStageRingHtml,
  sleepStageTotalSeconds,
  SLEEP_GOAL_H,
  type SleepStages,
} from "./life-rings";
import { deleteMeal, openHydrationDialog, openMealDialog, type TodayPanelRefresh } from "./meals-dialog";

type NapEntry = { start?: number; end?: number; duration?: number; source?: string };

function napTotalSeconds(naps: NapEntry[]): number {
  return naps.reduce((sum, n) => {
    if (typeof n.duration === "number" && n.duration > 0) return sum + n.duration;
    if (n.start && n.end && n.end > n.start) return sum + (n.end - n.start);
    return sum;
  }, 0);
}

function nightSleepSeconds(night?: NightData): number {
  if (!night) return 0;
  const stages = night.stages;
  if (stages) {
    const stageTotal = sleepStageTotalSeconds(stages);
    if (stageTotal > 0) return stageTotal;
  }
  if (night.sleep && night.wake && night.wake > night.sleep) return night.wake - night.sleep;
  return 0;
}

function formatGarminLastSync(ts: number): string {
  const d = new Date(ts * 1000);
  const date = d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" });
  const time = d.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function garminLastFetchedAt(entries: { kind?: string; source?: string; fetchedAt?: number }[]): number | null {
  let max = 0;
  for (const e of entries) {
    if (e.kind !== "daily" || e.source !== "garmin") continue;
    if (typeof e.fetchedAt === "number" && e.fetchedAt > max) max = e.fetchedAt;
  }
  return max > 0 ? max : null;
}

type NightData = {
  sleep?: number;
  wake?: number;
  score?: number;
  stages?: SleepStages;
};

function renderSleepRing(el: HTMLElement, sleepRingBtn: HTMLButtonElement, night?: NightData, naps: NapEntry[] = []) {
  const napSec = napTotalSeconds(naps);
  const nightSec = nightSleepSeconds(night);
  const totalSec = nightSec + napSec;
  const stages = night?.stages ?? { deep: 0, light: 0, rem: 0 };
  const stageTotal = sleepStageTotalSeconds(stages);

  sleepRingBtn.dataset.tip = buildSleepTip(nightSec, night?.score, napSec);

  if (stageTotal > 0) {
    el.innerHTML = sleepStageRingHtml({
      stages,
      goalHours: SLEEP_GOAL_H,
      totalSeconds: totalSec,
    });
    return;
  }

  if (nightSec > 0) {
    el.innerHTML = lifeRingHtml({
      colorVar: "--life-ring-sleep",
      ratio: nightSec / 3600 / SLEEP_GOAL_H,
      value: formatSleepCenter(totalSec),
      label: "睡眠",
    });
    return;
  }

  el.innerHTML = sleepStageRingHtml({
    stages: { deep: 0, light: 0, rem: 0 },
    goalHours: SLEEP_GOAL_H,
    totalSeconds: napSec,
  });
}

const TODAY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="15" r="1.75" fill="currentColor" stroke="none"/></svg>`;
const MEAL_ICON = "🍽";
const REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const REFRESH_DONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path class="ticktick-check-path" d="M7.5 12.2l2.6 2.6 5.4-5.4"/></svg>`;
const EVENT_ICON = "📌";
const MOOD_ADD_ICON = "✨";
const EDIT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const DEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>`;

type FeedItem =
  | { kind: "event"; id: string; icon: string; text: string; entry: Record<string, unknown> }
  | { kind: "mood"; id: string; icon: string; text: string; entry: Record<string, unknown> }
  | { kind: "meal"; id: string; icon: string; text: string; entry: MealEntry };

const KIND_ORDER = { event: 0, mood: 1, meal: 2 } as const;

function feedAt(item: FeedItem): string {
  if (item.kind === "meal") return item.entry.at ?? "99:99";
  const at = item.entry.at;
  return typeof at === "string" && at ? at : "99:99";
}

type PanelEntry = {
  kind?: string;
  id?: string;
  date?: string;
  remark?: string;
  data?: unknown;
  primary?: boolean;
  at?: unknown;
  fetchedAt?: number;
  source?: string;
};

function buildFeedItems(
  entries: PanelEntry[],
  meals: MealEntry[],
): FeedItem[] {
  const items: FeedItem[] = entries
    .filter((e) => (e.kind === "event" || e.kind === "mood") && !e.primary)
    .map((e) => {
      if (e.kind === "event") {
        const text = String(e.remark ?? "").trim() || "—";
        return {
          kind: "event" as const,
          id: String(e.id),
          icon: EVENT_ICON,
          text,
          entry: e as Record<string, unknown>,
        };
      }
      const data = (e.data ?? {}) as { emoji?: string; note?: string };
      const emoji = data.emoji || "🙂";
      const note = String(data.note ?? "").trim();
      return {
        kind: "mood" as const,
        id: String(e.id),
        icon: emoji,
        text: note || "—",
        entry: e as Record<string, unknown>,
      };
    });
  for (const m of meals) {
    const body = m.text || m.items.join("、") || "—";
    items.push({
      kind: "meal",
      id: m.id,
      icon: MEAL_ICON,
      text: `[${mealSlotLabel(m.slot)}] ${m.kcal}kcal · ${body}`,
      entry: m,
    });
  }
  items.sort((a, b) => {
    const ta = feedAt(a);
    const tb = feedAt(b);
    if (ta !== tb) return ta.localeCompare(tb);
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
  return items;
}

function feedItemHtml(item: FeedItem): string {
  return `<div class="today-feed-item" data-id="${escHtml(item.id)}" data-kind="${item.kind}">
    <span class="today-feed-icon" aria-hidden="true">${item.icon}</span>
    <span class="today-feed-text">${escHtml(item.text)}</span>
    <span class="today-feed-actions">
      <button type="button" class="today-feed-act" data-action="edit" data-tip="编辑">${EDIT_SVG}</button>
      <button type="button" class="today-feed-act" data-action="del" data-tip="删除">${DEL_SVG}</button>
    </span>
  </div>`;
}

export function mountTodayPanel(container: HTMLElement, dialogRoot: HTMLElement) {
  container.innerHTML = `
    <div class="launcher-head">
      <span class="launcher-title">${TODAY_SVG}今日</span>
      <div class="launcher-head-actions">
        <span class="garmin-last-sync privacy-sensitive" id="garminLastSync">最后更新：--</span>
        <button type="button" class="ticktick-icon-btn privacy-toggle-btn" id="todayPrivacyToggle" data-tip="隐藏敏感内容 (Ctrl+Shift+H)">
          <span class="privacy-toggle-show">${EYE_SVG}</span>
          <span class="privacy-toggle-hide">${EYE_OFF_SVG}</span>
        </button>
        <button type="button" class="ticktick-icon-btn" id="todayGarminSync" data-tip="同步佳明">
          <span class="ticktick-refresh-icon">${REFRESH_SVG}</span>
          <span class="ticktick-refresh-done">${REFRESH_DONE_SVG}</span>
        </button>
      </div>
    </div>
    <div class="today-panel">
      <div class="today-block">
        <span class="today-section-title">健康</span>
        <div class="life-rings" id="lifeRings">
          <button type="button" class="life-ring-btn" id="sleepRing">
            <div id="sleepRingGraphic"></div>
          </button>
          <div class="life-ring-btn life-ring-static" id="calorieRing">
            <div id="calorieRingGraphic"></div>
          </div>
          <button type="button" class="life-ring-btn" id="hydrationRing">
            <div id="hydrationRingGraphic"></div>
          </button>
        </div>
      </div>
      <div class="today-lower">
        <div class="today-feed">
          <div class="today-feed-toolbar">
            <span class="today-section-title">记录</span>
            <div class="today-feed-adds">
              <button type="button" class="today-feed-add" id="addEventBtn" data-tip="记事件"><span class="today-feed-add-icon">${EVENT_ICON}</span></button>
              <button type="button" class="today-feed-add" id="addMoodBtn" data-tip="记心情"><span class="today-feed-add-icon">${MOOD_ADD_ICON}</span></button>
              <button type="button" class="today-feed-add" id="addMealBtn" data-tip="记吃饭"><span class="today-feed-add-icon">${MEAL_ICON}</span></button>
            </div>
          </div>
          <div class="today-feed-list scroll-slim" id="recordsList"></div>
        </div>
      </div>
    </div>
  `;

  const listEl = container.querySelector<HTMLElement>("#recordsList")!;
  const sleepRing = container.querySelector<HTMLButtonElement>("#sleepRing")!;
  const syncBtn = container.querySelector<HTMLButtonElement>("#todayGarminSync")!;
  const privacyBtn = container.querySelector<HTMLButtonElement>("#todayPrivacyToggle")!;
  const lastSyncEl = container.querySelector<HTMLElement>("#garminLastSync")!;
  const sleepGraphic = container.querySelector("#sleepRingGraphic")!;
  const calorieGraphic = container.querySelector("#calorieRingGraphic")!;
  const hydrationGraphic = container.querySelector("#hydrationRingGraphic")!;

  let cachedEntries: PanelEntry[] = [];
  let cachedMeals: MealEntry[] = [];
  let cachedSyncEntries: PanelEntry[] = [];

  function snapshotState() {
    return { entries: [...cachedEntries], meals: [...cachedMeals] };
  }

  function restoreState(snap: { entries: PanelEntry[]; meals: MealEntry[] }) {
    cachedEntries = snap.entries;
    cachedMeals = snap.meals;
    refreshRings(cachedEntries, getSettings().ui.lifeRingGoals);
    refreshFeed(cachedEntries, cachedMeals);
  }

  function upsertDailyData(date: string, patch: (data: Record<string, unknown>) => Record<string, unknown>) {
    const idx = cachedEntries.findIndex((e) => e.kind === "daily" && e.date === date);
    if (idx >= 0) {
      const e = cachedEntries[idx];
      const prevData = e.data && typeof e.data === "object" ? { ...(e.data as Record<string, unknown>) } : {};
      cachedEntries = cachedEntries.map((en, i) => (i === idx ? { ...en, data: patch(prevData) } : en));
      return;
    }
    cachedEntries = [...cachedEntries, { kind: "daily", date, data: patch({}) }];
  }

  function refreshRings(entries: PanelEntry[], goals: ReturnType<typeof getSettings>["ui"]["lifeRingGoals"]) {
    const date = beijingToday();
    const routine = entries.find((e) => e.kind === "routine");
    const routineData =
      routine?.data && typeof routine.data === "object"
        ? (routine.data as { night?: NightData; naps?: NapEntry[] })
        : undefined;
    const night = routineData?.night;
    const naps = routineData?.naps ?? [];
    renderSleepRing(sleepGraphic as HTMLElement, sleepRing, night, naps);

    const daily = entries.find((e) => e.kind === "daily" && e.date === date);
    const todayDaily = parseDailyData(daily?.data);
    const meals = parseMeals(daily?.data);
    const slotKcal = sumMealsBySlot(meals);
    const intakeKcal = totalMealKcal(meals);
    calorieGraphic.innerHTML = calorieRingHtml({
      intakeKcal,
      totalCalories: todayDaily?.totalCalories ?? 0,
      activeCalories: todayDaily?.activeCalories ?? 0,
      slotKcal,
      goalIntake: goals.goalIntake,
      goalExp: goals.goalExp,
    });
    hydrationGraphic.innerHTML = hydrationRingHtml({
      hydrationMl: todayDaily?.hydrationMl ?? 0,
      goalHydration: goals.goalHydration,
    });
  }

  function bindFeedRows(feedItems: FeedItem[]) {
    listEl.querySelectorAll<HTMLElement>(".today-feed-item").forEach((row) => {
      const item = feedItems.find((e) => e.id === row.dataset.id && e.kind === row.dataset.kind);
      if (!item) return;
      row.querySelector('[data-action="edit"]')!.addEventListener("click", () => {
        if (item.kind === "event") openEventDialog(dialogRoot, item.entry, panelApi);
        else if (item.kind === "mood") openMoodDialog(dialogRoot, item.entry, panelApi);
        else openMealDialog(dialogRoot, item.entry, panelApi, beijingToday());
      });
      row.querySelector('[data-action="del"]')!.addEventListener("click", () => {
        const date = beijingToday();
        let rollback = () => {};
        if (item.kind === "meal") {
          const meals = cachedMeals.filter((m) => m.id !== item.id);
          rollback = panelApi.optimisticMeals(date, meals);
        } else {
          const snap = snapshotState();
          cachedEntries = cachedEntries.filter((e) => e.id !== item.id);
          rollback = () => restoreState(snap);
          refreshFeed(cachedEntries, cachedMeals);
        }
        void (async () => {
          try {
            if (item.kind === "meal") await deleteMeal(date, item.id);
            else await journalDelete(item.id);
            window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
          } catch (err) {
            rollback();
            alert(String(err));
          }
        })();
      });
    });
  }

  function refreshFeed(entries: PanelEntry[], meals: MealEntry[]) {
    cachedEntries = entries;
    cachedMeals = meals;
    const feedItems = buildFeedItems(entries, meals);
    if (isPrivacyMode()) {
      listEl.innerHTML = `<button type="button" class="today-feed-private" id="privacyUnlockBtn">🔒 已隐藏 · 点击显示</button>`;
      listEl.querySelector("#privacyUnlockBtn")!.addEventListener("click", () => {
        togglePrivacyMode();
        syncPrivacyBtn();
        refreshFeed(cachedEntries, cachedMeals);
      });
    } else {
      listEl.innerHTML = feedItems.length
        ? feedItems.map(feedItemHtml).join("")
        : `<div class="today-feed-empty">点 📌、✨ 或 🍽 记一笔</div>`;
      bindFeedRows(feedItems);
    }
  }

  function refreshLastSync(entries: PanelEntry[]) {
    setLastSync(garminLastFetchedAt(entries));
  }

  async function repaintFull() {
    const goals = getSettings().ui.lifeRingGoals;

    if (!journalConfigured(getSettings())) {
      listEl.innerHTML = `<p class="settings-hint">请配置今日记录目录</p>`;
      setLastSync(null);
      cachedEntries = [];
      cachedMeals = [];
      cachedSyncEntries = [];
      sleepGraphic.innerHTML = sleepStageRingHtml({
        stages: { deep: 0, light: 0, rem: 0 },
        goalHours: SLEEP_GOAL_H,
        totalSeconds: 0,
      });
      calorieGraphic.innerHTML = calorieRingHtml({
        intakeKcal: 0,
        totalCalories: 0,
        activeCalories: 0,
        slotKcal: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
        goalIntake: goals.goalIntake,
        goalExp: goals.goalExp,
      });
      hydrationGraphic.innerHTML = hydrationRingHtml({ hydrationMl: 0, goalHydration: goals.goalHydration });
      return;
    }

    const date = beijingToday();
    const { entries } = await journalList({ date });
    const { entries: syncEntries } = await journalList({ from: syncFromDate(30), to: date });
    cachedEntries = entries;
    cachedSyncEntries = syncEntries as PanelEntry[];
    const daily = entries.find((e) => e.kind === "daily" && e.date === date);
    cachedMeals = parseMeals(daily?.data);
    refreshLastSync(cachedSyncEntries);
    refreshRings(cachedEntries, goals);
    refreshFeed(cachedEntries, cachedMeals);
  }

  const panelApi: TodayPanelRefresh = {
    cachedMealsForDate: (date) => {
      if (date === beijingToday()) return cachedMeals;
      const daily = cachedEntries.find((e) => e.kind === "daily" && e.date === date);
      return parseMeals(daily?.data);
    },
    refreshRings: () => refreshRings(cachedEntries, getSettings().ui.lifeRingGoals),
    refreshFeed: () => refreshFeed(cachedEntries, cachedMeals),
    repaintFull,
    optimisticMeals: (date, meals) => panelApi.optimisticMealPatches([{ date, meals }]),
    optimisticMealPatches: (patches) => {
      const snap = snapshotState();
      for (const { date, meals } of patches) {
        upsertDailyData(date, (data) => ({ ...data, meals }));
      }
      const today = beijingToday();
      const daily = cachedEntries.find((e) => e.kind === "daily" && e.date === today);
      cachedMeals = parseMeals(daily?.data);
      refreshRings(cachedEntries, getSettings().ui.lifeRingGoals);
      refreshFeed(cachedEntries, cachedMeals);
      return () => restoreState(snap);
    },
    optimisticHydration: (date, ml) => {
      const snap = snapshotState();
      upsertDailyData(date, (data) => ({ ...data, hydrationMl: ml }));
      refreshRings(cachedEntries, getSettings().ui.lifeRingGoals);
      return () => restoreState(snap);
    },
    optimisticEvent: (next, existingId) => {
      const snap = snapshotState();
      if (existingId) {
        cachedEntries = cachedEntries.map((e) => (e.id === existingId ? { ...e, ...next, id: existingId } : e));
      } else {
        cachedEntries = [...cachedEntries, next];
      }
      refreshFeed(cachedEntries, cachedMeals);
      return () => restoreState(snap);
    },
    optimisticMood: (next, existingId) => {
      const snap = snapshotState();
      if (existingId) {
        cachedEntries = cachedEntries.map((e) => (e.id === existingId ? { ...e, ...next, id: existingId } : e));
      } else {
        cachedEntries = [...cachedEntries, next];
      }
      refreshFeed(cachedEntries, cachedMeals);
      return () => restoreState(snap);
    },
  };

  function setLastSync(ts: number | null) {
    lastSyncEl.textContent = ts ? `最后更新：${formatGarminLastSync(ts)}` : "最后更新：--";
  }

  function syncPrivacyBtn() {
    privacyBtn.classList.toggle("is-active", isPrivacyMode());
    privacyBtn.dataset.tip = isPrivacyMode() ? "显示敏感内容 (Ctrl+Shift+H)" : "隐藏敏感内容 (Ctrl+Shift+H)";
  }

  privacyBtn.addEventListener("click", () => {
    togglePrivacyMode();
    syncPrivacyBtn();
    refreshFeed(cachedEntries, cachedMeals);
  });
  syncPrivacyBtn();

  const hydrationRing = container.querySelector<HTMLButtonElement>("#hydrationRing")!;

  hydrationRing.addEventListener("click", () => {
    const date = beijingToday();
    void journalList({ date }).then(({ entries }) => {
      const d = entries.find((e) => e.kind === "daily" && e.date === date);
      const parsed = parseDailyData(d?.data);
      openHydrationDialog(dialogRoot, date, parsed?.hydrationMl ?? 0, panelApi);
    });
  });

  sleepRing.addEventListener("click", () => openSleepDialog(dialogRoot));

  syncBtn.addEventListener("click", () => void runGarminSync());

  let syncing = false;

  async function runGarminSync() {
    if (syncing) return;
    syncing = true;
    syncBtn.disabled = true;
    syncBtn.classList.remove("is-success");
    syncBtn.classList.add("is-spinning");
    try {
      const res = await garminSync({ from: syncFromDate(7), to: beijingToday() });
      if (res.ok) {
        syncBtn.classList.add("is-success");
        window.setTimeout(() => syncBtn.classList.remove("is-success"), 1600);
        window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
        void repaintFull();
      } else {
        alert(formatGarminError(res.reason, res.message));
      }
    } catch (e) {
      alert(String(e));
    } finally {
      syncing = false;
      syncBtn.classList.remove("is-spinning");
      syncBtn.disabled = false;
    }
  }

  container.querySelector("#addEventBtn")!.addEventListener("click", () => openEventDialog(dialogRoot, null, panelApi));
  container.querySelector("#addMoodBtn")!.addEventListener("click", () => openMoodDialog(dialogRoot, null, panelApi));
  container.querySelector("#addMealBtn")!.addEventListener("click", () => openMealDialog(dialogRoot, null, panelApi));

  window.addEventListener("orbita:journal-changed", () => void repaintFull());
  window.addEventListener("orbita:ui-prefs", () => panelApi.refreshRings());
  window.addEventListener(PRIVACY_MODE_EVT, () => {
    syncPrivacyBtn();
    refreshFeed(cachedEntries, cachedMeals);
  });
  void repaintFull();
}

function napEntryLabel(nap: NapEntry, index: number): string {
  if (nap.source === "garmin") return `小睡 ${index + 1} · 佳明`;
  return `小睡 ${index + 1}`;
}

function napEntryHtml(id: string, nap?: NapEntry, index = 0): string {
  let startVal = "";
  let endVal = "";
  let durVal = "";
  if (nap?.start) startVal = unixToTimeParts(nap.start).time;
  if (nap?.end) endVal = unixToTimeParts(nap.end).time;
  if (!startVal && !endVal && typeof nap?.duration === "number" && nap.duration > 0) {
    durVal = String(Math.round(nap.duration / 60));
  }
  return `<div class="nap-entry" data-nap-id="${escHtml(id)}">
    <div class="nap-entry-head">
      <span class="nap-entry-title">${escHtml(napEntryLabel(nap ?? {}, index))}</span>
      <button type="button" class="nap-entry-del" data-tip="删除">${DEL_SVG}</button>
    </div>
    <div class="nap-entry-fields">
      <div class="dialog-field nap-entry-field"><label>开始</label><input type="time" class="nap-start" value="${startVal}"></div>
      <div class="dialog-field nap-entry-field"><label>结束</label><input type="time" class="nap-end" value="${endVal}"></div>
      <div class="dialog-field nap-entry-field nap-entry-field--dur"><label>时长(分)</label><input type="number" class="nap-dur" min="1" step="1" value="${durVal}" placeholder="仅时长"></div>
    </div>
  </div>`;
}

function bindNapEntry(row: HTMLElement) {
  row.querySelector(".nap-entry-del")!.addEventListener("click", () => row.remove());
}

function renderNapList(listEl: HTMLElement, naps: NapEntry[]) {
  if (!naps.length) {
    listEl.innerHTML = `<div class="nap-list-empty">暂无小睡，点下方添加</div>`;
    return;
  }
  listEl.innerHTML = naps.map((nap, i) => napEntryHtml(`nap-${i}`, nap, i)).join("");
  listEl.querySelectorAll<HTMLElement>(".nap-entry").forEach(bindNapEntry);
}

function collectNapsFromForm(form: HTMLElement, date: string): NapEntry[] {
  const naps: NapEntry[] = [];
  form.querySelectorAll<HTMLElement>(".nap-entry").forEach((row) => {
    const startT = row.querySelector<HTMLInputElement>(".nap-start")!.value;
    const endT = row.querySelector<HTMLInputElement>(".nap-end")!.value;
    const durMin = Number(row.querySelector<HTMLInputElement>(".nap-dur")!.value);
    if (startT && endT) {
      naps.push({ start: dateTimeToUnix(date, startT), end: dateTimeToUnix(date, endT), source: "manual" });
      return;
    }
    if (startT || endT) return;
    if (Number.isFinite(durMin) && durMin > 0) {
      naps.push({ duration: Math.round(durMin * 60), source: "manual" });
    }
  });
  return naps;
}

function openSleepDialog(root: HTMLElement) {
  if (!journalConfigured(getSettings())) {
    alert("请先在设置中配置数据存储位置");
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  const today = beijingToday();
  backdrop.innerHTML = `
    <form class="dialog-panel" id="sleepForm">
      <div class="dialog-title">睡眠</div>
      <div class="settings-tabs">
        <button type="button" class="settings-tab is-active" data-tab="night">睡眠</button>
        <button type="button" class="settings-tab" data-tab="nap">午睡</button>
      </div>
      <div class="dialog-field"><label>日期</label><input type="date" id="sleepDate" value="${today}"></div>
      <div class="dialog-tab-panels">
        <div class="dialog-tab-panel is-active" data-panel="night">
          <div class="dialog-field"><label>入睡</label><input type="time" id="sleepStart"></div>
          <div class="dialog-field"><label>醒来</label><input type="time" id="sleepEnd"></div>
        </div>
        <div class="dialog-tab-panel" data-panel="nap">
          <div class="nap-list" id="napList"></div>
          <button type="button" class="dialog-btn nap-add-btn" id="napAddBtn">添加小睡</button>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#sleepForm")!;
  const napListEl = backdrop.querySelector<HTMLElement>("#napList")!;
  const dateInput = form.querySelector<HTMLInputElement>("#sleepDate")!;
  const sleepStartInput = form.querySelector<HTMLInputElement>("#sleepStart")!;
  const sleepEndInput = form.querySelector<HTMLInputElement>("#sleepEnd")!;

  async function loadRoutine(date: string) {
    const { entries } = await journalList({ date });
    const routine = entries.find((e) => e.kind === "routine" && e.date === date);
    const data = routine?.data && typeof routine.data === "object"
      ? (routine.data as { night?: { sleep?: number; wake?: number }; naps?: NapEntry[] })
      : undefined;
    const night = data?.night;
    sleepStartInput.value = night?.sleep ? unixToTimeParts(night.sleep).time : "";
    sleepEndInput.value = night?.wake ? unixToTimeParts(night.wake).time : "";
    renderNapList(napListEl, data?.naps ?? []);
  }

  backdrop.querySelectorAll<HTMLButtonElement>(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("is-active")) return;
      backdrop.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const name = tab.dataset.tab!;
      backdrop.querySelectorAll<HTMLElement>(".dialog-tab-panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === name);
      });
    });
  });

  const close = async () => {
    await motion.close();
    backdrop.remove();
  };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) void close(); });

  void motion.open();

  dateInput.addEventListener("change", () => void loadRoutine(dateInput.value));
  backdrop.querySelector("#napAddBtn")!.addEventListener("click", () => {
    if (napListEl.querySelector(".nap-list-empty")) napListEl.innerHTML = "";
    const index = napListEl.querySelectorAll(".nap-entry").length;
    const wrap = document.createElement("div");
    wrap.innerHTML = napEntryHtml(`nap-new-${Date.now()}`, undefined, index);
    const row = wrap.firstElementChild as HTMLElement;
    napListEl.appendChild(row);
    bindNapEntry(row);
  });

  void loadRoutine(today);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = dateInput.value;
    const sleepT = sleepStartInput.value;
    const wakeT = sleepEndInput.value;
    const naps = collectNapsFromForm(form, date);
    for (const row of form.querySelectorAll<HTMLElement>(".nap-entry")) {
      const startT = row.querySelector<HTMLInputElement>(".nap-start")!.value;
      const endT = row.querySelector<HTMLInputElement>(".nap-end")!.value;
      const durMin = row.querySelector<HTMLInputElement>(".nap-dur")!.value;
      if ((startT && !endT) || (!startT && endT)) {
        alert("每条小睡的开始与结束须同时填写，或只填时长");
        return;
      }
      if (!startT && !endT && !durMin) {
        alert("请完善小睡条目或删除空行");
        return;
      }
    }
    try {
      const { entries } = await journalList({ date });
      const existing = entries.find((en) => en.kind === "routine" && en.date === date);
      const prevData = existing?.data && typeof existing.data === "object"
        ? { ...(existing.data as Record<string, unknown>) }
        : {};
      const prevNight = prevData.night && typeof prevData.night === "object"
        ? { ...(prevData.night as Record<string, unknown>) }
        : {};
      const data: Record<string, unknown> = { ...prevData, naps };
      if (sleepT && wakeT) {
        data.night = {
          ...prevNight,
          sleep: dateTimeToUnix(date, sleepT),
          wake: dateTimeToUnix(date, wakeT),
          source: "manual",
        };
      } else if (sleepT || wakeT) {
        alert("入睡与醒来须同时填写");
        return;
      }
      await journalUpsert({
        id: existing?.id ?? "",
        kind: "routine",
        date,
        tz: "Asia/Shanghai",
        data,
      });
      await close();
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
    } catch (err) {
      alert(String(err));
    }
  });
}

function openEventDialog(root: HTMLElement, entry: Record<string, unknown> | null, panel: TodayPanelRefresh) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel">
      <div class="dialog-title">${entry ? "编辑事件" : "新事件"}</div>
      <div class="dialog-field"><label>日期</label><input type="date" id="evDate" value="${beijingToday()}"></div>
      <div class="dialog-field"><label>备注</label><input type="text" id="evRemark" value="${entry ? escHtml(String(entry.remark ?? "")) : ""}"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const close = async () => { await motion.close(); backdrop.remove(); };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) void close(); });
  void motion.open();
  if (entry?.date) backdrop.querySelector<HTMLInputElement>("#evDate")!.value = String(entry.date);
  backdrop.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = backdrop.querySelector<HTMLInputElement>("#evDate")!.value;
    const remark = backdrop.querySelector<HTMLInputElement>("#evRemark")!.value.trim();
    const existingId = entry?.id ? String(entry.id) : undefined;
    const payload = { id: existingId ?? "", kind: "event" as const, date, at: null, remark };
    const rollback = panel.optimisticEvent(
      { ...payload, id: existingId ?? `tmp-${Date.now()}` },
      existingId,
    );
    await close();
    void (async () => {
      try {
        await journalUpsert(payload);
        window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
      } catch (err) {
        rollback();
        alert(String(err));
      }
    })();
  });
}

function openMoodDialog(root: HTMLElement, entry: Record<string, unknown> | null, panel: TodayPanelRefresh) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  const data = (entry?.data ?? {}) as { emoji?: string; note?: string };
  backdrop.innerHTML = `
    <form class="dialog-panel">
      <div class="dialog-title">${entry ? "编辑心情" : "新心情"}</div>
      <div class="dialog-field"><label>日期</label><input type="date" id="mdDate" value="${beijingToday()}"></div>
      <div class="primary-mood-grid">
        ${MOOD_EMOJI_PRESETS.map((em) => `<button type="button" class="primary-mood-opt${data.emoji === em ? " is-active" : ""}" data-emoji="${em}">${em}</button>`).join("")}
      </div>
      <input type="hidden" id="mdEmoji" value="${data.emoji ?? MOOD_EMOJI_PRESETS[0]}">
      <div class="dialog-field"><label>简记</label><input type="text" id="mdNote" value="${escHtml(data.note ?? "")}"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const emojiInput = backdrop.querySelector<HTMLInputElement>("#mdEmoji")!;
  backdrop.querySelectorAll<HTMLButtonElement>(".primary-mood-opt").forEach((b) => {
    b.addEventListener("click", () => {
      backdrop.querySelectorAll(".primary-mood-opt").forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      emojiInput.value = b.dataset.emoji!;
    });
  });
  const close = async () => { await motion.close(); backdrop.remove(); };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) void close(); });
  void motion.open();
  if (entry?.date) backdrop.querySelector<HTMLInputElement>("#mdDate")!.value = String(entry.date);
  backdrop.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = backdrop.querySelector<HTMLInputElement>("#mdDate")!.value;
    const existingId = entry?.id ? String(entry.id) : undefined;
    const data = { emoji: emojiInput.value, note: backdrop.querySelector<HTMLInputElement>("#mdNote")!.value.trim() };
    const payload = {
      id: existingId ?? "",
      kind: "mood" as const,
      date,
      primary: false,
      data,
    };
    const rollback = panel.optimisticMood(
      { ...payload, id: existingId ?? `tmp-${Date.now()}` },
      existingId,
    );
    await close();
    void (async () => {
      try {
        await journalUpsert(payload);
        window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
      } catch (err) {
        rollback();
        alert(String(err));
      }
    })();
  });
}
