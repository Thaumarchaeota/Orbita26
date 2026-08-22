import {
  DEFAULT_CURRENCY,
  REMARK_MAX_LENGTH,
} from "../../constants";
import {
  ACTION_SUCCESS_MS,
  clearActionMotion,
  ensureActionButton,
  playActionError,
  playActionSuccess,
  withActionPending,
} from "../../../../ui/action-motion";
import {
  allowedCurrenciesForAccount,
  buildAccountIndex,
  intersectAllowedCurrencies,
  simpleModeNeedsAdvanced,
  validateOpenCurrency,
} from "../../domain/account-validate";
import { buildPostingsFromSimple } from "../../domain/entry";
import { newOrbitaId } from "../../domain/orbita-id";
import { nextSeqForDate } from "../../domain/seq";
import { getDetailEntries, pushEntry } from "../../state/ledger";
import { getWriteTarget } from "../../state/write-target";
import type { AccountGroup, Entry } from "../../types";
import { formatTags, sleep, todayIso } from "../../utils";
import { mountAccountPicker, type AccountPickerHandle } from "../../ui/account-picker";
import { mountDatePicker, type DatePickerHandle } from "../../../../ui/date-picker";
import { mountAdvancedComposer } from "./entry-form-advanced";
import {
  getTagsFromBox,
  initTagInput,
  setTagsInBox,
} from "./entry-form-tags";

type EntryType = "expense" | "income" | "transfer";
type ComposerMode = "simple" | "advanced";

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

