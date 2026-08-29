import { isBalanceItem, isPadItem, isTransactionItem } from "../domain/detail-item";
import type { DetailItem, Entry, Posting } from "../types";
import { parseTagsString } from "../utils";
import "./finance-search.css";

export type FinanceSearchScope = "all" | "payee-remark" | "account" | "tag" | "amount";

export type FinanceSearchField = "payee" | "remark" | "account" | "tag" | "amount";

export type FinanceSearchHighlight = {
  queryNorm: string;
  activeId: string | null;
  hits: ReadonlyMap<string, ReadonlySet<FinanceSearchField>>;
};

type IndexedHaystacks = Record<FinanceSearchScope, string>;

export type FinanceSearchIndexEntry = {
  id: string;
  haystacks: IndexedHaystacks;
  completionValues: string[];
};

export type FinanceSearchIndex = {
  entries: readonly FinanceSearchIndexEntry[];
};

export type FinanceSearchHit = {
  id: string;
  fields: ReadonlySet<FinanceSearchField>;
};

export type FinanceSearchQueryResult = {
  hits: FinanceSearchHit[];
};

const SCOPE_LABELS: Record<FinanceSearchScope, string> = {
  all: "全部",
  "payee-remark": "收款人+摘要",
  account: "账户",
  tag: "标签",
  amount: "金额",
};

const SCOPES: FinanceSearchScope[] = ["all", "payee-remark", "account", "tag", "amount"];

const MAX_COMPLETIONS = 6;

export function normalizeFinanceSearchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function pushUnique(target: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!target.includes(trimmed)) target.push(trimmed);
}

function formatPostingAmount(amount: number | null | undefined): string {
  if (amount == null) return "";
  if (amount === 0) return "0";
  return String(amount);
}

function collectPostingAmountTokens(posting: Posting, tokens: string[]): void {
  const amount = formatPostingAmount(posting.amount);
  if (amount) pushUnique(tokens, amount);
  const currency = (posting.currency || "").trim();
  if (currency) pushUnique(tokens, currency);
  if (posting.cost_amount != null) {
    pushUnique(tokens, formatPostingAmount(posting.cost_amount));
    const costCurrency = (posting.cost_currency || "").trim();
    if (costCurrency) pushUnique(tokens, costCurrency);
  }
}

function indexTransaction(item: Entry): FinanceSearchIndexEntry {
  const payee = (item.payee || "").trim();
  const remark = (item.remark || "").trim();
  const tags = parseTagsString(item.tags);
  const accounts: string[] = [];
  const amountTokens: string[] = [];

  for (const posting of item.postings) {
    pushUnique(accounts, posting.account);
    collectPostingAmountTokens(posting, amountTokens);
  }

  const payeeRemark = normalizeFinanceSearchText([payee, remark].filter(Boolean).join(" "));
  const accountHay = normalizeFinanceSearchText(accounts.join(" "));
  const tagHay = normalizeFinanceSearchText(tags.join(" "));
  const amountHay = normalizeFinanceSearchText(amountTokens.join(" "));
  const allHay = normalizeFinanceSearchText(
    [payee, remark, ...accounts, ...tags, ...amountTokens].filter(Boolean).join(" "),
  );

  const completionValues: string[] = [];
  pushUnique(completionValues, payee);
  pushUnique(completionValues, remark);
  for (const account of accounts) pushUnique(completionValues, account);
  for (const tag of tags) pushUnique(completionValues, tag);
  for (const token of amountTokens) pushUnique(completionValues, token);

  return {
    id: item.id,
    haystacks: {
      all: allHay,
      "payee-remark": payeeRemark,
      account: accountHay,
      tag: tagHay,
      amount: amountHay,
    },
    completionValues,
  };
}

function indexPad(item: Extract<DetailItem, { kind: "pad" }>): FinanceSearchIndexEntry {
  const accounts = [item.account, item.source_account].filter(Boolean);
  const accountHay = normalizeFinanceSearchText(accounts.join(" "));
  const completionValues: string[] = [];
  for (const account of accounts) pushUnique(completionValues, account);

  return {
    id: item.id,
    haystacks: {
      all: accountHay,
      "payee-remark": "",
      account: accountHay,
      tag: "",
      amount: "",
    },
    completionValues,
  };
}

function indexBalance(item: Extract<DetailItem, { kind: "balance" }>): FinanceSearchIndexEntry {
  const account = (item.account || "").trim();
  const amount = String(item.amount ?? "").trim();
  const currency = (item.currency || "").trim();
  const amountTokens = [amount, currency].filter(Boolean);
  const accountHay = normalizeFinanceSearchText(account);
  const amountHay = normalizeFinanceSearchText(amountTokens.join(" "));
  const allHay = normalizeFinanceSearchText([account, ...amountTokens].filter(Boolean).join(" "));

  const completionValues: string[] = [];
  pushUnique(completionValues, account);
  for (const token of amountTokens) pushUnique(completionValues, token);

  return {
    id: item.id,
    haystacks: {
      all: allHay,
      "payee-remark": "",
      account: accountHay,
      tag: "",
      amount: amountHay,
    },
    completionValues,
  };
}

