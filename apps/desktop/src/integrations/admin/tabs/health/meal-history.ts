import { MEAL_ICON_CHOICES, renderMealIcon } from "./meal-icons";
import "./meal-history.css";
import { showCommandMenuAt } from "../../../../ui/command-menu-popover";
import { getConfirmDialog } from "../../../shell/dialog";
import { makeFoodDrafts, mountMealFoodEditor } from "./meal-food-editor";
import { getSettings } from "../../../../core/settings";
import { mountInlineTextField } from "../../../../ui/inline-text-field";
import { mountFlatSelectPopover } from "../../../../ui/flat-select-popover";
import { invokeDomainWrite } from "../../domain-write-guard";
import { escHtml } from "../../../../core/html";
import {
  healthListMeals,
  unixToTimeParts,
  type HealthMealFoodSnapshot,
  type HealthMealSnapshot,
} from "../../../journal/client";

const SLOT_OPTIONS = [
  { value: "", label: "全部" },
  { value: "breakfast", label: "早餐" },
  { value: "lunch", label: "午餐" },
  { value: "dinner", label: "晚餐" },
  { value: "late_night", label: "夜宵" },
  { value: "coffee", label: "咖啡" },
  { value: "beverage", label: "饮料" },
  { value: "snack", label: "零食" },
  { value: "other", label: "其他" },
  { value: "uncategorized", label: "未分类" },
] as const;

function mealLocalDate(meal: HealthMealSnapshot): string {
  const ts = Math.floor(Date.parse(meal.startedAt) / 1000);
  if (Number.isFinite(ts)) return unixToTimeParts(ts).date;
  return meal.startedAt.slice(0, 10);
}

function mealTimeLabel(meal: HealthMealSnapshot): string {
  return meal.atHm || "未设置时间";
}

function slotDisplay(meal: HealthMealSnapshot): string {
  if (meal.slot == null || meal.slot === "") return "未分类";
  return SLOT_OPTIONS.find((option) => option.value === meal.slot)?.label ?? meal.slot;
}

function matchesSlot(meal: HealthMealSnapshot, filter: string): boolean {
  if (!filter) return true;
  if (filter === "uncategorized") return meal.slot == null || meal.slot === "";
  return meal.slot === filter;
}

function matchesSearch(meal: HealthMealSnapshot, query: string): boolean {
  if (!query) return true;
  // Search the complete snapshot, including collapsed and legacy food items.
  const fields = [meal.title, meal.text, slotDisplay(meal), ...(meal.items ?? []),
    ...meal.foods.flatMap((food) => [food.text, food.servingText])];
  return fields.some((field) => field?.toLocaleLowerCase().includes(query));
}

function formatKcal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return `${Math.round(v)} kcal`;
}

function formatNutrient(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "";
  const n = Math.round(v * 10) / 10;
  return `${n} ${unit}`;
}

