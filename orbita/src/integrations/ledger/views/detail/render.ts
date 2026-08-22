import { validatePostingBalance } from "../../domain/balance";
import { hasPostingCost, normEntry, postingCostKey } from "../../domain/entry";
import { getBaseline, getDetailEntries } from "../../state/ledger";
import type { BalanceItem, Entry, PadItem } from "../../types";
import { escapeHtml, parseTagsString } from "../../utils";


export function findEntry(id: string): Entry | undefined {
  return getDetailEntries().find((e) => e.id === id);
}

export function entryVisualState(entry: Entry): "deleted" | "new" | "modified" | "unchanged" {
  if (entry._deleted) return "deleted";
  if (entry._is_new) return "new";
  const b = getBaseline().find((x) => x.id === entry.id);
  if (!b) return "new";
  if (JSON.stringify(normEntry(entry)) !== JSON.stringify(normEntry(b))) return "modified";
  return "unchanged";
}

export function isEntryBalanced(entry: Entry): boolean {
  return validatePostingBalance(entry.postings).ok;
}

export function fieldRaw(field: string, entry: Entry, pi: number): string {
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
    case "tags":
      return entry.tags;
    case "account":
      return entry.postings[pi].account;
    case "amount":
      return String(entry.postings[pi].amount);
    case "currency":
      return entry.postings[pi].currency;
    case "cost_amount":
      return entry.postings[pi].cost_amount != null ? String(entry.postings[pi].cost_amount) : "";
    case "cost_currency":
      return entry.postings[pi].cost_currency || "";
    default:
      return "";
  }
}

export function fieldDisplay(field: string, entry: Entry, pi: number): string {
  switch (field) {
    case "date":
      return entry.date;
    case "payee":
      return entry.payee || "收款人";
    case "remark":
      return entry.remark || "简记";
    case "type":
      return TYPE_LABELS[entry.type] || entry.type;
    case "flag":
      return entry.flag || "*";
    case "tags":
      return entry.tags || "标签";
    case "account":
      return entry.postings[pi].account;
    case "amount": {
      const a = entry.postings[pi].amount;
      return a === 0 ? "0" : String(a);
    }
    case "currency":
      return entry.postings[pi].currency || "—";
    case "cost_amount": {
      const c = entry.postings[pi].cost_amount;
      return c == null ? "成本" : String(c);
    }
    case "cost_currency":
      return entry.postings[pi].cost_currency || "币种";
    default:
      return "";
  }
}

export function isPlaceholder(field: string, entry: Entry, pi: number): boolean {
  const raw = fieldRaw(field, entry, pi);
  if (field === "payee" || field === "remark" || field === "tags") return !raw;
  if (field === "currency") return !entry.postings[pi].currency;
  if (field === "cost_amount") return entry.postings[pi].cost_amount == null;
  if (field === "cost_currency") return !entry.postings[pi].cost_currency;
  return false;
}

function editableSpan(id: string, field: string, entry: Entry, pi: number): string {
  const ph = isPlaceholder(field, entry, pi) ? " is-placeholder" : "";
  const piAttr = pi >= 0 ? ` data-posting="${pi}"` : "";
  const typeClass = field === "type" ? ` type-badge type-${entry.type}` : "";
  const fieldClass = field === "account" ? " posting-account-field" : "";
  const text = escapeHtml(fieldDisplay(field, entry, pi));
  const titleAttr =
    field === "account" && pi >= 0
      ? ` title="${escapeHtml(entry.postings[pi].account)}"`
      : "";
  return `<span class="editable${ph}${typeClass}${fieldClass}" data-id="${id}" data-field="${field}"${piAttr}${titleAttr}>${text}</span>`;
}

function renderBalanceBadge(entry: Entry): string {
  if (entry._deleted) return "";
  const ok = isEntryBalanced(entry);
  const cls = ok ? "detail-card-balance-badge is-ok" : "detail-card-balance-badge is-err";
  return `<span class="${cls}" data-balance-for="${entry.id}">${ok ? "✓" : "未配平"}</span>`;
}

