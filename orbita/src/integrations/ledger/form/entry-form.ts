import { ERROR_MIN_MS, SUCCESS_MIN_MS, CHECK_ICON, REMARK_MAX_LENGTH } from "../constants";
import { buildPostingsFromSimple } from "../domain/entry";
import {
  accountDisplayLabel,
  getAccountNames,
  getAccountRecords,
} from "../state/accounts";
import { commitNewEntry } from "../state/ledger";
import type { AccountGroup, AccountRecord } from "../types";
import { formatTags, sleep, todayIso } from "../utils";

type EntryType = "expense" | "income" | "transfer";

const TYPE_CONFIG: Record<
  EntryType,
  {
    title: string;
    categoryGroup: AccountGroup;
    accountGroup: AccountGroup[];
    label1: string;
    label2: string;
  }
> = {
  expense: {
    title: "支出",
    categoryGroup: "expenses",
    accountGroup: ["assets", "liabilities"],
    label1: "支出类型",
    label2: "支出账户",
  },
  income: {
    title: "收入",
    categoryGroup: "income",
    accountGroup: ["assets"],
    label1: "收入类型",
    label2: "收入账户",
  },
  transfer: {
    title: "转账",
    categoryGroup: "assets",
    accountGroup: ["assets", "liabilities"],
    label1: "发起账户",
    label2: "接收账户",
  },
};

