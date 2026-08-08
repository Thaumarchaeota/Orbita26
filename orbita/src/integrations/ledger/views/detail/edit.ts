import { REMARK_MAX_LENGTH, TYPE_LABELS } from "../../constants";
import { previewEntryBalance } from "../../domain/balance";
import { hasPostingCost, postingCostKey } from "../../domain/entry";
import { nextSeqForDate } from "../../domain/seq";
import { getAllAccountList } from "../../state/accounts";
import {
  getDetailEntries,
  softDeleteEntry,
  undoDeleteEntry,
} from "../../state/ledger";
import type { Entry } from "../../types";
import { formatTags } from "../../utils";
import { applyDetailFilters } from "./filters";
import {
  canDragEntry,
  entryVisualState,
  fieldDisplay,
  fieldRaw,
  findEntry,
  getExpandedCostPanels,
  isPlaceholder,
  updateEntryBalanceBadge,
} from "./render";
import { recomputeSaveUI } from "./save";

type ActiveEdit = {
  el: HTMLElement;
  input: HTMLInputElement | HTMLSelectElement;
  field: string;
  id: string;
  postingIndex: number;
};

let activeEdit: ActiveEdit | null = null;

function fillSelect(el: HTMLSelectElement, items: string[], selected: string): void {
  el.innerHTML = "";
  for (const name of items) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

function createTagChip(text: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "tag-chip";
  chip.textContent = text;
  return chip;
}

function notifyChange(opts?: { visualOnly?: boolean; entryId?: string }): void {
  if (opts?.visualOnly && opts.entryId) {
    updateEntryBlockVisual(opts.entryId);
    recomputeSaveUI();
    return;
  }
  applyDetailFilters();
  recomputeSaveUI();
}

export function cancelEdit(): void {
  if (!activeEdit) return;
  const { el, field, id, postingIndex } = activeEdit;
  const entry = findEntry(id);
  if (entry) {
    el.textContent = fieldDisplay(field, entry, postingIndex);
    el.classList.toggle("is-placeholder", isPlaceholder(field, entry, postingIndex));
  }
  el.classList.remove("editing");
  activeEdit = null;
  updateEntryBalanceBadge(id);
}

export function commitEdit(): void {
  if (!activeEdit) return;
  const { el, input, field, id, postingIndex } = activeEdit;
  const entry = findEntry(id);
  if (!entry) {
    cancelEdit();
    return;
  }
  const value = input.value;
  switch (field) {
    case "date":
      if (entry.date !== value) {
        entry.date = value;
        entry.seq = nextSeqForDate(getDetailEntries(), value, entry.id);
      }
      el.textContent = fieldDisplay(field, entry, postingIndex);
      el.classList.remove("editing");
      activeEdit = null;
      notifyChange();
      return;
    case "payee":
      entry.payee = value;
      break;
    case "remark":
      entry.remark = value.slice(0, REMARK_MAX_LENGTH);
      break;
    case "type":
      entry.type = value as Entry["type"];
      el.className = `editable type-badge type-${entry.type}`;
      el.textContent = fieldDisplay(field, entry, postingIndex);
      el.classList.remove("editing");
      activeEdit = null;
      notifyChange();
      return;
    case "flag":
      entry.flag = value;
      break;
    case "tags":
      entry.tags = value;
      break;
    case "account":
      entry.postings[postingIndex].account = value;
      el.title = value;
      break;
    case "amount":
      entry.postings[postingIndex].amount = parseFloat(value) || 0;
      break;
    case "currency":
      entry.postings[postingIndex].currency = value;
      break;
    case "cost_amount":
      entry.postings[postingIndex].cost_amount = value.trim() ? parseFloat(value) || 0 : null;
      break;
    case "cost_currency":
      entry.postings[postingIndex].cost_currency = value.trim();
      break;
  }
  el.textContent = fieldDisplay(field, entry, postingIndex);
  el.classList.toggle("is-placeholder", isPlaceholder(field, entry, postingIndex));
  el.classList.remove("editing");
  activeEdit = null;
  notifyChange();
}

function previewBalance(id: string, field: string, postingIndex: number, value: string): void {
  const entry = findEntry(id);
  if (!entry || postingIndex < 0) return;
  previewEntryBalance(entry, field, postingIndex, value);
  const postings = entry.postings.map((p, i) => {
    if (i !== postingIndex) return { ...p };
    const copy = { ...p };
    if (field === "amount") copy.amount = parseFloat(value) || 0;
    else if (field === "currency") copy.currency = value;
    else if (field === "cost_amount")
      copy.cost_amount = String(value).trim() ? parseFloat(value) || 0 : null;
    else if (field === "cost_currency") copy.cost_currency = String(value).trim();
    else if (field === "account") copy.account = value;
    return copy;
  });
  updateEntryBalanceBadge(id, postings);
}

function startEdit(el: HTMLElement): void {
  const field = el.dataset.field!;
  const id = el.dataset.id!;
  const postingIndex =
    el.dataset.posting !== undefined ? parseInt(el.dataset.posting, 10) : -1;
  const entry = findEntry(id);
  if (!entry) return;

  let input: HTMLInputElement | HTMLSelectElement;
  if (field === "type") {
    input = document.createElement("select");
    for (const [k, v] of Object.entries(TYPE_LABELS)) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = v;
      if (entry.type === k) opt.selected = true;
      input.appendChild(opt);
    }
  } else if (field === "flag") {
    input = document.createElement("select");
    for (const f of ["*", "!", "?"]) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      if ((entry.flag || "*") === f) opt.selected = true;
      input.appendChild(opt);
    }
  } else if (field === "date") {
    input = document.createElement("input");
    input.type = "date";
    input.value = entry.date;
  } else if (field === "account") {
    input = document.createElement("select");
    const cur = fieldRaw(field, entry, postingIndex);
    const list =
      cur && !getAllAccountList().includes(cur) ? [cur, ...getAllAccountList()] : getAllAccountList();
    fillSelect(input, list, cur);
  } else if (field === "amount" || field === "cost_amount") {
    input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.value = fieldRaw(field, entry, postingIndex);
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = fieldRaw(field, entry, postingIndex);
    if (field === "remark") input.maxLength = REMARK_MAX_LENGTH;
  }

  input.className = "editable-input";
  el.classList.add("editing");
  el.classList.remove("is-placeholder");
  el.textContent = "";
  el.appendChild(input);
  input.focus();
  if (input instanceof HTMLInputElement && (input.type === "text" || input.type === "number"))
    input.select();

  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      commitEdit();
    }
    if ((e as KeyboardEvent).key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  });

  activeEdit = { el, input, field, id, postingIndex };

  const balanceFields = ["amount", "currency", "cost_amount", "cost_currency", "account"];
  if (balanceFields.includes(field) && postingIndex >= 0) {
    const onBalanceInput = () => previewBalance(id, field, postingIndex, input.value);
    input.addEventListener("input", onBalanceInput);
    input.addEventListener("change", onBalanceInput);
  }
}

