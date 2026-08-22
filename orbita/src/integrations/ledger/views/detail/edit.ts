import { REMARK_MAX_LENGTH, TYPE_LABELS } from "../../constants";
import { applyEntryDeleteButton } from "../../domain/entry-visual";
import { previewEntryBalance } from "../../domain/balance";
import { hasPostingCost, postingCostKey } from "../../domain/entry";
import { nextSeqForDate } from "../../domain/seq";
import { getAllAccountList } from "../../state/accounts";
import { getDetailEntries, notifyWorkCopyEdited, softDeleteEntry, touchWorkCopy, undoDeleteEntry } from "../../state/ledger";
import type { Entry } from "../../types";
import { formatTags } from "../../utils";
import { entryVisualState, fieldDisplay, fieldRaw, findEntry, isPlaceholder } from "./render";

type ActiveEdit = { el: HTMLElement; input: HTMLInputElement | HTMLSelectElement; field: string; id: string; postingIndex: number };
export type DetailEditingHandle = { cancelEdit: () => void; commitEdit: () => void; dispose: () => void };

function fillSelect(el: HTMLSelectElement, items: string[], selected: string): void {
  el.replaceChildren(...items.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === selected;
    return option;
  }));
}

import { createTagChip, removeTagChip } from "../../surface/cds-tag-input";
export function mountDetailEditing(
  listEl: HTMLElement,
  options: { applyFilters: () => void; recompute: () => void; updateBalance: (id: string, postings?: Entry["postings"]) => void; expandedCosts: Set<string> },
): DetailEditingHandle {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  let activeEdit: ActiveEdit | null = null;
  let disposed = false;

  function notifyChange(options?: { visualOnly?: boolean; entryId?: string }): void {
    if (options?.visualOnly && options.entryId) {
      notifyWorkCopyEdited();
      updateEntryBlockVisual(options.entryId);
      options.recompute();
      return;
    }
    touchWorkCopy();
    options.applyFilters();
    options.recompute();
  }

  function cancelEdit(): void {
    const edit = activeEdit;
    if (!edit) return;
    const entry = findEntry(edit.id);
    if (entry) {
      edit.el.textContent = fieldDisplay(edit.field, entry, edit.postingIndex);
      edit.el.classList.toggle("is-placeholder", isPlaceholder(edit.field, entry, edit.postingIndex));
    }
    edit.el.classList.remove("editing");
    activeEdit = null;
    options.updateBalance(edit.id);
  }

  function commitEdit(): void {
    const edit = activeEdit;
    if (!edit) return;
    const entry = findEntry(edit.id);
    if (!entry) {
      cancelEdit();
      return;
    }
    const value = edit.input.value;
    switch (edit.field) {
      case "date":
        if (entry.date !== value) {
          entry.date = value;
          entry.seq = nextSeqForDate(getDetailEntries(), value, entry.id);
        }
        edit.el.textContent = fieldDisplay(edit.field, entry, edit.postingIndex);
        edit.el.classList.remove("editing");
        activeEdit = null;
        notifyChange();
        return;
      case "payee": entry.payee = value; break;
      case "remark": entry.remark = value.slice(0, REMARK_MAX_LENGTH); break;
      case "type": entry.type = value as Entry["type"]; edit.el.className = `editable type-badge type-${entry.type}`; break;
      case "flag": entry.flag = value; break;
      case "tags": entry.tags = value; break;
      case "account": entry.postings[edit.postingIndex].account = value; edit.el.title = value; break;
      case "amount": entry.postings[edit.postingIndex].amount = parseFloat(value) || 0; break;
      case "currency": entry.postings[edit.postingIndex].currency = value; break;
      case "cost_amount": entry.postings[edit.postingIndex].cost_amount = value.trim() ? parseFloat(value) || 0 : null; break;
      case "cost_currency": entry.postings[edit.postingIndex].cost_currency = value.trim(); break;
    }
    edit.el.textContent = fieldDisplay(edit.field, entry, edit.postingIndex);
    edit.el.classList.toggle("is-placeholder", isPlaceholder(edit.field, entry, edit.postingIndex));
    edit.el.classList.remove("editing");
    activeEdit = null;
    notifyChange({ visualOnly: true, entryId: edit.id });
  }

  function previewBalance(id: string, field: string, postingIndex: number, value: string): void {
    const entry = findEntry(id);
    if (!entry || postingIndex < 0) return;
    previewEntryBalance(entry, field, postingIndex, value);
    const postings = entry.postings.map((posting, index) => {
      if (index !== postingIndex) return { ...posting };
      const copy = { ...posting };
      if (field === "amount") copy.amount = parseFloat(value) || 0;
      else if (field === "currency") copy.currency = value;
      else if (field === "cost_amount") copy.cost_amount = value.trim() ? parseFloat(value) || 0 : null;
      else if (field === "cost_currency") copy.cost_currency = value.trim();
      else if (field === "account") copy.account = value;
      return copy;
    });
    options.updateBalance(id, postings);
  }

  function startEdit(el: HTMLElement): void {
    const field = el.dataset.field ?? "";
    const id = el.dataset.id ?? "";
    const postingIndex = el.dataset.posting === undefined ? -1 : parseInt(el.dataset.posting, 10);
    const entry = findEntry(id);
    if (!entry) return;
    let input: HTMLInputElement | HTMLSelectElement;
    if (field === "type" || field === "flag" || field === "account") {
      input = document.createElement("select");
      if (field === "type") {
        for (const [key, label] of Object.entries(TYPE_LABELS)) {
          const option = document.createElement("option"); option.value = key; option.textContent = label; option.selected = entry.type === key; input.appendChild(option);
        }
      } else if (field === "flag") fillSelect(input, ["*", "!", "?"], entry.flag || "*");
      else {
        const current = fieldRaw(field, entry, postingIndex);
        const accounts = getAllAccountList();
        fillSelect(input, current && !accounts.includes(current) ? [current, ...accounts] : accounts, current);
      }
    } else {
      input = document.createElement("input");
      input.type = field === "date" ? "date" : field === "amount" || field === "cost_amount" ? "number" : "text";
      if (input.type === "number") input.step = "0.01";
      input.value = field === "date" ? entry.date : fieldRaw(field, entry, postingIndex);
      if (field === "remark") input.maxLength = REMARK_MAX_LENGTH;
    }
    input.className = "editable-input";
    el.classList.add("editing");
    el.classList.remove("is-placeholder");
    el.replaceChildren(input);
    input.focus();
    if (input instanceof HTMLInputElement && (input.type === "text" || input.type === "number")) input.select();
    activeEdit = { el, input, field, id, postingIndex };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
      if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
    }, { signal });
    if (["amount", "currency", "cost_amount", "cost_currency", "account"].includes(field) && postingIndex >= 0) {
      const onBalanceInput = () => previewBalance(id, field, postingIndex, input.value);
      input.addEventListener("input", onBalanceInput, { signal });
      input.addEventListener("change", onBalanceInput, { signal });
    }
  }

  function syncEntryWrapState(id: string): void {
    const entry = findEntry(id);
    const wrap = listEl.querySelector<HTMLElement>(`.detail-card-wrap[data-entry-id="${id}"]`);
    if (!entry || !wrap) return;
    wrap.dataset.date = entry.date;
  }

  function updateEntryBlockVisual(id: string): void {
    const entry = findEntry(id);
    const block = listEl.querySelector<HTMLElement>(`.detail-card[data-entry-id="${id}"]`);
    if (!entry || !block) return;
    const visual = entryVisualState(entry);
    const next = new Set<string>();
    if (visual === "deleted") next.add("detail-card-deleted");
    else if (visual === "new") next.add("detail-card-new");
    else if (visual === "modified") next.add("detail-card-modified");
    const changed = [...["detail-card-deleted", "detail-card-new", "detail-card-modified"]].some((name) => block.classList.contains(name) !== next.has(name));
    block.classList.remove("detail-card-deleted", "detail-card-new", "detail-card-modified");
    next.forEach((name) => block.classList.add(name));
    if (changed) { block.classList.remove("detail-card-state-animate"); void block.offsetWidth; block.classList.add("detail-card-state-animate"); }
    options.updateBalance(id);
    const deleteButton = block.querySelector<HTMLButtonElement>(".detail-card-delete-btn");
    if (deleteButton) applyEntryDeleteButton(deleteButton, !!entry._deleted);
    syncEntryWrapState(id);
  }

  function togglePostingCostPanel(toggle: HTMLElement): void {
    const id = toggle.dataset.id ?? "";
    const postingIndex = parseInt(toggle.dataset.posting ?? "", 10);
    const entry = findEntry(id);
    const panel = toggle.closest(".posting-line")?.querySelector<HTMLElement>(".posting-cost-panel");
    if (!entry || !panel || Number.isNaN(postingIndex)) return;
    const expanded = options.expandedCosts;
    const key = postingCostKey(id, postingIndex);
    if (expanded.has(key)) {
      expanded.delete(key); panel.classList.remove("is-open"); toggle.classList.remove("is-open"); toggle.textContent = "+";
      if (!hasPostingCost(entry.postings[postingIndex])) { entry.postings[postingIndex].cost_amount = null; entry.postings[postingIndex].cost_currency = ""; }
      notifyChange({ visualOnly: true, entryId: id });
    } else { expanded.add(key); panel.classList.add("is-open"); toggle.classList.add("is-open"); toggle.textContent = "−"; }
    options.updateBalance(id);
  }

  function syncTagsFromBox(box: HTMLElement): void {
    const entry = findEntry(box.dataset.entryId ?? "");
    if (!entry) return;
    entry.tags = formatTags([...box.querySelectorAll<HTMLElement>(".tag-chip")].map((chip) => chip.textContent || ""));
    notifyChange({ visualOnly: true, entryId: entry.id });
  }

  listEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const costToggle = target.closest<HTMLElement>(".posting-cost-toggle");
    if (costToggle) { if (activeEdit) commitEdit(); togglePostingCostPanel(costToggle); return; }
    const deleteButton = target.closest<HTMLElement>(".detail-card-delete-btn");
    if (deleteButton) {
      activeEdit = null;
      const id = deleteButton.dataset.id ?? "";
      const entry = findEntry(id);
      if (!entry) return;
      if (entry._deleted) undoDeleteEntry(id, { notify: false }); else softDeleteEntry(id, { notify: false });
      notifyChange({ visualOnly: true, entryId: id });
      return;
    }
    const editable = target.closest<HTMLElement>(".editable");
    if (!editable || !listEl.contains(editable) || activeEdit?.el === editable) return;
    if (activeEdit) commitEdit();
    startEdit(editable);
  }, { signal });

  listEl.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("entry-tag-input")) return;
    const box = target.closest<HTMLElement>(".detail-card-tags");
    if (!box || !listEl.contains(box)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const value = (target as HTMLInputElement).value.trim().replace(/^#/, "");
      if (!value) return;
      const existing = [...box.querySelectorAll<HTMLElement>(".tag-chip")].map((chip) => chip.textContent || "");
      if (!existing.includes(value)) {
        box.insertBefore(
          createTagChip(value, { chipClass: "tag-chip", onChange: () => syncTagsFromBox(box) }),
          target,
        );
        syncTagsFromBox(box);
      }
      (target as HTMLInputElement).value = "";
    } else if (event.key === "Backspace" && !(target as HTMLInputElement).value) {
      const chips = box.querySelectorAll<HTMLElement>(".tag-chip");
      const last = chips[chips.length - 1];
      if (last) removeTagChip(last, () => syncTagsFromBox(box));
    }
  }, { signal });

  document.addEventListener("mousedown", (event) => {
    const edit = activeEdit;
    if (!edit) return;
    const target = event.target as Node;
    if (edit.el.contains(target)) return;
    const element = event.target as HTMLElement;
    if (element.closest(".ledger-entry-form, .detail-card-tags, .posting-cost-toggle")) return;
    commitEdit();
  }, { signal });

  const handle: DetailEditingHandle = {
    cancelEdit,
    commitEdit,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelEdit();
      lifecycle.abort();
    },
  };
  return handle;
}
