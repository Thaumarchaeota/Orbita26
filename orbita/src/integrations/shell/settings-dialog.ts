import type { AppSettings, AppTheme } from "../../core/settings";
import {
  applyAppearance,
  applyUiPrefs,
  getSettings,
  isTransparentTheme,
  patchSettings,
} from "../../core/settings";
import type { GridPrefs } from "../../core/data/types";
import { normalizeGridLayoutPrefs, DEFAULT_TOP_GRID, DEFAULT_DOCK_LEFT_GRID } from "../../core/data/client";
import { SETTINGS_GEAR_SVG } from "../ai/icons";
import { pickAppFile, pickLocalFolder } from "./adapter";
import { bindDialog, type MotionTrigger } from "../../ui/motion";
import { didaAuthStatus, didaConnect, didaDisconnect, invokeError } from "../ticktick/client";

export function mountSettingsButton(root: HTMLElement) {
  const mount = root.querySelector<HTMLElement>("#settingsMount") ?? root;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-btn";
  btn.title = "设置";
  btn.innerHTML = SETTINGS_GEAR_SVG;
  mount.appendChild(btn);

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
          <label>上方网格（应用）</label>
          <div class="settings-grid-row">
            <label>列 <input id="settingsAppsCols" type="number" min="3" max="12" step="1"></label>
            <label>行 <input id="settingsAppsRows" type="number" min="1" max="8" step="1"></label>
          </div>
          <div class="settings-grid-row">
            <label>图标 <span id="settingsTopTileScaleVal">100</span>%</label>
            <input id="settingsTopTileScale" type="range" min="70" max="130" step="5" value="100">
          </div>
          <div class="settings-grid-row">
            <label>列距 <span id="settingsTopColGapVal">8</span></label>
            <input id="settingsTopColGap" type="range" min="0" max="24" step="1" value="8">
            <label>行距 <span id="settingsTopRowGapVal">8</span></label>
            <input id="settingsTopRowGap" type="range" min="0" max="24" step="1" value="8">
          </div>
        </div>
        <div class="dialog-field">
          <label>左下网格（书签）</label>
          <div class="settings-grid-row">
            <label>列 <input id="settingsBookmarksCols" type="number" min="1" max="4" step="1"></label>
            <label>行 <input id="settingsBookmarksRows" type="number" min="1" max="10" step="1"></label>
          </div>
          <div class="settings-grid-row">
            <label>图标 <span id="settingsDockTileScaleVal">100</span>%</label>
            <input id="settingsDockTileScale" type="range" min="70" max="130" step="5" value="100">
          </div>
          <div class="settings-grid-row">
            <label>列距 <span id="settingsDockColGapVal">8</span></label>
            <input id="settingsDockColGap" type="range" min="0" max="24" step="1" value="8">
            <label>行距 <span id="settingsDockRowGapVal">8</span></label>
            <input id="settingsDockRowGap" type="range" min="0" max="24" step="1" value="8">
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
        <div class="dialog-field">
          <label for="settingsVaultDir">Obsidian 库目录</label>
          <div class="settings-path-row">
            <input id="settingsVaultDir" type="text" readonly>
            <button type="button" class="dialog-btn" data-action="browse-vault">浏览</button>
          </div>
        </div>
        <div class="dialog-field">
          <label>滴答清单</label>
          <div class="dialog-field">
            <label for="settingsTicktickClientId">Client ID</label>
            <input id="settingsTicktickClientId" type="text" autocomplete="off">
          </div>
          <div class="dialog-field">
            <label for="settingsTicktickClientSecret">Client Secret</label>
            <input id="settingsTicktickClientSecret" type="password" autocomplete="off">
          </div>
          <div class="dialog-field">
            <label for="settingsTicktickRedirect">Redirect URI</label>
            <input id="settingsTicktickRedirect" type="text" autocomplete="off">
          </div>
          <div class="settings-path-row">
            <button type="button" class="dialog-btn" data-action="ticktick-connect">连接</button>
            <button type="button" class="dialog-btn" data-action="ticktick-disconnect">断开</button>
            <span id="settingsTicktickStatus" class="settings-ticktick-status"></span>
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
  const vaultInput = backdrop.querySelector<HTMLInputElement>("#settingsVaultDir")!;
  const ticktickClientIdInput = backdrop.querySelector<HTMLInputElement>("#settingsTicktickClientId")!;
  const ticktickClientSecretInput = backdrop.querySelector<HTMLInputElement>("#settingsTicktickClientSecret")!;
  const ticktickRedirectInput = backdrop.querySelector<HTMLInputElement>("#settingsTicktickRedirect")!;
  const ticktickStatusEl = backdrop.querySelector<HTMLElement>("#settingsTicktickStatus")!;
  const blockOpacityField = backdrop.querySelector<HTMLElement>("#settingsBlockOpacityField")!;
  const blockOpacityInput = backdrop.querySelector<HTMLInputElement>("#settingsBlockOpacity")!;
  const blockOpacityVal = backdrop.querySelector<HTMLElement>("#settingsBlockOpacityVal")!;
  const topTileScaleInput = backdrop.querySelector<HTMLInputElement>("#settingsTopTileScale")!;
  const topTileScaleVal = backdrop.querySelector<HTMLElement>("#settingsTopTileScaleVal")!;
  const topColGapInput = backdrop.querySelector<HTMLInputElement>("#settingsTopColGap")!;
  const topColGapVal = backdrop.querySelector<HTMLElement>("#settingsTopColGapVal")!;
  const topRowGapInput = backdrop.querySelector<HTMLInputElement>("#settingsTopRowGap")!;
  const topRowGapVal = backdrop.querySelector<HTMLElement>("#settingsTopRowGapVal")!;
  const dockTileScaleInput = backdrop.querySelector<HTMLInputElement>("#settingsDockTileScale")!;
  const dockTileScaleVal = backdrop.querySelector<HTMLElement>("#settingsDockTileScaleVal")!;
  const dockColGapInput = backdrop.querySelector<HTMLInputElement>("#settingsDockColGap")!;
  const dockColGapVal = backdrop.querySelector<HTMLElement>("#settingsDockColGapVal")!;
  const dockRowGapInput = backdrop.querySelector<HTMLInputElement>("#settingsDockRowGap")!;
  const dockRowGapVal = backdrop.querySelector<HTMLElement>("#settingsDockRowGapVal")!;
  const bookmarksColsInput = backdrop.querySelector<HTMLInputElement>("#settingsBookmarksCols")!;
  const bookmarksRowsInput = backdrop.querySelector<HTMLInputElement>("#settingsBookmarksRows")!;
  const appsColsInput = backdrop.querySelector<HTMLInputElement>("#settingsAppsCols")!;
  const appsRowsInput = backdrop.querySelector<HTMLInputElement>("#settingsAppsRows")!;
  const themeBtns = backdrop.querySelectorAll<HTMLButtonElement>("[data-theme]");

  let draftTheme: AppTheme = "light";
  let draftBlockOpacity = 12;
  let draftTopGrid: GridPrefs = { ...DEFAULT_TOP_GRID };
  let draftDockLeftGrid: GridPrefs = { ...DEFAULT_DOCK_LEFT_GRID };
  let savedSettings = getSettings();
  let resolvePending: ((value: boolean) => void) | null = null;

  function readDraftUi() {
    return {
      ...savedSettings.ui,
      blockOpacity: draftBlockOpacity,
      topGrid: draftTopGrid,
      dockLeftGrid: draftDockLeftGrid,
    };
  }

  function syncDraftGrids() {
    draftTopGrid = normalizeGridLayoutPrefs(
      {
        cols: Number(appsColsInput.value),
        rows: Number(appsRowsInput.value),
        tileScale: Number(topTileScaleInput.value),
        colGap: Number(topColGapInput.value),
        rowGap: Number(topRowGapInput.value),
      },
      draftTopGrid,
      3,
      12,
      1,
      8,
    );
    draftDockLeftGrid = normalizeGridLayoutPrefs(
      {
        cols: Number(bookmarksColsInput.value),
        rows: Number(bookmarksRowsInput.value),
        tileScale: Number(dockTileScaleInput.value),
        colGap: Number(dockColGapInput.value),
        rowGap: Number(dockRowGapInput.value),
      },
      draftDockLeftGrid,
      1,
      4,
      1,
      10,
    );
    bookmarksColsInput.value = String(draftDockLeftGrid.cols);
    bookmarksRowsInput.value = String(draftDockLeftGrid.rows);
    appsColsInput.value = String(draftTopGrid.cols);
    appsRowsInput.value = String(draftTopGrid.rows);
    topTileScaleInput.value = String(draftTopGrid.tileScale);
    topTileScaleVal.textContent = String(draftTopGrid.tileScale);
    topColGapInput.value = String(draftTopGrid.colGap);
    topColGapVal.textContent = String(draftTopGrid.colGap);
    topRowGapInput.value = String(draftTopGrid.rowGap);
    topRowGapVal.textContent = String(draftTopGrid.rowGap);
    dockTileScaleInput.value = String(draftDockLeftGrid.tileScale);
    dockTileScaleVal.textContent = String(draftDockLeftGrid.tileScale);
    dockColGapInput.value = String(draftDockLeftGrid.colGap);
    dockColGapVal.textContent = String(draftDockLeftGrid.colGap);
    dockRowGapInput.value = String(draftDockLeftGrid.rowGap);
    dockRowGapVal.textContent = String(draftDockLeftGrid.rowGap);
  }

  function fillGridInputs(grid: GridPrefs, prefix: "top" | "dock") {
    if (prefix === "top") {
      appsColsInput.value = String(grid.cols);
      appsRowsInput.value = String(grid.rows);
      topTileScaleInput.value = String(grid.tileScale);
      topTileScaleVal.textContent = String(grid.tileScale);
      topColGapInput.value = String(grid.colGap);
      topColGapVal.textContent = String(grid.colGap);
      topRowGapInput.value = String(grid.rowGap);
      topRowGapVal.textContent = String(grid.rowGap);
    } else {
      bookmarksColsInput.value = String(grid.cols);
      bookmarksRowsInput.value = String(grid.rows);
      dockTileScaleInput.value = String(grid.tileScale);
      dockTileScaleVal.textContent = String(grid.tileScale);
      dockColGapInput.value = String(grid.colGap);
      dockColGapVal.textContent = String(grid.colGap);
      dockRowGapInput.value = String(grid.rowGap);
      dockRowGapVal.textContent = String(grid.rowGap);
    }
  }

  function syncBlockFieldVisibility() {
    blockOpacityField.hidden = !isTransparentTheme(draftTheme);
  }

  function fillForm(settings: AppSettings) {
    savedSettings = settings;
    draftTheme = settings.theme;
    draftBlockOpacity = settings.ui.blockOpacity;
    draftTopGrid = { ...settings.ui.topGrid };
    draftDockLeftGrid = { ...settings.ui.dockLeftGrid };
    blockOpacityInput.value = String(draftBlockOpacity);
    blockOpacityVal.textContent = String(draftBlockOpacity);
    fillGridInputs(draftTopGrid, "top");
    fillGridInputs(draftDockLeftGrid, "dock");
    dataDirInput.value = settings.dataDir;
    v2rayInput.value = settings.integrations.v2ray.exePath;
    zoteroInput.value = settings.integrations.zotero.dataDir;
    noteInput.value = settings.integrations.zotero.articleNoteDir;
    vaultInput.value = settings.integrations.obsidian.vaultDir;
    ticktickClientIdInput.value = settings.integrations.ticktick.clientId;
    ticktickClientSecretInput.value = settings.integrations.ticktick.clientSecret;
    ticktickRedirectInput.value = settings.integrations.ticktick.redirectUri;
    void didaAuthStatus().then(({ connected }) => {
      ticktickStatusEl.textContent = connected ? "已连接" : "未连接";
    });
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

  const previewLayout = () => {
    syncDraftGrids();
    applyUiPrefs(readDraftUi());
  };
  bookmarksColsInput.addEventListener("input", previewLayout);
  bookmarksRowsInput.addEventListener("input", previewLayout);
  appsColsInput.addEventListener("input", previewLayout);
  appsRowsInput.addEventListener("input", previewLayout);
  topTileScaleInput.addEventListener("input", previewLayout);
  topColGapInput.addEventListener("input", previewLayout);
  topRowGapInput.addEventListener("input", previewLayout);
  dockTileScaleInput.addEventListener("input", previewLayout);
  dockColGapInput.addEventListener("input", previewLayout);
  dockRowGapInput.addEventListener("input", previewLayout);

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
  backdrop.querySelector('[data-action="browse-vault"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) vaultInput.value = path;
  });

  backdrop.querySelector('[data-action="ticktick-connect"]')!.addEventListener("click", async () => {
    const current = getSettings();
    await patchSettings({
      integrations: {
        ...current.integrations,
        ticktick: {
          clientId: ticktickClientIdInput.value.trim(),
          clientSecret: ticktickClientSecretInput.value.trim(),
          redirectUri: ticktickRedirectInput.value.trim(),
          accessToken: current.integrations.ticktick.accessToken,
          defaultProjectId: current.integrations.ticktick.defaultProjectId,
        },
      },
    });
    try {
      await didaConnect();
      ticktickStatusEl.textContent = "已连接";
      window.dispatchEvent(new CustomEvent("orbita:ticktick-auth"));
    } catch (e) {
      alert(invokeError(e));
    }
  });

  backdrop.querySelector('[data-action="ticktick-disconnect"]')!.addEventListener("click", async () => {
    await didaDisconnect();
    ticktickStatusEl.textContent = "未连接";
    window.dispatchEvent(new CustomEvent("orbita:ticktick-auth"));
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
        obsidian: { vaultDir: vaultInput.value.trim() },
        ticktick: {
          clientId: ticktickClientIdInput.value.trim(),
          clientSecret: ticktickClientSecretInput.value.trim(),
          redirectUri: ticktickRedirectInput.value.trim(),
          accessToken: savedSettings.integrations.ticktick.accessToken,
          defaultProjectId: savedSettings.integrations.ticktick.defaultProjectId,
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
