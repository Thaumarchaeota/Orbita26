import { mountDecoupledDatePicker, type DecoupledDatePickerHandle } from "../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker, type DecoupledTimePickerHandle } from "../../../ui/decoupled-time-picker";
import { DEFAULT_CURRENCY, MAX_POSTINGS, REMARK_MAX_LENGTH } from "../constants";
import { validateComposerPostings } from "../domain/composer-validate";
import { parseDecimalInput, parseOptionalDecimalInput } from "../domain/field-validate";
import type { Entry, Posting } from "../types";
import { todayIso } from "../utils";
import { mountAccountSelect, type AccountSelectHandle } from "../ui/account-select";
import { getTagsFromBox, initTagInput, setTagsInBox } from "./cds-tag-input";
import { validateTxnTimeInput } from "../domain/txn-time";

const ALL_GROUPS = ["expenses", "income", "assets", "liabilities", "equity"] as const;
const MIN_ROWS = 2;

type PostingRow = {
  root: HTMLElement;
  accountPicker: AccountSelectHandle;
  amountEl: HTMLInputElement;
  currencyEl: HTMLInputElement;
  costAmountEl: HTMLInputElement;
  costCurrencyEl: HTMLInputElement;
  removeBtn: HTMLButtonElement;
};

export type AdvancedDraft = {
  date: string;
  time: string;
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
  resetForContinue: () => void;
  setDate: (date: string) => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function labeledField(labelText: string, control: HTMLElement, full = false): HTMLElement {
  const wrap = el("div", `composer-adv-field${full ? " composer-adv-field-full" : ""}`);
  const label = el("label");
  label.textContent = labelText;
  wrap.append(label, control);
  return wrap;
}

export function mountCdsAdvancedComposer(
  container: HTMLElement,
  signal: AbortSignal,
): AdvancedComposerHandle {
  const form = el("div", "composer-advanced-form");

  const payeeEl = el("input") as HTMLInputElement;
  const flagEl = el("select") as HTMLSelectElement;
  for (const [val, label] of [
    ["*", "*"],
    ["!", "!"],
    ["?", "?"],
  ] as const) {
    const opt = el("option") as HTMLOptionElement;
    opt.value = val;
    opt.textContent = label;
    if (val === "*") opt.selected = true;
    flagEl.appendChild(opt);
  }
  const typeEl = el("select") as HTMLSelectElement;
  for (const [val, label] of [
    ["expense", "支出"],
    ["income", "收入"],
    ["transfer", "转账"],
    ["", "未分类"],
  ] as const) {
    const opt = el("option") as HTMLOptionElement;
    opt.value = val;
    opt.textContent = label;
    typeEl.appendChild(opt);
  }

  const flagTypeRow = el("div", "composer-adv-field-row");
  flagTypeRow.append(labeledField("标记", flagEl), labeledField("类型", typeEl));

  const dateMount = el("div", "cds-composer-adv-date-mount");
  const timeMount = el("div", "cds-composer-adv-time-mount");
  const dateTimeRow = el("div", "composer-adv-field-row");
  dateTimeRow.append(labeledField("日期", dateMount), labeledField("时间", timeMount));

  const remarkEl = el("input") as HTMLInputElement;
  remarkEl.maxLength = REMARK_MAX_LENGTH;

  const tagBox = el("div", "cds-composer-adv-tag-box ledger-tag-box");
  const tagField = el("input", "ledger-tag-field") as HTMLInputElement;
  tagField.placeholder = "回车添加";
  tagBox.appendChild(tagField);

  const rowsEl = el("div", "composer-posting-rows");
  const addBtn = el("button", "composer-add-row") as HTMLButtonElement;
  addBtn.type = "button";
  addBtn.textContent = "添加分录";

  form.append(
    labeledField("收款人", payeeEl, true),
    flagTypeRow,
    dateTimeRow,
    labeledField("简记", remarkEl, true),
    labeledField("标签", tagBox, true),
    labeledField("分录", rowsEl, true),
    addBtn,
  );
  container.replaceChildren(form);

  const datePicker: DecoupledDatePickerHandle = mountDecoupledDatePicker({ defaultTrigger: { container: dateMount } });
  const timePicker: DecoupledTimePickerHandle = mountDecoupledTimePicker({ defaultTrigger: { container: timeMount } });
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
    const root = el("div", "composer-posting-row");
    const top = el("div", "composer-posting-top");
    const accountMount = el("div", "composer-posting-account");
    const removeBtn = el("button", "composer-posting-remove") as HTMLButtonElement;
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "删除分录");
    removeBtn.textContent = "×";
    top.append(accountMount, removeBtn);

    const line = el("div", "composer-posting-line");
    const values = el("div", "composer-posting-values");
    const amountEl = el("input", "composer-posting-amount") as HTMLInputElement;
    amountEl.type = "text";
    amountEl.inputMode = "decimal";
    amountEl.placeholder = "金额";
    const currencyEl = el("input", "composer-posting-currency ledger-currency-input") as HTMLInputElement;
    currencyEl.type = "text";
    currencyEl.value = DEFAULT_CURRENCY;
    currencyEl.placeholder = "币";
    values.append(amountEl, currencyEl);

    const costs = el("div", "composer-posting-costs");
    const costLabel = el("span", "composer-posting-cost-label");
    costLabel.textContent = "@@";
    const costAmountEl = el("input", "composer-posting-cost-amount") as HTMLInputElement;
    costAmountEl.type = "text";
    costAmountEl.inputMode = "decimal";
    costAmountEl.placeholder = "成本";
    const costCurrencyEl = el(
      "input",
      "composer-posting-cost-currency ledger-currency-input",
    ) as HTMLInputElement;
    costCurrencyEl.type = "text";
    costCurrencyEl.placeholder = "币";
    costs.append(costLabel, costAmountEl, costCurrencyEl);
    line.append(values, costs);
    root.append(top, line);

    const accountPicker = mountAccountSelect(accountMount, {
      groups: [...ALL_GROUPS],
      displayMode: "admin",
    });

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

  function collectPostings(): Posting[] | { error: string } {
    const postings: Posting[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const amountRaw = row.amountEl.value.trim();
      const amountParsed = amountRaw
        ? parseDecimalInput(amountRaw, { allowZero: true })
        : null;
      if (amountParsed && !amountParsed.ok) {
        return { error: `第 ${i + 1} 行: ${amountParsed.message}` };
      }
      const costParsed = parseOptionalDecimalInput(row.costAmountEl.value);
      if (!costParsed.ok) return { error: `第 ${i + 1} 行: ${costParsed.message}` };
      postings.push({
        account: row.accountPicker.getValue(),
        amount: amountParsed ? amountParsed.value : null,
        currency: row.currencyEl.value.trim() || DEFAULT_CURRENCY,
        cost_amount: costParsed.value,
        cost_currency: row.costCurrencyEl.value.trim(),
      });
    }
    return postings;
  }

  return {
    validate(): string | null {
      const date = datePicker.getValue();
      if (!date) return "请填写日期";
      const timeErr = validateTxnTimeInput(timePicker.getValue());
      if (timeErr) return timeErr;
      const collected = collectPostings();
      if ("error" in collected) return collected.error;
      if (collected.length < MIN_ROWS) return `至少需要 ${MIN_ROWS} 条分录`;
      if (collected.length > MAX_POSTINGS) return `最多 ${MAX_POSTINGS} 条分录`;
      return validateComposerPostings(collected);
    },
    getDraft(): AdvancedDraft {
      const collected = collectPostings();
      const postings = "error" in collected ? [] : collected;
      return {
        date: datePicker.getValue(),
        time: timePicker.getValue(),
        payee: payeeEl.value.trim(),
        remark: remarkEl.value.trim().slice(0, REMARK_MAX_LENGTH),
        flag: flagEl.value || "*",
        tags: getTagsFromBox(tagBox),
        type: (typeEl.value || "") as Entry["type"] | "",
        postings,
      };
    },
    reset(): void {
      payeeEl.value = "";
      flagEl.value = "*";
      typeEl.value = "expense";
      remarkEl.value = "";
      setTagsInBox(tagBox, tagField, []);
      datePicker.setValue(todayIso());
      timePicker.setValue("");
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
    resetForContinue(): void {
      payeeEl.value = "";
      remarkEl.value = "";
      setTagsInBox(tagBox, tagField, []);
      for (const row of rows) {
        row.amountEl.value = "";
        row.costAmountEl.value = "";
        row.costCurrencyEl.value = "";
      }
    },
    setDate(date: string): void {
      datePicker.setValue(date);
    },
  };
}
