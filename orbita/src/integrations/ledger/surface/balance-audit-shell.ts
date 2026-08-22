import { buildAccountIndex } from "../domain/account-validate";
import type { BalanceAuditSnapshot } from "./types";
import "./balance-audit-shell.css";

const MAX_VERIFY_SLOTS = 3;

const TYPE_OPTIONS = [
  { value: "asset", label: "资产", prefix: "Assets:" },
  { value: "credit", label: "信贷", prefix: "Liabilities:" },
] as const;

type SlotType = (typeof TYPE_OPTIONS)[number]["value"];

type SlotState = {
  type: SlotType;
  account: string;
};

export type BalanceAuditOptions = {
  getAudit: () => BalanceAuditSnapshot;
  isDirty: () => boolean;
  subscribe: (fn: () => void) => () => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function accountsForType(type: SlotType): string[] {
  const opt = TYPE_OPTIONS.find((o) => o.value === type);
  if (!opt) return [];
  const index = buildAccountIndex();
  return [...index.allNames].filter((name) => name.startsWith(opt.prefix)).sort();
}

function formatBalance(
  audit: BalanceAuditSnapshot,
  account: string,
): string {
  if (audit.loadState === "loading") return "加载中…";
  if (audit.loadState === "error") return audit.error || "加载失败";
  const stats = audit.accounts.find((s) => s.account === account);
  if (!stats?.balances?.length) return "—";
  return stats.balances.map((b) => `${b.amount} ${b.currency}`).join(" · ");
}

/** Read-only committed balances from Store snapshot (§25.11). */
export function mountBalanceAuditShell(
  container: HTMLElement,
  signal: AbortSignal,
  options: BalanceAuditOptions,
): () => void {
  const root = el("section", "cds-verify");
  root.setAttribute("data-role", "balance-audit");

  const head = el("div", "cds-verify-head");
  const title = el("h2", "cds-verify-title");
  title.textContent = "校验";
  const addBtn = el("button", "cds-verify-add");
  addBtn.type = "button";
  addBtn.setAttribute("aria-label", "添加校验账户");
  addBtn.textContent = "+";
  head.append(title, addBtn);

  const hint = el("p", "cds-verify-hint");
  hint.setAttribute("data-role", "balance-audit-hint");

  const errorEl = el("p", "cds-verify-error");
  errorEl.setAttribute("data-role", "balance-audit-error");
  errorEl.hidden = true;

  const slots = el("div", "cds-verify-slots");
  slots.setAttribute("data-role", "verify-slots");

  let disposed = false;
  const slotStates: SlotState[] = [];

  function syncHint(): void {
    hint.textContent = options.isDirty()
      ? "有待保存变更，核验值尚未包含。"
      : "仅显示已落盘余额；未保存变更不计入。";
    const audit = options.getAudit();
    if (audit.loadState === "error") {
      errorEl.hidden = false;
      errorEl.textContent = audit.error || "余额加载失败";
    } else {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    refreshSlotBalances();
  }

  function refreshSlotBalances(): void {
    const audit = options.getAudit();
    slots.querySelectorAll<HTMLElement>("[data-role='verify-slot']").forEach((slot, i) => {
      const state = slotStates[i];
      const balanceEl = slot.querySelector<HTMLElement>("[data-role='verify-balance']");
      if (!balanceEl || !state) return;
      balanceEl.textContent = state.account
        ? formatBalance(audit, state.account)
        : "—";
    });
  }

  function syncAddBtn(): void {
    addBtn.disabled = slots.children.length >= MAX_VERIFY_SLOTS;
  }

  function buildTypeSelect(value: SlotType, slotIndex: number): HTMLSelectElement {
    const select = el("select", "cds-verify-type");
    select.setAttribute("data-role", "verify-type");
    for (const opt of TYPE_OPTIONS) {
      const option = el("option");
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener(
      "change",
      () => {
        slotStates[slotIndex]!.type = select.value as SlotType;
        slotStates[slotIndex]!.account = "";
        const accountSelect = select
          .closest<HTMLElement>("[data-role='verify-slot']")
          ?.querySelector<HTMLSelectElement>("[data-role='verify-account']");
        if (accountSelect) rebuildAccountSelect(accountSelect, slotIndex);
        refreshSlotBalances();
      },
      { signal },
    );
    return select;
  }

  function rebuildAccountSelect(select: HTMLSelectElement, slotIndex: number): void {
    const state = slotStates[slotIndex]!;
    const names = accountsForType(state.type);
    select.replaceChildren();
    const placeholder = el("option");
    placeholder.value = "";
    placeholder.textContent = "选择账户";
    if (!state.account) placeholder.selected = true;
    select.appendChild(placeholder);
    for (const name of names) {
      const option = el("option");
      option.value = name;
      option.textContent = name;
      if (name === state.account) option.selected = true;
      select.appendChild(option);
    }
  }

  function buildAccountSelect(slotIndex: number): HTMLSelectElement {
    const select = el("select", "cds-verify-account");
    select.setAttribute("data-role", "verify-account");
    rebuildAccountSelect(select, slotIndex);
    select.addEventListener(
      "change",
      () => {
        slotStates[slotIndex]!.account = select.value;
        refreshSlotBalances();
      },
      { signal },
    );
    return select;
  }

  function createSlot(): HTMLElement {
    const slotIndex = slotStates.length;
    const state: SlotState = { type: "asset", account: "" };
    slotStates.push(state);

    const slot = el("div", "cds-verify-slot");
    slot.setAttribute("data-role", "verify-slot");

    const row1 = el("div", "cds-verify-row cds-verify-row-pickers");
    row1.append(buildTypeSelect(state.type, slotIndex), buildAccountSelect(slotIndex));

    const row2 = el("div", "cds-verify-row cds-verify-row-balance");
    const balance = el("span", "cds-verify-balance");
    balance.setAttribute("data-role", "verify-balance");
    balance.textContent = "—";
    row2.appendChild(balance);

    const removeBtn = el("button", "cds-verify-remove");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "移除校验账户");
    removeBtn.textContent = "×";
    removeBtn.addEventListener(
      "click",
      () => {
        const idx = slotStates.indexOf(state);
        if (idx >= 0) slotStates.splice(idx, 1);
        slot.remove();
        syncAddBtn();
      },
      { signal },
    );

    slot.append(row1, row2, removeBtn);
    return slot;
  }

  addBtn.addEventListener(
    "click",
    () => {
      if (slots.children.length >= MAX_VERIFY_SLOTS) return;
      slots.appendChild(createSlot());
      syncAddBtn();
      refreshSlotBalances();
    },
    { signal },
  );

  root.append(head, hint, errorEl, slots);
  container.appendChild(root);
  syncHint();
  syncAddBtn();

  const unsub = options.subscribe(() => syncHint());

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unsub();
    signal.removeEventListener("abort", onAbort);
    root.remove();
  }

  const onAbort = () => dispose();
  signal.addEventListener("abort", onAbort);

  return dispose;
}
