import { notifyDataDirChanged } from "../../../core/data/dir-sync";
import { patchForDataDirChange } from "../../../core/data/rebase-data-dir";
import { isTauri } from "../../../core/data/client";
import { getSettings, patchSettings } from "../../../core/settings";
import { SETTINGS_GEAR_SVG } from "../../ai/icons";
import { pickLocalFolder } from "../../shell/adapter";
import { bindDialog } from "../../../ui/motion";
import { mountModalBackdrop } from "../../../ui/modal-root";
import { invoke } from "@tauri-apps/api/core";

let open = false;

export function isBillDirectory(path: string): boolean {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1)?.toLowerCase() === "bill";
}

export function mountAdminSettingsButton(titlebar: HTMLElement): () => void {
  const spacer = titlebar.querySelector(".admin-titlebar-spacer");
  if (!spacer) return () => {};

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-settings-btn";
  btn.setAttribute("aria-label", "设置");
  btn.innerHTML = SETTINGS_GEAR_SVG;
  titlebar.insertBefore(btn, spacer);

  const ac = new AbortController();
  btn.addEventListener("click", () => openAdminSettings(), { signal: ac.signal });

  return () => ac.abort();
}

export function openAdminSettings(): void {
  if (open) return;
  open = true;

  const backdrop = document.createElement("div");
  backdrop.className = "admin-settings-backdrop";
  backdrop.innerHTML = `
    <form class="admin-settings-dialog" role="dialog" aria-label="设置">
      <header class="admin-settings-header">
        <h2 class="admin-settings-title">设置</h2>
        <button type="button" class="admin-settings-close" aria-label="关闭">&times;</button>
      </header>
      <div class="admin-settings-body">
        <div class="admin-settings-field">
          <label class="admin-settings-label" for="admin-data-dir">数据存储位置</label>
          <div class="admin-settings-path-row">
            <input id="admin-data-dir" type="text" placeholder="Orbita 数据根目录" readonly>
            <button type="button" class="admin-settings-browse" data-action="browse-data">浏览</button>
          </div>
          <p class="admin-settings-hint">账本目录固定为此处下的 bill 文件夹（需 account.bean、category.bean、ledger/*.bean）</p>
          <p class="admin-settings-error" role="status" hidden></p>
        </div>
      </div>
      <footer class="admin-settings-footer">
        <button type="button" class="admin-settings-btn-secondary" data-action="cancel">取消</button>
        <button type="submit" class="admin-settings-btn-primary">保存</button>
      </footer>
    </form>`;

  // All overlays share this root so the settings dialog cannot sit below a Finance modal.
  mountModalBackdrop(backdrop);

  const form = backdrop.querySelector<HTMLFormElement>(".admin-settings-dialog")!;
  const dataDirEl = backdrop.querySelector<HTMLInputElement>("#admin-data-dir")!;
  const errorEl = backdrop.querySelector<HTMLElement>(".admin-settings-error")!;
  const submitBtn = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  const motion = bindDialog(backdrop, form);
  dataDirEl.value = getSettings().dataDir;

  async function close(): Promise<void> {
    if (!open) return;
    open = false;
    document.removeEventListener("keydown", onKey);
    await motion.close();
    backdrop.remove();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") void close();
  }

  backdrop.querySelector('[data-action="browse-data"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) {
      dataDirEl.value = path;
      errorEl.hidden = true;
    }
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close());
  backdrop.querySelector(".admin-settings-close")!.addEventListener("click", () => void close());
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close();
  });
  document.addEventListener("keydown", onKey);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nextDataDir = dataDirEl.value.trim();
    if (isBillDirectory(nextDataDir)) {
      errorEl.textContent = "请选择包含 bill 文件夹的数据根目录，而不是 bill 文件夹本身。";
      errorEl.hidden = false;
      return;
    }
    const { requestInsightDataDirChange } = await import("../shell");
    if (!(await requestInsightDataDirChange())) return;
    const current = getSettings();
    if (current.dataDir === nextDataDir) {
      void close();
      return;
    }

    submitBtn.disabled = true;
    errorEl.hidden = true;
    try {
      // Persist first because the sidecar reads its root from bootstrap. If it cannot restart,
      // restore the old root before either webview receives the dataDir change notification.
      await patchSettings(patchForDataDirChange(current, nextDataDir));
      if (isTauri()) await invoke("restart_ledger_sidecar");
    } catch (error) {
      try {
        await patchSettings(current);
        if (isTauri()) await invoke("restart_ledger_sidecar");
        errorEl.textContent = `未能切换数据目录，已恢复原目录：${String(error)}`;
      } catch (rollbackError) {
        errorEl.textContent = `未能切换数据目录，恢复原目录也失败：${String(rollbackError)}`;
      }
      errorEl.hidden = false;
      submitBtn.disabled = false;
      return;
    }
    notifyDataDirChanged();
    void close();
  });

  void motion.open();
}
