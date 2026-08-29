import { TYPE_LABELS } from "../constants";
import { applyEntryDeleteButton, entryVisualState } from "../domain/entry-visual";
import { formatPostingCostLabel, hasPostingCost } from "../domain/entry";
import { isBalanceItem, isPadItem, isTransactionItem } from "../domain/detail-item";
import { getBaseline } from "../state/ledger";
import type { BalanceItem, CandidateDiagnostic, DetailItem, Entry, PadItem, Posting } from "../types";
import { parseTagsString } from "../utils";

import { displayTxnTime } from "../domain/txn-time";

import { mountTagChip } from "./cds-tag-input";
import { resolveStripeKind } from "./stripe-kind";
import type { StripeKind } from "./stripe-kind";
import { transitionCardVisualState, transitionClassPaint } from "./card-surface-motion";

const STRIPE_CLASS_PREFIX = "cds-stripe-";

export function itemRenderKey(item: DetailItem): string {
  return JSON.stringify(item);
}

export function itemContentKey(item: DetailItem): string {
  if (!isTransactionItem(item)) return itemRenderKey(item);
  return JSON.stringify(item, (key, value) => (key === "_deleted" ? undefined : value));
}

export function itemVisualKey(item: DetailItem, ctx: RenderCardContext = {}): string {
  if (!isTransactionItem(item)) return itemContentKey(item);
  const visual = entryVisualState(item, getBaseline());
  const stripe = resolveStripeKind(item);
  const err = ctx.markedErrorIds?.has(item.id) ? "1" : "0";
  const diagCount = ctx.cardDiagnostics?.get(item.id)?.length ?? 0;
  return `${itemContentKey(item)}|v:${visual}|e:${err}|s:${stripe}|d:${diagCount}`;
}

function patchStripeClass(card: HTMLElement, stripe: StripeKind): void {
  for (const cls of [...card.classList]) {
    if (cls.startsWith(STRIPE_CLASS_PREFIX)) card.classList.remove(cls);
  }
  card.classList.add(`${STRIPE_CLASS_PREFIX}${stripe}`);
  const wrap = card.closest<HTMLElement>(".cds-card-wrap");
  if (wrap) wrap.dataset.stripe = stripe;
}

function applyVisualState(
  card: HTMLElement,
  item: Entry,
  ctx: RenderCardContext,
): void {
  const visual = entryVisualState(item, getBaseline());
  transitionCardVisualState(card, `is-${visual}`, !!ctx.markedErrorIds?.has(item.id));
}

function patchFieldText(node: HTMLElement, value: string, ghostLabel?: string): void {
  if (node.classList.contains("is-editing")) return;
  const empty = !value.trim();
  node.classList.toggle("is-ghost", empty);
  if (empty) {
    node.setAttribute("data-ghost-label", ghostLabel || value);
    node.setAttribute("aria-label", ghostLabel || value);
    node.replaceChildren();
    return;
  }
  node.removeAttribute("data-ghost-label");
  node.removeAttribute("aria-label");
  node.textContent = value;
}

function patchTimeField(node: HTMLElement | null, value: string): void {
  if (!node || node.classList.contains("is-editing")) return;
  const empty = !value.trim();
  node.classList.toggle("is-empty", empty);
  node.classList.toggle("is-ghost", empty);
  if (empty) {
    node.replaceChildren();
    node.setAttribute("data-ghost-label", "时间");
    node.setAttribute("aria-label", "时间");
    return;
  }
  node.removeAttribute("data-ghost-label");
  node.removeAttribute("aria-label");
  node.textContent = value;
}

export function patchInlineTags(node: HTMLElement, tagsRaw: string): void {
  if (node.classList.contains("is-editing")) return;
  const tags = parseTagsString(tagsRaw);
  node.replaceChildren();
  node.classList.toggle("is-ghost", !tags.length);
  if (!tags.length) {
    node.setAttribute("data-ghost-label", "标签");
    node.setAttribute("aria-label", "标签");
    return;
  }
  node.removeAttribute("data-ghost-label");
  node.removeAttribute("aria-label");
  const visible = tags.slice(0, 2);
  const hidden = tags.length - visible.length;
  for (const tag of visible) {
    const chip = el("span", "cds-tag-chip");
    chip.textContent = tag;
    mountTagChip(chip);
    node.appendChild(chip);
  }
  if (hidden > 0) {
    const more = el("span", "cds-tag-more");
    more.setAttribute("data-role", "tag-overflow");
    more.textContent = `+${hidden}`;
    node.appendChild(more);
  }
}

