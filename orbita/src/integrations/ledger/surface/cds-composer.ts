import {
  ACTION_SUCCESS_MS,
  clearActionMotion,
  ensureActionButton,
  playActionError,
  playActionSuccess,
  withActionPending,
} from "../../../ui/action-motion";
import {
  DEFAULT_CURRENCY,
  REMARK_MAX_LENGTH,
} from "../constants";
import {
  allowedCurrenciesForAccount,
  buildAccountIndex,
  intersectAllowedCurrencies,
  simpleModeNeedsAdvanced,
  validateOpenCurrency,
} from "../domain/account-validate";
import { buildPostingsFromSimple } from "../domain/entry";
import { mountDatePicker, type DatePickerHandle } from "../../../ui/date-picker";
import { mountAccountPicker, type AccountPickerHandle } from "../ui/account-picker";
import { mountCdsAdvancedComposer } from "./cds-composer-advanced";
import { getTagsFromBox, initTagInput, setTagsInBox } from "./cds-tag-input";
import { parseDecimalInput } from "../domain/field-validate";
import { upsertTxnTimeMetadata, validateTxnTimeInput } from "../domain/txn-time";
import { createTxnTimeInput } from "./cds-editing";
import type { AccountGroup, Entry } from "../types";
import { formatTags, sleep, todayIso } from "../utils";
import type { CardDetailStore } from "./types";
import "./composer-shell.css";

type EntryType = "expense" | "income" | "transfer";
type ComposerTab = EntryType | "advanced";

const TAB_ORDER: ComposerTab[] = ["expense", "income", "transfer", "advanced"];

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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function field(labelText: string, control: HTMLElement, extraClass = ""): HTMLElement {
  const wrap = el("div", `cds-composer-field${extraClass ? ` ${extraClass}` : ""}`);
  const label = el("label", "cds-composer-label");
  label.textContent = labelText;
  wrap.append(label, control);
  return wrap;
}

