import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { normalizeHhMm } from "../../../ui/time-picker";
import type { MealFoodEntry, MealSlot } from "../../../core/data/meals";
import { mealSlotLabel, normalizeMealSlot } from "../../../core/data/meals";
import { completeChat } from "../../ai/adapter";
import { getActiveEntry, loadAiConfig } from "../../ai/config";
import { getSettings } from "../../../core/settings";
import { invokeDomainWrite } from "../domain-write-guard";
import { healthCreateMeal, healthListMeals, healthUpdateMeal, dateTimeToUnix, unixToTimeParts } from "../../journal/client";
import type { HealthMealSnapshot } from "../../journal/client";
import {
  archiveMealToEntry,
  computeMealNutritionTotals,
  defaultMealTitle,
  getMeal,
  MEAL_AI_SYSTEM,
  mealEntryToCreateReq,
  mealEntryToUpdateReq,
  mealFoodEntryFromSnapshot,
  mealFoodSearchHits,
  searchMealFoods,
} from "../../journal/meals-archive";
import type { InsightDestination, InsightDestinationHandle } from "../types";
import "./meal-compose.css";

const ARROW_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`;

type FoodDraft = {
  text: string;
  kcal: string;
  kcalMissing: boolean;
  servingText: string;
  carbsGrams: string;
  proteinGrams: string;
  fatGrams: string;
  sugarGrams: string;
  fiberGrams: string;
  sodiumMilligrams: string;
  vitaminCMilligrams: string;
  kcalEstimated: boolean;
  nutrientsEstimated: boolean | null;
  legacyProtected?: boolean;
};

function nowShanghai(): { date: string; time: string } {
  const now = new Date();
  const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const time = now.toLocaleTimeString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

function emptyFood(): FoodDraft {
  return {
    text: "",
    kcal: "",
    kcalMissing: false,
    servingText: "",
    carbsGrams: "",
    proteinGrams: "",
    fatGrams: "",
    sugarGrams: "",
    fiberGrams: "",
    sodiumMilligrams: "",
    vitaminCMilligrams: "",
    kcalEstimated: true,
    nutrientsEstimated: null,
  };
}

function parseAiJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(text);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function strOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numStr(v: unknown): string {
  const n = numOrNull(v);
  return n !== null ? String(n) : "";
}

export const mealDestination: InsightDestination = {
  id: "meal",
  kind: "workspace",
  label: "新餐食",
  icon: "health",
  showInNav: false,
  mount(root) {
    const ownerDir = getSettings().dataDir.trim();
    const { date: initDate, time: initTime } = nowShanghai();
    let title = "";
    let notes = "";
    let date = initDate;
    let time = initTime;
    let slot: MealSlot | null = "other";
    let unrecognizedSlot: string | undefined;
    let iconKey: string | undefined;
    let foods: FoodDraft[] = [];
    let legacyTotalKcal: number | null = null;
    let legacyFoodTexts: string[] | null = null;
    let loadedFoodsJson: string | null = null;
    let loadedStartedAt: string | null = null;
    let loadedDate = "";
    let loadedExactTime: string | null = null;
    let loadedStartedAtTime = "00:00";
    let aiBusy = false;
    let saveBusy = false;
    let editingMealId: string | null = null;
    let expectedRevision: number | null = null;
    const searchTimers = new Map<number, ReturnType<typeof setTimeout>>();

    root.innerHTML = `
      <div class="meal-compose-page">
        <div class="meal-compose-backdrop"></div>
        <div class="meal-compose-card">
          <h2 class="meal-compose-title" data-region="page-title">新餐食</h2>
          <div class="meal-compose-scroll">
            <div class="meal-compose-recent" data-region="recent">
              <div class="meal-compose-recent-head">
                <span>最近餐食</span>
              </div>
              <div class="meal-compose-recent-list" data-region="recent-list"></div>
            </div>
            <div class="meal-compose-field" data-field="title">
              <label>名字</label>
              <input type="text" data-region="title" placeholder="餐食名称">
            </div>
            <div class="meal-compose-field" data-field="notes">
              <label>备注</label>
              <textarea data-region="notes" rows="2" placeholder="整餐备注"></textarea>
            </div>
            <div class="meal-compose-row-2">
              <div class="meal-compose-field" data-field="datetime">
                <label>时间</label>
                <div class="meal-compose-datetime-pickers">
                  <div data-region="date-picker"></div>
                  <div data-region="time-picker"></div>
                </div>
              </div>
              <div class="meal-compose-field" data-field="slot">
                <label>类型</label>
                <select data-region="slot">
                  <option value="">未分类</option>
                  <option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option>
                  <option value="late_night">夜宵</option><option value="coffee">咖啡</option><option value="beverage">饮料</option>
                  <option value="snack">零食</option><option value="other" selected>其他</option>
                </select>
              </div>
            </div>
            <div class="meal-compose-foods">
              <div class="meal-compose-foods-head">
                <span>食物</span>
                <button type="button" data-region="add-food">添加</button>
              </div>
              <div data-region="foods"></div>
            </div>
            <div class="meal-compose-totals" data-region="totals"></div>
          </div>
          <div class="meal-compose-footer">
            <div class="meal-compose-ai">
              <input type="text" data-region="ai-input" placeholder="用自然语言描述餐食…" autocomplete="off">
              <button type="button" data-region="ai-send" aria-label="发送">${ARROW_SVG}</button>
            </div>
            <div class="meal-compose-ai-hint" data-region="ai-hint"></div>
            <div class="meal-compose-actions">
              <button type="button" class="meal-compose-save" data-region="save">保存</button>
              <span class="meal-compose-status" data-region="status"></span>
            </div>
          </div>
        </div>
      </div>`;

    const titleInput = root.querySelector<HTMLInputElement>('[data-region="title"]')!;
    const notesInput = root.querySelector<HTMLTextAreaElement>('[data-region="notes"]')!;
    const datePicker = mountDecoupledDatePicker({ defaultTrigger: { container: root.querySelector("[data-region=date-picker]")! },
      value: date,
      onChange: () => {
        date = datePicker.getValue();
        statusEl.textContent = "";
        statusEl.className = "meal-compose-status";
      },
    });
    const timePicker = mountDecoupledTimePicker({ defaultTrigger: { container: root.querySelector("[data-region=time-picker]")! },
      value: normalizeHhMm(time) || time,
      onChange: () => {
        time = normalizeHhMm(timePicker.getValue()) || timePicker.getValue();
        statusEl.textContent = "";
        statusEl.className = "meal-compose-status";
      },
    });
    const slotSelect = root.querySelector<HTMLSelectElement>('[data-region="slot"]')!;
    const foodsEl = root.querySelector<HTMLElement>('[data-region="foods"]')!;
    const addFoodBtn = root.querySelector<HTMLButtonElement>('[data-region="add-food"]')!;
    const aiInput = root.querySelector<HTMLInputElement>('[data-region="ai-input"]')!;
    const aiSendBtn = root.querySelector<HTMLButtonElement>('[data-region="ai-send"]')!;
    const aiHint = root.querySelector<HTMLElement>('[data-region="ai-hint"]')!;
    const saveBtn = root.querySelector<HTMLButtonElement>('[data-region="save"]')!;
    const statusEl = root.querySelector<HTMLElement>('[data-region="status"]')!;
    const totalsEl = root.querySelector<HTMLElement>('[data-region="totals"]')!;
    const recentListEl = root.querySelector<HTMLElement>('[data-region="recent-list"]')!;
    const pageTitleEl = root.querySelector<HTMLElement>('[data-region="page-title"]')!;

    function syncPickerValues(): void {
      datePicker.setValue(date);
      timePicker.setValue(normalizeHhMm(time) || time);
    }

    slotSelect.value = slot ?? "";

    function draftJson() {
      return {
        title,
        text: notes,
        date,
        time,
        slot: slot ?? unrecognizedSlot ?? null,
        iconKey,
        foods: foods.map((f) => ({
          text: f.text,
          kcal: f.kcal === "" ? null : Number(f.kcal),
          kcalEstimated: f.kcalEstimated,
          servingText: f.servingText || null,
          carbsGrams: f.carbsGrams === "" ? null : Number(f.carbsGrams),
          proteinGrams: f.proteinGrams === "" ? null : Number(f.proteinGrams),
          fatGrams: f.fatGrams === "" ? null : Number(f.fatGrams),
          sugarGrams: f.sugarGrams === "" ? null : Number(f.sugarGrams),
          fiberGrams: f.fiberGrams === "" ? null : Number(f.fiberGrams),
          sodiumMilligrams: f.sodiumMilligrams === "" ? null : Number(f.sodiumMilligrams),
          vitaminCMilligrams: f.vitaminCMilligrams === "" ? null : Number(f.vitaminCMilligrams),
          nutrientsEstimated: f.nutrientsEstimated,
        })),
      };
    }

    function formatTotalValue(sum: number | null, integer = false): string {
      if (sum == null) return "—";
      return integer ? String(Math.round(sum)) : String(Math.round(sum * 10) / 10);
    }

    function renderTotals() {
      const t = computeMealNutritionTotals(foods);
      const row = (label: string, unit: string, total: { sum: number | null; incomplete: boolean }, integer = false) => {
        const badge = total.incomplete ? `<span class="meal-compose-total-warn">不完整</span>` : "";
        const val = formatTotalValue(total.sum, integer);
        return `<div class="meal-compose-total-item"><span class="meal-compose-total-label">${label}</span><span class="meal-compose-total-value">${val} ${unit}</span>${badge}</div>`;
      };
      totalsEl.innerHTML = `
        <div class="meal-compose-totals-head">营养合计</div>
        <div class="meal-compose-totals-grid">
          ${row("热量", "千卡", t.kcal, true)}
          ${row("碳水", "克", t.carbsGrams)}
          ${row("蛋白质", "克", t.proteinGrams)}
          ${row("脂肪", "克", t.fatGrams)}
          ${row("糖", "克", t.sugarGrams)}
          ${row("膳食纤维", "克", t.fiberGrams)}
          ${row("钠", "毫克", t.sodiumMilligrams, true)}
          ${row("维生素 C", "毫克", t.vitaminCMilligrams, true)}
        </div>`;
    }

    function foodDraftFromEntry(entry: MealFoodEntry): FoodDraft {
      return {
        text: entry.text,
        kcal: String(entry.kcal),
        kcalMissing: false,
        servingText: entry.servingText ?? "",
        carbsGrams: entry.carbsGrams != null ? String(entry.carbsGrams) : "",
        proteinGrams: entry.proteinGrams != null ? String(entry.proteinGrams) : "",
        fatGrams: entry.fatGrams != null ? String(entry.fatGrams) : "",
        sugarGrams: entry.sugarGrams != null ? String(entry.sugarGrams) : "",
        fiberGrams: entry.fiberGrams != null ? String(entry.fiberGrams) : "",
        sodiumMilligrams: entry.sodiumMilligrams != null ? String(entry.sodiumMilligrams) : "",
        vitaminCMilligrams: entry.vitaminCMilligrams != null ? String(entry.vitaminCMilligrams) : "",
        kcalEstimated: entry.kcalEstimated,
        nutrientsEstimated: entry.nutrientsEstimated ?? null,
      };
    }

    function applyFoodEntry(idx: number, entry: MealFoodEntry) {
      const f = foods[idx];
      if (!f) return;
      Object.assign(f, foodDraftFromEntry(entry));
      renderFoods();
    }

    function closeSearchDropdown(idx: number) {
      const row = foodsEl.querySelector<HTMLElement>(`[data-food="${idx}"]`);
      const panel = row?.querySelector<HTMLElement>(".meal-food-search-results");
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = "";
      }
    }

    async function runFoodSearch(idx: number, query: string) {
      const row = foodsEl.querySelector<HTMLElement>(`[data-food="${idx}"]`);
      const panel = row?.querySelector<HTMLElement>(".meal-food-search-results");
      if (!panel) return;
      const q = query.trim();
      if (q.length < 1) {
        closeSearchDropdown(idx);
        return;
      }
      try {
        const { meals } = await searchMealFoods({ text: q });
        const hits = mealFoodSearchHits(meals, q).slice(0, 8);
        if (hits.length === 0) {
          panel.innerHTML = `<p class="meal-food-search-empty">无匹配</p>`;
          panel.hidden = false;
          return;
        }
        panel.innerHTML = hits
          .map((hit, hi) => {
            const title = hit.mealTitle?.trim() || "未命名餐食";
            const date = hit.mealStartedAt.slice(0, 10);
            return `<button type="button" class="meal-food-search-hit" data-hit="${hi}">
              <span class="meal-food-search-hit-name">${escapeAttr(hit.food.text)}</span>
              <span class="meal-food-search-hit-meta">${escapeAttr(title)} · ${escapeAttr(date)} · ${Math.round(hit.food.kcal)} 千卡</span>
            </button>`;
          })
          .join("");
        panel.hidden = false;
        panel.querySelectorAll<HTMLButtonElement>(".meal-food-search-hit").forEach((btn, hi) => {
          btn.addEventListener("click", () => {
            const hit = hits[hi];
            if (!hit) return;
            applyFoodEntry(idx, mealFoodEntryFromSnapshot(hit.food));
            closeSearchDropdown(idx);
          });
        });
      } catch (e) {
        panel.innerHTML = `<p class="meal-food-search-empty">${escapeAttr(String(e))}</p>`;
        panel.hidden = false;
      }
    }

    function scheduleFoodSearch(idx: number, query: string) {
      const prev = searchTimers.get(idx);
      if (prev) clearTimeout(prev);
      searchTimers.set(
        idx,
        setTimeout(() => {
          searchTimers.delete(idx);
          void runFoodSearch(idx, query);
        }, 280),
      );
    }

    function mealListLabel(m: HealthMealSnapshot): string {
      const title = m.title?.trim();
      const slot = mealSlotLabel(normalizeMealSlot(m.slot));
      const date = m.startedAt.slice(0, 10);
      return title ? `${date} ${title}` : `${date} ${slot}`;
    }

    async function loadRecentMeals() {
      recentListEl.innerHTML = `<p class="meal-compose-recent-loading">加载中…</p>`;
      try {
        const { meals } = await healthListMeals({});
        const recent = meals
          .filter((m) => !m.deletedAt)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, 20);
        if (recent.length === 0) {
          recentListEl.innerHTML = `<p class="meal-compose-recent-empty">暂无记录</p>`;
          return;
        }
        recentListEl.innerHTML = recent
          .map(
            (m) =>
              `<button type="button" class="meal-compose-recent-item" data-meal-id="${escapeAttr(m.id)}">${escapeAttr(mealListLabel(m))}</button>`,
          )
          .join("");
        recentListEl.querySelectorAll<HTMLButtonElement>(".meal-compose-recent-item").forEach((btn) => {
          btn.addEventListener("click", () => {
            const id = btn.dataset.mealId;
            if (id) void loadMealIntoForm(id);
          });
        });
      } catch (e) {
        recentListEl.innerHTML = `<p class="meal-compose-recent-empty">${escapeAttr(String(e))}</p>`;
      }
    }

    async function loadMealIntoForm(mealId: string) {
      try {
        const { meal } = await getMeal(mealId);
        const ts = Math.floor(Date.parse(meal.startedAt) / 1000);
        const parts = unixToTimeParts(ts);
        const entry = archiveMealToEntry(meal, parts.date);
        editingMealId = meal.id;
        loadedStartedAt = meal.startedAt;
        loadedDate = parts.date;
        loadedStartedAtTime = parts.time;
        loadedExactTime = meal.atHm ?? null;
        expectedRevision = meal.revision;
        title = entry.title ?? "";
        notes = entry.text ?? "";
        date = parts.date;
        time = entry.at ?? "";
        slot = entry.slot;
        unrecognizedSlot = entry.unrecognizedSlot;
        iconKey = entry.iconKey;
        foods = entry.foods.map(foodDraftFromEntry);
        const legacyItems = (meal.items ?? []).map((item) => item.trim()).filter(Boolean);
        const hasLegacyItems = legacyItems.length > 0;
        const rootKcal = meal.mealKcal ?? meal.kcal;
        legacyTotalKcal = null;
        legacyFoodTexts = null;
        if (meal.recordShape !== "foods" && hasLegacyItems) {
          legacyFoodTexts = legacyItems;
          foods = legacyItems.map((text) => {
            const draft = emptyFood();
            draft.text = text;
            draft.legacyProtected = true;
            return draft;
          });
        } else if (meal.recordShape !== "foods" && rootKcal != null && Number.isFinite(rootKcal)) {
          const preservedTotal = emptyFood();
          preservedTotal.legacyProtected = true;
          foods = [preservedTotal];
          legacyTotalKcal = Math.round(rootKcal);
        }
        loadedFoodsJson = JSON.stringify(foods);
        titleInput.value = title;
        notesInput.value = notes;
        syncPickerValues();
        slotSelect.value = slot ?? "";
        pageTitleEl.textContent = "编辑餐食";
        statusEl.textContent = "";
        statusEl.className = "meal-compose-status";
        renderFoods();
      } catch (e) {
        statusEl.textContent = String(e);
        statusEl.className = "meal-compose-status is-err";
      }
    }

    function foodField(label: string, key: string, value: string, kind: "text" | "num", step = "0.1"): string {
      const input =
        kind === "text"
          ? `<input type="text" data-f="${key}" value="${escapeAttr(value)}">`
          : `<input type="number" data-f="${key}" min="0" step="${step}" value="${escapeAttr(value)}">`;
      return `<label class="meal-food-field"><span>${label}</span>${input}</label>`;
    }

    function renderFoods() {
      foodsEl.innerHTML =
        foods.length === 0
          ? `<p class="meal-food-empty">还没有食物记录</p>`
          : foods
              .map((f, i) => {
                const warn = f.kcalMissing ? `<p class="meal-compose-food-warn">请补充热量</p>` : "";
                const legacyNote = f.legacyProtected
                  ? `<p class="meal-compose-food-warn">${legacyTotalKcal !== null ? `旧整餐总热量 ${Math.round(legacyTotalKcal)} 千卡尚未分配；` : "旧食物项尚无逐项热量；"}请核对并补充名称与热量</p>`
                  : "";
                return `<article class="meal-food-card" data-food="${i}">
            <header class="meal-food-card-head">
              <input type="text" class="meal-food-name" data-f="text" value="${escapeAttr(f.text)}" placeholder="食物名称">
              <button type="button" data-f="del"${f.legacyProtected ? " disabled title=\"请先为旧食物项补充热量后再保存\"" : ""}>删除</button>
            </header>
            ${legacyNote}
            <div class="meal-food-search-wrap">
              <input type="search" class="meal-food-search-input" data-f="search" placeholder="搜索历史食物…" autocomplete="off">
              <div class="meal-food-search-results" hidden></div>
            </div>
            <div class="meal-food-grid">
              ${foodField("热量（千卡）", "kcal", f.kcal, "num", "1")}
              ${foodField("份量", "serving", f.servingText, "text")}
            </div>
            <p class="meal-food-section">营养素</p>
            <div class="meal-food-grid meal-food-grid-3">
              ${foodField("碳水（克）", "carbs", f.carbsGrams, "num")}
              ${foodField("蛋白质（克）", "protein", f.proteinGrams, "num")}
              ${foodField("脂肪（克）", "fat", f.fatGrams, "num")}
            </div>
            <p class="meal-food-section">扩展</p>
            <div class="meal-food-grid meal-food-grid-4">
              ${foodField("糖（克）", "sugar", f.sugarGrams, "num")}
              ${foodField("膳食纤维（克）", "fiber", f.fiberGrams, "num")}
              ${foodField("钠（毫克）", "sodium", f.sodiumMilligrams, "num")}
              ${foodField("维生素 C（毫克）", "vitc", f.vitaminCMilligrams, "num")}
            </div>
            ${warn}
          </article>`;
              })
              .join("");

      foodsEl.querySelectorAll<HTMLElement>(".meal-food-card").forEach((row) => {
        const idx = Number(row.dataset.food);
        row.querySelectorAll<HTMLInputElement>("input").forEach((inp) => {
          inp.addEventListener("input", () => {
            const f = foods[idx];
            if (!f) return;
            const key = inp.dataset.f;
            if (key === "text") {
              f.text = inp.value;
              f.kcalMissing = false;
            } else if (key === "kcal") {
              f.kcal = inp.value;
              f.kcalMissing = false;
              f.kcalEstimated = false;
            } else if (key === "serving") f.servingText = inp.value;
            else if (key === "carbs") f.carbsGrams = inp.value;
            else if (key === "protein") f.proteinGrams = inp.value;
            else if (key === "fat") f.fatGrams = inp.value;
            else if (key === "sugar") f.sugarGrams = inp.value;
            else if (key === "fiber") f.fiberGrams = inp.value;
            else if (key === "sodium") f.sodiumMilligrams = inp.value;
            else if (key === "vitc") f.vitaminCMilligrams = inp.value;
            else if (key === "search") scheduleFoodSearch(idx, inp.value);
            statusEl.textContent = "";
            statusEl.className = "meal-compose-status";
            renderTotals();
          });
        });
        row.querySelector<HTMLButtonElement>('[data-f="del"]')?.addEventListener("click", () => {
          foods.splice(idx, 1);
          renderFoods();
        });
      });
      renderTotals();
    }

    function escapeAttr(s: string): string {
      return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    function syncFromInputs() {
      title = titleInput.value;
      notes = notesInput.value;
      date = datePicker.getValue();
      time = normalizeHhMm(timePicker.getValue()) || timePicker.getValue();
      slot = normalizeMealSlot(slotSelect.value);
    }

    function applyAiResult(data: Record<string, unknown>) {
      if (typeof data.title === "string") title = data.title;
      if (typeof data.text === "string") notes = data.text;
      if (typeof data.date === "string" && data.date) date = data.date;
      if (typeof data.time === "string" && data.time) time = data.time.slice(0, 5);
      if (Object.prototype.hasOwnProperty.call(data, "slot")) {
        if (unrecognizedSlot) slot = null;
        else slot = normalizeMealSlot(data.slot);
      }
      if (Object.prototype.hasOwnProperty.call(data, "iconKey")) iconKey = typeof data.iconKey === "string" ? data.iconKey : undefined;

      titleInput.value = title;
      notesInput.value = notes;
      syncPickerValues();
      slotSelect.value = slot ?? "";

      if (Array.isArray(data.foods)) {
        const proposedFoods = data.foods.map((item) => {
          const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const kcalVal = numOrNull(o.kcal);
          const missing = kcalVal === null && strOrEmpty(o.text).trim().length > 0;
          return {
            text: strOrEmpty(o.text),
            kcal: kcalVal !== null ? String(Math.round(kcalVal)) : "",
            kcalMissing: missing,
            servingText: o.servingText ? strOrEmpty(o.servingText) : "",
            carbsGrams: numStr(o.carbsGrams),
            proteinGrams: numStr(o.proteinGrams),
            fatGrams: numStr(o.fatGrams),
            sugarGrams: numStr(o.sugarGrams),
            fiberGrams: numStr(o.fiberGrams),
            sodiumMilligrams: numStr(o.sodiumMilligrams),
            vitaminCMilligrams: numStr(o.vitaminCMilligrams),
            kcalEstimated: o.kcalEstimated === true,
            nutrientsEstimated:
              o.nutrientsEstimated === true || o.nutrientsEstimated === false
                ? o.nutrientsEstimated
                : null,
          };
        });
        if (legacyFoodTexts !== null) {
          const existingProtected = foods.filter((food) => food.legacyProtected);
          let protectedIndex = 0;
          const protectedFoods = legacyFoodTexts.map((text) => {
            const candidate = existingProtected[protectedIndex];
            const current = candidate?.text === text ? candidate : undefined;
            if (current) protectedIndex += 1;
            const draft = current ?? emptyFood();
            draft.text = text;
            draft.legacyProtected = true;
            return draft;
          });
          const supplements = proposedFoods.filter((food) => !legacyFoodTexts!.includes(food.text.trim()));
          foods = [...protectedFoods, ...supplements];
        } else if (legacyTotalKcal !== null) {
          const placeholder = foods.find((food) => food.legacyProtected) ?? emptyFood();
          placeholder.legacyProtected = true;
          foods = [placeholder, ...proposedFoods];
        } else foods = proposedFoods;
        renderFoods();
      }
      statusEl.textContent = "";
      statusEl.className = "meal-compose-status";

      const hasMissing = foods.some((f) => f.kcalMissing);
      if (hasMissing) {
        aiHint.textContent = "部分食物缺少热量，请补充后再保存";
      }
    }

    function clearFieldErrors() {
      root.querySelectorAll(".meal-compose-field.is-error").forEach((el) => el.classList.remove("is-error"));
      root.querySelectorAll(".meal-food-card.is-error").forEach((el) => el.classList.remove("is-error"));
    }

    function validate(): boolean {
      syncFromInputs();
      clearFieldErrors();
      let ok = true;

      for (let i = 0; i < foods.length; i++) {
        const f = foods[i];
        const row = foodsEl.querySelector<HTMLElement>(`[data-food="${i}"]`);
        const textOk = f.text.trim().length > 0;
        const kcalNum = f.kcal === "" ? NaN : Number(f.kcal);
        const kcalOk = Number.isFinite(kcalNum) && kcalNum >= 0 && !f.kcalMissing;
        if (!textOk || !kcalOk) {
          row?.classList.add("is-error");
          ok = false;
        }
      }

      if (foods.some((f) => f.kcalMissing)) ok = false;
      return ok;
    }

    function buildMealEntry(): { date: string; foods: MealFoodEntry[] } | null {
      if (!validate()) return null;
      const mealFoods: MealFoodEntry[] = foods.map((f) => {
        const entry: MealFoodEntry = {
          text: f.text.trim(),
          kcal: Math.round(Number(f.kcal)),
          kcalEstimated: f.kcalEstimated,
        };
        if (f.servingText.trim()) {
          entry.servingText = f.servingText.trim();
          entry.servingEstimated = false;
        }
        if (f.carbsGrams !== "") entry.carbsGrams = Number(f.carbsGrams);
        if (f.proteinGrams !== "") entry.proteinGrams = Number(f.proteinGrams);
        if (f.fatGrams !== "") entry.fatGrams = Number(f.fatGrams);
        if (f.sugarGrams !== "") entry.sugarGrams = Number(f.sugarGrams);
        if (f.fiberGrams !== "") entry.fiberGrams = Number(f.fiberGrams);
        if (f.sodiumMilligrams !== "") entry.sodiumMilligrams = Number(f.sodiumMilligrams);
        if (f.vitaminCMilligrams !== "") entry.vitaminCMilligrams = Number(f.vitaminCMilligrams);
        const hasNutrient =
          entry.carbsGrams != null ||
          entry.proteinGrams != null ||
          entry.fatGrams != null ||
          entry.sugarGrams != null ||
          entry.fiberGrams != null ||
          entry.sodiumMilligrams != null ||
          entry.vitaminCMilligrams != null;
        if (hasNutrient) entry.nutrientsEstimated = f.nutrientsEstimated ?? true;
        return entry;
      });
      return { date, foods: mealFoods };
    }

    async function runAi() {
      const text = aiInput.value.trim();
      if (!text || aiBusy) return;
      syncFromInputs();
      aiHint.textContent = "";
      aiBusy = true;
      aiSendBtn.disabled = true;
      aiInput.disabled = true;

      try {
        const config = await loadAiConfig();
        const entry = getActiveEntry(config);
        if (!entry) {
          aiHint.textContent = "请先在 AI 设置中添加 API";
          return;
        }
        if (!entry.apiKey.trim()) {
          aiHint.textContent = "请先在设置中填写 API Key";
          return;
        }
        const raw = await completeChat(
          MEAL_AI_SYSTEM,
          JSON.stringify(draftJson()) + "\n\n用户：" + text,
          entry,
          config.activeModel,
        );
        aiInput.value = "";
        const parsed = parseAiJson(raw);
        if (!parsed) {
          aiHint.textContent = "AI 返回格式无法解析";
          return;
        }
        applyAiResult(parsed);
      } catch (e) {
        aiHint.textContent = String(e);
      } finally {
        aiBusy = false;
        aiSendBtn.disabled = false;
        aiInput.disabled = false;
      }
    }

    async function runSave() {
      if (saveBusy) return;
      syncFromInputs();
      const foodsChanged = editingMealId !== null && loadedFoodsJson !== null && JSON.stringify(foods) !== loadedFoodsJson;
      if (unrecognizedSlot && foodsChanged) {
        statusEl.textContent = "餐食分类值未知；修改食物前请先明确选择一个分类或未分类";
        statusEl.className = "meal-compose-status is-err";
        return;
      }
      const built = editingMealId !== null && !foodsChanged ? { date, foods: [] as MealFoodEntry[] } : buildMealEntry();
      if (!built) {
        statusEl.textContent = "请修正表单错误";
        statusEl.className = "meal-compose-status is-err";
        return;
      }

      saveBusy = true;
      saveBtn.disabled = true;
      statusEl.textContent = "";
      statusEl.className = "meal-compose-status";

      const mealTitle = title.trim() || defaultMealTitle(built.date, slot);
      const kcal = built.foods.reduce((s, f) => s + f.kcal, 0);

      try {
        const entry = {
          id: editingMealId ?? crypto.randomUUID(),
          title: mealTitle,
          at: time || undefined,
          slot,
          unrecognizedSlot,
          iconKey,
          foods: built.foods,
          items: built.foods.map((f) => f.text),
          text: notes,
          kcal,
          source: "manual",
        };
        let savedMeal: HealthMealSnapshot | null = null;
        if (getSettings().dataDir.trim() !== ownerDir) throw new Error("数据目录已切换，草稿未保存；请重新打开餐食页面");
        if (editingMealId != null && expectedRevision != null) {
          if (!foodsChanged) {
            const updateTime = date !== loadedDate || time !== (loadedExactTime ?? "");
            const seconds = loadedStartedAt ? new Date(Date.parse(loadedStartedAt)).getUTCSeconds() : 0;
            const metadataStartedAt = updateTime
              ? new Date((dateTimeToUnix(date, time || loadedStartedAtTime) + seconds) * 1000).toISOString()
              : loadedStartedAt!;
            const response = await invokeDomainWrite<{ meal: HealthMealSnapshot }>("health_update_meal_metadata", { req: {
              expectedDataDir: ownerDir,
              meal: { id: editingMealId, expectedRevision },
              title: mealTitle,
              updateTime,
              startedAt: metadataStartedAt,
              atHm: updateTime ? (time || null) : loadedExactTime,
              slot: slot ?? unrecognizedSlot ?? null,
              iconKey: iconKey ?? null,
              text: notes,
            } });
            savedMeal = response.meal;
          } else {
            const updateTime = date !== loadedDate || time !== (loadedExactTime ?? "");
            const seconds = loadedStartedAt ? new Date(Date.parse(loadedStartedAt)).getUTCSeconds() : 0;
            const updateReq = {
              ...mealEntryToUpdateReq(built.date, entry),
              startedAt: updateTime
                ? new Date((dateTimeToUnix(date, time || loadedStartedAtTime) + seconds) * 1000).toISOString()
                : loadedStartedAt!,
              atHm: updateTime ? (time || null) : loadedExactTime,
            };
            const response = await healthUpdateMeal({
              expectedDataDir: ownerDir,
              meal: { id: editingMealId, expectedRevision },
              ...updateReq,
            });
            savedMeal = response.meal;
          }
          if (savedMeal) {
            expectedRevision = savedMeal.revision;
            loadedStartedAt = savedMeal.startedAt;
            const returnedParts = unixToTimeParts(Math.floor(Date.parse(savedMeal.startedAt) / 1000));
            loadedDate = returnedParts.date;
            loadedStartedAtTime = returnedParts.time;
            loadedExactTime = savedMeal.atHm ?? null;
            date = loadedDate;
            time = loadedExactTime ?? "";
            syncPickerValues();
          }
          loadedFoodsJson = JSON.stringify(foods);
          if (foodsChanged && (legacyTotalKcal !== null || legacyFoodTexts !== null)) {
            for (const food of foods) delete food.legacyProtected;
            legacyTotalKcal = null;
            legacyFoodTexts = null;
            loadedFoodsJson = JSON.stringify(foods);
          }
        } else {
          await healthCreateMeal({ expectedDataDir: ownerDir, ...mealEntryToCreateReq(built.date, entry) });
        }
        statusEl.textContent = "已保存";
        statusEl.className = "meal-compose-status is-ok";
        void loadRecentMeals();
      } catch (e) {
        statusEl.textContent = String(e);
        statusEl.className = "meal-compose-status is-err";
      } finally {
        saveBusy = false;
        saveBtn.disabled = false;
      }
    }

    titleInput.addEventListener("input", () => {
      statusEl.textContent = "";
    });
    notesInput.addEventListener("input", () => {
      statusEl.textContent = "";
    });
    slotSelect.addEventListener("change", () => {
      unrecognizedSlot = undefined;
      statusEl.textContent = "";
    });

    addFoodBtn.addEventListener("click", () => {
      foods.push(emptyFood());
      renderFoods();
    });

    aiSendBtn.addEventListener("click", () => void runAi());
    aiInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void runAi();
      }
    });

    saveBtn.addEventListener("click", () => void runSave());

    renderFoods();
    void loadRecentMeals();

    const handle: InsightDestinationHandle = {
      activate() {},
      deactivate() {},
      dispose() {
        datePicker.dispose();
        timePicker.dispose();
        root.innerHTML = "";
      },
    };
    return handle;
  },
};
