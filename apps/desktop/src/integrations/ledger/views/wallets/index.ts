import { mountDecoupledDatePicker, type DecoupledDatePickerHandle } from "../../../../ui/decoupled-date-picker";
import { getConfirmDialog } from "../../../shell/dialog";
import {
  fetchAccounts,
  postAccountCreate,
  postAccountDelete,
  postAccountDeleteScan,
  postAccountLabelCommit,
  postAccountMigrateCommit,
  postAccountMigrateScan,
  postAccountMigrateValidate,
} from "../../api/client";
import { isCategoriesDirty } from "../../state/categories";
import { isLedgerDirty } from "../../state/ledger";
import { setAccounts, getAccounts } from "../../state/accounts";
import {
  renderDeleteScanPanel,
  renderMigratePanel,
  renderWalletsList,
} from "./render";
import type { AccountDeleteScanResponse, AccountMigrateValidateResponse, AccountRecord } from "../../types";
import { structureGuardReason } from "./structure-guard";

function structureBlocked(): boolean {
  return structureGuardReason(isLedgerDirty(), isCategoriesDirty()) !== null;
}

function blockedMessage(): string {
  return structureGuardReason(isLedgerDirty(), isCategoriesDirty()) ?? "";
}

function findWalletAccount(name: string): AccountRecord | undefined {
  const acc = getAccounts();
  return [...(acc.assets || []), ...(acc.liabilities || [])].find((a) => a.name === name);
}

