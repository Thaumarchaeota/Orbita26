import { mountDecoupledDatePicker } from "../../ui/decoupled-date-picker";
import {
  mealSlotLabel,
  sumMealsBySlot,
  totalMealKcal,
  type MealEntry,
} from "../../core/data/meals";
import { getSettings } from "../../core/settings";
import { isPrivacyMode, PRIVACY_MODE_EVT, togglePrivacyMode } from "../../core/privacy-mode";
import { escHtml } from "../../core/html";
import { bindBackdropPressDismiss } from "../../ui/backdrop-dismiss";
import { bindDialog } from "../../ui/motion";
import {
  beijingToday,
  healthListMeals,
  healthOverviewQuery,
  healthSyncStatus,
  journalConfigured,
  unixToTimeParts,
  bindJournalChanged,
  type HealthOverviewResponse,
} from "./client";
import {
  journalArchiveCreateNote,
  journalArchiveListEntries,
  journalArchiveUpdateNote,
  type JournalEntrySnapshot,
} from "./archive-client";
import { bindGarminSyncButton, garminSyncButtonMarkup } from "./garmin-sync-button";
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
import { archiveMealToEntry, type MealEntryWithRevision } from "./meals-archive";
import { deleteMeal, openMealDialog, type TodayPanelRefresh } from "./meals-dialog";

const MEAL_UNDO_MS = 5000;

type NapEntry = { start?: number; end?: number; duration?: number; source?: string };

type NightData = {
  sleep?: number;
  wake?: number;
  score?: number;
  stages?: SleepStages;
};

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

function beijingDayUtcRange(date: string): { from: number; to: number } {
  const from = Math.floor(Date.parse(`${date}T00:00:00+08:00`) / 1000);
  return { from, to: from + 86400 };
}

function overviewToNightAndNaps(overview: HealthOverviewResponse | null): { night?: NightData; naps: NapEntry[] } {
  if (!overview) return { naps: [] };
  const nightBlock = overview.track.sleepBlocks.find((b) => !b.isNap);
  const naps: NapEntry[] = overview.track.sleepBlocks
    .filter((b) => b.isNap)
    .map((b) => ({ start: b.startUtc, end: b.endUtc, source: b.source }));
  if (!nightBlock) return { naps };
  const totals = nightBlock.stageTotals;
  return {
    night: {
      sleep: nightBlock.startUtc,
      wake: nightBlock.endUtc,
      score: nightBlock.score ?? undefined,
      stages: totals
        ? { deep: totals.deep, light: totals.light, rem: totals.rem, awake: totals.awake }
        : undefined,
    },
    naps,
  };
}

