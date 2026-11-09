import { mountDecoupledDatePicker, type DecoupledDatePickerHandle } from "../../../ui/decoupled-date-picker";
import { mountPopoverPortal } from "../../../ui/popover-portal";
import { mountDecoupledTimePicker, type DecoupledTimePickerHandle } from "../../../ui/decoupled-time-picker";
import { normalizeHhMm } from "../../../ui/time-picker";
import { buildValidatedPatch } from "../domain/field-validate";
import { displayTxnTime, normalizeTimeInput, validateTxnTimeInput } from "../domain/txn-time";
import type { Entry } from "../types";
import type { CardDetailStore } from "./types";

export type TxnDateTimePopoverHandle = {
  commit: () => boolean;
  cancel: () => void;
  dispose: () => void;
};

function findEntry(store: CardDetailStore, id: string): Entry | undefined {
  const item = store.getSnapshot().items.find((e) => e.id === id);
  if (!item || item.kind === "pad" || item.kind === "balance") return undefined;
  return item as Entry;
}

function readTimePickerRaw(timePicker: DecoupledTimePickerHandle): string {
  return timePicker.getValue();
}

export function mountTxnDateTimePopover(options: {
  anchor: HTMLElement;
  entryId: string;
  store: CardDetailStore;
  signal: AbortSignal;
  onCommitted: () => void;
}): TxnDateTimePopoverHandle {
  const { anchor, entryId, store, signal, onCommitted } = options;
  const entry = findEntry(store, entryId);
  if (!entry) {
    return { commit: () => true, cancel: () => {}, dispose: () => {} };
  }

  const panel = document.createElement("div");
  panel.className = "cds-datetime-popover motion-popover scroll-slim";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "编辑日期与时间");

  const dateRow = document.createElement("div");
  dateRow.className = "cds-datetime-popover-row";
  const dateLabel = document.createElement("span");
  dateLabel.className = "cds-datetime-popover-label";
  dateLabel.textContent = "日期";
  const dateMount = document.createElement("div");
  dateMount.className = "cds-datetime-popover-date-mount";
  const datePicker: DecoupledDatePickerHandle = mountDecoupledDatePicker({ defaultTrigger: { container: dateMount },
    value: entry.date,
  });
  dateRow.append(dateLabel, dateMount);

  const timeRow = document.createElement("div");
  timeRow.className = "cds-datetime-popover-row";
  const timeLabel = document.createElement("span");
  timeLabel.className = "cds-datetime-popover-label";
  timeLabel.textContent = "时间";
  const timeMount = document.createElement("div");
  timeMount.className = "cds-datetime-popover-time-mount";
  const timePicker = mountDecoupledTimePicker({ defaultTrigger: { container: timeMount },
    value: displayTxnTime(entry.metadata, entry.date),
  });
  timeRow.append(timeLabel, timeMount);

  const errorEl = document.createElement("p");
  errorEl.className = "cds-datetime-popover-error";
  errorEl.hidden = true;

  panel.append(dateRow, timeRow, errorEl);

  const portal = mountPopoverPortal({
    anchor,
    popover: panel,
    onOpenChange: (open) => {
      anchor.classList.toggle("is-datetime-open", open);
    },
  });

  let disposed = false;

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  };

  const closePortal = async (): Promise<void> => {
    await portal.close();
    anchor.classList.remove("is-datetime-open");
  };

  const commit = (): boolean => {
    if (disposed) return true;
    const current = findEntry(store, entryId);
    if (!current) return true;

    const dateVal = datePicker.getValue().trim();
    if (!dateVal) {
      showError("请选择日期");
      return false;
    }

    const raw = readTimePickerRaw(timePicker);
    const normalized = normalizeHhMm(raw);
    const timeVal = normalized || (raw ? normalizeTimeInput(raw) : "");
    const timeErr = validateTxnTimeInput(timeVal);
    if (timeErr) {
      showError(timeErr);
      return false;
    }

    showError("");

    if (current.date !== dateVal) {
      const datePatch = buildValidatedPatch(current, "date", dateVal, 0);
      if ("error" in datePatch) {
        showError(datePatch.error);
        return false;
      }
      store.dispatch({ type: "update-entry", id: entryId, patch: datePatch.patch });
    }

    const afterDate = findEntry(store, entryId);
    if (!afterDate) return true;

    const timePatch = buildValidatedPatch(afterDate, "time", timeVal, 0);
    if ("error" in timePatch) {
      showError(timePatch.error);
      return false;
    }
    store.dispatch({ type: "update-entry", id: entryId, patch: timePatch.patch });
    onCommitted();
    void closePortal();
    return true;
  };

  const cancel = (): void => {
    showError("");
    void closePortal();
  };

  const onFieldKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      // The shared picker otherwise normalizes/reverts invalid draft text before
      // Finance can report its field-level validation error.
      e.stopImmediatePropagation();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
  timeMount.addEventListener("keydown", onFieldKeydown, { capture: true, signal });

  void portal.open();

  return {
    commit,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      datePicker.dispose();
      timePicker.dispose();
      portal.dispose();
      anchor.classList.remove("is-datetime-open");
    },
  };
}
