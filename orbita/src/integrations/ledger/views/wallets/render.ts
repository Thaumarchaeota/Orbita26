import type { AccountRecord } from "../../types";
import { getAccounts } from "../../state/accounts";
import { escapeHtml } from "../../utils";

const WALLET_GROUPS: Array<{ key: "assets" | "liabilities"; title: string }> = [
  { key: "assets", title: "资产" },
  { key: "liabilities", title: "负债" },
];

function renderWalletRow(item: AccountRecord): string {
  const label = item.label
    ? `<span class="wallets-label">${escapeHtml(item.label)}</span>`
    : "";
  return `<div class="wallets-row">
    <span class="wallets-name">${escapeHtml(item.name)}</span>
    ${label}
  </div>`;
}

export function renderWalletsList(container: HTMLElement): void {
  const accounts = getAccounts();
  const html = WALLET_GROUPS
    .map(({ key, title }) => {
      const items = accounts[key] || [];
      if (!items.length) return "";
      const rows = items.map(renderWalletRow).join("");
      return `<div class="wallets-group">
        <div class="wallets-group-header">${escapeHtml(title)}</div>
        <div class="wallets-group-list">${rows}</div>
      </div>`;
    })
    .join("");
  container.innerHTML = html || '<p class="wallets-empty">暂无账户</p>';
}