function fillSelect(el: HTMLSelectElement, items: string[], selected: string): void {
  el.innerHTML = "";
  for (const name of items) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

function groupCategories(records: AccountRecord[]): Map<string, AccountRecord[]> {
  const groups = new Map<string, AccountRecord[]>();
  for (const item of records) {
    const key = item.label_path?.[0] || item.name.split(":").pop() || "其他";
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function renderCategoryBubbles(
  container: HTMLElement,
  group: AccountGroup,
  selected: string,
  onSelect: (name: string) => void,
): void {
  container.innerHTML = "";
  const records = getAccountRecords(group);
  if (!records.length) {
    container.innerHTML = '<p class="ledger-hint">暂无分类，请先配置 category.bean</p>';
    return;
  }
  const isTransfer = group === "assets";
  if (isTransfer) {
    const wrap = document.createElement("div");
    wrap.className = "ledger-bubble-group";
    for (const item of records) {
      wrap.appendChild(createBubble(item, selected, onSelect));
    }
    container.appendChild(wrap);
    return;
  }
  for (const [groupName, items] of groupCategories(records)) {
    const section = document.createElement("div");
    section.className = "ledger-bubble-section";
    const title = document.createElement("div");
    title.className = "ledger-bubble-section-title";
    title.textContent = groupName;
    section.appendChild(title);
    const wrap = document.createElement("div");
    wrap.className = "ledger-bubble-group";
    for (const item of items) {
      wrap.appendChild(createBubble(item, selected, onSelect));
    }
    section.appendChild(wrap);
    container.appendChild(section);
  }
}

function createBubble(
  item: AccountRecord,
  selected: string,
  onSelect: (name: string) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ledger-bubble";
  if (item.name === selected) btn.classList.add("is-active");
  btn.textContent = accountDisplayLabel(item);
  btn.title = item.name;
  btn.addEventListener("click", () => onSelect(item.name));
  return btn;
}

function getTagsFromBox(box: HTMLElement): string[] {
  return [...box.querySelectorAll<HTMLElement>(".ledger-tag-chip")].map((c) => c.textContent || "");
}

function setTagsInBox(box: HTMLElement, field: HTMLInputElement, tags: string[]): void {
  box.querySelectorAll(".ledger-tag-chip").forEach((c) => c.remove());
  for (const t of tags) {
    const v = String(t).trim().replace(/^#/, "");
    if (v) box.insertBefore(createTagChip(v), field);
  }
}

function createTagChip(text: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "ledger-tag-chip";
  chip.textContent = text;
  return chip;
}

function initTagInput(field: HTMLInputElement, box: HTMLElement): void {
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = field.value.trim().replace(/^#/, "");
      if (v && !getTagsFromBox(box).includes(v)) {
        box.insertBefore(createTagChip(v), field);
      }
      field.value = "";
    }
    if (e.key === "Backspace" && !field.value) {
      const chips = box.querySelectorAll(".ledger-tag-chip");
      if (chips.length) chips[chips.length - 1].remove();
    }
  });
}

export function mountEntryForm(container: HTMLElement): () => void {
  let activeType: EntryType = "expense";
  let selectedCategory = "";
  let submitAnimating = false;
  const ac = new AbortController();
  const { signal } = ac;

  container.innerHTML = `
    <div class="ledger-entry-form">
      <h2 class="ledger-form-title" id="ledger-form-title">支出</h2>
      <div class="ledger-type-switch">
        <span class="ledger-type-slider" aria-hidden="true"></span>
        <input type="radio" name="ledger-type" id="ledger-type-expense" value="expense" checked>
        <label for="ledger-type-expense">支出</label>
        <input type="radio" name="ledger-type" id="ledger-type-income" value="income">
        <label for="ledger-type-income">收入</label>
        <input type="radio" name="ledger-type" id="ledger-type-transfer" value="transfer">
        <label for="ledger-type-transfer">转账</label>
      </div>
      <form id="ledger-entry-form" novalidate>
        <label id="ledger-label1">支出类型</label>
        <div id="ledger-category-bubbles" class="ledger-category-bubbles"></div>
        <input type="hidden" id="ledger-category" value="">
        <label id="ledger-label2" for="ledger-account">支出账户</label>
        <select id="ledger-account" required></select>
        <label for="ledger-amount">金额</label>
        <div class="ledger-amount-row">
          <input type="number" id="ledger-amount" class="ledger-amount-input" step="0.01" required>
          <input type="text" id="ledger-currency" class="ledger-currency-input" value="CNY" placeholder="CNY">
        </div>
        <label for="ledger-date">日期</label>
        <input type="date" id="ledger-date" required>
        <label for="ledger-remark">简记</label>
        <input type="text" id="ledger-remark" maxlength="${REMARK_MAX_LENGTH}">
        <label for="ledger-tag-field">标签</label>
        <div id="ledger-tag-box" class="ledger-tag-box">
          <input type="text" id="ledger-tag-field" class="ledger-tag-field" placeholder="回车添加">
        </div>
        <button type="submit" id="ledger-submit-btn" class="ledger-submit-btn">保存</button>
        <p id="ledger-form-error" class="ledger-form-error" hidden></p>
      </form>
    </div>`;

  const titleEl = container.querySelector<HTMLElement>("#ledger-form-title")!;
  const label1 = container.querySelector<HTMLElement>("#ledger-label1")!;
  const label2 = container.querySelector<HTMLElement>("#ledger-label2")!;
  const bubblesEl = container.querySelector<HTMLElement>("#ledger-category-bubbles")!;
  const categoryInput = container.querySelector<HTMLInputElement>("#ledger-category")!;
  const accountEl = container.querySelector<HTMLSelectElement>("#ledger-account")!;
  const amountEl = container.querySelector<HTMLInputElement>("#ledger-amount")!;
  const currencyEl = container.querySelector<HTMLInputElement>("#ledger-currency")!;
  const dateEl = container.querySelector<HTMLInputElement>("#ledger-date")!;
  const remarkEl = container.querySelector<HTMLInputElement>("#ledger-remark")!;
  const tagBox = container.querySelector<HTMLElement>("#ledger-tag-box")!;
  const tagField = container.querySelector<HTMLInputElement>("#ledger-tag-field")!;
  const submitBtn = container.querySelector<HTMLButtonElement>("#ledger-submit-btn")!;
  const errorEl = container.querySelector<HTMLElement>("#ledger-form-error")!;
  const slider = container.querySelector<HTMLElement>(".ledger-type-slider")!;

  dateEl.value = todayIso();
  initTagInput(tagField, tagBox);

  function updateSlider(): void {
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="ledger-type"]');
    const index = [...radios].findIndex((el) => el.checked);
    slider.style.transform = `translateX(${index * 100}%)`;
  }

  function selectCategory(name: string): void {
    selectedCategory = name;
    categoryInput.value = name;
    bubblesEl.querySelectorAll<HTMLButtonElement>(".ledger-bubble").forEach((btn) => {
      btn.classList.toggle("is-active", btn.title === name);
    });
  }

  function switchType(type: EntryType): void {
    activeType = type;
    const cfg = TYPE_CONFIG[type];
    titleEl.textContent = cfg.title;
    label1.textContent = cfg.label1;
    label2.textContent = cfg.label2;
    updateSlider();
    selectedCategory = "";
    categoryInput.value = "";
    const accountNames =
      type === "transfer"
        ? [...getAccountNames("assets"), ...getAccountNames("liabilities")]
        : cfg.accountGroup.flatMap((g) => getAccountNames(g));
    fillSelect(accountEl, accountNames, accountEl.value);
    renderCategoryBubbles(bubblesEl, cfg.categoryGroup, "", selectCategory);
  }

  container.querySelectorAll<HTMLInputElement>('input[name="ledger-type"]').forEach((el) => {
    el.addEventListener(
      "change",
      () => switchType(el.value as EntryType),
      { signal },
    );
  });

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError(): void {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function setBtnState(state: "idle" | "pending" | "success" | "error"): void {
    submitBtn.classList.remove("is-pending", "is-success", "is-error");
    if (state === "pending") {
      submitBtn.classList.add("is-pending");
      submitBtn.textContent = "保存中…";
    } else if (state === "success") {
      submitBtn.classList.add("is-success");
      submitBtn.innerHTML = CHECK_ICON;
    } else if (state === "error") {
      submitBtn.classList.add("is-error");
      submitBtn.textContent = "✕";
    } else {
      submitBtn.textContent = "保存";
    }
    submitAnimating = state !== "idle";
    submitBtn.disabled = state !== "idle";
  }

  container.querySelector<HTMLFormElement>("#ledger-entry-form")!.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      if (submitAnimating) return;
      clearError();

      if (!dateEl.value) {
        showError("请填写日期");
        return;
      }
      const raw = amountEl.value.trim();
      if (!raw) {
        showError("请填写金额");
        return;
      }
      const amount = parseFloat(raw);
      if (isNaN(amount) || amount <= 0) {
        showError("金额必须大于 0");
        return;
      }
      if (!selectedCategory) {
        showError(`请选择${TYPE_CONFIG[activeType].label1}`);
        return;
      }
      if (!accountEl.value) {
        showError(`请选择${TYPE_CONFIG[activeType].label2}`);
        return;
      }
      if (activeType !== "transfer" && selectedCategory === accountEl.value) {
        showError("分类与账户不能相同");
        return;
      }
      if (activeType === "transfer" && selectedCategory === accountEl.value) {
        showError("发起账户与接收账户不能相同");
        return;
      }

      const account1 = selectedCategory;
      const account2 = accountEl.value;
      const currency = currencyEl.value.trim() || "CNY";
      const remark = remarkEl.value.trim().slice(0, REMARK_MAX_LENGTH);
      const tags = formatTags(getTagsFromBox(tagBox));
      const postings = buildPostingsFromSimple(activeType, account1, account2, amount, currency);

      setBtnState("pending");
      const start = Date.now();
      try {
        await commitNewEntry({
          type: activeType,
          date: dateEl.value,
          flag: "*",
          payee: "",
          remark,
          tags,
          postings,
        });
        setBtnState("success");
        await sleep(Math.max(0, SUCCESS_MIN_MS - (Date.now() - start)));
        amountEl.value = "";
        remarkEl.value = "";
        setTagsInBox(tagBox, tagField, []);
        setBtnState("idle");
      } catch (err) {
        setBtnState("error");
        showError(err instanceof Error ? err.message : "保存失败");
        await sleep(ERROR_MIN_MS);
        setBtnState("idle");
      }
    },
    { signal },
  );

  switchType("expense");

  return () => ac.abort();
}
