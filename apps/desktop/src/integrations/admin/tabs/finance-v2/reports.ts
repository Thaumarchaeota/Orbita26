import type { FinanceV2Backend, IsolatedFinanceSession } from "../../../finance-v2/types";
import { el, section, setStatus, statusNode } from "./dom";

export function mountReports(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession): { dispose(): void } {
  const block = section("原币报表", "收支、实际结算额和余额依据分开呈现；未知余额保留未知，不换算币种。");
  const status = statusNode();
  const transactionsTable = table("当前账本投影");
  const balanceTable = table("余额与校准基准");
  const incomeTable = table("收支投影");
  const settlementTable = table("实际收付原币");
  const deltaTable = table("校准差额");
  block.append(transactionsTable.root, balanceTable.root, incomeTable.root, settlementTable.root, deltaTable.root, status); root.append(block);
  let disposed = false;
  void backend.loadReports(session).then((report) => {
    if (disposed) return;
    if (report.generation !== session.generation) throw new Error("报表与当前隔离会话 generation 不一致，请重新载入");
    fill(transactionsTable.body, report.transactions.map((item) => [item.businessDate, item.title || "—", item.notes || "—",
      item.postings.map((posting) => `${JSON.stringify(posting.account)} · ${posting.quantity.amount} ${posting.quantity.commodity}${posting.totalPrice ? ` · 价格 ${posting.totalPrice.amount} ${posting.totalPrice.commodity}` : ""}`).join("\n")]));
    fill(balanceTable.body, report.dailyBalances.map((item) => [item.date, item.accountId, item.amount == null ? "未知" : `${item.amount} ${item.commodity}`, item.basis, item.calibrationPointIds.join(", ") || "—"]));
    fill(incomeTable.body, report.incomeExpenseTotals.map((item) => [item.date, item.accountId, item.kind, `${item.quantity.amount} ${item.quantity.commodity}`]));
    fill(settlementTable.body, report.settlementTotals.map((item) => [item.date, item.accountId, item.kind, `${item.quantity.amount} ${item.quantity.commodity}`]));
    fill(deltaTable.body, report.calibrationDeltas.map((item) => [item.effectiveDate, item.beanBalanceDate, item.accountId, `${item.amount.amount} ${item.amount.commodity}`, `${item.expectedBefore.amount} ${item.expectedBefore.commodity}`, `${item.observed.amount} ${item.observed.commodity}`]));
    setStatus(status, `同一账本 generation ${report.generation}。`, "success");
  }).catch((error) => setStatus(status, errorText(error), "error"));
  return { dispose() { disposed = true; root.replaceChildren(); } };
}

function table(title: string): { root: HTMLElement; body: HTMLElement } {
  const block = section(title);
  const table = el("table", "finance-v2-table");
  const body = el("tbody"); table.append(body); block.append(table);
  return { root: block, body };
}
function fill(body: HTMLElement, rows: string[][]): void {
  body.replaceChildren();
  for (const values of rows) { const row = el("tr"); for (const value of values) row.append(el("td", "", value)); body.append(row); }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
