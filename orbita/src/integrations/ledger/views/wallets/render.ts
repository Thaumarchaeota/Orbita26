import type { AccountDeleteScanResponse, AccountRecord } from "../../types";
import { escapeHtml } from "../../utils";

const WALLET_GROUPS: Array<{ key: "assets" | "liabilities"; title: string }> = [
  { key: "assets", title: "资产" },
  { key: "liabilities", title: "负债" },
];

function renderWalletRow(item: AccountRecord, selected: boolean): string {
  const labelText = item.label || "添加标签";
  const labelPh = item.label ? "" : " is-placeholder";
  return `<div class="wallets-row${selected ? " is-selected" : ""}" data-account="${escapeHtml(item.name)}">
    <div class="wallets-row-main">
      <span class="wallets-name">${escapeHtml(item.name)}</span>
      <span class="wallets-label wallets-editable${labelPh}" data-account="${escapeHtml(item.name)}" data-field="label" title="${escapeHtml(item.name)}">${escapeHtml(labelText)}</span>
    </div>
    <button type="button" class="wallets-delete-btn" data-action="scan-delete" data-account="${escapeHtml(item.name)}">删除</button>
  </div>`;
}

export function renderWalletsList(
  container: HTMLElement,
  accounts: { assets: AccountRecord[]; liabilities: AccountRecord[] },
  selectedAccount: string | null,
): void {
  const html = WALLET_GROUPS.map(({ key, title }) => {
    const items = accounts[key] || [];
    if (!items.length) return "";
    const rows = items.map((item) => renderWalletRow(item, item.name === selectedAccount)).join("");
    return `<div class="wallets-group">
      <div class="wallets-group-header">${escapeHtml(title)}</div>
      <div class="wallets-group-list">${rows}</div>
    </div>`;
  }).join("");
  container.innerHTML = html || '<p class="wallets-empty">暂无账户</p>';
}

export function renderDeleteScanPanel(
  panel: HTMLElement,
  scan: AccountDeleteScanResponse | null,
  busy: boolean,
): void {
  if (!scan) {
    panel.innerHTML = '<p class="wallets-scan-empty">选择账户并点击删除以查看扫描结果</p>';
    return;
  }
  const refs = scan.references || [];
  const children = scan.child_accounts || [];
  const refRows = refs
    .map(
      (ref) =>
        `<li>${escapeHtml(ref.source_file)}:${ref.source_line} · ${escapeHtml(ref.kind)} · ${escapeHtml(ref.date)} · ${escapeHtml(ref.field)}</li>`,
    )
    .join("");
  const childRows = children.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
  panel.innerHTML = `
    <div class="wallets-scan-card">
      <h3 class="wallets-scan-title">${escapeHtml(scan.account)}</h3>
      <p class="wallets-scan-summary">
        ${scan.can_delete ? "可删除" : "不可删除"}
        · 引用 ${scan.reference_count} · 子账户 ${scan.child_account_count}
      </p>
      ${children.length ? `<div class="wallets-scan-block"><strong>子账户</strong><ul>${childRows}</ul></div>` : ""}
      ${refs.length ? `<div class="wallets-scan-block"><strong>引用</strong><ul>${refRows}</ul></div>` : ""}
      <button type="button" class="wallets-confirm-delete-btn" id="wallets-confirm-delete" ${scan.can_delete && !busy ? "" : "disabled"}>
        ${busy ? "删除中…" : "确认删除"}
      </button>
    </div>`;
}

export function renderMigratePanel(
  panel: HTMLElement,
  summary: string,
  busy: boolean,
  canCommit: boolean,
): void {
  panel.innerHTML = `
    <div class="wallets-migrate-card">
      <h3 class="wallets-scan-title">账户迁移</h3>
      <p class="wallets-scan-summary">${escapeHtml(summary || "填写旧名与新名后扫描迁移影响")}</p>
      <button type="button" class="wallets-migrate-commit-btn" id="wallets-migrate-commit" ${canCommit && !busy ? "" : "disabled"}>
        ${busy ? "迁移中…" : "确认迁移"}
      </button>
    </div>`;
}
