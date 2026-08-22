import { notifyDataDirChanged } from "../../../core/data/dir-sync";
import { patchForDataDirChange } from "../../../core/data/rebase-data-dir";
import { isTauri } from "../../../core/data/client";
import { getSettings, patchSettings } from "../../../core/settings";
import { SETTINGS_GEAR_SVG } from "../../ai/icons";
import { pickLocalFolder } from "../../shell/adapter";
import { invoke } from "@tauri-apps/api/core";

let open = false;

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
        </div>
      </div>
      <footer class="admin-settings-footer">
        <button type="button" class="admin-settings-btn-secondary" data-action="cancel">取消</button>
        <button type="submit" class="admin-settings-btn-primary">保存</button>
      </footer>
    </form>`;

  document.body.appendChild(backdrop);

  const form = backdrop.querySelector<HTMLFormElement>(".admin-settings-dialog")!;
  const dataDirEl = backdrop.querySelector<HTMLInputElement>("#admin-data-dir")!;
  dataDirEl.value = getSettings().dataDir;

  function close(): void {
    if (!open) return;
    open = false;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  backdrop.querySelector('[data-action="browse-data"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) dataDirEl.value = path;
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", close);
  backdrop.querySelector(".admin-settings-close")!.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { requestInsightDataDirChange } = await import("../shell");
    if (!(await requestInsightDataDirChange())) return;
    const current = getSettings();
    await patchSettings(patchForDataDirChange(current, dataDirEl.value));
    if (isTauri()) await invoke("restart_ledger_sidecar");
    notifyDataDirChanged();
    close();
  });

  requestAnimationFrame(() => backdrop.classList.add("is-open"));
}
