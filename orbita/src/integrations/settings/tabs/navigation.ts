import type { AppSettings } from "../../../core/settings";
import { pickAppFile, pickLocalFolder } from "../../shell/adapter";

export const navigationTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="navigation" hidden>
    <div class="dialog-field">
      <label for="settingsDataDir">数据存储位置</label>
      <div class="settings-path-row">
        <input id="settingsDataDir" type="text" readonly>
        <button type="button" class="dialog-btn" data-action="browse-data">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="settingsV2rayPath">v2rayN 路径</label>
      <div class="settings-path-row">
        <input id="settingsV2rayPath" type="text">
        <button type="button" class="dialog-btn" data-action="browse-v2ray">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="settingsZoteroDir">Zotero 数据目录</label>
      <div class="settings-path-row">
        <input id="settingsZoteroDir" type="text" readonly>
        <button type="button" class="dialog-btn" data-action="browse-zotero">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="settingsNoteDir">文献笔记目录</label>
      <div class="settings-path-row">
        <input id="settingsNoteDir" type="text" readonly>
        <button type="button" class="dialog-btn" data-action="browse-note">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="settingsVaultDir">Obsidian 库目录</label>
      <div class="settings-path-row">
        <input id="settingsVaultDir" type="text" readonly>
        <button type="button" class="dialog-btn" data-action="browse-vault">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="settingsEverythingPath">Everything es.exe</label>
      <div class="settings-path-row">
        <input id="settingsEverythingPath" type="text">
        <button type="button" class="dialog-btn" data-action="browse-everything">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="settingsCursorPath">Cursor 路径</label>
      <div class="settings-path-row">
        <input id="settingsCursorPath" type="text" placeholder="Cursor.exe">
        <button type="button" class="dialog-btn" data-action="browse-cursor">浏览</button>
      </div>
    </div>
  </div>`;

export type NavigationDraft = {
  dataDir: string;
  v2rayExePath: string;
  zoteroDataDir: string;
  zoteroNoteDir: string;
  obsidianVaultDir: string;
  everythingExePath: string;
  cursorExePath: string;
};

export function bindNavigationTab(root: HTMLElement) {
  const dataDirInput = root.querySelector<HTMLInputElement>("#settingsDataDir")!;
  const v2rayInput = root.querySelector<HTMLInputElement>("#settingsV2rayPath")!;
  const zoteroInput = root.querySelector<HTMLInputElement>("#settingsZoteroDir")!;
  const noteInput = root.querySelector<HTMLInputElement>("#settingsNoteDir")!;
  const vaultInput = root.querySelector<HTMLInputElement>("#settingsVaultDir")!;
  const everythingInput = root.querySelector<HTMLInputElement>("#settingsEverythingPath")!;
  const cursorInput = root.querySelector<HTMLInputElement>("#settingsCursorPath")!;

  root.querySelector('[data-action="browse-data"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) dataDirInput.value = path;
  });
  root.querySelector('[data-action="browse-v2ray"]')!.addEventListener("click", async () => {
    const path = await pickAppFile();
    if (path) v2rayInput.value = path;
  });
  root.querySelector('[data-action="browse-zotero"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) zoteroInput.value = path;
  });
  root.querySelector('[data-action="browse-note"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) noteInput.value = path;
  });
  root.querySelector('[data-action="browse-vault"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) vaultInput.value = path;
  });
  root.querySelector('[data-action="browse-everything"]')!.addEventListener("click", async () => {
    const path = await pickAppFile();
    if (path) everythingInput.value = path;
  });
  root.querySelector('[data-action="browse-cursor"]')!.addEventListener("click", async () => {
    const path = await pickAppFile();
    if (path) cursorInput.value = path;
  });

  return {
    fill(settings: AppSettings) {
      dataDirInput.value = settings.dataDir;
      v2rayInput.value = settings.integrations.v2ray.exePath;
      zoteroInput.value = settings.integrations.zotero.dataDir;
      noteInput.value = settings.integrations.zotero.articleNoteDir;
      vaultInput.value = settings.integrations.obsidian.vaultDir;
      everythingInput.value = settings.integrations.everything.exePath;
      cursorInput.value = settings.integrations.cursor.exePath;
    },
    read(): NavigationDraft {
      return {
        dataDir: dataDirInput.value.trim(),
        v2rayExePath: v2rayInput.value.trim(),
        zoteroDataDir: zoteroInput.value.trim(),
        zoteroNoteDir: noteInput.value.trim(),
        obsidianVaultDir: vaultInput.value.trim(),
        everythingExePath: everythingInput.value.trim(),
        cursorExePath: cursorInput.value.trim(),
      };
    },
  };
}