function patchPostingLine(
  line: HTMLElement,
  posting: Posting,
  index: number,
): void {
  line.dataset.postingIndex = String(index);

  const account = line.querySelector<HTMLElement>("[data-role='posting-account']");
  if (account && !account.classList.contains("is-editing")) {
    account.textContent = posting.account;
    account.title = posting.account;
  }

  const amount = line.querySelector<HTMLElement>("[data-role='posting-amount']");
  if (amount && !amount.classList.contains("is-editing")) {
    const emptyAmount = posting.amount == null;
    amount.textContent = formatAmount(posting.amount);
    amount.classList.toggle("is-ghost", emptyAmount);
    if (emptyAmount) {
      amount.setAttribute("data-ghost-label", "金额");
      amount.setAttribute("aria-label", "金额");
    } else {
      amount.removeAttribute("data-ghost-label");
      amount.removeAttribute("aria-label");
    }
  }

  const currency = line.querySelector<HTMLElement>("[data-role='posting-currency']");
  if (currency && !currency.classList.contains("is-editing")) {
    const emptyCurrency = posting.amount == null && !(posting.currency || "").trim();
    currency.textContent = posting.amount == null ? (posting.currency || "") : (posting.currency || "CNY");
    currency.classList.toggle("is-ghost", emptyCurrency);
    if (emptyCurrency) {
      currency.setAttribute("data-ghost-label", "币种");
      currency.setAttribute("aria-label", "币种");
    } else {
      currency.removeAttribute("data-ghost-label");
      currency.removeAttribute("aria-label");
    }
  }

  const cost = line.querySelector<HTMLElement>("[data-role='posting-cost']");
  const costLabel = formatPostingCostLabel(posting);
  const hasCost = costLabel != null;
  if (hasCost) {
    if (!cost) {
      const tail = line.querySelector(".cds-posting-tail");
      const toggle = line.querySelector(".cds-posting-toggle");
      const node = el("span", "cds-posting-cost cds-field");
      node.setAttribute("data-role", "posting-cost");
      node.setAttribute("data-editable", "cost_amount");
      node.dataset.postingIndex = String(index);
      tail?.insertBefore(node, toggle);
    }
    const costNode = line.querySelector<HTMLElement>("[data-role='posting-cost']");
    if (costNode && !costNode.classList.contains("is-editing")) {
      costNode.textContent = costLabel;
    }
  } else {
    cost?.remove();
  }

  const toggle = line.querySelector<HTMLButtonElement>("[data-role='posting-toggle']");
  if (toggle) {
    toggle.classList.toggle("is-open", hasCost);
    toggle.textContent = hasCost ? "−" : "+";
  }
}

function rebuildPostings(card: HTMLElement, item: Entry): void {
  const container = card.querySelector<HTMLElement>("[data-role='txn-postings']");
  if (!container) return;
  container.replaceChildren();
  for (let i = 0; i < item.postings.length; i++) {
    container.appendChild(renderPostingLine(item.postings[i]!, i, true));
  }
}

function patchCardDiagnostics(card: HTMLElement, item: Entry, ctx: RenderCardContext): void {
  const diags = ctx.cardDiagnostics?.get(item.id) ?? [];
  let panel = card.querySelector<HTMLElement>("[data-role='card-validation']");
  if (!diags.length) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = el("div", "cds-card-validation");
    panel.setAttribute("data-role", "card-validation");
    card.appendChild(panel);
  }
  panel.replaceChildren();
  for (const diag of diags) {
    const row = el("details", "cds-card-validation-item");
    const summary = el("summary", "cds-card-validation-summary");
    summary.textContent = diag.message;
    row.appendChild(summary);
    if (diag.raw) {
      const raw = el("pre", "cds-card-validation-raw");
      raw.textContent = diag.raw;
      row.appendChild(raw);
    }
    panel.appendChild(row);
  }
}