export function mountWalletsView(panel: HTMLElement): () => void {
  panel.innerHTML = `
    <div class="wallets-view">
      <div class="wallets-toolbar">
        <form class="wallets-create-form" id="wallets-create-form">
          <h3 class="wallets-section-title">新建账户</h3>
          <div class="wallets-form-grid">
            <label>账户名<input type="text" name="name" placeholder="Assets:Wallet" required></label>
            <label>开户日<div data-region="open-date"></div></label>
            <label>币种<input type="text" name="extra" placeholder="CNY"></label>
            <label>标签<input type="text" name="label" placeholder="钱包"></label>
          </div>
          <button type="submit" class="wallets-create-btn">创建</button>
        </form>
        <form class="wallets-migrate-form" id="wallets-migrate-form">
          <h3 class="wallets-section-title">迁移账户</h3>
          <div class="wallets-form-grid">
            <label>旧名<input type="text" name="old_name" placeholder="Assets:Cash"></label>
            <label>新名<input type="text" name="new_name" placeholder="Assets:Wallet"></label>
          </div>
          <button type="submit" class="wallets-migrate-scan-btn">扫描迁移</button>
        </form>
      </div>
      <div class="wallets-layout">
        <div id="wallets-list" class="wallets-list"></div>
        <aside class="wallets-side">
          <div id="wallets-delete-scan" class="wallets-side-panel"></div>
          <div id="wallets-migrate-panel" class="wallets-side-panel"></div>
        </aside>
      </div>
    </div>`;

  const listEl = panel.querySelector<HTMLElement>("#wallets-list")!;
  const scanEl = panel.querySelector<HTMLElement>("#wallets-delete-scan")!;
  const migrateEl = panel.querySelector<HTMLElement>("#wallets-migrate-panel")!;
  const createForm = panel.querySelector<HTMLFormElement>("#wallets-create-form")!;
  const migrateForm = panel.querySelector<HTMLFormElement>("#wallets-migrate-form")!;
  const openDatePicker: DecoupledDatePickerHandle = mountDecoupledDatePicker({ defaultTrigger: { container: createForm.querySelector<HTMLElement>('[data-region="open-date"]')! }, value: "2026-01-01" });

  const ac = new AbortController();
  const { signal } = ac;
  const confirmDialog = getConfirmDialog();
  let selectedAccount: string | null = null;
  let deleteScan: AccountDeleteScanResponse | null = null;
  let migrateValidation: AccountMigrateValidateResponse | null = null;
  let migrateSummary = "";
  let deleteBusy = false;
  let migrateBusy = false;
  let labelBusy = false;
  let activeLabelEdit: { el: HTMLElement; input: HTMLInputElement; account: string } | null = null;

  function cancelLabelEdit(): void {
    activeLabelEdit = null;
    refreshList();
  }

  async function commitLabelEdit(): Promise<void> {
    if (!activeLabelEdit) return;
    const { input, account } = activeLabelEdit;
    const item = findWalletAccount(account);
    const label = input.value.trim();
    activeLabelEdit = null;
    if (!item) {
      refreshList();
      return;
    }
    if (label === (item.label || "")) {
      refreshList();
      return;
    }
    if (structureBlocked()) {
      alert(blockedMessage());
      refreshList();
      return;
    }
    labelBusy = true;
    refreshList();
    try {
      await postAccountLabelCommit({
        accounts: [
          {
            id: item.id,
            name: item.name,
            source_file: item.source_file,
            source_line: item.source_line,
            label,
            open_date: item.open_date || "2026-01-01",
            extra: item.extra || "",
          },
        ],
      });
      await reloadAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "标签保存失败");
      refreshList();
    } finally {
      labelBusy = false;
      refreshList();
    }
  }

  function startLabelEdit(el: HTMLElement): void {
    const account = el.dataset.account || "";
    const item = findWalletAccount(account);
    if (!item || labelBusy) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "wallets-editable-input";
    input.value = item.label || "";
    el.classList.add("editing");
    el.textContent = "";
    el.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitLabelEdit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelLabelEdit();
      }
    });
    activeLabelEdit = { el, input, account };
  }

  function refreshList(): void {
    const acc = getAccounts();
    renderWalletsList(listEl, { assets: acc.assets, liabilities: acc.liabilities }, selectedAccount);
    renderDeleteScanPanel(scanEl, deleteScan, deleteBusy);
    renderMigratePanel(migrateEl, migrateSummary, migrateBusy, Boolean(migrateValidation?.ok));
  }

  async function reloadAccounts(): Promise<void> {
    const acc = await fetchAccounts();
    setAccounts(acc);
    refreshList();
  }

  refreshList();
  renderMigratePanel(migrateEl, migrateSummary, migrateBusy, false);

  panel.addEventListener(
    "click",
    async (e) => {
      const target = e.target as HTMLElement;
      const labelEl = target.closest<HTMLElement>(".wallets-editable");
      if (labelEl && listEl.contains(labelEl)) {
        if (activeLabelEdit && activeLabelEdit.el !== labelEl) await commitLabelEdit();
        if (!labelEl.classList.contains("editing")) startLabelEdit(labelEl);
        return;
      }

      const scanBtn = target.closest<HTMLButtonElement>('[data-action="scan-delete"]');
      if (scanBtn) {
        if (structureBlocked()) {
          alert(blockedMessage());
          return;
        }
        const account = scanBtn.dataset.account || "";
        selectedAccount = account;
        try {
          deleteScan = await postAccountDeleteScan(account);
        } catch (err) {
          alert(err instanceof Error ? err.message : "扫描失败");
          deleteScan = null;
        }
        refreshList();
        return;
      }

      if (target.id === "wallets-confirm-delete" && deleteScan?.can_delete) {
        if (structureBlocked()) {
          alert(blockedMessage());
          return;
        }
        if (!(await confirmDialog("删除确认", `确认删除账户 ${deleteScan.account}？`, target))) return;
        deleteBusy = true;
        refreshList();
        try {
          await postAccountDelete(deleteScan.account);
          deleteScan = null;
          selectedAccount = null;
          await reloadAccounts();
        } catch (err) {
          alert(err instanceof Error ? err.message : "删除失败");
        } finally {
          deleteBusy = false;
          refreshList();
        }
      }

      if (target.id === "wallets-migrate-commit" && migrateValidation?.ok) {
        if (structureBlocked()) {
          alert(blockedMessage());
          return;
        }
        const oldName = migrateValidation.scan?.old_name || "";
        const newName = migrateValidation.scan?.new_name || "";
        if (!(await confirmDialog("迁移确认", `确认将 ${oldName} 迁移为 ${newName}？`, target, { confirmLabel: "迁移", danger: true }))) return;
        migrateBusy = true;
        refreshList();
        try {
          await postAccountMigrateCommit({
            old_name: oldName,
            new_name: newName,
            validation_token: migrateValidation.validation_token || "",
            candidate_hash: migrateValidation.candidate_hash || "",
          });
          migrateValidation = null;
          migrateSummary = "迁移完成";
          deleteScan = null;
          selectedAccount = null;
          await reloadAccounts();
        } catch (err) {
          alert(err instanceof Error ? err.message : "迁移失败");
        } finally {
          migrateBusy = false;
          refreshList();
        }
      }
    },
    { signal },
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!activeLabelEdit) return;
      if ((e.target as HTMLElement).closest(".wallets-editable.editing")) return;
      void commitLabelEdit();
    },
    { signal },
  );

  createForm.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      if (structureBlocked()) {
        alert(blockedMessage());
        return;
      }
      const fd = new FormData(createForm);
      const name = String(fd.get("name") || "").trim();
      const open_date = openDatePicker.getValue().trim();
      if (!open_date) {
        alert("请填写开户日");
        return;
      }
      const extra = String(fd.get("extra") || "").trim();
      const label = String(fd.get("label") || "").trim();
      try {
        await postAccountCreate({ name, open_date, extra, label });
        createForm.reset();
        openDatePicker.setValue(open_date || "2026-01-01");
        await reloadAccounts();
      } catch (err) {
        alert(err instanceof Error ? err.message : "创建失败");
      }
    },
    { signal },
  );

  migrateForm.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      if (structureBlocked()) {
        alert(blockedMessage());
        return;
      }
      const fd = new FormData(migrateForm);
      const old_name = String(fd.get("old_name") || "").trim();
      const new_name = String(fd.get("new_name") || "").trim();
      migrateBusy = true;
      migrateValidation = null;
      migrateSummary = "扫描中…";
      refreshList();
      try {
        const scan = await postAccountMigrateScan(old_name, new_name);
        if (scan.blocking_diagnostics?.length) {
          migrateSummary = scan.blocking_diagnostics.map((d) => d.message).join("；");
          migrateValidation = null;
          refreshList();
          return;
        }
        if (!scan.can_migrate) {
          migrateSummary = "没有可迁移的引用";
          migrateValidation = null;
          refreshList();
          return;
        }
        const validated = await postAccountMigrateValidate(old_name, new_name);
        migrateValidation = validated;
        if (!validated.ok) {
          const diags = validated.diagnostics?.map((d) => d.message).join("；");
          migrateSummary = validated.error || diags || "迁移校验失败";
          refreshList();
          return;
        }
        const files = validated.scan?.affected_files?.map((f) => `${f.file}(${f.changes})`).join("、") || "";
        migrateSummary = `影响 ${validated.change_count} 处 · ${validated.file_count} 个文件 · ${files}`;
      } catch (err) {
        migrateSummary = err instanceof Error ? err.message : "迁移扫描失败";
        migrateValidation = null;
      } finally {
        migrateBusy = false;
        refreshList();
      }
    },
    { signal },
  );

  return () => {
    ac.abort();
    openDatePicker.dispose();
  };
}
