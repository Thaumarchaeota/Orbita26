import { REMARK_MAX_LENGTH } from "../constants";
import { buildValidatedPatch } from "../domain/field-validate";
import { displayTxnTime, normalizeTimeInput } from "../domain/txn-time";
import { getAllAccountList } from "../state/accounts";
import type { EntryFieldPatch } from "../state/ledger-store";
import type { Entry } from "../types";
import { formatTags, parseTagsString } from "../utils";
import { mountTxnDateTimePopover, type TxnDateTimePopoverHandle } from "./cds-datetime-popover";
import {
  getTagsFromBox,
  initTagInput,
  setTagsInBox,
} from "./cds-tag-input";
import { patchInlineTags } from "./render-cards";
import type { CardDetailStore } from "./types";

type EditableField =
  | "date"
  | "datetime"
  | "flag"
  | "time"
  | "remark"
  | "payee"
  | "tags"
  | "type"
  | "account"
  | "amount"
  | "currency"
  | "cost_amount"
  | "cost_currency";

type ActiveEdit = {
  el: HTMLElement;
  input: HTMLInputElement | HTMLSelectElement;
  field: EditableField;
  id: string;
  postingIndex: number;
  tagBox?: HTMLElement;
};

export type CdsEditingHandle = {
  commitEdit: () => void;
  cancelEdit: () => void;
  dispose: () => void;
};

export function createTxnTimeInput(value = "", className = "cds-edit-input"): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "time";
  input.step = "60";
  input.value = value;
  input.className = className;
  return input;
}

function fieldRaw(field: EditableField, entry: Entry, pi: number): string {
  switch (field) {
    case "date":
      return entry.date;
    case "payee":
      return entry.payee;
    case "remark":
      return entry.remark;
    case "type":
      return entry.type;
    case "flag":
      return entry.flag || "*";
    case "time":
    case "datetime":
      return displayTxnTime(entry.metadata, entry.date);
    case "tags":
      return entry.tags;
    case "account":
      return entry.postings[pi]?.account ?? "";
    case "amount":
      return entry.postings[pi]?.amount != null ? String(entry.postings[pi]!.amount) : "";
    case "currency":
      return entry.postings[pi]?.currency ?? "";
    case "cost_amount":
      return entry.postings[pi]?.cost_amount != null ? String(entry.postings[pi]!.cost_amount) : "";
    case "cost_currency":
      return entry.postings[pi]?.cost_currency ?? "";
    default:
      return "";
  }
}

function fieldDisplay(field: EditableField, entry: Entry, pi: number): string {
  const raw = fieldRaw(field, entry, pi);
  if (field === "tags" && !raw.trim()) return "";
  return raw;
}

function isPlaceholder(field: EditableField, entry: Entry, pi: number): boolean {
  if (field === "time" || field === "datetime") return false;
  return !fieldDisplay(field, entry, pi).trim();
}

function fillSelect(el: HTMLSelectElement, items: string[], selected: string): void {
  el.replaceChildren(
    ...items.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === selected;
      return option;
    }),
  );
}

function findEntryInSnapshot(store: CardDetailStore, id: string): Entry | undefined {
  const item = store.getSnapshot().items.find((e) => e.id === id);
  if (!item || item.kind === "pad" || item.kind === "balance") return undefined;
  return item as Entry;
}

function restoreTagsDisplay(el: HTMLElement, entry: Entry | undefined): void {
  el.classList.remove("is-editing");
  if (!entry) {
    el.replaceChildren();
    return;
  }
  patchInlineTags(el, fieldDisplay("tags", entry, 0));
}

function applyTimeDisplay(el: HTMLElement, entry: Entry | undefined): void {
  const text = entry ? displayTxnTime(entry.metadata, entry.date) : "";
  el.replaceChildren();
  if (text) {
    el.textContent = text;
    el.classList.remove("is-ghost", "is-empty");
  } else {
    el.classList.add("is-empty", "is-ghost");
    el.setAttribute("data-ghost-label", "时间");
    el.setAttribute("aria-label", "时间");
  }
}

