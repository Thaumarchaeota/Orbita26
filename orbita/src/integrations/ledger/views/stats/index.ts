import { fetchEntries } from "../../api/client";
import { accountDisplayLabel, getAccountRecords } from "../../state/accounts";
import { getDetailEntries } from "../../state/ledger";
import { normalizeEntry } from "../../domain/entry";
import type { Entry } from "../../types";
import { escapeHtml } from "../../utils";
import { aggregateByCategory, aggregateMonthExpenses } from "./aggregate";

function buildLabelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of getAccountRecords("expenses")) {
    map.set(item.name, accountDisplayLabel(item));
  }
  return map;
}

function renderStats(panel: HTMLElement, monthTotal: number, top: ReturnType<typeof aggregateByCategory>): void {
  const rows =
    top.length === 0
      ? '<p class="stats-empty">本月暂无支出记录</p>'
      : top
          .map(
            (row) =>
              `<div class="stats-row">
                <span class="stats-row-label">${escapeHtml(row.label)}</span>
                <span class="stats-row-amount">${row.total.toFixed(2)}</span>
              </div>`,
          )
          .join("");

  panel.innerHTML = `
    <div class="stats-view">
      <div class="stats-summary">
        <div class="stats-summary-label">本月支出</div>
        <div class="stats-summary-amount">${monthTotal.toFixed(2)}</div>
      </div>
      <div class="stats-section">
        <h2 class="stats-section-title">分类 Top 10</h2>
        <div class="stats-list">${rows}</div>
      </div>
    </div>`;
}

async function loadEntries(): Promise<Entry[]> {
  const cached = getDetailEntries();
  if (cached.length > 0) return cached;
  const data = await fetchEntries();
  return (data.entries || []).map(normalizeEntry);
}

export function mountStatsView(panel: HTMLElement): () => void {
  panel.innerHTML = `<div class="stats-view stats-loading">加载中…</div>`;
  const ac = new AbortController();

  void (async () => {
    try {
      const entries = await loadEntries();
      if (ac.signal.aborted) return;
      const labelMap = buildLabelMap();
      const monthTotal = aggregateMonthExpenses(entries);
      const top = aggregateByCategory(entries, labelMap);
      renderStats(panel, monthTotal, top);
    } catch {
      if (!ac.signal.aborted) {
        panel.innerHTML = `<div class="stats-view stats-error">加载统计失败</div>`;
      }
    }
  })();

  return () => ac.abort();
}
