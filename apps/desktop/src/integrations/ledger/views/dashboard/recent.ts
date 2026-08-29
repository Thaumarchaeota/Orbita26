import { TYPE_LABELS } from "../../constants";
import { isActiveEntry } from "../../domain/entry";
import { getDetailEntries } from "../../state/ledger";
import type { Entry } from "../../types";
import { escapeHtml } from "../../utils";

const RECENT_COUNT = 5;

function recentDesc(entry: Entry): string {
  return entry.payee || entry.remark || TYPE_LABELS[entry.type] || "—";
}

function recentAmount(entry: Entry): string {
  const p = entry.postings[0];
  if (!p) return "—";
  const cur = p.currency || "";
  const amt = p.amount;
  if (entry.type === "expense") return `-${amt} ${cur}`.trim();
  if (entry.type === "income") return `+${amt} ${cur}`.trim();
  return `${amt} ${cur}`.trim();
}

export function renderRecentTransactions(listEl: HTMLElement): void {
  const rows = getDetailEntries().filter(isActiveEntry).slice(0, RECENT_COUNT);
  if (!rows.length) {
    listEl.innerHTML =
      '<div class="dashboard-recent-row"><span class="dashboard-recent-date">—</span><span class="dashboard-recent-desc">暂无数据</span><span class="dashboard-recent-amount">—</span></div>';
    return;
  }
  listEl.innerHTML = rows
    .map(
      (e) =>
        `<div class="dashboard-recent-row"><span class="dashboard-recent-date">${escapeHtml(e.date)}</span><span class="dashboard-recent-desc">${escapeHtml(recentDesc(e))}</span><span class="dashboard-recent-amount">${escapeHtml(recentAmount(e))}</span></div>`,
    )
    .join("");
}
