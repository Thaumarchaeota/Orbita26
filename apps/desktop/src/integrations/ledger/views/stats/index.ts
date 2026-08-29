import { fetchStats } from "../../api/client";
import { accountDisplayLabel, getAccountRecords } from "../../state/accounts";
import type { LedgerRouter, LedgerViewHandle } from "../../shell";
import type { AccountStats, CategoryExpenseStat } from "../../types";
import { escapeHtml } from "../../utils";
import { mountFinancePage } from "../../ui/page-shell";

function buildAssetLabelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of ["assets", "liabilities"] as const) {
    for (const item of getAccountRecords(key)) {
      map.set(item.name, accountDisplayLabel(item));
    }
  }
  return map;
}

function buildExpenseLabelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of getAccountRecords("expenses")) {
    map.set(item.name, accountDisplayLabel(item));
  }
  return map;
}

function buildIncomeLabelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of getAccountRecords("income")) {
    map.set(item.name, accountDisplayLabel(item));
  }
  return map;
}

function formatBalance(account: AccountStats): string {
  if (account.balances.length === 0) return "0";
  return account.balances
    .map((b) => `${b.amount} ${b.currency}`)
    .join(" / ");
}

function assertionLabel(status: AccountStats["assertion_status"]): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  return "";
}

function renderStats(
  bodyEl: HTMLElement,
  monthExpenseTotal: number,
  expenseTop: Array<CategoryExpenseStat & { label: string }>,
  monthIncomeTotal: number,
  incomeTop: Array<CategoryExpenseStat & { label: string }>,
  accounts: Array<AccountStats & { label: string }>,
  currency: string,
): void {
  const expenseRows =
    expenseTop.length === 0
      ? '<p class="stats-empty">本月暂无支出记录</p>'
      : expenseTop
          .map(
            (row) =>
              `<div class="stats-row">
                <span class="stats-row-label">${escapeHtml(row.label)}</span>
                <span class="stats-row-amount">${row.total.toFixed(2)}</span>
              </div>`,
          )
          .join("");

  const incomeRows =
    incomeTop.length === 0
      ? '<p class="stats-empty">本月暂无收入记录</p>'
      : incomeTop
          .map(
            (row) =>
              `<div class="stats-row">
                <span class="stats-row-label">${escapeHtml(row.label)}</span>
                <span class="stats-row-amount">${row.total.toFixed(2)}</span>
              </div>`,
          )
          .join("");

  const balanceRows =
    accounts.length === 0
      ? '<p class="stats-empty">暂无资产/负债账户</p>'
      : accounts
          .map((row) => {
            const mark = assertionLabel(row.assertion_status);
            const markClass =
              row.assertion_status === "fail"
                ? "stats-assert-fail"
                : row.assertion_status === "pass"
                  ? "stats-assert-pass"
                  : "";
            return `<div class="stats-row">
                <span class="stats-row-label">${escapeHtml(row.label)}${mark ? `<span class="stats-assert ${markClass}">${mark}</span>` : ""}</span>
                <span class="stats-row-amount">${escapeHtml(formatBalance(row))}</span>
              </div>`;
          })
          .join("");

  bodyEl.innerHTML = `
    <div class="stats-view">
      <div class="stats-summary">
        <div class="stats-summary-label">本月支出 (${escapeHtml(currency)})</div>
        <div class="stats-summary-amount">${monthExpenseTotal.toFixed(2)}</div>
      </div>
      <div class="stats-summary">
        <div class="stats-summary-label">本月收入 (${escapeHtml(currency)})</div>
        <div class="stats-summary-amount">${monthIncomeTotal.toFixed(2)}</div>
      </div>
      <div class="stats-section">
        <h2 class="stats-section-title">账户余额</h2>
        <div class="stats-list">${balanceRows}</div>
      </div>
      <div class="stats-section">
        <h2 class="stats-section-title">支出 Top 10</h2>
        <div class="stats-list">${expenseRows}</div>
      </div>
      <div class="stats-section">
        <h2 class="stats-section-title">收入 Top 10</h2>
        <div class="stats-list">${incomeRows}</div>
      </div>
    </div>`;
}

/** 统计子页：顶栏 ← 回 Dashboard */
export function mountStatsView(panel: HTMLElement, router: LedgerRouter): LedgerViewHandle {
  const page = mountFinancePage(panel, {
    title: "资产·统计",
    showBack: true,
    onBack: () => router.back(),
    renderBody(bodyEl) {
      const ac = new AbortController();

      bodyEl.innerHTML = `<div class="stats-view stats-loading">加载中…</div>`;

      void (async () => {
        try {
          const data = await fetchStats(ac.signal);
          if (ac.signal.aborted) return;
          if (!data.ok) {
            bodyEl.innerHTML = `<div class="stats-view stats-error">${escapeHtml(data.error || "加载统计失败")}</div>`;
            return;
          }
          const assetLabels = buildAssetLabelMap();
          const expenseLabels = buildExpenseLabelMap();
          const incomeLabels = buildIncomeLabelMap();
          const currency = data.reporting_currency || "CNY";
          const accounts = (data.accounts || [])
            .filter((a) => a.balances.length > 0 || a.assertion_status !== "none")
            .map((a) => ({
              ...a,
              label: assetLabels.get(a.account) || a.account.split(":").pop() || a.account,
            }));
          const expenseTop = (data.month_expenses_by_category || []).map((row) => ({
            ...row,
            label: expenseLabels.get(row.account) || row.account.split(":").pop() || row.account,
          }));
          const incomeTop = (data.month_income_by_category || []).map((row) => ({
            ...row,
            label: incomeLabels.get(row.account) || row.account.split(":").pop() || row.account,
          }));
          renderStats(
            bodyEl,
            data.month_expenses_total || 0,
            expenseTop,
            data.month_income_total || 0,
            incomeTop,
            accounts,
            currency,
          );
        } catch {
          if (!ac.signal.aborted) {
            bodyEl.innerHTML = `<div class="stats-view stats-error">加载统计失败</div>`;
          }
        }
      })();

      return () => ac.abort();
    },
  });

  return {
    getScrollEl: () => page.getScrollEl(),
    dispose() {
      page.unmount();
    },
  };
}
