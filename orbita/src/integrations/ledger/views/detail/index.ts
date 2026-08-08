import type { LedgerRouter } from "../../shell";
import { onDetailMutated } from "../../state/ledger";
import { mountEntryFormDetail } from "../form/entry-form-detail";
import { initDetailDrag } from "./drag";
import { initDetailEditing } from "./edit";
import { applyDetailFilters, initDetailFilters } from "./filters";
import { initDetailList } from "./list";
import { initSaveUI, recomputeSaveUI } from "./save";

export function mountDetailView(panel: HTMLElement, router: LedgerRouter): () => void {
  const ac = new AbortController();
  let firstEnterDone = false;

  panel.innerHTML = `
    <div class="detail-layout">
      <div class="detail-main">
        <div class="detail-toolbar">
          <button type="button" class="detail-toolbar-back" id="detail-toolbar-back" aria-label="返回">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
          <div class="detail-toolbar-filters">
            <input type="date" id="filter-from" class="detail-filter-date" aria-label="起始日期">
            <span class="detail-filter-sep">—</span>
            <input type="date" id="filter-to" class="detail-filter-date" aria-label="截止日期">
            <div class="type-filters">
              <button type="button" class="type-filter type-filter-expense" data-type="expense">支出</button>
              <button type="button" class="type-filter type-filter-income" data-type="income">收入</button>
              <button type="button" class="type-filter type-filter-transfer" data-type="transfer">转账</button>
              <button type="button" class="type-filter type-filter-inv" data-type="inv">投资</button>
            </div>
          </div>
        </div>
        <div id="detail-list" class="detail-list"></div>
      </div>
      <aside class="detail-entry-sidebar">
        <div class="entry-form-panel" id="detail-form-mount"></div>
        <div class="save-btn-dock">
          <button type="button" id="save-btn" class="save-btn save-unedited" disabled>保存</button>
        </div>
      </aside>
    </div>`;

  panel.querySelector("#detail-toolbar-back")!.addEventListener(
    "click",
    () => router.back(),
    { signal: ac.signal },
  );

  function onDetailFirstEnter(): void {
    if (firstEnterDone) return;
    firstEnterDone = true;
    initDetailList();
    initDetailDrag(ac);
    initDetailEditing(ac);
  }

  initDetailFilters(() => applyDetailFilters());
  initSaveUI(ac);

  const formMount = panel.querySelector<HTMLElement>("#detail-form-mount")!;
  const unmountForm = mountEntryFormDetail(formMount, () => {
    applyDetailFilters();
    recomputeSaveUI();
  });

  const unsubMutated = onDetailMutated(() => {
    applyDetailFilters();
    recomputeSaveUI();
  });

  onDetailFirstEnter();
  applyDetailFilters();
  recomputeSaveUI();

  return () => {
    unsubMutated();
    unmountForm();
    ac.abort();
  };
}
