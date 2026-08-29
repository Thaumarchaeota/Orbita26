/**

 * Finance Detail — CardDetailSurface with Phase C controlled interactions.

 * See docs/plans/v0.0.17-closeout.md §4.2.

 */

import type { LedgerRouter, LedgerViewHandle } from "../../shell";

import { onDetailMutated, onSavePhaseChanged } from "../../state/ledger";

import { mountSaveChrome, mountDiscardChrome, showSaveSuccess, type SaveChromeHandle, type DiscardChromeHandle } from "../../ui/chrome";
import { getConfirmDialog } from "../../../shell/dialog";

import { mountCardDetailSurface } from "../../surface/card-detail-surface";

import { mountFinanceDetailShell } from "../../surface/finance-detail-shell";

import { mountFinanceRailFilter } from "../../surface/finance-rail-filter";

import { mountFinanceRail } from "../../surface/finance-rail";

import { mountFinanceSearch } from "../../surface/finance-search";

import { createLedgerCardStore } from "../../surface/ledger-card-store";

import { mountCdsCsvModal } from "../../surface/cds-csv-modal";

import { mountComposerModal } from "../../surface/composer-modal";

import type { CsvImportOrder } from "../import/csv";

import type { Transaction } from "../../domain/ledger-item";



export function mountDetailView(panel: HTMLElement, router: LedgerRouter): LedgerViewHandle {

  const ac = new AbortController();

  let surface: ReturnType<typeof mountCardDetailSurface> | null = null;

  let filterDispose: (() => void) | null = null;

  let rail: ReturnType<typeof mountFinanceRail> | null = null;

  let search: ReturnType<typeof mountFinanceSearch> | null = null;

  let saveChrome: SaveChromeHandle | null = null;
  let discardChrome: DiscardChromeHandle | null = null;



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



  const composerModal = mountComposerModal(ac, store);



  const shell = mountFinanceDetailShell(panel, {

    title: "资产·明细",

    onBack: () => router.back(),

    renderBody: (el) => {

      surface = mountCardDetailSurface(el, {

        store,

        onAddEntry: (date, trigger) => composerModal.open(trigger, date),

      });

    },

    renderRail: (railMount) => {

      rail = mountFinanceRail(railMount, ac.signal, {

        store,

        onImport: (trigger) => importModal.open(trigger),

        onAddEntry: (trigger) => composerModal.open(trigger),

        renderFilters: (filterRoot) => {

          filterDispose = mountFinanceRailFilter(filterRoot, store, ac.signal);

        },

      });

    },

  });



  search = mountFinanceSearch(

    shell.searchHost,

    shell.titleBtn,

    {

      getFilteredItems: () => store.getSnapshot().items,

      onHighlightChange: (highlight) => surface?.setSearchHighlight(highlight),

      onNavigate: (id) => surface?.focusItem(id),

      subscribeItems: (listener) => store.subscribeRendered(listener),

    },

    ac.signal,

  );



  saveChrome = mountSaveChrome(shell.saveBtn, () => store.handleSave(), ac.signal);

  discardChrome = mountDiscardChrome(shell.discardAllBtn, async () => {
    const ok = await getConfirmDialog()(
      "撤销全部",
      "是否确认撤销所有未保存的更改？",
      shell.discardAllBtn,
      { confirmLabel: "撤销全部", danger: true },
    );
    if (!ok) return;
    if (store.revertAllEdits()) recomputeSaveChrome();
  }, ac.signal);



  function recomputeSaveChrome(): void {

    saveChrome?.recompute();
    discardChrome?.recompute();

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

      composerModal.dispose();

      filterDispose?.();

      search?.dispose();

      surface?.dispose();

      rail?.dispose();

      store.dispose();

      shell.dispose();

      ac.abort();

    },

  };

}
