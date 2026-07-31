import type { AppSettings } from "../../../core/settings";
import type { GridPrefs } from "../../../core/data/types";
import { DEFAULT_DOCK_LEFT_GRID, DEFAULT_TOP_GRID, normalizeGridLayoutPrefs } from "../../../core/data/client";

export const layoutTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="layout" hidden>
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
  </div>`;

export type LayoutState = {
  topGrid: GridPrefs;
  dockLeftGrid: GridPrefs;
};

export function createLayoutState(settings: AppSettings): LayoutState {
  return {
    topGrid: { ...settings.ui.topGrid },
    dockLeftGrid: { ...settings.ui.dockLeftGrid },
  };
}

export function bindLayoutTab(
  root: HTMLElement,
  getState: () => LayoutState,
  setState: (patch: Partial<LayoutState>) => void,
  onPreview: () => void,
) {
  const topTileScaleInput = root.querySelector<HTMLInputElement>("#settingsTopTileScale")!;
  const topTileScaleVal = root.querySelector<HTMLElement>("#settingsTopTileScaleVal")!;
  const topColGapInput = root.querySelector<HTMLInputElement>("#settingsTopColGap")!;
  const topColGapVal = root.querySelector<HTMLElement>("#settingsTopColGapVal")!;
  const topRowGapInput = root.querySelector<HTMLInputElement>("#settingsTopRowGap")!;
  const topRowGapVal = root.querySelector<HTMLElement>("#settingsTopRowGapVal")!;
  const dockTileScaleInput = root.querySelector<HTMLInputElement>("#settingsDockTileScale")!;
  const dockTileScaleVal = root.querySelector<HTMLElement>("#settingsDockTileScaleVal")!;
  const dockColGapInput = root.querySelector<HTMLInputElement>("#settingsDockColGap")!;
  const dockColGapVal = root.querySelector<HTMLElement>("#settingsDockColGapVal")!;
  const dockRowGapInput = root.querySelector<HTMLInputElement>("#settingsDockRowGap")!;
  const dockRowGapVal = root.querySelector<HTMLElement>("#settingsDockRowGapVal")!;
  const bookmarksColsInput = root.querySelector<HTMLInputElement>("#settingsBookmarksCols")!;
  const bookmarksRowsInput = root.querySelector<HTMLInputElement>("#settingsBookmarksRows")!;
  const appsColsInput = root.querySelector<HTMLInputElement>("#settingsAppsCols")!;
  const appsRowsInput = root.querySelector<HTMLInputElement>("#settingsAppsRows")!;

  const syncDraftGrids = () => {
    const topGrid = normalizeGridLayoutPrefs(
      {
        cols: Number(appsColsInput.value),
        rows: Number(appsRowsInput.value),
        tileScale: Number(topTileScaleInput.value),
        colGap: Number(topColGapInput.value),
        rowGap: Number(topRowGapInput.value),
      },
      getState().topGrid,
      3,
      12,
      1,
      8,
    );
    const dockLeftGrid = normalizeGridLayoutPrefs(
      {
        cols: Number(bookmarksColsInput.value),
        rows: Number(bookmarksRowsInput.value),
        tileScale: Number(dockTileScaleInput.value),
        colGap: Number(dockColGapInput.value),
        rowGap: Number(dockRowGapInput.value),
      },
      getState().dockLeftGrid,
      1,
      4,
      1,
      10,
    );
    setState({ topGrid, dockLeftGrid });
    bookmarksColsInput.value = String(dockLeftGrid.cols);
    bookmarksRowsInput.value = String(dockLeftGrid.rows);
    appsColsInput.value = String(topGrid.cols);
    appsRowsInput.value = String(topGrid.rows);
    topTileScaleInput.value = String(topGrid.tileScale);
    topTileScaleVal.textContent = String(topGrid.tileScale);
    topColGapInput.value = String(topGrid.colGap);
    topColGapVal.textContent = String(topGrid.colGap);
    topRowGapInput.value = String(topGrid.rowGap);
    topRowGapVal.textContent = String(topGrid.rowGap);
    dockTileScaleInput.value = String(dockLeftGrid.tileScale);
    dockTileScaleVal.textContent = String(dockLeftGrid.tileScale);
    dockColGapInput.value = String(dockLeftGrid.colGap);
    dockColGapVal.textContent = String(dockLeftGrid.colGap);
    dockRowGapInput.value = String(dockLeftGrid.rowGap);
    dockRowGapVal.textContent = String(dockLeftGrid.rowGap);
  };

  const fillGridInputs = (grid: GridPrefs, prefix: "top" | "dock") => {
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
  };

  const previewLayout = () => {
    syncDraftGrids();
    onPreview();
  };

  [bookmarksColsInput, bookmarksRowsInput, appsColsInput, appsRowsInput, topTileScaleInput, topColGapInput, topRowGapInput, dockTileScaleInput, dockColGapInput, dockRowGapInput].forEach(
    (el) => el.addEventListener("input", previewLayout),
  );

  return {
    fill(settings: AppSettings) {
      const state = createLayoutState(settings);
      setState(state);
      fillGridInputs(state.topGrid, "top");
      fillGridInputs(state.dockLeftGrid, "dock");
    },
    read(): LayoutState {
      syncDraftGrids();
      return getState();
    },
    reset() {
      setState({ topGrid: { ...DEFAULT_TOP_GRID }, dockLeftGrid: { ...DEFAULT_DOCK_LEFT_GRID } });
      fillGridInputs(DEFAULT_TOP_GRID, "top");
      fillGridInputs(DEFAULT_DOCK_LEFT_GRID, "dock");
    },
  };
}
