import { sortDetailEntries } from "../../domain/seq";
import { getDetailEntries } from "../../state/ledger";
import type { EntryType } from "../../types";
import { paintDetailList } from "./list";

let selectedTypes = new Set<EntryType>();

export function getSelectedTypes(): Set<EntryType> {
  return selectedTypes;
}

export function dragEnabled(): boolean {
  return selectedTypes.size === 0;
}

export function getFilteredEntries() {
  let entries = getDetailEntries();
  const from = document.querySelector<HTMLInputElement>("#filter-from")?.value;
  const to = document.querySelector<HTMLInputElement>("#filter-to")?.value;
  if (from) entries = entries.filter((e) => e.date >= from);
  if (to) entries = entries.filter((e) => e.date <= to);
  if (selectedTypes.size > 0) {
    entries = entries.filter((e) => selectedTypes.has(e.type));
  }
  return entries;
}

export function applyDetailFilters(): void {
  sortDetailEntries(getDetailEntries());
  paintDetailList();
}

export function initDetailFilters(onFilterChange: () => void): void {
  const fromEl = document.querySelector<HTMLInputElement>("#filter-from");
  const toEl = document.querySelector<HTMLInputElement>("#filter-to");
  fromEl?.addEventListener("change", onFilterChange);
  toEl?.addEventListener("change", onFilterChange);
  document.querySelectorAll<HTMLButtonElement>(".type-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.type as EntryType;
      if (selectedTypes.has(t)) {
        selectedTypes.delete(t);
        btn.classList.remove("active");
      } else {
        selectedTypes.add(t);
        btn.classList.add("active");
      }
      onFilterChange();
    });
  });
}
