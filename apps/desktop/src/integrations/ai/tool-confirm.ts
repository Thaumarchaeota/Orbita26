import { invoke } from "@tauri-apps/api/core";
import { normalizeMealSlot, parseMeals, mealEntryToArgs, mealSlotRowHtml, bindMealSlotRow, type MealSlot } from "../../core/data/meals";
import { MOOD_EMOJI_PRESETS } from "../../core/data/mood-emojis";
import { escHtml } from "../../core/html";
import { bindDialog } from "../../ui/motion";
import { beijingToday, journalList } from "../journal/client";

export type ToolConfirmEvent = {
  confirmId?: string;
  confirm_id?: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
};

const TAG_DEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

function str(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strArr(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function mealSlotOptions(selected: MealSlot): string {
  return mealSlotRowHtml(selected);
}

async function loadMealById(date: string, id: string) {
  try {
    const { entries } = await journalList({ date });
    const daily = entries.find((e) => e.kind === "daily" && e.date === date);
    if (!daily?.data) return null;
    return parseMeals(daily.data).find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}

async function hydrateMealArgs(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (name !== "journal_update_meal") return args;
  const date = str(args, "date", beijingToday());
  const id = str(args, "id");
  if (!id) return args;
  const existing = await loadMealById(date, id);
  if (!existing) return args;
  return { ...mealEntryToArgs(existing, date), ...args, date, id };
}

function mealTagHtml(tag: string): string {
  return `<span class="meal-tag" data-tag="${escHtml(tag)}">${escHtml(tag)}<button type="button" class="meal-tag-del" aria-label="删除">${TAG_DEL}</button></span>`;
}

function bindMealTags(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>(".meal-tags");
  const input = root.querySelector<HTMLInputElement>(".meal-tag-input");
  if (!list || !input) return;

  const bindTagEl = (el: HTMLElement) => {
    el.querySelector(".meal-tag-del")?.addEventListener("click", () => el.remove());
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
  };

  const addTag = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const wrap = document.createElement("span");
    wrap.innerHTML = mealTagHtml(t);
    const el = wrap.firstElementChild as HTMLElement;
    bindTagEl(el);
    list.appendChild(el);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    addTag(input.value);
    input.value = "";
  });

  list.querySelectorAll<HTMLElement>(".meal-tag").forEach(bindTagEl);
}

function collectMealTags(form: HTMLFormElement): string[] {
  return [...form.querySelectorAll<HTMLElement>(".meal-tag")]
    .map((el) => el.dataset.tag?.trim() ?? "")
    .filter(Boolean);
}

async function loadHydrationMl(date: string): Promise<number> {
  try {
    const { entries } = await journalList({ date });
    const daily = entries.find((e) => e.kind === "daily" && e.date === date);
    if (!daily?.data || typeof daily.data !== "object") return 0;
    const ml = (daily.data as Record<string, unknown>).hydrationMl;
    return typeof ml === "number" && Number.isFinite(ml) ? Math.round(ml) : 0;
  } catch {
    return 0;
  }
}

function mealFormFields(args: Record<string, unknown>, withId = false, hydrationMl = 0): string {
  const today = beijingToday();
  const slot = normalizeMealSlot(str(args, "slot", "snack"));
  const items = strArr(args, "items");
  return `
    ${!withId ? `<p class="settings-hint">今日喝水：${hydrationMl} ml（佳明同步，喝水请在今日面板记录）</p>` : ""}
    <div class="dialog-field"><label>日期</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
    ${withId ? `<div class="dialog-field"><label>ID</label><input type="text" name="id" value="${escHtml(str(args, "id"))}"></div>` : ""}
    <div class="dialog-field"><label>餐次</label>${mealSlotOptions(slot)}</div>
    <div class="dialog-field"><label>吃了啥</label>
      <div class="meal-tags">${items.map(mealTagHtml).join("")}</div>
      <input type="text" class="meal-tag-input" placeholder="回车添加标签">
    </div>
    <div class="dialog-field"><label>热量 kcal</label><input type="number" name="kcal" min="0" step="1" value="${num(args, "kcal", 0) || ""}"></div>
    <div class="dialog-field"><label>备注</label><input type="text" name="text" value="${escHtml(str(args, "text"))}"></div>
    <div class="dialog-field"><label>时间</label><input type="time" name="at" value="${escHtml(str(args, "at"))}"></div>`;
}

function formFields(name: string, args: Record<string, unknown>): string {
  const today = beijingToday();
  switch (name) {
    case "journal_add_event":
      return `
        <div class="dialog-field"><label>日期</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
        <div class="dialog-field"><label>备注</label><input type="text" name="remark" value="${escHtml(str(args, "remark"))}"></div>`;
    case "journal_add_mood": {
      const emoji = str(args, "emoji", MOOD_EMOJI_PRESETS[0]);
      return `
        <div class="dialog-field"><label>日期</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
        <div class="primary-mood-grid">
          ${MOOD_EMOJI_PRESETS.map((em) => `<button type="button" class="primary-mood-opt${emoji === em ? " is-active" : ""}" data-emoji="${em}">${em}</button>`).join("")}
        </div>
        <input type="hidden" name="emoji" value="${escHtml(emoji)}">
        <div class="dialog-field"><label>简记</label><input type="text" name="note" value="${escHtml(str(args, "note"))}"></div>`;
    }
    case "journal_set_sleep":
      return `
        <div class="dialog-field"><label>醒来日</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
        <div class="dialog-field"><label>入睡</label><input type="time" name="sleepTime" value="${escHtml(str(args, "sleepTime"))}"></div>
        <div class="dialog-field"><label>醒来</label><input type="time" name="wakeTime" value="${escHtml(str(args, "wakeTime"))}"></div>`;
    case "journal_add_nap":
      return `
        <div class="dialog-field"><label>日期</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
        <div class="dialog-field"><label>开始</label><input type="time" name="startTime" value="${escHtml(str(args, "startTime"))}"></div>
        <div class="dialog-field"><label>结束</label><input type="time" name="endTime" value="${escHtml(str(args, "endTime"))}"></div>`;
    case "journal_add_meal":
      return mealFormFields(args, false);
    case "journal_update_meal":
      return mealFormFields(args, true);
    case "journal_delete_meal":
      return `
        <div class="dialog-field"><label>日期</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
        <div class="dialog-field"><label>ID</label><input type="text" name="id" value="${escHtml(str(args, "id"))}"></div>`;
    case "journal_delete_entry":
      return `<div class="dialog-field"><label>条目 ID</label><input type="text" name="id" value="${escHtml(str(args, "id"))}"></div>`;
    case "garmin_sync":
      return `<div class="dialog-field"><label>同步天数</label><input type="number" name="days" min="1" max="30" value="${num(args, "days", 7)}"></div>`;
    case "garmin_login":
      return `<p class="settings-hint">将向佳明 SSO 发起登录；429 冷却期内请勿重复。</p>`;
    case "beancount_add_transaction":
      return `
        <div class="dialog-field"><label>日期</label><input type="date" name="date" value="${escHtml(str(args, "date", today))}"></div>
        <div class="dialog-field"><label>金额（元）</label><input type="number" name="amount" step="0.01" min="0" value="${num(args, "amount", 0) || ""}"></div>
        <div class="dialog-field"><label>摘要</label><input type="text" name="description" value="${escHtml(str(args, "description"))}"></div>
        <div class="dialog-field"><label>分类</label><input type="text" name="category" value="${escHtml(str(args, "category"))}" placeholder="餐饮"></div>`;
    default:
      return `<div class="dialog-field"><label>参数 JSON</label><textarea name="_json" rows="6">${escHtml(JSON.stringify(args, null, 2))}</textarea></div>`;
  }
}

const CONFIRM_LABELS: Record<string, string> = {
  journal_add_event: "确认记录事件",
  journal_add_mood: "确认记录心情",
  journal_set_sleep: "确认记录睡眠",
  journal_add_nap: "确认记录午睡",
  journal_add_meal: "确认记录吃饭",
  journal_update_meal: "确认更新吃饭",
  journal_delete_meal: "确认删除吃饭",
  journal_delete_entry: "确认删除记录",
  garmin_sync: "确认同步佳明",
  garmin_login: "确认重新登录佳明",
  beancount_add_transaction: "确认记账",
};

function readForm(name: string, form: HTMLFormElement): Record<string, unknown> {
  const fd = new FormData(form);
  if (!CONFIRM_LABELS[name]) {
    try {
      return JSON.parse(String(fd.get("_json") ?? "{}")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const out: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (k === "days" || k === "amount" || k === "kcal") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else out[k] = String(v);
  });
  if (name === "journal_add_meal" || name === "journal_update_meal") {
    out.items = collectMealTags(form);
    if (name === "journal_update_meal" && !("kcal" in out)) {
      const raw = fd.get("kcal");
      if (raw !== null && String(raw).trim() !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) out.kcal = n;
      }
    }
  }
  return out;
}

export async function openToolConfirm(
  root: HTMLElement,
  event: ToolConfirmEvent,
): Promise<Record<string, unknown> | null> {
  const hydratedArgs = await hydrateMealArgs(event.name, event.args);
  const hydrationMl =
    event.name === "journal_add_meal"
      ? await loadHydrationMl(str(hydratedArgs, "date", beijingToday()))
      : 0;
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const title = CONFIRM_LABELS[event.name] ?? event.label;
    backdrop.innerHTML = `
      <form class="dialog-panel" id="toolConfirmForm">
        <div class="dialog-title">${escHtml(title)}</div>
        ${event.name === "journal_add_meal" ? mealFormFields(hydratedArgs, false, hydrationMl) : formFields(event.name, hydratedArgs)}
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" data-action="cancel">取消</button>
          <button type="submit" class="dialog-btn dialog-btn-primary">确认执行</button>
        </div>
      </form>
    `;
    root.appendChild(backdrop);
    const motion = bindDialog(backdrop);
    const form = backdrop.querySelector<HTMLFormElement>("#toolConfirmForm")!;

    bindMealTags(form);
    if (event.name === "journal_add_meal" || event.name === "journal_update_meal") {
      bindMealSlotRow(form);
    }

    const emojiInput = form.querySelector<HTMLInputElement>('input[name="emoji"]');
    if (emojiInput) {
      backdrop.querySelectorAll<HTMLButtonElement>(".primary-mood-opt").forEach((b) => {
        b.addEventListener("click", () => {
          backdrop.querySelectorAll(".primary-mood-opt").forEach((x) => x.classList.remove("is-active"));
          b.classList.add("is-active");
          emojiInput.value = b.dataset.emoji!;
        });
      });
    }

    const finish = async (result: Record<string, unknown> | null) => {
      await motion.close();
      backdrop.remove();
      resolve(result);
    };

    backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void finish(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) void finish(null);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const args = readForm(event.name, form);
      if (event.name === "journal_add_meal" || event.name === "journal_update_meal") {
        const kcal = args.kcal;
        if (typeof kcal !== "number" || !Number.isFinite(kcal) || kcal < 0) {
          alert("请填写有效热量");
          return;
        }
        if (event.name === "journal_update_meal" && !str(args, "id")) {
          alert("缺少吃饭记录 ID");
          return;
        }
      }
      void finish(args);
    });
    void motion.open();
  });
}

function resolveConfirmId(event: ToolConfirmEvent): string {
  const id = event.confirmId ?? (event as { confirm_id?: string }).confirm_id;
  if (!id) throw new Error("tool confirm id missing");
  return id;
}

export async function confirmAgentTool(
  root: HTMLElement,
  event: ToolConfirmEvent,
): Promise<boolean> {
  const confirmId = resolveConfirmId(event);
  const args = await openToolConfirm(root, event);
  if (!args) {
    try {
      await invoke("agent_tool_reject", { req: { confirmId } });
    } catch {
      /* backend may already be aborted */
    }
    return false;
  }
  await invoke("agent_tool_confirm", { req: { confirmId, args } });
  return true;
}
