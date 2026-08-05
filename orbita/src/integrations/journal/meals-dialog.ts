import {
  inferMealSlotFromNow,
  inferMealSlotFromTime,
  mealSlotLabel,
  newMealId,
  normalizeMealSlot,
  type MealEntry,
  type MealSlot,
} from "../../core/data/meals";
import { getSettings } from "../../core/settings";
import { escHtml } from "../../core/html";
import { bindDialog } from "../../ui/motion";
import { beijingToday, journalList, journalUpsert } from "./client";

const DEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

async function loadDailyMeals(date: string): Promise<{ dailyId: string; meals: MealEntry[]; data: Record<string, unknown> }> {
  const { entries } = await journalList({ date });
  const daily = entries.find((e) => e.kind === "daily" && e.date === date);
  const data =
    daily?.data && typeof daily.data === "object" ? { ...(daily.data as Record<string, unknown>) } : {};
  const raw = data.meals;
  const meals: MealEntry[] = Array.isArray(raw)
    ? raw
        .map((m) => {
          if (!m || typeof m !== "object") return null;
          const o = m as Record<string, unknown>;
          const id = typeof o.id === "string" ? o.id : "";
          if (!id) return null;
          return {
            id,
            at: typeof o.at === "string" ? o.at : undefined,
            slot: normalizeMealSlot(o.slot),
            items: Array.isArray(o.items) ? o.items.filter((x): x is string => typeof x === "string") : [],
            text: typeof o.text === "string" ? o.text : "",
            kcal: typeof o.kcal === "number" ? Math.round(o.kcal) : 0,
            source: typeof o.source === "string" ? o.source : undefined,
            confidence: typeof o.confidence === "string" ? o.confidence : undefined,
          } as MealEntry;
        })
        .filter((m): m is MealEntry => !!m)
    : [];
  return { dailyId: daily?.id ? String(daily.id) : "", meals, data };
}

async function saveDailyMeals(date: string, meals: MealEntry[], prev: { dailyId: string; data: Record<string, unknown> }) {
  const data = { ...prev.data, meals };
  await journalUpsert({
    id: prev.dailyId,
    kind: "daily",
    date,
    data,
  });
}

function slotOptions(selected: MealSlot): string {
  const slots: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
  return slots
    .map((s) => `<option value="${s}"${s === selected ? " selected" : ""}>${mealSlotLabel(s)}</option>`)
    .join("");
}

function tagHtml(tag: string): string {
  return `<span class="meal-tag" data-tag="${escHtml(tag)}">${escHtml(tag)}<button type="button" class="meal-tag-del" aria-label="删除">${DEL_SVG}</button></span>`;
}

function bindTagInput(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>(".meal-tags")!;
  const input = root.querySelector<HTMLInputElement>(".meal-tag-input")!;
  const addTag = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const wrap = document.createElement("span");
    wrap.innerHTML = tagHtml(t);
    const el = wrap.firstElementChild as HTMLElement;
    bindTagEl(el, list);
    list.appendChild(el);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addTag(input.value);
    input.value = "";
  });
  list.querySelectorAll<HTMLElement>(".meal-tag").forEach((el) => bindTagEl(el, list));
}

function bindTagEl(el: HTMLElement, _list: HTMLElement) {
  el.querySelector(".meal-tag-del")!.addEventListener("click", () => el.remove());
  el.addEventListener("dblclick", () => {
    const old = el.dataset.tag ?? "";
    const v = prompt("编辑标签", old);
    if (!v) return;
    const t = v.trim();
    if (!t) {
      el.remove();
      return;
    }
    el.dataset.tag = t;
    const del = el.querySelector(".meal-tag-del");
    el.textContent = t;
    if (del) el.appendChild(del);
  });
}

function collectTags(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".meal-tag")]
    .map((el) => el.dataset.tag?.trim() ?? "")
    .filter(Boolean);
}

export async function deleteMeal(date: string, mealId: string) {
  const prev = await loadDailyMeals(date);
  const meals = prev.meals.filter((m) => m.id !== mealId);
  await saveDailyMeals(date, meals, prev);
}