export function mountEntryFormDetail(
  container: HTMLElement,
  onRecord: () => void,
): () => void {
  let activeType: EntryType = "expense";
  let composerMode: ComposerMode = "simple";
  let submitAnimating = false;
  const ac = new AbortController();
  const { signal } = ac;

  container.innerHTML = `
    <div class="ledger-entry-form" id="detail-entry-form">
      <h2 class="ledger-form-title" id="detail-form-title">支出</h2>
      <div class="ledger-mode-switch">
        <span class="ledger-mode-slider" aria-hidden="true"></span>
        <input type="radio" name="detail-composer-mode" id="detail-mode-simple" value="simple" checked>
        <label for="detail-mode-simple">简单</label>
        <input type="radio" name="detail-composer-mode" id="detail-mode-advanced" value="advanced">
        <label for="detail-mode-advanced">高级</label>
      </div>
      <div id="simple-composer-section">
        <div class="ledger-type-switch">
          <span class="ledger-type-slider" aria-hidden="true"></span>
          <input type="radio" name="detail-ledger-type" id="detail-type-expense" value="expense" checked>
          <label for="detail-type-expense">支出</label>
          <input type="radio" name="detail-ledger-type" id="detail-type-income" value="income">
          <label for="detail-type-income">收入</label>
          <input type="radio" name="detail-ledger-type" id="detail-type-transfer" value="transfer">
          <label for="detail-type-transfer">转账</label>
        </div>
        <form id="detail-entry-form-inner" novalidate>
          <p id="detail-advanced-guide" class="composer-advanced-guide" hidden>
            所选账户无共同币种，请使用高级模式或指定 @@ 成本。
            <button type="button" id="detail-switch-advanced" class="composer-advanced-guide-btn">切换到高级</button>
          </p>
          <label id="detail-label1">支出类型</label>
          <div id="detail-category-picker"></div>
          <label id="detail-label2">支出账户</label>
          <div id="detail-account-picker"></div>
          <label for="detail-amount">金额</label>
          <div class="ledger-amount-row">
            <input type="number" id="detail-amount" class="ledger-amount-input" step="0.01" required>
            <input type="text" id="detail-currency" class="ledger-currency-input" value="${DEFAULT_CURRENCY}" placeholder="${DEFAULT_CURRENCY}">
          </div>
          <label for="detail-date">日期</label>
          <div id="detail-date-picker"></div>
          <label for="detail-remark">简记</label>
          <input type="text" id="detail-remark" maxlength="${REMARK_MAX_LENGTH}">
          <label for="detail-tag-field">标签</label>
          <div id="detail-tag-box" class="ledger-tag-box">
            <input type="text" id="detail-tag-field" class="ledger-tag-field" placeholder="回车添加">
          </div>
        </form>
      </div>
      <div id="advanced-composer-section" hidden>
        <form id="detail-advanced-form" novalidate></form>
      </div>
      <button type="button" id="detail-submit-btn" class="ledger-submit-btn orbita-action-btn">记录</button>
      <p id="detail-form-error" class="ledger-form-error" hidden></p>
    </div>`;

  const titleEl = container.querySelector<HTMLElement>("#detail-form-title")!;
  const simpleSection = container.querySelector<HTMLElement>("#simple-composer-section")!;
  const advancedSection = container.querySelector<HTMLElement>("#advanced-composer-section")!;
  const advancedFormMount = container.querySelector<HTMLElement>("#detail-advanced-form")!;
  const guideEl = container.querySelector<HTMLElement>("#detail-advanced-guide")!;
  const label1 = container.querySelector<HTMLElement>("#detail-label1")!;
  const label2 = container.querySelector<HTMLElement>("#detail-label2")!;
  const amountEl = container.querySelector<HTMLInputElement>("#detail-amount")!;
  const currencyEl = container.querySelector<HTMLInputElement>("#detail-currency")!;
  const remarkEl = container.querySelector<HTMLInputElement>("#detail-remark")!;
  const tagBox = container.querySelector<HTMLElement>("#detail-tag-box")!;
  const tagField = container.querySelector<HTMLInputElement>("#detail-tag-field")!;
  const submitBtn = container.querySelector<HTMLButtonElement>("#detail-submit-btn")!;
  ensureActionButton(submitBtn);
  const errorEl = container.querySelector<HTMLElement>("#detail-form-error")!;
  const typeSlider = simpleSection.querySelector<HTMLElement>(".ledger-type-slider")!;
  const modeSlider = container.querySelector<HTMLElement>(".ledger-mode-slider")!;

  const categoryPickerMount = container.querySelector<HTMLElement>("#detail-category-picker")!;
  const accountPickerMount = container.querySelector<HTMLElement>("#detail-account-picker")!;
  const datePickerMount = container.querySelector<HTMLElement>("#detail-date-picker")!;

  let categoryPicker: AccountPickerHandle;
  let accountPicker: AccountPickerHandle;
  let datePicker: DatePickerHandle;
  const advancedComposer = mountAdvancedComposer(advancedFormMount, signal);

  initTagInput(tagField, tagBox, signal);

  function updateModeSlider(): void {
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="detail-composer-mode"]');
    const index = [...radios].findIndex((el) => el.checked);
    modeSlider.style.transform = `translateX(${index * 100}%)`;
  }

  function updateTypeSlider(): void {
    const radios = simpleSection.querySelectorAll<HTMLInputElement>('input[name="detail-ledger-type"]');
    const index = [...radios].findIndex((el) => el.checked);
    typeSlider.style.transform = `translateX(${index * 100}%)`;
  }

  function syncAdvancedGuide(): void {
    if (composerMode !== "simple") {
      guideEl.hidden = true;
      return;
    }
    const a1 = categoryPicker.getValue();
    const a2 = accountPicker.getValue();
    guideEl.hidden = !simpleModeNeedsAdvanced(a1, a2);
  }

  function syncSimpleCurrency(): void {
    if (composerMode !== "simple") return;
    const index = buildAccountIndex();
    const a1 = categoryPicker.getValue();
    const a2 = accountPicker.getValue();
    if (a1 && a2) {
      const common = intersectAllowedCurrencies(
        index.findRecord(a1),
        index.findRecord(a2),
      );
      syncAdvancedGuide();
      if (common === null) return;
      if (common.length === 1) currencyEl.value = common[0]!;
      else if (common.length > 0 && !common.includes(currencyEl.value.trim())) {
        currencyEl.value = common[0]!;
      }
      return;
    }
    const single = a1 || a2;
    if (!single) return;
    const allowed = allowedCurrenciesForAccount(index.findRecord(single));
    if (allowed?.length === 1) currencyEl.value = allowed[0]!;
    syncAdvancedGuide();
  }

  function switchMode(mode: ComposerMode): void {
    composerMode = mode;
    updateModeSlider();
    const isSimple = mode === "simple";
    simpleSection.hidden = !isSimple;
    advancedSection.hidden = isSimple;
    titleEl.textContent = isSimple ? TYPE_CONFIG[activeType].title : "高级记账";
    syncAdvancedGuide();
  }

  function switchType(type: EntryType): void {
    activeType = type;
    const cfg = TYPE_CONFIG[type];
    if (composerMode === "simple") titleEl.textContent = cfg.title;
    label1.textContent = cfg.label1;
    label2.textContent = cfg.label2;
    updateTypeSlider();
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

  container.querySelectorAll<HTMLInputElement>('input[name="detail-composer-mode"]').forEach((el) => {
    el.addEventListener("change", () => switchMode(el.value as ComposerMode), { signal });
  });

  container.querySelectorAll<HTMLInputElement>('input[name="detail-ledger-type"]').forEach((el) => {
    el.addEventListener("change", () => switchType(el.value as EntryType), { signal });
  });

  container.querySelector<HTMLButtonElement>("#detail-switch-advanced")!.addEventListener(
    "click",
    () => {
      const advRadio = container.querySelector<HTMLInputElement>("#detail-mode-advanced")!;
      advRadio.checked = true;
      switchMode("advanced");
    },
    { signal },
  );

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError(): void {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function resetSubmitBtn(): void {
    clearActionMotion(submitBtn);
    submitBtn.textContent = "记录";
    submitAnimating = false;
    submitBtn.disabled = false;
  }

  const onAccountChange = () => syncSimpleCurrency();

  categoryPicker = mountAccountPicker(categoryPickerMount, {
    groups: TYPE_CONFIG.expense.categoryGroup,
    placeholder: "请选择",
    onChange: onAccountChange,
  });
  accountPicker = mountAccountPicker(accountPickerMount, {
    groups: TYPE_CONFIG.expense.accountGroup,
    placeholder: "请选择",
    onChange: onAccountChange,
  });
  datePicker = mountDatePicker(datePickerMount, { value: todayIso() });

  function pushDraft(entry: Omit<Entry, "kind" | "source_file" | "source_line" | "seq" | "id">): void {
    const dateValue = entry.date;
    pushEntry({
      ...entry,
      kind: "transaction",
      id: newOrbitaId(),
      source_file: getWriteTarget(),
      source_line: 0,
      seq: nextSeqForDate(getDetailEntries(), dateValue),
      _is_new: true,
    });
  }

  async function handleSubmit(): Promise<void> {
    if (submitAnimating) return;
    clearError();

    if (composerMode === "advanced") {
      const err = advancedComposer.validate();
      if (err) {
        showError(err);
        return;
      }
      const draft = advancedComposer.getDraft();
      submitAnimating = true;
      const start = Date.now();
      try {
        await withActionPending(submitBtn, { label: "记录中…" }, () => {
          pushDraft({
            type: (draft.type || "") as Entry["type"],
            date: draft.date,
            flag: draft.flag,
            payee: draft.payee,
            remark: draft.remark,
            tags: formatTags(draft.tags),
            postings: draft.postings,
          });
          advancedComposer.reset();
        });
        await playActionSuccess(submitBtn, {
          minMs: Math.max(0, ACTION_SUCCESS_MS - (Date.now() - start)),
          onDone: () => resetSubmitBtn(),
        });
        onRecord();
      } catch (err) {
        showError(err instanceof Error ? err.message : "记录失败");
        await playActionError(submitBtn);
        resetSubmitBtn();
      }
      return;
    }

    const dateValue = datePicker.getValue();
    if (!dateValue) {
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
      showError("所选账户无共同币种，请切换到高级模式");
      return;
    }

    const currency = currencyEl.value.trim() || DEFAULT_CURRENCY;
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

    const remark = remarkEl.value.trim().slice(0, REMARK_MAX_LENGTH);
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
      await withActionPending(submitBtn, { label: "记录中…" }, () => {
        pushDraft({
          type: activeType,
          date: dateValue,
          flag: "*",
          payee: "",
          remark,
          tags,
          postings,
        });
        amountEl.value = "";
        remarkEl.value = "";
        setTagsInBox(tagBox, tagField, []);
      });
      await playActionSuccess(submitBtn, {
        minMs: Math.max(0, ACTION_SUCCESS_MS - (Date.now() - start)),
        onDone: () => resetSubmitBtn(),
      });
      onRecord();
    } catch (err) {
      showError(err instanceof Error ? err.message : "记录失败");
      await playActionError(submitBtn);
      resetSubmitBtn();
    }
  }

  submitBtn.addEventListener("click", () => void handleSubmit(), { signal });

  switchType("expense");
  switchMode("simple");

  return () => ac.abort();
}
