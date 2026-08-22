import { DEFAULT_CURRENCY, MAX_POSTINGS, REMARK_MAX_LENGTH } from "../../constants";
import { todayIso } from "../../utils";
import { validateComposerPostings } from "../../domain/composer-validate";
import type { Entry, Posting } from "../../types";
import { mountAccountPicker, type AccountPickerHandle } from "../../ui/account-picker";
import { mountDatePicker, type DatePickerHandle } from "../../../../ui/date-picker";
import {
  createTagChip,
  getTagsFromBox,
  initTagInput,
  setTagsInBox,
} from "./entry-form-tags";

const ALL_GROUPS = ["expenses", "income", "assets", "liabilities"] as const;
const MIN_ROWS = 2;

type PostingRow = {
  root: HTMLElement;
  accountPicker: AccountPickerHandle;
  amountEl: HTMLInputElement;
  currencyEl: HTMLInputElement;
  costAmountEl: HTMLInputElement;
  costCurrencyEl: HTMLInputElement;
  removeBtn: HTMLButtonElement;
};

export type AdvancedDraft = {
  date: string;
  payee: string;
  remark: string;
  flag: string;
  tags: string[];
  type: Entry["type"] | "";
  postings: Posting[];
};

export type AdvancedComposerHandle = {
  validate: () => string | null;
  getDraft: () => AdvancedDraft;
  reset: () => void;
};