export function patchTransactionCard(
  wrap: HTMLElement,
  item: Entry,
  ctx: RenderCardContext = {},
): boolean {
  const card = wrap.querySelector<HTMLElement>(".cds-card.cds-txn-card");
  if (!card) return false;

  applyVisualState(card, item, ctx);
  patchStripeClass(card, resolveStripeKind(item));
  patchCardDiagnostics(card, item, ctx);

  const identity = card.querySelector<HTMLElement>("[data-role='txn-identity']");
  if (identity) {
    patchTimeField(identity.querySelector<HTMLElement>("[data-role='txn-time']")!, displayTxnTime(item.metadata, item.date));
    patchFieldText(
      identity.querySelector<HTMLElement>("[data-role='txn-remark']")!,
      item.remark,
      "标题",
    );
    patchFieldText(
      identity.querySelector<HTMLElement>("[data-role='txn-payee']")!,
      item.payee,
      "收款人",
    );
    const tags = identity.querySelector<HTMLElement>("[data-role='txn-tags']");
    if (tags) patchInlineTags(tags, item.tags);
    const btn = identity.querySelector<HTMLButtonElement>("[data-role='delete-btn']");
    if (btn) {
      const deleted = !!item._deleted;
      if (btn.classList.contains("is-undo") !== deleted) {
        transitionClassPaint(btn, "is-undo", deleted, ["backgroundColor"]);
      }
      applyEntryDeleteButton(btn, deleted);
    }
  }

  const lines = card.querySelectorAll<HTMLElement>("[data-role='posting']");
  if (lines.length !== item.postings.length) {
    rebuildPostings(card, item);
    return true;
  }
  lines.forEach((line, index) => {
    patchPostingLine(line, item.postings[index]!, index);
  });
  return true;
}

export function updateEntryCardVisual(
  wrap: HTMLElement,
  item: DetailItem,
  ctx: RenderCardContext = {},
): void {
  if (!isTransactionItem(item)) return;
  patchTransactionCard(wrap, item, ctx);
}

export { carryCardPaintState, mountConnectedCardVisual, primeCardVisualTransition } from "./card-surface-motion";

function stampCardWrapKeys(wrap: HTMLElement, item: DetailItem): void {
  wrap.dataset.renderKey = itemRenderKey(item);
  wrap.dataset.contentKey = itemContentKey(item);
}

export type RenderCardContext = {
  markedErrorIds?: ReadonlySet<string>;
  cardDiagnostics?: ReadonlyMap<string, readonly CandidateDiagnostic[]>;
};

const TYPE_ARIA: Record<string, string> = {
  expense: "支出交易",
  income: "收入交易",
  transfer: "转账交易",
  "proxy-expense": "代支出交易",
  repayment: "还款交易",
  "": "未分类交易",
  pad: "Pad 只读条目",
  balance: "Balance 只读条目",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  }
  return node;
}

function field(
  role: string,
  value: string,
  extraClass: string,
  ghostLabel?: string,
  editable?: string,
  postingIndex?: number,
): HTMLSpanElement {
  const empty = !value.trim();
  const node = el("span", `cds-field ${extraClass}${empty ? " is-ghost" : ""}`);
  node.setAttribute("data-role", role);
  if (editable) {
    node.setAttribute("data-editable", editable);
    if (postingIndex != null) node.dataset.postingIndex = String(postingIndex);
  }
  if (empty) {
    node.setAttribute("data-ghost-label", ghostLabel || value);
    node.setAttribute("aria-label", ghostLabel || value);
  } else {
    node.textContent = value;
  }
  return node;
}

function timeField(item: Entry): HTMLSpanElement {
  const value = displayTxnTime(item.metadata, item.date);
  const node = el("span", `cds-field cds-field-time${value ? "" : " is-empty is-ghost"}`);
  node.setAttribute("data-role", "txn-time");
  node.setAttribute("data-editable", "datetime");
  if (value) {
    node.textContent = value;
  } else {
    node.setAttribute("data-ghost-label", "时间");
    node.setAttribute("aria-label", "时间");
  }
  return node;
}

function wrapCard(
  card: HTMLElement,
  id: string,
  date: string,
  stripeKind: StripeKind,
  extra = "",
): HTMLElement {
  const wrap = el("div", `cds-card-wrap${extra}`);
  wrap.dataset.itemId = id;
  wrap.dataset.date = date;
  wrap.dataset.stripe = stripeKind;
  wrap.setAttribute("aria-label", TYPE_ARIA[stripeKind] || TYPE_ARIA[""]);
  card.classList.add(`cds-stripe-${stripeKind}`);
  wrap.appendChild(card);
  return wrap;
}

