import { fetchAccountPeriodStats } from "../api/client";
import { mountAccountSelect } from "../ui/account-select";
import type { AccountGroup, AccountPeriodCurrencyStat, AccountPeriodStatsResponse } from "../types";
import { mountToggleSwitch } from "../../../ui/choice-control";
import { mountDateRangePicker } from "../../../ui/date-range-picker";
import { mountLoadingIndicator } from "../../../ui/loading-indicator";
import { mountSimpleSelect } from "../../../ui/simple-select";
import type { CardDetailStore } from "./types";
import "./finance-rail-audit.css";

type PeriodLabels = {
  inflows: string;
  outflows: string;
  netChange: string;
};

const ASSET_LABELS: PeriodLabels = {
  inflows: "流入",
  outflows: "流出",
  netChange: "净变动",
};

const LIABILITY_LABELS: PeriodLabels = {
  inflows: "消费",
  outflows: "还款",
  netChange: "欠款变化",
};

function periodLabels(kind: AccountPeriodStatsResponse["account_kind"]): PeriodLabels {
  return kind === "liability" ? LIABILITY_LABELS : ASSET_LABELS;
}

function formatAmount(value: string | undefined, currency: string): string {
  if (value === undefined || value === "") return "—";
  return `${value} ${currency}`;
}

function hasDateRange(from: string, to: string): boolean {
  return Boolean(from || to);
}

