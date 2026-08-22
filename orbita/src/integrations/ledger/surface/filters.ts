import { mountDatePicker, type DatePickerHandle } from "../../../ui/date-picker";
import { mountPopoverPortal } from "../../../ui/popover-portal";
import { ALL_FILTERABLE_STRIPE_KINDS } from "./filter-kinds";
import type { FilterableStripeKind } from "./filter-kinds";
import { isFilterableStripeKind } from "./filter-kinds";
import type { CardDetailStore } from "./types";

export type CardDetailFiltersHandle = {
  closePopovers: () => Promise<void>;
  dispose: () => void;
};

function syncTypeFilterUi(
  typeRoot: HTMLElement,
  panel: HTMLElement,
  types: ReadonlySet<FilterableStripeKind>,
): void {
  const showAll = !types.size || types.size >= ALL_FILTERABLE_STRIPE_KINDS.length;
  for (const option of panel.querySelectorAll<HTMLButtonElement>(".finance-type-filter-option")) {
    const stripe = option.dataset.detailType;
    const selected = showAll || (stripe && isFilterableStripeKind(stripe) && types.has(stripe));
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
  const label = typeRoot.querySelector<HTMLElement>(".finance-type-filter-label");
  if (label) {
    if (showAll) label.textContent = "类型 · 全部";
    else label.textContent = `类型 · ${types.size} 项`;
  }
}

function mountTypeFilterPopover(
  root: HTMLElement,
  store: CardDetailStore,
  onChange: () => void,
): { dispose: () => void; close: () => Promise<void> } {
  const trigger = root.querySelector<HTMLButtonElement>(".finance-type-filter-trigger");
  const panel = root.querySelector<HTMLElement>(".finance-type-filter-panel");
  if (!trigger || !panel) return { dispose: () => {}, close: async () => {} };

  const portal = mountPopoverPortal({
    anchor: trigger,
    popover: panel,
    onOpenChange: (open) => {
      trigger.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", String(open));
    },
  });

  trigger.addEventListener("click", () => {
    if (portal.isOpen()) void portal.close();
    else void portal.open();
  });

  for (const option of panel.querySelectorAll<HTMLButtonElement>(".finance-type-filter-option")) {
    option.addEventListener("click", () => {
      const stripe = option.dataset.detailType;
      if (!stripe || !isFilterableStripeKind(stripe)) return;
      store.dispatch({ type: "toggle-type", stripeKind: stripe });
      onChange();
    });
  }

  return { dispose: () => portal.dispose(), close: () => portal.close() };
}

export function mountCardDetailFilters(
  root: HTMLElement,
  store: CardDetailStore,
  onChange: () => void,
): CardDetailFiltersHandle {
  const disposers: Array<() => void> = [];
  const pickers: DatePickerHandle[] = [];

  const syncFromStore = (): void => {
    const { filter } = store.getSnapshot();
    if (typeRoot && typePanel) syncTypeFilterUi(typeRoot, typePanel, filter.types);
    fromPicker?.setValue(filter.dateFrom);
    toPicker?.setValue(filter.dateTo);
    const clearBtn = root.querySelector<HTMLButtonElement>("[data-role='detail-filter-clear']");
    if (clearBtn) {
      const hasFilter =
        !!filter.dateFrom ||
        !!filter.dateTo ||
        (filter.types.size > 0 && filter.types.size < ALL_FILTERABLE_STRIPE_KINDS.length);
      clearBtn.hidden = !hasFilter;
    }
  };

  let fromPicker: DatePickerHandle | null = null;
  let toPicker: DatePickerHandle | null = null;
  let typeRoot: HTMLElement | null = null;
  let typePanel: HTMLElement | null = null;

  const unsub = store.subscribe(syncFromStore);

  const fromMount = root.querySelector<HTMLElement>("[data-detail-filter-from-mount]");
  const toMount = root.querySelector<HTMLElement>("[data-detail-filter-to-mount]");

  if (fromMount) {
    fromPicker = mountDatePicker(fromMount, {
      compact: true,
      placeholder: "起始日期",
      onChange: (value) => {
        store.dispatch({ type: "set-date-from", value });
        onChange();
      },
    });
    pickers.push(fromPicker);
    disposers.push(() => fromPicker!.dispose());
  }

  if (toMount) {
    toPicker = mountDatePicker(toMount, {
      compact: true,
      placeholder: "截止日期",
      onChange: (value) => {
        store.dispatch({ type: "set-date-to", value });
        onChange();
      },
    });
    pickers.push(toPicker);
    disposers.push(() => toPicker!.dispose());
  }

  typeRoot = root.querySelector<HTMLElement>("[data-role='detail-type-filter']");
  if (typeRoot) {
    typePanel = typeRoot.querySelector<HTMLElement>(".finance-type-filter-panel");
  }
  const typePopover = typeRoot ? mountTypeFilterPopover(typeRoot, store, onChange) : null;
  if (typePopover) disposers.push(() => typePopover.dispose());

  const clearBtn = root.querySelector<HTMLButtonElement>("[data-role='detail-filter-clear']");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      store.dispatch({ type: "reset-filters" });
      onChange();
    });
  }

  const filterSection =
    root.closest<HTMLElement>(".finance-chrome-filter-narrow") ??
    root.closest<HTMLElement>(".finance-chrome-filter");
  if (filterSection) {
    const observer = new MutationObserver(() => {
      if (!filterSection.classList.contains("is-open")) void closePopovers();
    });
    observer.observe(filterSection, { attributes: true, attributeFilter: ["class"] });
    disposers.push(() => observer.disconnect());
  }

  syncFromStore();

  async function closePopovers(): Promise<void> {
    await Promise.all([
      ...pickers.map((picker) => picker.close()),
      typePopover?.close() ?? Promise.resolve(),
    ]);
  }

  return {
    closePopovers,
    dispose: () => {
      unsub();
      for (const dispose of disposers) dispose();
    },
  };
}