function renderIdentityRow(item: Entry): HTMLElement {
  const row = el("div", "cds-card-identity");
  row.setAttribute("data-role", "txn-identity");
  const tagsEl = renderInlineTags(item.tags);
  tagsEl.setAttribute("data-editable", "tags");
  row.append(
    timeField(item),
    field("txn-remark", item.remark, "cds-field-remark", "标题", "remark"),
    field("txn-payee", item.payee, "cds-field-payee", "收款人", "payee"),
    tagsEl,
    deleteBtn(!!item._deleted),
  );
  return row;
}

function deleteBtn(deleted = false, hidden = false): HTMLButtonElement {
  const btn = el(
    "button",
    `cds-delete-btn${deleted ? " is-undo" : ""}${hidden ? " is-hidden" : ""}`,
  );
  btn.type = "button";
  btn.setAttribute("data-role", "delete-btn");
  applyEntryDeleteButton(btn, deleted);
  return btn;
}

function renderInlineTags(tagsRaw: string, maxVisible = 2): HTMLElement {
  const wrap = el("div", "cds-inline-tags");
  wrap.setAttribute("data-role", "txn-tags");
  const tags = parseTagsString(tagsRaw);
  if (!tags.length) {
    wrap.classList.add("is-ghost");
    wrap.setAttribute("data-ghost-label", "标签");
    wrap.setAttribute("aria-label", "标签");
    return wrap;
  }
  const visible = tags.slice(0, maxVisible);
  const hidden = tags.length - visible.length;
  for (const tag of visible) {
    const chip = el("span", "cds-tag-chip");
    chip.textContent = tag;
    wrap.appendChild(chip);
  }
  if (hidden > 0) {
    const more = el("span", "cds-tag-more");
    more.setAttribute("data-role", "tag-overflow");
    more.textContent = `+${hidden}`;
    wrap.appendChild(more);
  }
  return wrap;
}

function formatAmount(amount: number | null | undefined): string {
  if (amount == null) return "";
  if (amount === 0) return "0";
  return String(amount);
}

function renderPostingLine(
  posting: Posting,
  index: number,
  editable: boolean,
): HTMLElement {
  const line = el("div", "cds-posting-line");
  line.setAttribute("data-role", "posting");
  line.dataset.postingIndex = String(index);

  const account = el("span", "cds-posting-account");
  account.setAttribute("data-role", "posting-account");
  account.title = posting.account;
  account.textContent = posting.account;
  if (editable) {
    account.setAttribute("data-editable", "account");
    account.dataset.postingIndex = String(index);
    account.classList.add("cds-field");
  }

  const tail = el("div", "cds-posting-tail");
  const emptyAmount = posting.amount == null;
  const amount = el("span", `cds-posting-amount${emptyAmount ? " is-ghost" : ""}`);
  amount.setAttribute("data-role", "posting-amount");
  amount.textContent = formatAmount(posting.amount);
  if (emptyAmount) {
    amount.setAttribute("data-ghost-label", "金额");
    amount.setAttribute("aria-label", "金额");
  }
  if (editable) {
    amount.setAttribute("data-editable", "amount");
    amount.dataset.postingIndex = String(index);
    amount.classList.add("cds-field");
  }

  const emptyCurrency = emptyAmount && !(posting.currency || "").trim();
  const currency = el("span", `cds-posting-currency${emptyCurrency ? " is-ghost" : ""}`);
  currency.setAttribute("data-role", "posting-currency");
  currency.textContent = emptyAmount ? (posting.currency || "") : (posting.currency || "CNY");
  if (emptyCurrency) {
    currency.setAttribute("data-ghost-label", "币种");
    currency.setAttribute("aria-label", "币种");
  }
  if (editable) {
    currency.setAttribute("data-editable", "currency");
    currency.dataset.postingIndex = String(index);
    currency.classList.add("cds-field");
  }

  tail.append(amount, currency);

  const costLabel = formatPostingCostLabel(posting);
  if (costLabel) {
    const cost = el("span", "cds-posting-cost");
    cost.setAttribute("data-role", "posting-cost");
    cost.textContent = costLabel;
    if (editable) {
      cost.setAttribute("data-editable", "cost_amount");
      cost.dataset.postingIndex = String(index);
      cost.classList.add("cds-field");
    }
    tail.appendChild(cost);
  }

  const toggle = el("button", `cds-posting-toggle${hasPostingCost(posting) ? " is-open" : ""}`);
  toggle.type = "button";
  toggle.setAttribute("data-role", "posting-toggle");
  toggle.setAttribute("aria-label", "展开成本");
  toggle.disabled = !editable;
  toggle.textContent = hasPostingCost(posting) ? "−" : "+";
  tail.appendChild(toggle);

  line.append(account, tail);

  return line;
}