export function buildFinanceSearchIndex(items: readonly DetailItem[]): FinanceSearchIndex {
  const entries: FinanceSearchIndexEntry[] = [];
  for (const item of items) {
    if (isTransactionItem(item)) entries.push(indexTransaction(item));
    else if (isPadItem(item)) entries.push(indexPad(item));
    else if (isBalanceItem(item)) entries.push(indexBalance(item));
  }
  return { entries };
}

function resolveHitFields(
  item: DetailItem,
  queryNorm: string,
  scope: FinanceSearchScope,
): ReadonlySet<FinanceSearchField> | null {
  if (!queryNorm) return null;
  const fields = new Set<FinanceSearchField>();

  if (isTransactionItem(item)) {
    const payee = normalizeFinanceSearchText(item.payee || "");
    const remark = normalizeFinanceSearchText(item.remark || "");
    const tags = parseTagsString(item.tags).map((tag) => normalizeFinanceSearchText(tag));
    const accounts = item.postings.map((posting) => normalizeFinanceSearchText(posting.account || ""));
    const amountParts: string[] = [];
    for (const posting of item.postings) {
      const amount = normalizeFinanceSearchText(formatPostingAmount(posting.amount));
      const currency = normalizeFinanceSearchText(posting.currency || "");
      if (amount) amountParts.push(amount);
      if (currency) amountParts.push(currency);
      if (posting.cost_amount != null) {
        amountParts.push(normalizeFinanceSearchText(formatPostingAmount(posting.cost_amount)));
        const costCurrency = normalizeFinanceSearchText(posting.cost_currency || "");
        if (costCurrency) amountParts.push(costCurrency);
      }
    }
    const amountHay = amountParts.join(" ");

    const matchPayeeRemark =
      (scope === "all" || scope === "payee-remark") &&
      ((payee && payee.includes(queryNorm)) || (remark && remark.includes(queryNorm)));
    const matchAccount =
      (scope === "all" || scope === "account") && accounts.some((account) => account.includes(queryNorm));
    const matchTag =
      (scope === "all" || scope === "tag") && tags.some((tag) => tag.includes(queryNorm));
    const matchAmount =
      (scope === "all" || scope === "amount") && amountHay.includes(queryNorm);

    if (matchPayeeRemark) {
      if (payee.includes(queryNorm)) fields.add("payee");
      if (remark.includes(queryNorm)) fields.add("remark");
    }
    if (matchAccount) fields.add("account");
    if (matchTag) fields.add("tag");
    if (matchAmount) fields.add("amount");
  } else if (isPadItem(item)) {
    const accounts = [item.account, item.source_account]
      .map((value) => normalizeFinanceSearchText(value || ""))
      .filter(Boolean);
    const matchAccount =
      (scope === "all" || scope === "account") && accounts.some((account) => account.includes(queryNorm));
    if (matchAccount) fields.add("account");
  } else if (isBalanceItem(item)) {
    const account = normalizeFinanceSearchText(item.account || "");
    const amountHay = normalizeFinanceSearchText(
      [String(item.amount ?? ""), item.currency || ""].filter(Boolean).join(" "),
    );
    const matchAccount = (scope === "all" || scope === "account") && account.includes(queryNorm);
    const matchAmount = (scope === "all" || scope === "amount") && amountHay.includes(queryNorm);
    if (matchAccount) fields.add("account");
    if (matchAmount) fields.add("amount");
  }

  return fields.size ? fields : null;
}

export function queryFinanceSearch(
  index: FinanceSearchIndex,
  items: readonly DetailItem[],
  query: string,
  scope: FinanceSearchScope,
): FinanceSearchQueryResult {
  const queryNorm = normalizeFinanceSearchText(query);
  if (!queryNorm) return { hits: [] };

  const itemById = new Map(items.map((item) => [item.id, item]));
  const hits: FinanceSearchHit[] = [];

  for (const entry of index.entries) {
    const haystack = entry.haystacks[scope];
    if (!haystack.includes(queryNorm)) continue;
    const item = itemById.get(entry.id);
    if (!item) continue;
    const fields = resolveHitFields(item, queryNorm, scope);
    if (!fields) continue;
    hits.push({ id: entry.id, fields });
  }

  return { hits };
}