export function mountFinanceRailAudit(
  container: HTMLElement,
  signal: AbortSignal,
  store: CardDetailStore,
): () => void {
  const root = document.createElement("section");
  root.className = "finance-rail-audit-section";
  root.setAttribute("data-role", "finance-rail-audit");

  const head = document.createElement("div");
  head.className = "finance-rail-audit-head";
  const title = document.createElement("h2");
  title.className = "finance-rail-audit-title";
  title.textContent = "校验";
  head.appendChild(title);

  const accountKindMount = document.createElement("div");
  accountKindMount.className = "finance-rail-audit-kind";
  accountKindMount.setAttribute("data-role", "audit-kind-mount");

  const accountMount = document.createElement("div");
  accountMount.className = "finance-rail-audit-account";
  accountMount.setAttribute("data-role", "audit-account-mount");

  const followRow = document.createElement("div");
  followRow.className = "finance-rail-audit-follow";
  const followSwitchMount = document.createElement("span");
  followSwitchMount.className = "finance-rail-audit-follow-switch";
  const followText = document.createElement("span");
  followText.textContent = "跟随筛选日期";
  followRow.append(followSwitchMount, followText);

  const dateMount = document.createElement("div");
  dateMount.className = "finance-rail-audit-dates";
  dateMount.setAttribute("data-role", "audit-date-mount");
  dateMount.hidden = true;

  const loadingMount = document.createElement("div");
  loadingMount.className = "finance-rail-audit-loading";
  const loading = mountLoadingIndicator(loadingMount, { size: "compact", label: "加载中" });

  const errorEl = document.createElement("p");
  errorEl.className = "finance-rail-audit-error";
  errorEl.setAttribute("data-role", "audit-error");
  errorEl.hidden = true;

  const resultsEl = document.createElement("div");
  resultsEl.className = "finance-rail-audit-results";
  resultsEl.setAttribute("data-role", "audit-results");

  root.append(head, accountKindMount, accountMount, followRow, dateMount, loadingMount, errorEl, resultsEl);
  container.appendChild(root);

  let followFilterDate = true;
  let customFrom = "";
  let customTo = "";
  let accountKind: AccountGroup = "assets";
  let account = "";
  let generation = 0;

  const datePicker = mountDateRangePicker(dateMount, {
    value: { from: customFrom, to: customTo },
    onChange: (v) => {
      customFrom = v.from;
      customTo = v.to;
      void refresh();
    },
  });

  const kindSelect = mountSimpleSelect(accountKindMount, {
    value: "assets",
    options: [
      { value: "assets", label: "资产" },
      { value: "liabilities", label: "信贷" },
    ],
    role: "audit-account-kind",
    onChange: (value) => {
      accountKind = value as AccountGroup;
      account = "";
      accountSelect.setGroups([accountKind]);
      accountSelect.setValue("");
      void refresh();
    },
  });

  const accountSelect = mountAccountSelect(accountMount, {
    groups: [accountKind],
    displayMode: "default",
    placeholder: "选择账户",
    onChange: (name) => {
      account = name;
      void refresh();
    },
  });

  const followSwitch = mountToggleSwitch(followSwitchMount, {
    checked: true,
    role: "audit-follow-filter-date",
    onChange: (checked) => {
      followFilterDate = checked;
      syncFollowUi();
      void refresh();
    },
  });

  function effectiveDates(): { from: string; to: string } {
    if (followFilterDate) {
      const { dateFrom, dateTo } = store.getFilterSnapshot();
      return { from: dateFrom, to: dateTo };
    }
    return { from: customFrom, to: customTo };
  }

  function renderBalanceCard(stat: AccountPeriodCurrencyStat): HTMLElement {
    const card = document.createElement("div");
    card.className = "finance-rail-audit-balance-card";
    const label = document.createElement("span");
    label.className = "finance-rail-audit-balance-label";
    label.textContent = "当前余额";
    const value = document.createElement("span");
    value.className = "finance-rail-audit-balance-value";
    value.textContent = formatAmount(stat.balance, stat.currency);
    const hint = document.createElement("p");
    hint.className = "finance-rail-audit-balance-hint";
    hint.textContent = "未选日期范围，显示账户当前余额";
    card.append(label, value, hint);
    return card;
  }

  function renderPeriodGrid(
    stat: AccountPeriodCurrencyStat,
    labels: PeriodLabels,
  ): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "finance-rail-audit-grid";
    const cells: [string, string][] = [
      ["期初", formatAmount(stat.opening_balance, stat.currency)],
      [labels.inflows, formatAmount(stat.inflows, stat.currency)],
      [labels.outflows, formatAmount(stat.outflows, stat.currency)],
      [labels.netChange, formatAmount(stat.net_change, stat.currency)],
      ["期末", formatAmount(stat.closing_balance, stat.currency)],
      ["笔数", String(stat.transaction_count ?? 0)],
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement("div");
      cell.className = "finance-rail-audit-cell";
      const labelEl = document.createElement("span");
      labelEl.className = "finance-rail-audit-cell-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "finance-rail-audit-cell-value";
      valueEl.textContent = value;
      cell.append(labelEl, valueEl);
      grid.appendChild(cell);
    }
    return grid;
  }

  function renderResults(data: AccountPeriodStatsResponse, dated: boolean): void {
    resultsEl.replaceChildren();
    const currencies = data.currencies ?? [];
    if (!currencies.length) {
      const empty = document.createElement("p");
      empty.className = "finance-rail-audit-empty";
      empty.textContent = "—";
      resultsEl.appendChild(empty);
      return;
    }
    const labels = periodLabels(data.account_kind);
    for (const stat of currencies) {
      const block = document.createElement("div");
      block.className = "finance-rail-audit-currency";
      if (currencies.length > 1) {
        const header = document.createElement("div");
        header.className = "finance-rail-audit-currency-label";
        header.textContent = stat.currency;
        block.appendChild(header);
      }
      block.appendChild(dated ? renderPeriodGrid(stat, labels) : renderBalanceCard(stat));
      resultsEl.appendChild(block);
    }
  }

  function syncFollowUi(): void {
    dateMount.hidden = followFilterDate;
    if (!followFilterDate) {
      datePicker.setValue({ from: customFrom, to: customTo });
    }
  }

  let lastFollowedFrom = "";
  let lastFollowedTo = "";

  async function refresh(): Promise<void> {
    const gen = ++generation;
    errorEl.hidden = true;
    errorEl.textContent = "";

    if (!account) {
      loading.setLoading(false);
      resultsEl.replaceChildren();
      return;
    }

    loading.setLoading(true);

    const { from, to } = effectiveDates();
    if (followFilterDate) {
      lastFollowedFrom = from;
      lastFollowedTo = to;
    }
    const dated = hasDateRange(from, to);

    try {
      const params: { account: string; date_from?: string; date_to?: string } = { account };
      if (dated) {
        if (from) params.date_from = from;
        if (to) params.date_to = to;
      }
      const data = await fetchAccountPeriodStats(params, signal);
      if (gen !== generation || signal.aborted) return;
      renderResults(data, dated);
    } catch (err) {
      if (gen !== generation || signal.aborted) return;
      resultsEl.replaceChildren();
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : "加载失败";
    } finally {
      if (gen === generation) loading.setLoading(false);
    }
  }

  const unsub = store.subscribeFilter(() => {
    if (!followFilterDate || !account) return;
    const { dateFrom, dateTo } = store.getFilterSnapshot();
    if (dateFrom === lastFollowedFrom && dateTo === lastFollowedTo) return;
    loading.setLoading(true);
    void refresh();
  });

  syncFollowUi();

  function dispose(): void {
    generation++;
    unsub();
    followSwitch.dispose();
    kindSelect.dispose();
    accountSelect.dispose();
    datePicker.dispose();
    loading.dispose();
    signal.removeEventListener("abort", onAbort);
    root.remove();
  }

  const onAbort = () => dispose();
  signal.addEventListener("abort", onAbort);

  return dispose;
}