export function updateEntryBlockVisual(id: string): void {
  const entry = findEntry(id);
  const block = document.querySelector<HTMLElement>(`.entry-block[data-entry-id="${id}"]`);
  if (!entry || !block) return;
  block.classList.remove("entry-deleted", "entry-new", "entry-modified");
  const visual = entryVisualState(entry);
  if (visual === "deleted") block.classList.add("entry-deleted");
  else if (visual === "new") block.classList.add("entry-new");
  else if (visual === "modified") block.classList.add("entry-modified");
  updateEntryBalanceBadge(id);
  const delBtn = block.querySelector<HTMLElement>(".entry-delete-btn");
  if (!delBtn) return;
  if (entry._deleted) {
    delBtn.classList.add("is-undo");
    delBtn.textContent = "撤销";
    delBtn.setAttribute("aria-label", "撤销");
  } else {
    delBtn.classList.remove("is-undo");
    delBtn.textContent = "✕";
    delBtn.setAttribute("aria-label", "删除");
  }
  syncEntryWrapDragState(id);
}

export function syncEntryWrapDragState(id: string): void {
  const entry = findEntry(id);
  const wrap = document.querySelector<HTMLElement>(`.entry-block-wrap[data-entry-id="${id}"]`);
  if (!entry || !wrap) return;
  wrap.dataset.date = entry.date;
  wrap.classList.toggle("is-undraggable", !canDragEntry(entry));
  const header = wrap.querySelector<HTMLElement>(".entry-block-header");
  if (!header) return;
  const handle = header.querySelector<HTMLElement>(".entry-drag-handle");
  if (canDragEntry(entry)) {
    if (!handle)
      header.insertAdjacentHTML(
        "afterbegin",
        '<span class="entry-drag-handle" aria-label="拖动排序">⋮⋮</span>',
      );
  } else {
    handle?.remove();
  }
}

