/**

 * detail-surface：虚拟列表挂载点与滚动根（v0.0.17-spec.md §3.1）。

 * #detail-list is a stable CSS/test selector created by this instance; Finance

 * Shell only uses the handle for scroll and refresh, never this internal DOM.

 */

import { getDetailItems, onDetailMutated } from "../../state/ledger";

import {

  collectValidationMarkedEntryIds,

  resolveValidationFocusEntryId,

} from "../../domain/validation-errors";

import type { CandidateDiagnostic, Entry, ValidateError } from "../../types";

import { mountDetailEditing } from "./edit";

import { createDetailVirtualList } from "./list";

import type { DetailFiltersHandle } from "./filters";

import { updateEntryBalanceBadgeInList } from "./render";



export type DetailSurfaceHandle = {

  listEl: HTMLElement;

  getScrollEl: () => HTMLElement;

  refresh: () => void;

  setFilters: (filters: DetailFiltersHandle) => void;

  applyFilters: () => void;

  resetFilters: () => void;

  scrollToEntry: (id: string) => void;

  animateCommitRemovals: (ids: string[]) => Promise<void>;

  commitEdit: () => void;

  updateEntryBalanceBadge: (id: string, postingsOverride?: Entry["postings"]) => void;

  showValidationErrors: (errors: ValidateError[] | CandidateDiagnostic[]) => void;

  dispose: () => void;

};



export type DetailSurfaceOptions = {

  /** Lets the current filter adapter run before the legacy virtual-list paint. */

  refresh?: () => void;

};



export function mountDetailSurface(

  container: HTMLElement,

  options: DetailSurfaceOptions = {},

): DetailSurfaceHandle {

  const listEl = document.createElement("div");

  // TODO(v0.0.17 detail migration): remove once list/edit accept this handle.

  listEl.id = "detail-list";

  listEl.className = "detail-list detail-surface";

  listEl.setAttribute("role", "list");

  container.replaceChildren(listEl);

  let filters: DetailFiltersHandle | null = null;

  const expandedCosts = new Set<string>();

  const virtualList = createDetailVirtualList(listEl, {

    getItems: () => filters?.getFilteredItems() ?? getDetailItems(),

    expandedCosts: () => expandedCosts,

  });

  const editing = mountDetailEditing(listEl, {

    applyFilters: () => filters?.refresh() ?? refresh(),

    recompute: () => options.refresh?.(),

    updateBalance: (id, postings) => updateEntryBalanceBadgeInList(listEl, id, postings),

    expandedCosts,

  });



  let disposed = false;

  const refresh = () => {

    if (disposed) return;

    options.refresh?.();

    virtualList.refresh();

  };

  const applyFilters = () => filters?.refresh() ?? refresh();

  const resetFilters = () => filters?.reset();

  const unsubscribe = onDetailMutated(refresh);

  const showValidationErrors = (errors: ValidateError[] | CandidateDiagnostic[]) => {

    const marked = new Set(collectValidationMarkedEntryIds(errors));

    const cards = Array.from(listEl.querySelectorAll<HTMLElement>(".detail-card"));

    for (const card of cards) {

      card.classList.toggle("field-error-block", marked.has(card.dataset.entryId ?? ""));

    }

    const focusId = errors.length ? resolveValidationFocusEntryId(errors[0]!) : null;

    if (!focusId) return;

    cards.find((card) => card.dataset.entryId === focusId)?.scrollIntoView({

      behavior: "smooth",

      block: "nearest",

    });

  };

  const updateEntryBalanceBadge = (

    id: string,

    postingsOverride?: Entry["postings"],

  ) => {

    if (disposed) return;

    updateEntryBalanceBadgeInList(listEl, id, postingsOverride);

  };



  return {

    listEl,

    getScrollEl: () => listEl,

    refresh,

    setFilters: (next) => { filters = next; refresh(); },

    applyFilters,

    resetFilters,

    scrollToEntry: virtualList.scrollToEntry,

    animateCommitRemovals: virtualList.animateCommitRemovals,

    commitEdit: editing.commitEdit,

    updateEntryBalanceBadge,

    showValidationErrors,

    dispose: () => {

      if (disposed) return;

      disposed = true;

      unsubscribe();

      editing.dispose();

      virtualList.dispose();

      container.replaceChildren();

    },

  };

}