function renderFoodRow(food: HealthMealFoodSnapshot): string {
  const cells = [
    escHtml(food.text),
    formatKcal(food.kcal),
    food.servingText ? escHtml(food.servingText) : "",
    formatNutrient(food.carbsGrams, "g"),
    formatNutrient(food.proteinGrams, "g"),
    formatNutrient(food.fatGrams, "g"),
    formatNutrient(food.sugarGrams, "g"),
    formatNutrient(food.fiberGrams, "g"),
    formatNutrient(food.sodiumMilligrams, "mg"),
    formatNutrient(food.vitaminCMilligrams, "mg"),
  ];
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

function renderFoods(meal: HealthMealSnapshot): string {
  if (meal.foods.length > 0) {
    const rows = meal.foods
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(renderFoodRow)
      .join("");
    return `<table class="health-activity-table health-meal-foods-table">
      <thead><tr>
        <th>食物</th><th>热量</th><th>份量</th><th>碳水</th><th>蛋白</th><th>脂肪</th><th>糖</th><th>纤维</th><th>钠</th><th>维C</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
  if (meal.items?.length) {
    return `<ul class="health-meal-legacy-items">${meal.items.map((i) => `<li>${escHtml(i)}</li>`).join("")}</ul>`;
  }
  if (meal.text?.trim()) {
    return `<p class="health-meal-legacy-text">${escHtml(meal.text)}</p>`;
  }
  return `<div class="health-activity-empty">暂无食物明细</div>`;
}

type MealWithIcon = HealthMealSnapshot & { iconKey?: string | null };

function renderMealRow(meal: MealWithIcon, expanded: boolean): string {
  const time = mealTimeLabel(meal);
  const title = meal.title?.trim() || slotDisplay(meal);
  const kcal = formatKcal(meal.mealKcal ?? meal.kcal ?? null);
  return `<details class="health-meal-row" data-meal-id="${escHtml(meal.id)}"${expanded ? " open" : ""}>
    <summary class="health-activity-row health-meal-row-summary">
      <span class="health-meal-when">${escHtml(time)}</span>
      <button type="button" class="health-activity-row-type" data-edit-slot>${escHtml(slotDisplay(meal))}</button>
      <button type="button" class="health-meal-icon" data-edit-icon aria-label="选择饮食图标">${renderMealIcon(meal.iconKey, { size: 18 })}</button>
      <span class="health-meal-title-energy">
        <span class="health-activity-row-title" data-edit-title data-value="${escHtml(title)}"></span>
        <span class="health-activity-row-duration">${escHtml(kcal)}</span>
      </span>
    </summary>
    <div class="health-meal-row-body">${renderFoods(meal)}</div>
  </details>`;
}

export function mountMealHistorySection(
  root: HTMLElement,
  signal: AbortSignal,
): { reload: () => Promise<void> } {
  let meals: MealWithIcon[] = [];
  const ownerDir = getSettings().dataDir;
  const queues = new Map<string, Promise<void>>();
  const draftTitles = new Map<string, string>();
  const draftSlots = new Map<string, string | null>();
  const draftIcons = new Map<string, string | null>();
  const foodDrafts = new Map<string, ReturnType<typeof makeFoodDrafts>>();
  const foodDraftRevisions = new Map<string, number>();
  let repaintPending = false;
  let writesPending = 0;
  function trackWrite(write: Promise<void>): void {
    writesPending += 1;
    void write.finally(() => {
      writesPending -= 1;
      if (repaintPending && !signal.aborted) setTimeout(() => requestRepaint(), 0);
    });
  }
  const errors = new Map<string, string>();
  let disposers: (() => void)[] = [];
  let slotFilter = "";
  let search = "";
  let loadVersion = 0;
  const expanded = new Set<string>();

  root.innerHTML = `
    <section class="health-activity-board health-meal-section">
      <div class="health-activity-board-head">
        <div class="health-activity-board-lead">
          <h3 class="health-activity-board-title">饮食列表</h3>
          <div class="health-activity-pills" role="tablist">
            ${SLOT_OPTIONS.map((o) => `<button type="button" class="health-activity-pill${o.value === "" ? " is-active" : ""}" data-slot="${o.value}" role="tab" aria-selected="${o.value === ""}">${o.label}</button>`).join("")}
          </div>
        </div>
        <div class="health-activity-board-tools">
          <label class="health-activity-searchbox">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="search" placeholder="搜索饮食或食物" aria-label="搜索饮食或食物" data-field="search" />
          </label>
          <button type="button" class="health-activity-filter-btn" aria-label="筛选" aria-disabled="true">筛选</button>
        </div>
      </div>
      <div role="alert" data-region="error"></div>
      <div class="health-activity-list health-meal-list" data-region="list"></div>
    </section>`;

  const listRegion = root.querySelector<HTMLElement>('[data-region="list"]')!;
  const errorRegion = root.querySelector<HTMLElement>('[data-region="error"]')!;
  const searchEl = root.querySelector<HTMLInputElement>('[data-field="search"]')!;

  function filtered(): HealthMealSnapshot[] {
    return meals
      .filter((m) => !m.deletedAt)
      .filter((m) => matchesSlot(m, slotFilter))
      .filter((m) => matchesSearch(m, search))
      .sort((a, b) => {
        const dateCmp = mealLocalDate(b).localeCompare(mealLocalDate(a));
        if (dateCmp !== 0) return dateCmp;
        return Date.parse(b.startedAt) - Date.parse(a.startedAt);
      });
  }

  function saveMetadata(id: string, change: { title?: string; slot?: string | null; iconKey?: string | null }): void {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (errors.has(id)) throw new Error("上一项保存失败，请重新打开页面后检查草稿");
      if (signal.aborted || getSettings().dataDir !== ownerDir) throw new Error("数据目录已切换，草稿未保存");
      const meal = meals.find((item) => item.id === id);
      if (!meal) throw new Error("餐食已不可用");
      const title = change.title === undefined ? meal.title : change.title.trim();
      if (change.title !== undefined && !title) throw new Error("名称不能为空");
      const result = await invokeDomainWrite<{ meal: MealWithIcon }>("health_update_meal_metadata", { req: {
        expectedDataDir: ownerDir, meal: { id, expectedRevision: meal.revision },
        title, startedAt: meal.startedAt, slot: change.slot === undefined ? meal.slot : change.slot,
        iconKey: change.iconKey === undefined ? meal.iconKey ?? null : change.iconKey, text: meal.text, atHm: meal.atHm,
      } });
      if (signal.aborted || getSettings().dataDir !== ownerDir) throw new Error("数据目录已切换，结果未应用");
      meals = meals.map((item) => item.id === id ? result.meal : item);
      if (foodDraftRevisions.get(id) === meal.revision) foodDraftRevisions.set(id, result.meal.revision);
      if (change.title !== undefined && draftTitles.get(id) === change.title) draftTitles.delete(id);
      if (change.slot !== undefined && draftSlots.get(id) === change.slot) draftSlots.delete(id);
      if (change.iconKey !== undefined && draftIcons.get(id) === change.iconKey) draftIcons.delete(id);
      errors.delete(id);
      errorRegion.textContent = [...errors.values()].join("；");
      const card = [...listRegion.querySelectorAll<HTMLElement>("[data-meal-id]")].find((el) => el.dataset.mealId === id);
      const slot = card?.querySelector<HTMLElement>("[data-edit-slot]");
      if (slot && change.slot !== undefined) slot.textContent = slotDisplay(result.meal);
      const icon = card?.querySelector<HTMLElement>("[data-edit-icon]");
      if (icon && change.iconKey !== undefined) icon.innerHTML = renderMealIcon(result.meal.iconKey, { size: 18 });
      requestRepaint();
    }).catch((err: unknown) => {
      errors.set(id, err instanceof Error ? err.message : String(err));
      if (!signal.aborted) errorRegion.textContent = [...errors.values()].join("；");
    });
    trackWrite(next);
    queues.set(id, next);
  }

  function saveFoods(id: string, foods: Record<string, unknown>[]): Promise<boolean> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (errors.has(id)) throw new Error("上一项保存失败，请重新打开页面后检查草稿");
      if (signal.aborted || getSettings().dataDir !== ownerDir) throw new Error("数据目录已切换，草稿未保存");
      const meal = meals.find((item) => item.id === id);
      if (!meal) throw new Error("餐食已不可用");
      const title = meal.title?.trim() || `${mealLocalDate(meal)} ${meal.slot ? slotDisplay(meal) : "饮食记录"}`;
      const result = await invokeDomainWrite<{ meal: MealWithIcon }>("health_update_meal", { req: {
        expectedDataDir: ownerDir, meal: { id, expectedRevision: meal.revision }, title,
        startedAt: meal.startedAt, slot: meal.slot, iconKey: meal.iconKey ?? null, text: meal.text, atHm: meal.atHm, foods,
      } });
      if (signal.aborted || getSettings().dataDir !== ownerDir) throw new Error("数据目录已切换，结果未应用");
      meals = meals.map((item) => item.id === id ? result.meal : item);
      foodDraftRevisions.set(id, result.meal.revision);
      errors.delete(id);
      errorRegion.textContent = [...errors.values()].join("；");
      const card = [...listRegion.querySelectorAll<HTMLElement>("[data-meal-id]")].find((el) => el.dataset.mealId === id);
      const total = card?.querySelector<HTMLElement>(".health-activity-row-duration");
      if (total) total.textContent = formatKcal(result.meal.mealKcal);
      setTimeout(() => { if (!signal.aborted) requestRepaint(); }, 0);
    }).catch((err: unknown) => {
      errors.set(id, err instanceof Error ? err.message : String(err));
      if (!signal.aborted) errorRegion.textContent = [...errors.values()].join("；");
    });
    trackWrite(next);
    queues.set(id, next);
    return next.then(() => !errors.has(id));
  }

  function requestRepaint(): void {
    const active = document.activeElement;
    if (writesPending > 0) { repaintPending = true; return; }
    if (listRegion.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) { repaintPending = true; return; }
    repaintPending = false;
    paint();
  }

  function paint(): void {
    disposers.forEach((dispose) => dispose());
    disposers = [];
    errorRegion.textContent = [...errors.values()].join("；");
    const rows = filtered();
    if (rows.length === 0) {
      listRegion.innerHTML = `<div class="health-activity-empty">暂无餐食</div>`;
      return;
    }
    let previousDate = "";
    listRegion.innerHTML = rows.map((meal) => {
      const date = mealLocalDate(meal);
      const heading = date === previousDate ? "" : `<h4 class="health-meal-date-heading">${escHtml(date)}</h4>`;
      previousDate = date;
      return heading + renderMealRow(meal, expanded.has(meal.id));
    }).join("");
    for (const meal of rows) {
      const card = [...listRegion.querySelectorAll<HTMLElement>("[data-meal-id]")].find((el) => el.dataset.mealId === meal.id);
      if (!card) continue;
      const titleHost = card.querySelector<HTMLElement>("[data-edit-title]")!;
      const field = mountInlineTextField({ container: titleHost, value: draftTitles.get(meal.id) ?? meal.title?.trim() ?? slotDisplay(meal),
        contentSized: true,
        onCommit(value) { draftTitles.set(meal.id, value); saveMetadata(meal.id, { title: value }); } });
      disposers.push(() => field.dispose());
      const iconAnchor = card.querySelector<HTMLButtonElement>("[data-edit-icon]")!;
      const shownIcon = draftIcons.has(meal.id) ? draftIcons.get(meal.id) : meal.iconKey;
      iconAnchor.innerHTML = renderMealIcon(shownIcon, { size: 18 });
      const iconPicker = mountFlatSelectPopover({ anchor: iconAnchor,
        options: MEAL_ICON_CHOICES.map((icon) => {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 24 24");
          const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
          image.setAttribute("href", icon.src);
          image.setAttribute("width", "24");
          image.setAttribute("height", "24");
          svg.append(image);
          return { value: icon.key, label: icon.label, icon: svg };
        }),
        selected: new Set([shownIcon ?? "utensils"]), multiple: false, search: true, iconOnly: true,
        onChange(values) { const iconKey = [...values][0]; if (iconKey) { draftIcons.set(meal.id, iconKey); iconAnchor.innerHTML = renderMealIcon(iconKey, { size: 18 }); saveMetadata(meal.id, { iconKey }); } void iconPicker.close(); } });
      iconAnchor.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void iconPicker.open(); }, { signal });
      disposers.push(() => iconPicker.dispose());
      const anchor = card.querySelector<HTMLButtonElement>("[data-edit-slot]")!;
      const shownSlot = draftSlots.has(meal.id) ? draftSlots.get(meal.id) : meal.slot;
      if (draftSlots.has(meal.id)) anchor.textContent = slotDisplay({ ...meal, slot: shownSlot ?? null });
      const picker = mountFlatSelectPopover({ anchor, options: SLOT_OPTIONS.filter((o) => o.value !== "" && o.value !== "uncategorized").map((o): { value: string; label: string } => ({ value: o.value, label: o.label })).concat([{ value: "__clear__", label: "清除分类" }]),
        selected: new Set(shownSlot ? [shownSlot] : []), multiple: false, search: false,
        onChange(values) { const value = [...values][0]; if (value) { const slot = value === "__clear__" ? null : value; draftSlots.set(meal.id, slot); anchor.textContent = slotDisplay({ ...meal, slot }); saveMetadata(meal.id, { slot }); } void picker.close(); } });
      anchor.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void picker.open(); }, { signal });
      titleHost.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); }, { signal });
      disposers.push(() => picker.dispose());
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showCommandMenuAt(event.clientX, event.clientY, [{ value: "delete", label: "删除饮食记录", danger: true }], (value) => {
          if (value !== "delete") return;
          void (async () => {
            const confirmed = await getConfirmDialog()("删除饮食记录", `确定删除「${meal.title?.trim() || slotDisplay(meal)}」？${meal.items?.length ? ` 食物：${meal.items.join("、")}` : meal.foods.length ? ` 食物：${meal.foods.map((food) => food.text).join("、")}` : ""}`, card, { danger: true });
            if (!confirmed) return;
            const previous = queues.get(meal.id) ?? Promise.resolve();
            const next = previous.then(async () => {
              if (errors.has(meal.id)) throw new Error("上一项保存失败，请重新打开页面后检查草稿");
              if (signal.aborted || getSettings().dataDir !== ownerDir) throw new Error("数据目录已切换，删除未提交");
              const current = meals.find((item) => item.id === meal.id);
              if (!current) return;
              await invokeDomainWrite("health_delete_meal", { req: { expectedDataDir: ownerDir, meal: { id: current.id, expectedRevision: current.revision } } });
              if (signal.aborted || getSettings().dataDir !== ownerDir) throw new Error("数据目录已切换，结果未应用");
              meals = meals.filter((item) => item.id !== current.id); errors.delete(current.id); requestRepaint();
            }).catch((err: unknown) => { errors.set(meal.id, err instanceof Error ? err.message : String(err)); if (!signal.aborted) errorRegion.textContent = [...errors.values()].join("；"); });
            trackWrite(next);
            queues.set(meal.id, next);
          })();
        }, { returnFocus: card });
      }, { signal });
      const body = card.querySelector<HTMLElement>(".health-meal-row-body")!;
      let foods = foodDrafts.get(meal.id);
      if (!foods) { foods = makeFoodDrafts(meal); foodDrafts.set(meal.id, foods); foodDraftRevisions.set(meal.id, meal.revision); }
      disposers.push(mountMealFoodEditor(body, foods, (nextFoods) => saveFoods(meal.id, nextFoods), meal.recordShape === "legacy"));
    }
  }

  listRegion.addEventListener("focusout", () => {
    queueMicrotask(() => { if (repaintPending && !listRegion.contains(document.activeElement)) requestRepaint(); });
  }, { signal });

  listRegion.addEventListener("toggle", (event) => {
    const details = event.target as HTMLDetailsElement;
    const id = details.dataset.mealId;
    if (!id) return;
    if (details.open) expanded.add(id);
    else expanded.delete(id);
  }, { capture: true, signal });

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-slot]");
    if (!button || !root.contains(button)) return;
    slotFilter = button.dataset.slot ?? "";
    root.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    requestRepaint();
  }, { signal });
  searchEl.addEventListener("input", () => {
    search = searchEl.value.trim().toLocaleLowerCase();
    requestRepaint();
  }, { signal });

  signal.addEventListener("abort", () => disposers.forEach((dispose) => dispose()), { once: true });

  async function reload(): Promise<void> {
    if (writesPending > 0) return;
    const version = ++loadVersion;
    if (meals.length === 0) listRegion.innerHTML = `<div class="health-activity-empty">加载中…</div>`;
    try {
      const { meals: loaded } = await healthListMeals({});
      if (signal.aborted || version !== loadVersion || writesPending > 0) return;
      for (const meal of loaded) {
        const basedOn = foodDraftRevisions.get(meal.id);
        if (basedOn !== undefined && basedOn !== meal.revision) {
          errors.set(meal.id, "餐食已在其他位置更改；食物草稿已保留，请重新打开并核对后再编辑");
        }
      }
      meals = loaded;
      paint();
    } catch (err) {
      if (signal.aborted || version !== loadVersion || writesPending > 0) return;
      const msg = err instanceof Error ? err.message : "无法加载餐食";
      listRegion.innerHTML = `<div class="health-activity-empty">${escHtml(msg)}</div>`;
    }
  }

  return { reload };
}




