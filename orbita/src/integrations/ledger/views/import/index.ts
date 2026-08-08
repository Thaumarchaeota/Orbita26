import type { LedgerRouter } from "../../shell";

export function mountImportView(panel: HTMLElement, _router: LedgerRouter): () => void {
  panel.innerHTML = `
    <div class="ledger-placeholder">
      <p>导入功能开发中</p>
    </div>`;
  return () => {};
}
