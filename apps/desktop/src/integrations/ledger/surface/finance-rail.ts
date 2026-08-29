import type { MotionTrigger } from "../../../ui/motion";
import type { CardDetailStore } from "./types";
import { mountFinanceRailAdd } from "./finance-rail-add";
import { mountFinanceRailAudit } from "./finance-rail-audit";
import "./finance-rail.css";

export type FinanceRailOptions = {
  store: CardDetailStore;
  renderFilters?: (filterRoot: HTMLElement) => void;
  onImport: (trigger?: MotionTrigger) => void;
  onAddEntry: (trigger?: MotionTrigger) => void;
};

export function mountFinanceRail(
  container: HTMLElement,
  signal: AbortSignal,
  options: FinanceRailOptions,
): { dispose: () => void; getScrollEl: () => HTMLElement } {
  const { store, renderFilters, onImport, onAddEntry } = options;

  const scroll = document.createElement("div");
  scroll.className = "finance-rail-scroll";
  scroll.setAttribute("data-role", "finance-rail-scroll");

  const filterMount = document.createElement("div");
  filterMount.className = "finance-rail-filter-mount";
  filterMount.setAttribute("data-role", "finance-rail-filter-mount");

  const addMount = document.createElement("div");
  addMount.className = "finance-rail-add-mount";
  addMount.setAttribute("data-role", "finance-rail-add-mount");

  const auditMount = document.createElement("div");
  auditMount.className = "finance-rail-audit";
  auditMount.setAttribute("data-role", "balance-audit-mount");

  scroll.append(filterMount, addMount, auditMount);
  container.replaceChildren(scroll);

  renderFilters?.(filterMount);

  const disposeAdd = mountFinanceRailAdd(addMount, signal, { onImport, onAddEntry });
  const disposeAudit = mountFinanceRailAudit(auditMount, signal, store);

  const onAbort = () => container.replaceChildren();
  signal.addEventListener("abort", onAbort);

  return {
    getScrollEl: () => scroll,
    dispose: () => {
      signal.removeEventListener("abort", onAbort);
      disposeAdd();
      disposeAudit();
      container.replaceChildren();
    },
  };
}