export function mountCdsEditing(
  scrollRoot: HTMLElement,
  store: CardDetailStore,
): CdsEditingHandle {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  let activeEdit: ActiveEdit | null = null;
  let activeDateTime: TxnDateTimePopoverHandle | null = null;
  let disposed = false;

  function closeDateTimePopover(): void {
    activeDateTime?.dispose();
    activeDateTime = null;
  }

  function commitDateTimeEdit(): boolean {
    if (!activeDateTime) return true;
    const ok = activeDateTime.commit();
    if (ok) {
      activeDateTime.dispose();
      activeDateTime = null;
    }
    return ok;
  }

  function openDateTimeEdit(el: HTMLElement, id: string): void {
    if (disposed) return;
    const phase = store.getSnapshot().savePhase;
    if (phase === "checking" || phase === "submitting") return;
    const entry = findEntryInSnapshot(store, id);
    if (!entry || entry._deleted) return;
    cancelEdit();
    closeDateTimePopover();
    clearFieldError(el);

    activeDateTime = mountTxnDateTimePopover({
      anchor: el,
      entryId: id,
      store,
      signal,
      onCommitted: () => {
        applyTimeDisplay(el, findEntryInSnapshot(store, id));
        clearFieldError(el);
      },
    });
  }

  function cancelEdit(): void {
    closeDateTimePopover();
    const edit = activeEdit;
    if (!edit) return;
    const entry = findEntryInSnapshot(store, edit.id);
    if (edit.field === "tags") {
      restoreTagsDisplay(edit.el, entry);
      activeEdit = null;
      return;
    }
    if (entry) {
      const text = fieldDisplay(edit.field, entry, edit.postingIndex);
      edit.el.textContent = text;
      edit.el.classList.toggle("is-ghost", isPlaceholder(edit.field, entry, edit.postingIndex));
    }
    edit.el.classList.remove("is-editing");
    activeEdit = null;
  }

  function showFieldError(el: HTMLElement, message: string): void {
    el.classList.add("is-field-err");
    el.title = message;
  }

  function clearFieldError(el: HTMLElement): void {
    el.classList.remove("is-field-err");
    el.removeAttribute("title");
  }

  function editValue(edit: ActiveEdit): string {
    if (edit.field === "tags" && edit.tagBox) {
      return formatTags(getTagsFromBox(edit.tagBox));
    }
    return edit.input.value;
  }

  function buildPatch(edit: ActiveEdit, value: string): EntryFieldPatch | { error: string } | null {
    const entry = findEntryInSnapshot(store, edit.id);
    if (!entry) return null;
    if (edit.field === "remark") {
      return buildValidatedPatch(entry, edit.field, value.slice(0, REMARK_MAX_LENGTH), edit.postingIndex);
    }
    return buildValidatedPatch(entry, edit.field, value, edit.postingIndex);
  }

  function restoreFieldDisplay(edit: ActiveEdit): void {
    const entry = findEntryInSnapshot(store, edit.id);
    if (edit.field === "tags") {
      restoreTagsDisplay(edit.el, entry);
      return;
    }
    edit.el.classList.remove("is-editing");
    edit.el.replaceChildren();
    if (!entry) return;
    const text = fieldDisplay(edit.field, entry, edit.postingIndex);
    if (text) edit.el.textContent = text;
    edit.el.classList.toggle("is-ghost", isPlaceholder(edit.field, entry, edit.postingIndex));
  }

  function commitEdit(): void {
    if (activeDateTime) return;
    const edit = activeEdit;
    if (!edit) return;
    if (edit.field === "tags" && edit.el.querySelector(".ledger-tag-chip-edit")) return;
    const result = buildPatch(edit, editValue(edit));
    if (!result) {
      activeEdit = null;
      restoreFieldDisplay(edit);
      return;
    }
    if ("error" in result) {
      showFieldError(edit.el, result.error);
      edit.input.focus();
      return;
    }
    clearFieldError(edit.el);
    activeEdit = null;
    store.dispatch({ type: "update-entry", id: edit.id, patch: result.patch });
    restoreFieldDisplay(edit);
  }

  function startEdit(
    el: HTMLElement,
    field: EditableField,
    id: string,
    postingIndex: number,
  ): void {
    if (disposed) return;
    const phase = store.getSnapshot().savePhase;
    if (phase === "checking" || phase === "submitting") return;
    const entry = findEntryInSnapshot(store, id);
    if (!entry || entry._deleted) return;
    cancelEdit();
    closeDateTimePopover();

    const raw = fieldRaw(field, entry, postingIndex);

    if (field === "tags") {
      const box = document.createElement("div");
      box.className = "ledger-tag-box cds-inline-tag-edit";
      const tagField = document.createElement("input");
      tagField.type = "text";
      tagField.className = "ledger-tag-field";
      tagField.placeholder = "回车添加";
      box.appendChild(tagField);
      el.replaceChildren(box);
      el.classList.remove("is-ghost");
      el.classList.add("is-editing");
      clearFieldError(el);
      setTagsInBox(box, tagField, parseTagsString(raw), {
        chipClass: "ledger-tag-chip cds-tag-chip",
      });
      initTagInput(tagField, box, signal, { chipClass: "ledger-tag-chip cds-tag-chip" });
      tagField.focus();
      activeEdit = { el, input: tagField, field, id, postingIndex, tagBox: box };
      return;
    }

    let input: HTMLInputElement | HTMLSelectElement;

    if (field === "type") {
      const select = document.createElement("select");
      select.className = "cds-edit-input";
      for (const [val, label] of [
        ["expense", "支出"],
        ["income", "收入"],
        ["transfer", "转账"],
        ["", "未分类"],
      ] as const) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if (val === raw) opt.selected = true;
        select.appendChild(opt);
      }
      input = select;
    } else if (field === "flag") {
      const select = document.createElement("select");
      select.className = "cds-edit-input";
      for (const val of ["*", "!", "?"]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        if (val === raw) opt.selected = true;
        select.appendChild(opt);
      }
      input = select;
    } else if (field === "account") {
      const select = document.createElement("select");
      select.className = "cds-edit-input";
      fillSelect(select, getAllAccountList(), raw);
      input = select;
    } else {
      const text = document.createElement("input");
      text.type = field === "amount" || field === "cost_amount" ? "number" : "text";
      text.className = "cds-edit-input";
      text.value = raw;
      if (field === "remark") text.maxLength = REMARK_MAX_LENGTH;
      input = text;
    }

    el.replaceChildren(input);
    el.classList.remove("is-ghost", "is-empty");
    el.classList.add("is-editing");
    clearFieldError(el);
    activeEdit = { el, input, field, id, postingIndex };
    input.focus();
    if (input instanceof HTMLInputElement) input.select();

    input.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitEdit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelEdit();
        }
      },
      { signal },
    );
  }

  scrollRoot.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement;
      const deleteBtn = target.closest<HTMLButtonElement>("[data-role='delete-btn']");
      if (deleteBtn && !deleteBtn.disabled) {
        const wrap = deleteBtn.closest<HTMLElement>(".cds-card-wrap");
        const id = wrap?.dataset.itemId;
        if (!id) return;
        e.preventDefault();
        commitDateTimeEdit();
        commitEdit();
        if (deleteBtn.classList.contains("is-undo")) {
          store.dispatch({ type: "undo-delete", id });
        } else {
          store.dispatch({ type: "soft-delete", id });
        }
        return;
      }

      const fieldEl = target.closest<HTMLElement>("[data-editable]");
      if (!fieldEl || fieldEl.classList.contains("is-editing")) return;
      const wrap = fieldEl.closest<HTMLElement>(".cds-card-wrap");
      if (!wrap || wrap.classList.contains("is-readonly")) return;
      const id = wrap.dataset.itemId;
      if (!id) return;
      const field = fieldEl.dataset.editable as EditableField | undefined;
      if (!field) return;
      const pi = Number(fieldEl.dataset.postingIndex ?? "0");
      e.preventDefault();
      if (field === "datetime") {
        openDateTimeEdit(fieldEl, id);
        return;
      }
      startEdit(fieldEl, field, id, pi);
    },
    { signal },
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!activeEdit && !activeDateTime) return;
      const t = e.target as Node;
      if (activeEdit?.el.contains(t)) return;
      if (t instanceof Element && t.closest(".cds-datetime-popover")) return;
      if (activeDateTime) {
        if (!commitDateTimeEdit()) {
          e.stopImmediatePropagation();
          return;
        }
      }
      commitEdit();
    },
    { signal, capture: true },
  );

  return {
    commitEdit,
    cancelEdit,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelEdit();
      closeDateTimePopover();
      lifecycle.abort();
    },
  };
}