function renderTransactionCard(item: Entry, ctx: RenderCardContext = {}): HTMLElement {
  const typeKey = item.type || "";
  const visual = item._is_new ? "unchanged" : entryVisualState(item, getBaseline());
  const hasError = ctx.markedErrorIds?.has(item.id);

  const card = el(
    "article",
    `cds-card cds-txn-card cds-type-${typeKey || "unknown"} is-${visual}${hasError ? " is-validation-err" : ""}`,
  );
  card.setAttribute("data-role", "txn-card");
  card.setAttribute("aria-label", TYPE_ARIA[typeKey] || TYPE_ARIA[""]);

  card.appendChild(renderIdentityRow(item));

  const postings = el("div", "cds-card-postings");
  postings.setAttribute("data-role", "txn-postings");
  for (let i = 0; i < item.postings.length; i++) {
    postings.appendChild(renderPostingLine(item.postings[i]!, i, true));
  }
  card.appendChild(postings);
  patchCardDiagnostics(card, item, ctx);

  const wrap = wrapCard(card, item.id, item.date, resolveStripeKind(item));
  stampCardWrapKeys(wrap, item);
  return wrap;
}

function renderPadCard(item: PadItem): HTMLElement {
  const card = el("article", "cds-card cds-pad-card cds-type-pad cds-card-oneline");
  card.setAttribute("data-role", "pad-card");
  card.setAttribute("aria-label", TYPE_ARIA.pad);

  const row = el("div", "cds-card-identity");
  row.setAttribute("data-role", "pad-identity");
  const arrow = el("span", "cds-pad-arrow");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "←";
  row.append(
    field("pad-date", item.date, "cds-field-date"),
    field("pad-kind", "Pad", "cds-field-kind"),
    field("pad-account", item.account, "cds-field-account"),
    arrow,
    field("pad-source", item.source_account, "cds-field-source"),
    deleteBtn(true),
  );
  card.appendChild(row);

  const wrap = wrapCard(card, item.id, item.date, resolveStripeKind(item), " is-readonly");
  stampCardWrapKeys(wrap, item);
  return wrap;
}

function renderBalanceCard(item: BalanceItem): HTMLElement {
  const card = el("article", "cds-card cds-balance-card cds-type-balance cds-card-oneline");
  card.setAttribute("data-role", "balance-card");
  card.setAttribute("aria-label", TYPE_ARIA.balance);

  const row = el("div", "cds-card-identity");
  row.setAttribute("data-role", "balance-identity");
  const amount = el("span", "cds-field cds-field-balance-amount");
  amount.setAttribute("data-role", "balance-amount");
  amount.textContent = `${item.amount} ${item.currency}`;
  row.append(
    field("balance-date", item.date, "cds-field-date"),
    field("balance-kind", "Balance", "cds-field-kind"),
    field("balance-account", item.account, "cds-field-account"),
    amount,
    deleteBtn(true),
  );
  card.appendChild(row);

  const wrap = wrapCard(card, item.id, item.date, resolveStripeKind(item), " is-readonly");
  stampCardWrapKeys(wrap, item);
  return wrap;
}

export function renderDetailItemCard(
  item: DetailItem,
  ctx: RenderCardContext = {},
): HTMLElement {
  if (isPadItem(item)) return renderPadCard(item);
  if (isBalanceItem(item)) return renderBalanceCard(item);
  if (isTransactionItem(item)) return renderTransactionCard(item, ctx);
  const card = el("article", "cds-card cds-unknown-card");
  card.textContent = "未知条目";
  return wrapCard(card, (item as { id?: string }).id || "", (item as { date?: string }).date || "", "unknown");
}

export function typeAriaLabel(type: string): string {
  return TYPE_LABELS[type] ? TYPE_ARIA[type] || TYPE_ARIA[""] : TYPE_ARIA[""];
}