export function collectFinanceSearchCompletions(
  index: FinanceSearchIndex,
  query: string,
  scope: FinanceSearchScope,
  limit = MAX_COMPLETIONS,
): string[] {
  const queryNorm = normalizeFinanceSearchText(query);
  if (!queryNorm) return [];

  const results: string[] = [];
  const seen = new Set<string>();

  for (const entry of index.entries) {
    const haystack = entry.haystacks[scope];
    if (!haystack.includes(queryNorm)) continue;
    for (const value of entry.completionValues) {
      const valueNorm = normalizeFinanceSearchText(value);
      if (!valueNorm.includes(queryNorm)) continue;
      if (seen.has(valueNorm)) continue;
      seen.add(valueNorm);
      results.push(value);
      if (results.length >= limit) return results;
    }
  }

  return results;
}

export function stepFinanceSearchMatch(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

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

function fieldSelectors(field: FinanceSearchField): string {
  switch (field) {
    case "payee":
      return "[data-role='txn-payee']";
    case "remark":
      return "[data-role='txn-remark']";
    case "account":
      return "[data-role='posting-account'], [data-role='pad-account'], [data-role='balance-account']";
    case "tag":
      return "[data-role='txn-tags'] .cds-tag-chip, [data-role='txn-tags']";
    case "amount":
      return "[data-role='posting-amount'], [data-role='posting-currency'], [data-role='posting-cost'], [data-role='balance-amount']";
    default:
      return "";
  }
}

export function applyFinanceSearchHighlightToCard(
  wrap: HTMLElement,
  highlight: FinanceSearchHighlight | null,
): void {
  wrap.classList.toggle("cds-search-active", !!highlight && highlight.activeId === wrap.dataset.itemId);
  wrap.querySelectorAll<HTMLElement>(".cds-search-hit").forEach((node) => {
    node.classList.remove("cds-search-hit");
  });

  if (!highlight) return;
  const fields = highlight.hits.get(wrap.dataset.itemId || "");
  if (!fields?.size) return;

  for (const field of fields) {
    const selector = fieldSelectors(field);
    if (!selector) continue;
    wrap.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      node.classList.add("cds-search-hit");
    });
  }
}

export type FinanceSearchDeps = {
  getFilteredItems: () => readonly DetailItem[];
  onHighlightChange: (highlight: FinanceSearchHighlight | null) => void;
  onNavigate: (id: string) => void;
  subscribeItems: (listener: () => void) => () => void;
};

export type FinanceSearchHandle = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
};