/** Updates only the card owned by a DetailSurface; never reaches across views. */
export function updateEntryBalanceBadgeInList(
  listEl: HTMLElement,
  id: string,
  postingsOverride?: Entry["postings"],
): void {
  const entry = findEntry(id);
  const block = listEl.querySelector<HTMLElement>(`.detail-card[data-entry-id="${id}"]`);
  if (!block) return;
  let badge = block.querySelector<HTMLElement>(".detail-card-balance-badge");
  if (!entry || entry._deleted) {
    badge?.remove();
    return;
  }
  const postings = postingsOverride || entry.postings || [];
  const ok = validatePostingBalance(postings).ok;
  const cls = ok ? "detail-card-balance-badge is-ok" : "detail-card-balance-badge is-err";
  const label = ok ? "✓" : "未配平";
  if (!badge) {
    const typeEl = block.querySelector('.editable[data-field="type"]');
    if (!typeEl) return;
    badge = document.createElement("span");
    badge.className = cls;
    badge.dataset.balanceFor = id;
    badge.textContent = label;
    typeEl.insertAdjacentElement("afterend", badge);
  } else {
    badge.className = cls;
    badge.textContent = label;
  }
}

function renderEntryTags(entry: Entry): string {
  const tags = parseTagsString(entry.tags);
  const chips = tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
  return `<div class="detail-card-tags" data-entry-id="${entry.id}">${chips}<input type="text" class="tag-field detail-card-tag-input" placeholder="标签"></div>`;
}

function renderPostingLine(entry: Entry, p: Entry["postings"][0], i: number, expandedCosts: ReadonlySet<string>): string {
  const key = postingCostKey(entry.id, i);
  const expanded = expandedCosts.has(key) || hasPostingCost(p);
  const panelClass = expanded ? "posting-cost-panel is-open" : "posting-cost-panel";
  const toggleClass = expanded ? "posting-cost-toggle is-open" : "posting-cost-toggle";
  const toggleLabel = expanded ? "−" : "+";
  return `<div class="posting-line" data-posting-index="${i}">
    <div class="posting-main">
      ${editableSpan(entry.id, "account", entry, i)}
      <div class="posting-tail">
        ${editableSpan(entry.id, "amount", entry, i)}
        ${editableSpan(entry.id, "currency", entry, i)}
        <button type="button" class="${toggleClass}" data-id="${entry.id}" data-posting="${i}" aria-label="成本">${toggleLabel}</button>
      </div>
    </div>
    <div class="${panelClass}">
      <span class="posting-cost-label">@@</span>
      ${editableSpan(entry.id, "cost_amount", entry, i)}
      ${editableSpan(entry.id, "cost_currency", entry, i)}
    </div>
  </div>`;
}

export function renderPadBlockHtml(p: PadItem): string {
  const text = `Pad · ${p.account} ← ${p.source_account}`;
  return `<div class="detail-card-wrap is-readonly" data-entry-id="${p.id}" data-date="${p.date}">
    <div class="detail-card detail-card-readonly" data-entry-id="${p.id}">
      <div class="detail-card-readonly-line">${escapeHtml(text)}</div>
    </div>
  </div>`;
}

export function renderBalanceBlockHtml(b: BalanceItem): string {
  const text = `Balance · ${b.account} · ${b.amount} ${b.currency}`;
  return `<div class="detail-card-wrap is-readonly" data-entry-id="${b.id}" data-date="${b.date}">
    <div class="detail-card detail-card-readonly" data-entry-id="${b.id}">
      <div class="detail-card-readonly-line">${escapeHtml(text)}</div>
    </div>
  </div>`;
}

export function renderEntryBlockHtml(e: Entry, expandedCosts: ReadonlySet<string> = new Set()): string {
  const visual = entryVisualState(e);
  const classes = ["detail-card"];
  if (visual === "deleted") classes.push("detail-card-deleted");
  else if (visual === "new") classes.push("detail-card-new");
  else if (visual === "modified") classes.push("detail-card-modified");
  if (visual !== "unchanged") classes.push("detail-card-state-animate");
  const delContent = e._deleted ? "↩" : "✕";
  const delClass = e._deleted ? "detail-card-delete-btn is-undo" : "detail-card-delete-btn";
  const postings = e.postings.map((p, i) => renderPostingLine(e, p, i, expandedCosts)).join("");
  return `<div class="detail-card-wrap" data-entry-id="${e.id}" data-date="${e.date}">
    <div class="${classes.join(" ")}" data-entry-id="${e.id}">
      <div class="detail-card-header">
        ${editableSpan(e.id, "date", e, -1)}
        ${editableSpan(e.id, "payee", e, -1)}
        ${editableSpan(e.id, "remark", e, -1)}
        ${editableSpan(e.id, "type", e, -1)}
        ${renderBalanceBadge(e)}
        <button type="button" class="${delClass}" data-id="${e.id}" aria-label="${e._deleted ? "撤销" : "删除"}">${delContent}</button>
      </div>
      <div class="detail-card-meta">
        ${editableSpan(e.id, "flag", e, -1)}
        ${renderEntryTags(e)}
      </div>
      <div class="detail-card-postings">${postings}</div>
    </div>
  </div>`;
}