function renderSleepRing(el: HTMLElement, sleepRingEl: HTMLElement, night?: NightData, naps: NapEntry[] = []) {
  const napSec = napTotalSeconds(naps);
  const nightSec = nightSleepSeconds(night);
  const totalSec = nightSec + napSec;
  const stages = night?.stages ?? { deep: 0, light: 0, rem: 0 };
  const stageTotal = sleepStageTotalSeconds(stages);

  sleepRingEl.dataset.tip = buildSleepTip(nightSec, night?.score, napSec);

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
const NOTE_ICON = "📝";
const DOC_ICON = "📄";
const EDIT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const DEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>`;

type FeedItem =
  | { kind: "note"; id: string; icon: string; text: string; entry: JournalEntrySnapshot }
  | { kind: "document"; id: string; icon: string; text: string; entry: JournalEntrySnapshot }
  | { kind: "meal"; id: string; icon: string; text: string; entry: MealEntry };

const KIND_ORDER = { note: 0, document: 1, meal: 2 } as const;

function archiveEntryBeijingDate(startedAt: string): string {
  const ts = Math.floor(Date.parse(startedAt) / 1000);
  if (!Number.isFinite(ts)) return "";
  return unixToTimeParts(ts).date;
}

function archiveEntryFeedText(entry: JournalEntrySnapshot): string {
  if (entry.kind === "document") {
    const title = String(entry.title ?? "").trim();
    if (title) return title;
    const summary = String(entry.summary ?? "").trim();
    return summary || "—";
  }
  const text = String(entry.text ?? "").trim();
  const line = text.split(/\r?\n/)[0]?.trim();
  return line || String(entry.title ?? "").trim() || "—";
}

function feedAt(item: FeedItem): string {
  if (item.kind === "meal") return item.entry.at ?? "99:99";
  const ts = Math.floor(Date.parse(item.entry.startedAt) / 1000);
  return Number.isFinite(ts) ? unixToTimeParts(ts).time : "99:99";
}

function buildFeedItems(
  entries: JournalEntrySnapshot[],
  meals: MealEntry[],
): FeedItem[] {
  const items: FeedItem[] = entries
    .filter((e) => e.kind === "note" || e.kind === "document")
    .map((e) => ({
      kind: e.kind as "note" | "document",
      id: e.id,
      icon: e.kind === "document" ? DOC_ICON : NOTE_ICON,
      text: archiveEntryFeedText(e),
      entry: e,
    }));
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
  const actions =
    item.kind === "meal"
      ? `<span class="today-feed-actions">
      <button type="button" class="today-feed-act" data-action="edit" data-tip="编辑">${EDIT_SVG}</button>
      <button type="button" class="today-feed-act" data-action="del" data-tip="删除">${DEL_SVG}</button>
    </span>`
      : item.kind === "note"
        ? `<span class="today-feed-actions">
      <button type="button" class="today-feed-act" data-action="edit" data-tip="编辑">${EDIT_SVG}</button>
    </span>`
        : "";
  return `<div class="today-feed-item" data-id="${escHtml(item.id)}" data-kind="${item.kind}">
    <span class="today-feed-icon" aria-hidden="true">${item.icon}</span>
    <span class="today-feed-text">${escHtml(item.text)}</span>
    ${actions}
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
        ${garminSyncButtonMarkup({ id: "todayGarminSync" })}
      </div>
    </div>
    <div class="today-panel">
      <div class="today-block">
        <span class="today-section-title">健康</span>
        <div class="life-rings" id="lifeRings">
          <div class="life-ring-btn life-ring-static" id="sleepRing">
            <div id="sleepRingGraphic"></div>
          </div>
          <div class="life-ring-btn life-ring-static" id="calorieRing">
            <div id="calorieRingGraphic"></div>
          </div>
          <div class="life-ring-btn life-ring-readonly" id="hydrationRing">
            <div id="hydrationRingGraphic"></div>
          </div>
        </div>
        <p class="settings-hint" id="overviewError" hidden></p>
      </div>
      <div class="today-lower">
        <div class="today-feed">
          <div class="today-feed-toolbar">
            <span class="today-section-title">记录</span>
            <div class="today-feed-adds">
              <button type="button" class="today-feed-add" id="addNoteBtn" data-tip="记随记"><span class="today-feed-add-icon">${NOTE_ICON}</span></button>
              <button type="button" class="today-feed-add" id="addMealBtn" data-tip="记吃饭"><span class="today-feed-add-icon">${MEAL_ICON}</span></button>
            </div>
          </div>
          <div class="today-feed-list scroll-slim" id="recordsList"></div>
        </div>
      </div>
    </div>
  `;

  const listEl = container.querySelector<HTMLElement>("#recordsList")!;

  const mealUndoToast = document.createElement("div");
  mealUndoToast.className = "ticktick-undo-toast";
  mealUndoToast.setAttribute("aria-hidden", "true");
  mealUndoToast.innerHTML =
    '<div class="ticktick-undo-pill"><span class="ticktick-undo-msg">已删除餐食</span><button type="button" class="ticktick-undo-btn">撤销</button></div>';
  container.appendChild(mealUndoToast);
  const mealUndoMsg = mealUndoToast.querySelector<HTMLElement>(".ticktick-undo-msg")!;
  const mealUndoBtn = mealUndoToast.querySelector<HTMLButtonElement>(".ticktick-undo-btn")!;
  let mealUndoTimer = 0;
  let pendingMealDelete: { date: string; meal: MealEntry; rollback: () => void } | null = null;

  const clearMealUndo = () => {
    window.clearTimeout(mealUndoTimer);
    mealUndoTimer = 0;
    pendingMealDelete = null;
    mealUndoToast.classList.remove("is-visible");
    mealUndoToast.setAttribute("aria-hidden", "true");
  };

  mealUndoBtn.addEventListener("click", () => {
    const pending = pendingMealDelete;
    if (!pending) return;
    clearMealUndo();
    pending.rollback();
  });
  const sleepRing = container.querySelector<HTMLElement>("#sleepRing")!;
  const overviewErrorEl = container.querySelector<HTMLElement>("#overviewError")!;
  const syncBtn = container.querySelector<HTMLButtonElement>("#todayGarminSync")!;
  const privacyBtn = container.querySelector<HTMLButtonElement>("#todayPrivacyToggle")!;
  const lastSyncEl = container.querySelector<HTMLElement>("#garminLastSync")!;
  const sleepGraphic = container.querySelector("#sleepRingGraphic")!;
  const calorieGraphic = container.querySelector("#calorieRingGraphic")!;
  const hydrationGraphic = container.querySelector("#hydrationRingGraphic")!;

  let cachedArchiveEntries: JournalEntrySnapshot[] = [];
  let cachedArchiveError: string | null = null;
  let cachedMealsError: string | null = null;
  let cachedMeals: MealEntryWithRevision[] = [];
  let cachedOverview: HealthOverviewResponse | null = null;
  let cachedOverviewError: string | null = null;

  async function loadArchiveMeals(date: string): Promise<MealEntryWithRevision[]> {
    const { meals } = await healthListMeals({ localDateFrom: date, localDateTo: date });
    return meals.filter((m) => !m.deletedAt).map((m) => archiveMealToEntry(m, date));
  }

  function snapshotState() {
    return { meals: [...cachedMeals] };
  }

  function restoreState(snap: { meals: MealEntry[] }) {
    cachedMeals = snap.meals;
    refreshRings();
    refreshFeed(cachedArchiveEntries, cachedMeals, cachedArchiveError, cachedMealsError);
  }

  function refreshRings() {
    if (cachedOverviewError) {
      overviewErrorEl.hidden = false;
      overviewErrorEl.textContent = cachedOverviewError;
    } else {
      overviewErrorEl.hidden = true;
      overviewErrorEl.textContent = "";
    }
    if (!cachedOverview && cachedOverviewError) return;

    const goals = getSettings().ui.lifeRingGoals;
    const { night, naps } = overviewToNightAndNaps(cachedOverview);
    renderSleepRing(sleepGraphic as HTMLElement, sleepRing, night, naps);
    const meals = cachedMeals;
    const slotKcal = sumMealsBySlot(meals);
    const intakeKcal = totalMealKcal(meals);
    const waterCard = cachedOverview?.daySummary.cards.find((c) => c.id === "water");
    const hydrationMl = waterCard?.value ? Number(waterCard.value) : 0;
    calorieGraphic.innerHTML = calorieRingHtml({
      intakeKcal,
      totalCalories: cachedOverview?.daySummary.energy.burnKcal ?? 0,
      activeCalories: 0,
      slotKcal,
      goalIntake: goals.goalIntake,
      goalExp: goals.goalExp,
    });
    hydrationGraphic.innerHTML = hydrationRingHtml({
      hydrationMl: Number.isFinite(hydrationMl) ? hydrationMl : 0,
      goalHydration: goals.goalHydration,
    });
  }

  function bindFeedRows(feedItems: FeedItem[]) {
    listEl.querySelectorAll<HTMLElement>(".today-feed-item").forEach((row) => {
      const item = feedItems.find((e) => e.id === row.dataset.id && e.kind === row.dataset.kind);
      if (!item) return;
      if (item.kind === "note") {
        const openEdit = () => openNoteDialog(dialogRoot, item.entry);
        row.querySelector('[data-action="edit"]')?.addEventListener("click", (e) => {
          e.stopPropagation();
          openEdit();
        });
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".today-feed-act")) return;
          openEdit();
        });
        return;
      }
      if (item.kind !== "meal") return;
      row.querySelector('[data-action="edit"]')!.addEventListener("click", () => {
        openMealDialog(dialogRoot, item.entry, panelApi, beijingToday());
      });
      row.querySelector('[data-action="del"]')!.addEventListener("click", () => {
        const date = beijingToday();
        let rollback = () => {};
        if (item.kind === "meal") {
          const meal = item.entry;
          const meals = cachedMeals.filter((m) => m.id !== item.id);
          rollback = panelApi.optimisticMeals(date, meals);
          clearMealUndo();
          pendingMealDelete = { date, meal, rollback };
          mealUndoMsg.textContent = "已删除餐食";
          mealUndoToast.classList.add("is-visible");
          mealUndoToast.setAttribute("aria-hidden", "false");
          mealUndoTimer = window.setTimeout(() => {
            const pending = pendingMealDelete;
            clearMealUndo();
            if (!pending) return;
            void (async () => {
              try {
                await deleteMeal(pending.date, pending.meal.id, pending.meal.revision);
                window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
              } catch (err) {
                pending.rollback();
                alert(String(err));
              }
            })();
          }, MEAL_UNDO_MS);
          return;
        }
      });
    });
  }

  function refreshFeed(
    entries: JournalEntrySnapshot[],
    meals: MealEntry[],
    archiveError: string | null = cachedArchiveError,
    mealsError: string | null = cachedMealsError,
  ) {
    cachedArchiveEntries = entries;
    cachedMeals = meals;
    cachedArchiveError = archiveError;
    cachedMealsError = mealsError;
    if (archiveError) {
      listEl.innerHTML = `<p class="settings-hint">${escHtml(archiveError)}</p>`;
      return;
    }
    const feedItems = buildFeedItems(entries, meals);
    const mealHint = mealsError ? `<p class="settings-hint">${escHtml(mealsError)}</p>` : "";
    if (isPrivacyMode()) {
      listEl.innerHTML = `${mealHint}<button type="button" class="today-feed-private" id="privacyUnlockBtn">🔒 已隐藏 · 点击显示</button>`;
      listEl.querySelector("#privacyUnlockBtn")!.addEventListener("click", () => {
        togglePrivacyMode();
        syncPrivacyBtn();
        refreshFeed(cachedArchiveEntries, cachedMeals, cachedArchiveError, cachedMealsError);
      });
    } else {
      listEl.innerHTML = feedItems.length
        ? `${mealHint}${feedItems.map(feedItemHtml).join("")}`
        : `${mealHint}<div class="today-feed-empty">点 📝 或 🍽 记一笔</div>`;
      bindFeedRows(feedItems);
    }
  }

  async function refreshLastSync() {
    try {
      const status = await healthSyncStatus();
      if (status.lastSuccessAt) {
        const ms = Date.parse(status.lastSuccessAt);
        setLastSync(Number.isFinite(ms) ? Math.floor(ms / 1000) : null);
        return;
      }
    } catch {
      /* keep dash */
    }
    setLastSync(null);
  }

  async function repaintFull() {
    const goals = getSettings().ui.lifeRingGoals;

    if (!journalConfigured(getSettings())) {
      listEl.innerHTML = `<p class="settings-hint">请配置今日记录目录</p>`;
      setLastSync(null);
      cachedArchiveEntries = [];
      cachedArchiveError = null;
      cachedMealsError = null;
      cachedMeals = [];
      cachedOverview = null;
      cachedOverviewError = null;
      overviewErrorEl.hidden = true;
      overviewErrorEl.textContent = "";
      sleepGraphic.innerHTML = sleepStageRingHtml({
        stages: { deep: 0, light: 0, rem: 0 },
        goalHours: SLEEP_GOAL_H,
        totalSeconds: 0,
      });
      calorieGraphic.innerHTML = calorieRingHtml({
        intakeKcal: 0,
        totalCalories: 0,
        activeCalories: 0,
        slotKcal: { breakfast: 0, lunch: 0, dinner: 0, late_night: 0, coffee: 0, beverage: 0, snack: 0, other: 0 },
        goalIntake: goals.goalIntake,
        goalExp: goals.goalExp,
      });
      hydrationGraphic.innerHTML = hydrationRingHtml({ hydrationMl: 0, goalHydration: goals.goalHydration });
      return;
    }

    const date = beijingToday();
    const { from, to } = beijingDayUtcRange(date);
    let archiveError: string | null = null;
    try {
      const { entries } = await journalArchiveListEntries();
      cachedArchiveEntries = entries.filter(
        (e) =>
          !e.deletedAt &&
          (e.kind === "note" || e.kind === "document") &&
          archiveEntryBeijingDate(e.startedAt) === date,
      );
    } catch (err) {
      archiveError = String(err);
      cachedArchiveEntries = [];
    }
    let mealsError: string | null = null;
    try {
      cachedMeals = await loadArchiveMeals(date);
      cachedMealsError = null;
    } catch (err) {
      mealsError = String(err);
      cachedMealsError = mealsError;
    }
    try {
      cachedOverview = await healthOverviewQuery({
        selectedDate: date,
        trackFromUtc: from,
        trackToUtc: to,
        trendDays: 1,
      });
      cachedOverviewError = null;
    } catch (err) {
      cachedOverviewError = String(err);
    }
    refreshLastSync();
    refreshRings();
    refreshFeed(cachedArchiveEntries, cachedMeals, archiveError, mealsError);
  }

  const panelApi: TodayPanelRefresh = {
    cachedMealsForDate: (date) => {
      if (date === beijingToday()) return cachedMeals;
      return [];
    },
    refreshRings,
    refreshFeed: () => refreshFeed(cachedArchiveEntries, cachedMeals, cachedArchiveError, cachedMealsError),
    repaintFull,
    optimisticMeals: (date, meals) => panelApi.optimisticMealPatches([{ date, meals }]),
    optimisticMealPatches: (patches) => {
      const snap = snapshotState();
      const today = beijingToday();
      for (const { date, meals } of patches) {
        if (date === today) cachedMeals = meals;
      }
      refreshRings();
      refreshFeed(cachedArchiveEntries, cachedMeals, cachedArchiveError, cachedMealsError);
      return () => restoreState(snap);
    },
    optimisticEvent: () => () => {},
    optimisticMood: () => () => {},
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
    refreshFeed(cachedArchiveEntries, cachedMeals, cachedArchiveError, cachedMealsError);
  });
  syncPrivacyBtn();

  const unbindGarminSync = bindGarminSyncButton(syncBtn, {
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
      void repaintFull();
    },
  });

  container.querySelector("#addNoteBtn")!.addEventListener("click", () => openNoteDialog(dialogRoot, null));
  container.querySelector("#addMealBtn")!.addEventListener("click", () => openMealDialog(dialogRoot, null, panelApi));

  const unbindJournal = bindJournalChanged(() => void repaintFull());
  window.addEventListener("orbita:ui-prefs", () => panelApi.refreshRings());
  window.addEventListener(PRIVACY_MODE_EVT, () => {
    syncPrivacyBtn();
    refreshFeed(cachedArchiveEntries, cachedMeals, cachedArchiveError, cachedMealsError);
  });
  void repaintFull();
}

function noteDateToStartedAt(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const utc = Date.UTC(y, m - 1, d, hh - 8, mm, 0);
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function openNoteDialog(root: HTMLElement, entry: JournalEntrySnapshot | null) {
  const isEdit = entry?.kind === "note";
  const startedTs = entry ? Math.floor(Date.parse(entry.startedAt) / 1000) : NaN;
  const startedParts = Number.isFinite(startedTs) ? unixToTimeParts(startedTs) : null;
  const defaultDate = startedParts?.date || beijingToday();
  const defaultTime = startedParts?.time || "12:00";

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel" id="noteForm">
      <div class="dialog-title">${isEdit ? "编辑随记" : "新随记"}</div>
      <p class="settings-hint" id="noteError" hidden></p>
      <div class="dialog-field"><label>日期</label><div id="noteDateMount"></div></div>
      <div class="dialog-field"><label>标题</label><input type="text" id="noteTitle" value="${isEdit ? escHtml(entry?.title ?? "") : ""}" placeholder="可选"></div>
      <div class="dialog-field"><label>正文</label><textarea id="noteText" rows="4" required>${isEdit ? escHtml(entry?.text ?? "") : ""}</textarea></div>
      <div class="dialog-field"><label>心情</label><input type="text" id="noteMood" value="${isEdit ? escHtml(entry?.mood ?? "") : ""}" placeholder="可选"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#noteForm")!;
  const errorEl = backdrop.querySelector<HTMLElement>("#noteError")!;
  const datePicker = mountDecoupledDatePicker({ defaultTrigger: { container: form.querySelector("#noteDateMount")! },
    value: defaultDate,
  });
  const titleInput = form.querySelector<HTMLInputElement>("#noteTitle")!;
  const textInput = form.querySelector<HTMLTextAreaElement>("#noteText")!;
  const moodInput = form.querySelector<HTMLInputElement>("#noteMood")!;

  const showError = (msg: string) => {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  };

  const close = async () => {
    datePicker.dispose();
    await motion.close();
    backdrop.remove();
  };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  bindBackdropPressDismiss(backdrop, () => void close());
  void motion.open();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) {
      showError("正文不能为空");
      return;
    }
    errorEl.hidden = true;
    errorEl.textContent = "";
    const startedAt = noteDateToStartedAt(datePicker.getValue(), defaultTime);
    const title = titleInput.value.trim();
    const mood = moodInput.value.trim();
    void (async () => {
      try {
        if (isEdit && entry) {
          await journalArchiveUpdateNote({
            id: entry.id,
            expectedRevision: entry.revision,
            text,
            title: title || null,
            startedAt,
            mood: mood || null,
          });
        } else {
          await journalArchiveCreateNote({
            startedAt,
            text,
            title: title || undefined,
            mood: mood || undefined,
          });
        }
        await close();
        window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
      } catch (err) {
        showError(String(err));
      }
    })();
  });
}