export function openMealDialog(
  root: HTMLElement,
  meal: MealEntry | null,
  onSave: () => void,
  defaultDate?: string,
) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  const date = defaultDate ?? beijingToday();
  const slot = meal?.slot ?? inferMealSlotFromNow();
  const at = meal?.at ?? "";
  const items = meal?.items ?? [];
  backdrop.innerHTML = `
    <form class="dialog-panel" id="mealForm">
      <div class="dialog-title">${meal ? "编辑吃饭" : "记吃饭"}</div>
      <div class="dialog-field"><label>日期</label><input type="date" id="mealDate" value="${date}"></div>
      <div class="dialog-field"><label>时间</label><input type="time" id="mealAt" value="${escHtml(at)}"></div>
      <div class="dialog-field"><label>餐次</label><select id="mealSlot">${slotOptions(slot)}</select></div>
      <div class="dialog-field"><label>吃了啥</label>
        <div class="meal-tags">${items.map(tagHtml).join("")}</div>
        <input type="text" class="meal-tag-input" placeholder="回车添加标签">
      </div>
      <div class="dialog-field"><label>备注</label><input type="text" id="mealText" value="${escHtml(meal?.text ?? "")}"></div>
      <div class="dialog-field"><label>热量 kcal</label><input type="number" id="mealKcal" min="0" step="1" value="${meal?.kcal ?? ""}"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#mealForm")!;
  bindTagInput(form);
  const atInput = form.querySelector<HTMLInputElement>("#mealAt")!;
  const slotSelect = form.querySelector<HTMLSelectElement>("#mealSlot")!;
  atInput.addEventListener("change", () => {
    if (!meal) slotSelect.value = inferMealSlotFromTime(atInput.value);
  });
  const close = async () => {
    await motion.close();
    backdrop.remove();
  };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close();
  });
  void motion.open();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = form.querySelector<HTMLInputElement>("#mealDate")!.value;
    const kcal = Number(form.querySelector<HTMLInputElement>("#mealKcal")!.value);
    if (!Number.isFinite(kcal) || kcal < 0) {
      alert("请填写有效热量");
      return;
    }
    const entry: MealEntry = {
      id: meal?.id ?? newMealId(),
      at: atInput.value || undefined,
      slot: normalizeMealSlot(slotSelect.value),
      items: collectTags(form),
      text: form.querySelector<HTMLInputElement>("#mealText")!.value.trim(),
      kcal: Math.round(kcal),
      source: meal?.source ?? "manual",
    };
    const prev = await loadDailyMeals(d);
    const meals = meal
      ? prev.meals.map((m) => (m.id === entry.id ? entry : m))
      : [...prev.meals, entry];
    await saveDailyMeals(d, meals, prev);
    await close();
    onSave();
    window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
  });
}

export function openHydrationDialog(root: HTMLElement, date: string, currentMl: number, onSave: () => void) {
  if (!getSettings().dataDir) {
    alert("请先在设置中配置数据存储位置");
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel">
      <div class="dialog-title">喝水</div>
      <div class="dialog-field"><label>日期</label><input type="date" id="hydDate" value="${date}"></div>
      <div class="dialog-field"><label>毫升 ml</label><input type="number" id="hydMl" min="0" step="50" value="${currentMl > 0 ? currentMl : ""}"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);
  const motion = bindDialog(backdrop);
  const close = async () => {
    await motion.close();
    backdrop.remove();
  };
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close();
  });
  void motion.open();
  backdrop.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = backdrop.querySelector<HTMLInputElement>("#hydDate")!.value;
    const ml = Number(backdrop.querySelector<HTMLInputElement>("#hydMl")!.value);
    if (!Number.isFinite(ml) || ml < 0) {
      alert("请填写有效毫升数");
      return;
    }
    const { entries } = await journalList({ date: d });
    const daily = entries.find((en) => en.kind === "daily" && en.date === d);
    const prevData =
      daily?.data && typeof daily.data === "object" ? { ...(daily.data as Record<string, unknown>) } : {};
    await journalUpsert({
      id: daily?.id ? String(daily.id) : "",
      kind: "daily",
      date: d,
      data: { ...prevData, hydrationMl: Math.round(ml) },
    });
    await close();
    onSave();
    window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
  });
}
