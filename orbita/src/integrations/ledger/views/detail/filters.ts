import { mountDatePicker, type DatePickerHandle } from "../../../../ui/date-picker";
import { isTransactionItem } from "../../domain/detail-item";
import { sortDetailEntries } from "../../domain/seq";
import { getDetailEntries, getDetailItems } from "../../state/ledger";
import type { DetailItem, EntryType } from "../../types";

export type DetailFiltersHandle = {
  getSelectedTypes: () => ReadonlySet<EntryType>;
  getFilteredItems: () => DetailItem[];
  getFilteredEntries: () => DetailItem[];
  refresh: () => void;
  reset: () => void;
  dispose: () => void;
};

/**
 * Filter state belongs to the cached DetailSurface instance.
 */

export function mountDetailFilters(
  root: HTMLElement,
  onFilterChange: () => void,
): DetailFiltersHandle {
  const lifecycle = new AbortController();
  const selectedTypes = new Set<EntryType>();
  let from = "";
  let to = "";
  let fromPicker: DatePickerHandle | null = null;
  let toPicker: DatePickerHandle | null = null;

  const typeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-detail-type]"));
  const syncTypeButtons = () => {
    for (const button of typeButtons) {
      button.classList.toggle("active", selectedTypes.has(button.dataset.detailType as EntryType));
    }
  };
  const getFilteredItems = (): DetailItem[] => {
    let items = getDetailItems();
    if (from) items = items.filter((item) => item.date >= from);
    if (to) items = items.filter((item) => item.date <= to);
    if (selectedTypes.size) {
      items = items.filter(
        (item) => isTransactionItem(item) && selectedTypes.has(item.type),
      );
    }
    return items;
  };
  const refresh = () => {
    sortDetailEntries(getDetailEntries());
    onFilterChange();
  };
  const notifyChange = () => onFilterChange();

  const fromMount = root.querySelector<HTMLElement>("[data-detail-filter-from-mount]");
  const toMount = root.querySelector<HTMLElement>("[data-detail-filter-to-mount]");
  if (fromMount) {
    fromPicker = mountDatePicker(fromMount, {
      compact: true,
      placeholder: "起始日期",
      onChange: (value) => {
        from = value;
        notifyChange();
      },
    });
  }
  if (toMount) {
    toPicker = mountDatePicker(toMount, {
      compact: true,
      placeholder: "截止日期",
      onChange: (value) => {
        to = value;
        notifyChange();
      },
    });
  }
  for (const button of typeButtons) {
    button.addEventListener(
      "click",
      () => {
        const type = button.dataset.detailType as EntryType;
        if (selectedTypes.has(type)) selectedTypes.delete(type);
        else selectedTypes.add(type);
        syncTypeButtons();
        notifyChange();
      },
      { signal: lifecycle.signal },
    );
  }

  const handle: DetailFiltersHandle = {
    getSelectedTypes: () => selectedTypes,
    getFilteredItems,
    getFilteredEntries: () => getFilteredItems().filter(isTransactionItem),
    refresh,
    reset: () => {
      selectedTypes.clear();
      from = "";
      to = "";
      fromPicker?.setValue("");
      toPicker?.setValue("");
      syncTypeButtons();
      notifyChange();
    },
    dispose: () => {
      lifecycle.abort();
      void fromPicker?.close();
      void toPicker?.close();
    },
  };
  return handle;
}