export function mountAdvancedComposer(
  container: HTMLElement,
  signal: AbortSignal,
): AdvancedComposerHandle {
  container.innerHTML = `
    <div class="composer-advanced-form">
    <div class="composer-adv-field composer-adv-field-full">
      <label for="adv-payee">收款人</label>
      <input type="text" id="adv-payee">
    </div>
    <div class="composer-adv-field-row">
      <div class="composer-adv-field">
        <label for="adv-flag">标记</label>
        <select id="adv-flag">
          <option value="*" selected>*</option>
          <option value="!">!</option>
          <option value="?">?</option>
        </select>
      </div>
      <div class="composer-adv-field">
        <label for="adv-type">类型</label>
        <select id="adv-type">
          <option value="expense">支出</option>
          <option value="income">收入</option>
          <option value="transfer">转账</option>
          <option value="">未分类</option>
        </select>
      </div>
    </div>
    <div class="composer-adv-field composer-adv-field-full">
      <label for="adv-date">日期</label>
      <div id="adv-date-picker"></div>
    </div>
    <div class="composer-adv-field composer-adv-field-full">
      <label for="adv-remark">简记</label>
      <input type="text" id="adv-remark" maxlength="${REMARK_MAX_LENGTH}">
    </div>
    <div class="composer-adv-field composer-adv-field-full">
      <label for="adv-tag-field">标签</label>
      <div id="adv-tag-box" class="ledger-tag-box">
        <input type="text" id="adv-tag-field" class="ledger-tag-field" placeholder="回车添加">
      </div>
    </div>
    <div class="composer-adv-field composer-adv-field-full">
      <label for="adv-posting-rows">分录</label>
      <div id="adv-posting-rows" class="composer-posting-rows"></div>
      <button type="button" id="adv-add-row" class="composer-add-row">添加分录</button>
    </div>
    </div>`;

  const payeeEl = container.querySelector<HTMLInputElement>("#adv-payee")!;
  const flagEl = container.querySelector<HTMLSelectElement>("#adv-flag")!;
  const typeEl = container.querySelector<HTMLSelectElement>("#adv-type")!;
  const remarkEl = container.querySelector<HTMLInputElement>("#adv-remark")!;
  const tagBox = container.querySelector<HTMLElement>("#adv-tag-box")!;
  const tagField = container.querySelector<HTMLInputElement>("#adv-tag-field")!;
  const rowsEl = container.querySelector<HTMLElement>("#adv-posting-rows")!;
  const addBtn = container.querySelector<HTMLButtonElement>("#adv-add-row")!;
  const datePickerMount = container.querySelector<HTMLElement>("#adv-date-picker")!;

  const datePicker: DatePickerHandle = mountDatePicker(datePickerMount, { compact: true });
  initTagInput(tagField, tagBox, signal);

  const rows: PostingRow[] = [];

  function syncAddBtn(): void {
    addBtn.disabled = rows.length >= MAX_POSTINGS;
  }

  function syncRemoveBtns(): void {
    for (const row of rows) {
      row.removeBtn.disabled = rows.length <= MIN_ROWS;
    }
  }

  function createRow(): PostingRow {
    const root = document.createElement("div");
    root.className = "composer-posting-row";
    root.innerHTML = `
      <div class="composer-posting-top">
        <div class="composer-posting-account"></div>
        <button type="button" class="composer-posting-remove" aria-label="删除分录">×</button>
      </div>
      <div class="composer-posting-line">
        <div class="composer-posting-values">
          <input type="number" class="composer-posting-amount" step="0.01" placeholder="金额">
          <input type="text" class="composer-posting-currency ledger-currency-input" value="${DEFAULT_CURRENCY}" placeholder="币">
        </div>
        <div class="composer-posting-costs">
          <span class="composer-posting-cost-label">@@</span>
          <input type="number" class="composer-posting-cost-amount" step="0.01" placeholder="成本">
          <input type="text" class="composer-posting-cost-currency ledger-currency-input" placeholder="币">
        </div>
      </div>`;

    const accountMount = root.querySelector<HTMLElement>(".composer-posting-account")!;
    const accountPicker = mountAccountPicker(accountMount, {
      groups: [...ALL_GROUPS],
      placeholder: "账户",
    });
    const amountEl = root.querySelector<HTMLInputElement>(".composer-posting-amount")!;
    const currencyEl = root.querySelector<HTMLInputElement>(".composer-posting-currency")!;
    const costAmountEl = root.querySelector<HTMLInputElement>(".composer-posting-cost-amount")!;
    const costCurrencyEl = root.querySelector<HTMLInputElement>(".composer-posting-cost-currency")!;
    const removeBtn = root.querySelector<HTMLButtonElement>(".composer-posting-remove")!;

    removeBtn.addEventListener(
      "click",
      () => {
        if (rows.length <= MIN_ROWS) return;
        const idx = rows.findIndex((r) => r.root === root);
        if (idx < 0) return;
        rows.splice(idx, 1);
        root.remove();
        syncRemoveBtns();
        syncAddBtn();
      },
      { signal },
    );

    const row: PostingRow = {
      root,
      accountPicker,
      amountEl,
      currencyEl,
      costAmountEl,
      costCurrencyEl,
      removeBtn,
    };
    rows.push(row);
    rowsEl.appendChild(root);
    syncRemoveBtns();
    syncAddBtn();
    return row;
  }

  addBtn.addEventListener(
    "click",
    () => {
      if (rows.length >= MAX_POSTINGS) return;
      createRow();
    },
    { signal },
  );

  createRow();
  createRow();

  function collectPostings(): Posting[] {
    return rows.map((row) => {
      const costRaw = row.costAmountEl.value.trim();
      const costAmount = costRaw ? parseFloat(costRaw) || 0 : null;
      return {
        account: row.accountPicker.getValue(),
        amount: parseFloat(row.amountEl.value) || 0,
        currency: row.currencyEl.value.trim() || DEFAULT_CURRENCY,
        cost_amount: costAmount,
        cost_currency: row.costCurrencyEl.value.trim(),
      };
    });
  }

  return {
    validate(): string | null {
      const date = datePicker.getValue();
      if (!date) return "请填写日期";
      const postings = collectPostings();
      if (postings.length < MIN_ROWS) return `至少需要 ${MIN_ROWS} 条分录`;
      if (postings.length > MAX_POSTINGS) return `最多 ${MAX_POSTINGS} 条分录`;
      return validateComposerPostings(postings);
    },
    getDraft(): AdvancedDraft {
      return {
        date: datePicker.getValue(),
        payee: payeeEl.value.trim(),
        remark: remarkEl.value.trim().slice(0, REMARK_MAX_LENGTH),
        flag: flagEl.value || "*",
        tags: getTagsFromBox(tagBox),
        type: (typeEl.value || "") as Entry["type"] | "",
        postings: collectPostings(),
      };
    },
    reset(): void {
      payeeEl.value = "";
      flagEl.value = "*";
      typeEl.value = "expense";
      remarkEl.value = "";
      setTagsInBox(tagBox, tagField, []);
      datePicker.setValue(todayIso());
      while (rows.length > MIN_ROWS) {
        rows.pop()!.root.remove();
      }
      for (const row of rows) {
        row.accountPicker.setValue("");
        row.amountEl.value = "";
        row.currencyEl.value = DEFAULT_CURRENCY;
        row.costAmountEl.value = "";
        row.costCurrencyEl.value = "";
      }
      syncRemoveBtns();
      syncAddBtn();
    },
  };
}