export function mountFinanceSearch(
  host: HTMLElement,
  titleBtn: HTMLButtonElement,
  deps: FinanceSearchDeps,
  signal: AbortSignal,
): FinanceSearchHandle {
  let open = false;
  let scope: FinanceSearchScope = "all";
  let query = "";
  let composing = false;
  let activeIndex = -1;
  let hits: FinanceSearchHit[] = [];
  let index = buildFinanceSearchIndex(deps.getFilteredItems());
  let completionIndex = -1;
  let completions: string[] = [];
  let pendingFrame = 0;

  const overlay = el("div", "finance-search-overlay");
  overlay.setAttribute("data-role", "finance-search-overlay");
  overlay.hidden = true;

  const panel = el("div", "finance-search-panel");
  panel.setAttribute("role", "search");

  const scopeSelect = el("select", "finance-search-scope") as HTMLSelectElement;
  scopeSelect.setAttribute("aria-label", "搜索范围");
  for (const value of SCOPES) {
    const option = el("option", undefined, { value }) as HTMLOptionElement;
    option.textContent = SCOPE_LABELS[value];
    scopeSelect.appendChild(option);
  }

  const input = el("input", "finance-search-input") as HTMLInputElement;
  input.type = "search";
  input.placeholder = "在当前列表中查找";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "搜索关键词");

  const count = el("span", "finance-search-count");
  count.setAttribute("aria-live", "polite");

  const prevBtn = el("button", "finance-search-nav-btn") as HTMLButtonElement;
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "上一个");
  prevBtn.textContent = "↑";

  const nextBtn = el("button", "finance-search-nav-btn") as HTMLButtonElement;
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "下一个");
  nextBtn.textContent = "↓";

  const closeBtn = el("button", "finance-search-close-btn") as HTMLButtonElement;
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "关闭搜索");
  closeBtn.textContent = "×";

  const completionList = el("ul", "finance-search-completions");
  completionList.setAttribute("role", "listbox");
  completionList.hidden = true;

  const row = el("div", "finance-search-row");
  row.append(scopeSelect, input, count, prevBtn, nextBtn, closeBtn);
  panel.append(row, completionList);
  overlay.appendChild(panel);
  host.appendChild(overlay);

  function rebuildIndex(): void {
    index = buildFinanceSearchIndex(deps.getFilteredItems());
  }

  function syncCount(): void {
    if (!query.trim() || hits.length === 0) {
      count.textContent = hits.length ? `0 / ${hits.length}` : "0 / 0";
      return;
    }
    const current = activeIndex >= 0 ? activeIndex + 1 : 0;
    count.textContent = `${current} / ${hits.length}`;
  }

  function buildHighlight(): FinanceSearchHighlight | null {
    const queryNorm = normalizeFinanceSearchText(query);
    if (!queryNorm || !hits.length) return null;
    const hitMap = new Map<string, ReadonlySet<FinanceSearchField>>();
    for (const hit of hits) hitMap.set(hit.id, hit.fields);
    const activeId = activeIndex >= 0 ? hits[activeIndex]?.id ?? null : null;
    return { queryNorm, activeId, hits: hitMap };
  }

  function emitHighlight(): void {
    deps.onHighlightChange(buildHighlight());
  }

  function renderCompletions(): void {
    completionList.replaceChildren();
    const show = completions.length > 0 && completionIndex >= 0;
    completionList.hidden = !show;
    if (!show) return;
    completions.forEach((value, idx) => {
      const item = el("li", "finance-search-completion");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(idx === completionIndex));
      item.textContent = value;
      if (idx === completionIndex) item.classList.add("is-active");
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        adoptCompletion(value);
      });
      completionList.appendChild(item);
    });
  }

  function recompute(): void {
    const items = deps.getFilteredItems();
    const result = queryFinanceSearch(index, items, query, scope);
    hits = result.hits;
    if (activeIndex >= hits.length) activeIndex = hits.length ? Math.min(activeIndex, hits.length - 1) : -1;
    if (activeIndex < 0 && hits.length) activeIndex = -1;
    completions = collectFinanceSearchCompletions(index, query, scope);
    completionIndex = completions.length ? 0 : -1;
    syncCount();
    renderCompletions();
    emitHighlight();
  }

  function scheduleRecompute(): void {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      recompute();
    });
  }

  function adoptCompletion(value: string): void {
    query = value;
    input.value = value;
    completionIndex = -1;
    completions = [];
    renderCompletions();
    recompute();
    input.focus();
  }

  function navigate(direction: 1 | -1): void {
    if (!hits.length) return;
    activeIndex = stepFinanceSearchMatch(activeIndex, hits.length, direction);
    syncCount();
    emitHighlight();
    const id = hits[activeIndex]?.id;
    if (id) deps.onNavigate(id);
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    overlay.hidden = !open;
    titleBtn.classList.toggle("is-search-open", open);
    titleBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      rebuildIndex();
      requestAnimationFrame(() => input.focus());
    } else {
      query = "";
      input.value = "";
      scope = "all";
      scopeSelect.value = scope;
      activeIndex = -1;
      hits = [];
      completions = [];
      completionIndex = -1;
      completionList.hidden = true;
      syncCount();
      deps.onHighlightChange(null);
    }
  }

  scopeSelect.addEventListener("change", () => {
    scope = scopeSelect.value as FinanceSearchScope;
    scheduleRecompute();
  }, { signal });

  input.addEventListener("compositionstart", () => {
    composing = true;
  }, { signal });

  input.addEventListener("compositionend", () => {
    composing = false;
    scheduleRecompute();
  }, { signal });

  input.addEventListener("input", () => {
    query = input.value;
    if (!composing) scheduleRecompute();
  }, { signal });

  prevBtn.addEventListener("click", () => navigate(-1), { signal });
  nextBtn.addEventListener("click", () => navigate(1), { signal });
  closeBtn.addEventListener("click", () => setOpen(false), { signal });

  titleBtn.addEventListener("click", () => setOpen(!open), { signal });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && completions.length) {
      event.preventDefault();
      completionIndex = Math.min(completions.length - 1, completionIndex + 1);
      renderCompletions();
      return;
    }
    if (event.key === "ArrowUp" && completions.length) {
      event.preventDefault();
      completionIndex = Math.max(0, completionIndex - 1);
      renderCompletions();
      return;
    }
    if (event.key === "Tab" && completions.length && completionIndex >= 0) {
      event.preventDefault();
      adoptCompletion(completions[completionIndex]!);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (completions.length && completionIndex >= 0) {
        adoptCompletion(completions[completionIndex]!);
        return;
      }
      navigate(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (completions.length) {
        completions = [];
        completionIndex = -1;
        renderCompletions();
        return;
      }
      setOpen(false);
    }
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (!open) setOpen(true);
      else input.focus();
    }
    if (event.key === "Escape" && open && !overlay.contains(document.activeElement)) {
      setOpen(false);
    }
  }, { signal });

  const unsub = deps.subscribeItems(() => {
    rebuildIndex();
    if (open) scheduleRecompute();
  });

  signal.addEventListener("abort", () => {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    unsub();
    deps.onHighlightChange(null);
    overlay.remove();
  });

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => open,
    dispose: () => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      unsub();
      deps.onHighlightChange(null);
      overlay.remove();
    },
  };
}