function togglePostingCostPanel(toggle: HTMLElement): void {
  const expandedCostPanels = getExpandedCostPanels();
  const id = toggle.dataset.id!;
  const pi = parseInt(toggle.dataset.posting!, 10);
  const entry = findEntry(id);
  if (!entry) return;
  const key = postingCostKey(id, pi);
  const panel = toggle.closest(".posting-line")?.querySelector<HTMLElement>(".posting-cost-panel");
  if (!panel) return;
  if (expandedCostPanels.has(key)) {
    expandedCostPanels.delete(key);
    panel.classList.remove("is-open");
    toggle.classList.remove("is-open");
    toggle.textContent = "+";
    if (!hasPostingCost(entry.postings[pi])) {
      entry.postings[pi].cost_amount = null;
      entry.postings[pi].cost_currency = "";
    }
    notifyChange({ visualOnly: true, entryId: id });
  } else {
    expandedCostPanels.add(key);
    panel.classList.add("is-open");
    toggle.classList.add("is-open");
    toggle.textContent = "−";
  }
  updateEntryBalanceBadge(id);
}

function syncTagsFromBox(box: HTMLElement): void {
  const tags = [...box.querySelectorAll<HTMLElement>(".tag-chip")].map((c) => c.textContent || "");
  const entry = findEntry(box.dataset.entryId!);
  if (!entry) return;
  entry.tags = formatTags(tags);
  notifyChange();
}

export function initDetailEditing(ac: AbortController): void {
  const list = document.getElementById("detail-list");
  if (!list) return;
  const { signal } = ac;

  list.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as HTMLElement;
      const costToggle = target.closest<HTMLElement>(".posting-cost-toggle");
      if (costToggle) {
        if (activeEdit) commitEdit();
        togglePostingCostPanel(costToggle);
        return;
      }
      const delBtn = target.closest<HTMLElement>(".entry-delete-btn");
      if (delBtn) {
        activeEdit = null;
        const id = delBtn.dataset.id!;
        const entry = findEntry(id);
        if (!entry) return;
        if (entry._deleted) undoDeleteEntry(id);
        else softDeleteEntry(id);
        return;
      }
      const el = target.closest<HTMLElement>(".editable");
      if (!el) return;
      if (activeEdit?.el === el) return;
      if (activeEdit) commitEdit();
      startEdit(el);
    },
    { signal },
  );

  list.addEventListener(
    "keydown",
    (ev) => {
      const target = ev.target as HTMLElement;
      if (!target.classList.contains("entry-tag-input")) return;
      const box = target.closest<HTMLElement>(".entry-tags-box");
      if (!box) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        const v = (target as HTMLInputElement).value.trim().replace(/^#/, "");
        if (!v) return;
        const existing = [...box.querySelectorAll<HTMLElement>(".tag-chip")].map(
          (c) => c.textContent || "",
        );
        if (existing.includes(v)) {
          (target as HTMLInputElement).value = "";
          return;
        }
        box.insertBefore(createTagChip(v), target);
        (target as HTMLInputElement).value = "";
        syncTagsFromBox(box);
      }
      if (ev.key === "Backspace" && !(target as HTMLInputElement).value) {
        const chips = box.querySelectorAll(".tag-chip");
        if (chips.length) {
          chips[chips.length - 1].remove();
          syncTagsFromBox(box);
        }
      }
    },
    { signal },
  );

  document.addEventListener(
    "mousedown",
    (ev) => {
      if (!activeEdit) return;
      const target = ev.target as Node;
      if (activeEdit.el.contains(target)) return;
      if ((ev.target as HTMLElement).closest("#detail-entry-form")) return;
      if ((ev.target as HTMLElement).closest(".entry-tags-box")) return;
      if ((ev.target as HTMLElement).closest(".posting-cost-toggle")) return;
      commitEdit();
    },
    { signal },
  );
}
