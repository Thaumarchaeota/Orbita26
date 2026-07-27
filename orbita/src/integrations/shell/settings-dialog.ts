import type { AppSettings, AppTheme } from "../../core/settings";
import {
  applyAppearance,
  applyUiPrefs,
  getSettings,
  isTransparentTheme,
  patchSettings,
} from "../../core/settings";
import type { GridPrefs } from "../../core/data/types";
import { normalizeGridPrefs, DEFAULT_APPS_GRID, DEFAULT_BOOKMARKS_GRID } from "../../core/data/client";
import { SETTINGS_GEAR_SVG } from "../ai/icons";
import { pickAppFile, pickLocalFolder } from "./adapter";
import { bindDialog, type MotionTrigger } from "../../ui/motion";

export function mountSettingsButton(root: HTMLElement) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-btn";
  btn.title = "设置";
  btn.innerHTML = SETTINGS_GEAR_SVG;
  root.appendChild(btn);

  const openSettings = mountSettingsDialog(root);
  btn.addEventListener("click", (e) => void openSettings(e));
}

function mountSettingsDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-wide" id="settingsDialogForm">
      <div class="dialog-title">设置</div>
      <div class="dialog-scroll">
        <div class="dialog-field">
          <label>主题</label>
          <div class="settings-theme-row">
            <button type="button" class="dialog-btn" data-theme="light">亮色</button>
            <button type="button" class="dialog-btn" data-theme="dark">暗色</button>
            <button type="button" class="dialog-btn" data-theme="transparent-light">透明亮</button>
            <button type="button" class="dialog-btn" data-theme="transparent-dark">透明暗</button>
          </div>
        </div>
        <div class="dialog-field" id="settingsBlockOpacityField" hidden>
          <label for="settingsBlockOpacity">区块不透明度 <span id="settingsBlockOpacityVal">12</span></label>
          <input id="settingsBlockOpacity" type="range" min="0" max="100" value="12">
          <div class="settings-opacity-hint">0 为全透明，100 为不透明</div>
        </div>
        <div class="dialog-field">
          <label>书签网格</label>
          <div class="settings-grid-row">
            <label>列 <input id="settingsBookmarksCols" type="number" min="3" max="12" step="1"></label>
            <label>行 <input id="settingsBookmarksRows" type="number" min="1" max="8" step="1"></label>
          </div>
        </div>
        <div class="dialog-field">
          <label>应用网格</label>
          <div class="settings-grid-row">
            <label>列 <input id="settingsAppsCols" type="number" min="1" max="4" step="1"></label>
            <label>行 <input id="settingsAppsRows" type="number" min="1" max="10" step="1"></label>
          </div>
        </div>
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
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#settingsDialogForm")!;
  const dataDirInput = backdrop.querySelector<HTMLInputElement>("#settingsDataDir")!;
  const v2rayInput = backdrop.querySelector<HTMLInputElement>("#settingsV2rayPath")!;
  const zoteroInput = backdrop.querySelector<HTMLInputElement>("#settingsZoteroDir")!;
  const noteInput = backdrop.querySelector<HTMLInputElement>("#settingsNoteDir")!;
  const blockOpacityField = backdrop.querySelector<HTMLElement>("#settingsBlockOpacityField")!;
  const blockOpacityInput = backdrop.querySelector<HTMLInputElement>("#settingsBlockOpacity")!;
  const blockOpacityVal = backdrop.querySelector<HTMLElement>("#settingsBlockOpacityVal")!;
  const bookmarksColsInput = backdrop.querySelector<HTMLInputElement>("#settingsBookmarksCols")!;
  const bookmarksRowsInput = backdrop.querySelector<HTMLInputElement>("#settingsBookmarksRows")!;
  const appsColsInput = backdrop.querySelector<HTMLInputElement>("#settingsAppsCols")!;
  const appsRowsInput = backdrop.querySelector<HTMLInputElement>("#settingsAppsRows")!;
  const themeBtns = backdrop.querySelectorAll<HTMLButtonElement>("[data-theme]");

  let draftTheme: AppTheme = "light";
  let draftBlockOpacity = 12;
  let draftBookmarksGrid: GridPrefs = { ...DEFAULT_BOOKMARKS_GRID };
  let draftAppsGrid: GridPrefs = { ...DEFAULT_APPS_GRID };
  let savedSettings = getSettings();
  let resolvePending: ((value: boolean) => void) | null = null;

  function readDraftUi() {
    return {
      ...savedSettings.ui,
      blockOpacity: draftBlockOpacity,
      bookmarksGrid: draftBookmarksGrid,
      appsGrid: draftAppsGrid,
    };
  }

  function syncDraftGrids() {
    draftBookmarksGrid = normalizeGridPrefs(
      {
        cols: Number(bookmarksColsInput.value),
        rows: Number(bookmarksRowsInput.value),
      },
      DEFAULT_BOOKMARKS_GRID,
      3,
      12,
      1,
      8,
    );
    draftAppsGrid = normalizeGridPrefs(
      {
        cols: Number(appsColsInput.value),
        rows: Number(appsRowsInput.value),
      },
      DEFAULT_APPS_GRID,
      1,
      4,
      1,
      10,
    );
    bookmarksColsInput.value = String(draftBookmarksGrid.cols);
    bookmarksRowsInput.value = String(draftBookmarksGrid.rows);
    appsColsInput.value = String(draftAppsGrid.cols);
    appsRowsInput.value = String(draftAppsGrid.rows);
  }

  function syncBlockFieldVisibility() {
    blockOpacityField.hidden = !isTransparentTheme(draftTheme);
  }

  function fillForm(settings: AppSettings) {
    savedSettings = settings;
    draftTheme = settings.theme;
    draftBlockOpacity = settings.ui.blockOpacity;
    draftBookmarksGrid = { ...settings.ui.bookmarksGrid };
    draftAppsGrid = { ...settings.ui.appsGrid };
    blockOpacityInput.value = String(draftBlockOpacity);
    blockOpacityVal.textContent = String(draftBlockOpacity);
    bookmarksColsInput.value = String(draftBookmarksGrid.cols);
    bookmarksRowsInput.value = String(draftBookmarksGrid.rows);
    appsColsInput.value = String(draftAppsGrid.cols);
    appsRowsInput.value = String(draftAppsGrid.rows);
    dataDirInput.value = settings.dataDir;
    v2rayInput.value = settings.integrations.v2ray.exePath;
    zoteroInput.value = settings.integrations.zotero.dataDir;
    noteInput.value = settings.integrations.zotero.articleNoteDir;
    themeBtns.forEach((btn) => {
      btn.classList.toggle("dialog-btn-primary", btn.dataset.theme === draftTheme);
    });
    syncBlockFieldVisibility();
  }

  const close = async (saved: boolean) => {
    if (!saved) applyAppearance(savedSettings);
    await motion.close();
    resolvePending?.(saved);
    resolvePending = null;
  };

  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      draftTheme = btn.dataset.theme as AppTheme;
      themeBtns.forEach((b) => b.classList.toggle("dialog-btn-primary", b.dataset.theme === draftTheme));
      syncBlockFieldVisibility();
    });
  });

  blockOpacityInput.addEventListener("input", () => {
    draftBlockOpacity = Number(blockOpacityInput.value);
    blockOpacityVal.textContent = String(draftBlockOpacity);
    applyUiPrefs({ ...savedSettings.ui, blockOpacity: draftBlockOpacity });
  });

  const previewGrid = () => {
    syncDraftGrids();
    applyUiPrefs(readDraftUi());
  };
  bookmarksColsInput.addEventListener("input", previewGrid);
  bookmarksRowsInput.addEventListener("input", previewGrid);
  appsColsInput.addEventListener("input", previewGrid);
  appsRowsInput.addEventListener("input", previewGrid);

  backdrop.querySelector('[data-action="browse-data"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) dataDirInput.value = path;
  });
  backdrop.querySelector('[data-action="browse-v2ray"]')!.addEventListener("click", async () => {
    const path = await pickAppFile();
    if (path) v2rayInput.value = path;
  });
  backdrop.querySelector('[data-action="browse-zotero"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) zoteroInput.value = path;
  });
  backdrop.querySelector('[data-action="browse-note"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) noteInput.value = path;
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(false);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = await patchSettings({
      theme: draftTheme,
      dataDir: dataDirInput.value.trim(),
      ui: readDraftUi(),
      integrations: {
        v2ray: { exePath: v2rayInput.value.trim() },
        zotero: {
          dataDir: zoteroInput.value.trim(),
          articleNoteDir: noteInput.value.trim(),
        },
      },
    });
    applyAppearance(next);
    window.dispatchEvent(new CustomEvent("orbita:ui-prefs"));
    close(true);
  });

  return (trigger?: MotionTrigger) =>
    new Promise<boolean>((resolve) => {
      resolvePending = resolve;
      fillForm(getSettings());
      void motion.open(trigger);
    });
}
