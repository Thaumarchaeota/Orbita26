/**

 * Finance Detail — CardDetailSurface with Phase C controlled interactions.

 * See docs/plans/v0.0.17-finance-ui-execution.md §6 阶段 C.

 */

import type { LedgerRouter, LedgerViewHandle } from "../../shell";

import { onDetailMutated, onSavePhaseChanged } from "../../state/ledger";

import { mountSaveChrome, showSaveSuccess, type SaveChromeHandle } from "../../ui/chrome";

import { mountCardDetailSurface } from "../../surface/card-detail-surface";

import { mountCardDetailFilters } from "../../surface/filters";

import { mountFinanceDetailShell } from "../../surface/finance-detail-shell";

import { mountFinanceRail } from "../../surface/finance-rail";

import { createLedgerCardStore } from "../../surface/ledger-card-store";

import { mountCdsCsvModal } from "../../surface/cds-csv-modal";

import type { CsvImportOrder } from "../import/csv";

import type { Transaction } from "../../domain/ledger-item";



export function mountDetailView(panel: HTMLElement, router: LedgerRouter): LedgerViewHandle {

  const ac = new AbortController();

  let surface: ReturnType<typeof mountCardDetailSurface> | null = null;

  let filters: ReturnType<typeof mountCardDetailFilters> | null = null;

  let rail: ReturnType<typeof mountFinanceRail> | null = null;

  let saveChrome: SaveChromeHandle | null = null;



  const store = createLedgerCardStore({
    shake: async () => {
      await saveChrome?.shake();
    },
    onBeforeReload: (removedIds) => {
      void surface?.animateCommitRemovals(removedIds);
    },
    onCommitSuccess: async () => {
      if (saveChrome) await showSaveSuccess(saveChrome);
    },
  });



  const importModal = mountCdsCsvModal(ac, {

    resetFilters: () => store.dispatch({ type: "reset-filters" }),

    scrollToEntry: (id) => surface?.focusItem(id),

    onMerge: (drafts: Transaction[], orderMode: CsvImportOrder) => {

      store.dispatch({ type: "merge-csv", drafts, orderMode });

      return store.consumeMergeFocus();

    },

  });



  const shell = mountFinanceDetailShell(panel, {

    title: "资产·明细",

    onBack: () => router.back(),

    onImport: (e) => importModal.open(e),

    renderFilter: (filterRoot) => {

      filters = mountCardDetailFilters(filterRoot, store, () => surface?.refresh());

    },

    renderBody: (el) => {

      surface = mountCardDetailSurface(el, { store });

    },

    renderRail: (railMount) => {

      rail = mountFinanceRail(railMount, ac.signal, store);

    },

  });



  saveChrome = mountSaveChrome(shell.saveBtn, () => store.handleSave(), ac.signal);



  function recomputeSaveChrome(): void {

    saveChrome?.recompute();

  }



  const unsubDirty = onDetailMutated(recomputeSaveChrome);

  const unsubPhase = onSavePhaseChanged(recomputeSaveChrome);

  recomputeSaveChrome();



  store.onAfterCommit?.(() => {

    store.dispatch({ type: "reset-filters" });

    recomputeSaveChrome();

  });



  return {

    getScrollEl: () =>

      surface?.getScrollTargets().primary ?? rail?.getScrollEl() ?? shell.getScrollEl(),

    openImport: (trigger) => importModal.open(trigger),

    dispose() {

      unsubDirty();

      unsubPhase();

      importModal.dispose();

      filters?.dispose();

      surface?.dispose();

      rail?.dispose();

      store.dispose();

      shell.dispose();

      ac.abort();

    },

  };

}