/** Phase C Composer — dispatches create-transaction only; never writes bean. */
export function mountCdsComposer(
  container: HTMLElement,
  store: CardDetailStore,
  signal: AbortSignal,
): () => void {
  let activeType: EntryType = "expense";
  let activeTab: ComposerTab = "expense";
  let submitAnimating = false;

  const root = el("div", "cds-composer");
  root.setAttribute("data-role", "composer-shell");

  const title = el("h2", "cds-composer-title");
  title.textContent = "记一笔";

  const typeSwitch = el("div", "cds-composer-type-switch");
  typeSwitch.setAttribute("data-role", "composer-type-switch");
  const typeSlider = el("span", "cds-composer-type-slider");
  typeSlider.setAttribute("aria-hidden", "true");
  typeSwitch.appendChild(typeSlider);

  const tabBtns = new Map<ComposerTab, HTMLButtonElement>();
  for (const [tab, name] of [
    ["expense", "支出"],
    ["income", "收入"],
    ["transfer", "转账"],
    ["advanced", "高级"],
  ] as const) {
    const btn = el("button", "cds-composer-type-btn");
    btn.type = "button";
    btn.dataset.tab = tab;
    btn.textContent = name;
    if (tab === "expense") btn.classList.add("is-active");
    tabBtns.set(tab, btn);
    typeSwitch.appendChild(btn);
  }

  const simpleSection = el("div", "cds-composer-simple is-visible");
  const advancedSection = el("div", "cds-composer-advanced");

  const guideEl = el("p", "cds-composer-guide");
  guideEl.hidden = true;
  guideEl.textContent = "所选账户无共同币种，请切换到高级。";
  const guideBtn = el("button", "cds-composer-guide-btn");
  guideBtn.type = "button";
  guideBtn.textContent = "切换到高级";
  guideEl.append(" ", guideBtn);

  const categoryMount = el("div", "cds-composer-picker");
  const accountMount = el("div", "cds-composer-picker");

  const amountDateRow = el("div", "cds-composer-row-split");
  const amountInput = el("input", "cds-composer-input") as HTMLInputElement;
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.placeholder = "0.00";
  const currencyInput = el("input", "cds-composer-input cds-composer-currency") as HTMLInputElement;
  currencyInput.type = "text";
  currencyInput.value = DEFAULT_CURRENCY;
  const amountWrap = el("div", "cds-composer-amount-row");
  amountWrap.append(amountInput, currencyInput);

  const dateMount = el("div", "cds-composer-picker cds-composer-date-mount");
  const timeInput = createTxnTimeInput("", "cds-composer-input cds-composer-time");
  const dateTimeWrap = el("div", "cds-composer-date-time");
  dateTimeWrap.append(dateMount, timeInput);

  amountDateRow.append(
    field("金额", amountWrap, "cds-composer-field-amount"),
    field("日期 / 时间", dateTimeWrap),
  );

  const remarkInput = el("input", "cds-composer-input") as HTMLInputElement;
  remarkInput.maxLength = REMARK_MAX_LENGTH;

  const tagBox = el("div", "cds-composer-tags ledger-tag-box");
  const tagField = el("input", "ledger-tag-field") as HTMLInputElement;
  tagField.placeholder = "回车添加";
  tagBox.appendChild(tagField);

  const categoryField = field("支出类型", categoryMount);
  const accountField = field("支出账户", accountMount);
  const categoryLabel = categoryField.querySelector(".cds-composer-label")!;
  const accountLabel = accountField.querySelector(".cds-composer-label")!;

  simpleSection.append(
    guideEl,
    categoryField,
    accountField,
    amountDateRow,
    field("简记", remarkInput),
    field("标签", tagBox),
  );

  const advancedMount = el("div", "cds-composer-advanced-mount");
  advancedSection.appendChild(advancedMount);

  const errorEl = el("p", "cds-composer-error");
  errorEl.hidden = true;

  const submit = el("button", "cds-composer-submit orbita-action-btn");
  submit.type = "button";
  submit.textContent = "记录";

  root.append(title, typeSwitch, simpleSection, advancedSection, errorEl, submit);
  container.replaceChildren(root);

  let categoryPicker: AccountPickerHandle;
  let accountPicker: AccountPickerHandle;
  let datePicker: DatePickerHandle;
  const advancedComposer = mountCdsAdvancedComposer(advancedMount, signal);
  initTagInput(tagField, tagBox, signal);

  function updateTypeSlider(): void {
    const index = TAB_ORDER.indexOf(activeTab);
    typeSwitch.style.setProperty("--cds-tab-index", String(Math.max(0, index)));
  }

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError(): void {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function resetSubmitBtn(): void {
    clearActionMotion(submit);
    submit.textContent = "记录";
    submitAnimating = false;
    submit.disabled = false;
  }

  function syncAdvancedGuide(): void {
    if (activeTab === "advanced") {
      guideEl.hidden = true;
      return;
    }
    guideEl.hidden = !simpleModeNeedsAdvanced(categoryPicker.getValue(), accountPicker.getValue());
  }

  function syncSimpleCurrency(): void {
    if (activeTab === "advanced") return;
    const index = buildAccountIndex();
    const a1 = categoryPicker.getValue();
    const a2 = accountPicker.getValue();
    if (a1 && a2) {
      const common = intersectAllowedCurrencies(index.findRecord(a1), index.findRecord(a2));
      syncAdvancedGuide();
      if (common === null) return;
      if (common.length === 1) currencyInput.value = common[0]!;
      else if (common.length > 0 && !common.includes(currencyInput.value.trim())) {
        currencyInput.value = common[0]!;
      }
      return;
    }
    const single = a1 || a2;
    if (!single) return;
    const allowed = allowedCurrenciesForAccount(index.findRecord(single));
    if (allowed?.length === 1) currencyInput.value = allowed[0]!;
    syncAdvancedGuide();
  }

  function setSectionVisible(section: HTMLElement, visible: boolean): void {
    section.hidden = !visible;
    section.classList.toggle("is-visible", visible);
  }

  function switchTab(tab: ComposerTab): void {
    activeTab = tab;
    for (const [key, btn] of tabBtns) btn.classList.toggle("is-active", key === tab);
    updateTypeSlider();
    if (tab === "advanced") {
      setSectionVisible(simpleSection, false);
      setSectionVisible(advancedSection, true);
      title.textContent = "高级记账";
      syncAdvancedGuide();
      return;
    }
    setSectionVisible(simpleSection, true);
    setSectionVisible(advancedSection, false);
    activeType = tab;
    switchType(tab);
    title.textContent = TYPE_CONFIG[tab].title;
    syncAdvancedGuide();
  }

  function switchType(type: EntryType): void {
    activeType = type;
    const cfg = TYPE_CONFIG[type];
    if (activeTab !== "advanced") title.textContent = cfg.title;
    categoryLabel.textContent = cfg.label1;
    accountLabel.textContent = cfg.label2;
    categoryPicker.setGroups(cfg.categoryGroup);
    categoryPicker.setValue("");
    const accountGroups =
      type === "transfer"
        ? (["assets", "liabilities"] as AccountGroup[])
        : cfg.accountGroup;
    accountPicker.setGroups(accountGroups);
    accountPicker.setValue("");
    syncAdvancedGuide();
  }

  categoryPicker = mountAccountPicker(categoryMount, {
    groups: TYPE_CONFIG.expense.categoryGroup,
    placeholder: "请选择",
    onChange: syncSimpleCurrency,
  });
  accountPicker = mountAccountPicker(accountMount, {
    groups: TYPE_CONFIG.expense.accountGroup,
    placeholder: "请选择",
    onChange: syncSimpleCurrency,
  });
  datePicker = mountDatePicker(dateMount, { value: todayIso(), compact: true });

  for (const [tab, btn] of tabBtns) {
    btn.addEventListener("click", () => switchTab(tab), { signal });
  }
  guideBtn.addEventListener("click", () => switchTab("advanced"), { signal });

  async function handleSubmit(): Promise<void> {
    if (submitAnimating) return;
    const phase = store.getSnapshot().savePhase;
    if (phase === "checking" || phase === "submitting") return;
    clearError();

    if (activeTab === "advanced") {
      const err = advancedComposer.validate();
      if (err) {
        showError(err);
        return;
      }
      const draft = advancedComposer.getDraft();
      submitAnimating = true;
      const start = Date.now();
      try {
        await withActionPending(submit, { label: "记录中…" }, () => {
          store.dispatch({
            type: "create-transaction",
            draft: {
              type: (draft.type || "") as Entry["type"],
              date: draft.date,
              flag: draft.flag,
              payee: draft.payee,
              remark: draft.remark,
              tags: formatTags(draft.tags),
              postings: draft.postings,
              metadata: upsertTxnTimeMetadata([], draft.date, draft.time),
            },
          });
          advancedComposer.reset();
        });
        await playActionSuccess(submit, {
          minMs: Math.max(0, ACTION_SUCCESS_MS - (Date.now() - start)),
          onDone: () => resetSubmitBtn(),
        });
      } catch (err) {
        showError(err instanceof Error ? err.message : "记录失败");
        await playActionError(submit);
        resetSubmitBtn();
      }
      return;
    }

    const dateValue = datePicker.getValue();
    if (!dateValue) {
      showError("请填写日期");
      return;
    }
    const timeErr = validateTxnTimeInput(timeInput.value);
    if (timeErr) {
      showError(timeErr);
      return;
    }
    const raw = amountInput.value.trim();
    if (!raw) {
      showError("请填写金额");
      return;
    }
    const amountParsed = parseDecimalInput(raw);
    if (!amountParsed.ok) {
      showError(amountParsed.message);
      return;
    }
    if (amountParsed.value <= 0) {
      showError("金额必须大于 0");
      return;
    }
    const amount = amountParsed.value;
    const selectedCategory = categoryPicker.getValue();
    if (!selectedCategory) {
      showError(`请选择${TYPE_CONFIG[activeType].label1}`);
      return;
    }
    const accountValue = accountPicker.getValue();
    if (!accountValue) {
      showError(`请选择${TYPE_CONFIG[activeType].label2}`);
      return;
    }
    if (activeType !== "transfer" && selectedCategory === accountValue) {
      showError("分类与账户不能相同");
      return;
    }
    if (activeType === "transfer" && selectedCategory === accountValue) {
      showError("发起账户与接收账户不能相同");
      return;
    }
    if (simpleModeNeedsAdvanced(selectedCategory, accountValue)) {
      showError("所选账户无共同币种，请切换到高级");
      return;
    }

    const currency = currencyInput.value.trim() || DEFAULT_CURRENCY;
    const index = buildAccountIndex();
    const e1 = validateOpenCurrency(index.findRecord(selectedCategory), currency);
    if (e1) {
      showError(e1);
      return;
    }
    const e2 = validateOpenCurrency(index.findRecord(accountValue), currency);
    if (e2) {
      showError(e2);
      return;
    }

    const remark = remarkInput.value.trim().slice(0, REMARK_MAX_LENGTH);
    const tags = formatTags(getTagsFromBox(tagBox));
    const postings = buildPostingsFromSimple(
      activeType,
      selectedCategory,
      accountValue,
      amount,
      currency,
    );

    submitAnimating = true;
    const start = Date.now();
    try {
      await withActionPending(submit, { label: "记录中…" }, () => {
        store.dispatch({
          type: "create-transaction",
            draft: {
              type: activeType,
              date: dateValue,
              flag: "*",
              payee: "",
              remark,
              tags,
              postings,
              metadata: upsertTxnTimeMetadata([], dateValue, timeInput.value),
            },
        });
        amountInput.value = "";
        remarkInput.value = "";
        timeInput.value = "";
        setTagsInBox(tagBox, tagField, []);
      });
      await playActionSuccess(submit, {
        minMs: Math.max(0, ACTION_SUCCESS_MS - (Date.now() - start)),
        onDone: () => resetSubmitBtn(),
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : "记录失败");
      await playActionError(submit);
      resetSubmitBtn();
    }
  }

  submit.addEventListener("click", () => void handleSubmit(), { signal });

  switchTab("expense");
  updateTypeSlider();

  const onAbort = () => container.replaceChildren();
  signal.addEventListener("abort", onAbort);

  return () => {
    signal.removeEventListener("abort", onAbort);
    container.replaceChildren();
  };
}
