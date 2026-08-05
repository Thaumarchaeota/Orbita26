import type { AppSettings, AppTheme } from "../../../core/settings";
import { isTransparentTheme } from "../../../core/settings";
import {
  FONT_PRESET_IDS,
  FONT_PRESET_LABELS,
  defaultFontPrefs,
  type FontBasePreset,
  type FontPrefs,
  type FontPresetId,
} from "../../../core/data/fonts";

const FONT_SLOT_FIELDS: {
  key: keyof FontPrefs;
  label: string;
  inherit: boolean;
}[] = [
  { key: "base", label: "界面默认", inherit: false },
  { key: "launcher", label: "应用/书签", inherit: true },
  { key: "fileTree", label: "文件树", inherit: true },
  { key: "literature", label: "文献标题", inherit: true },
  { key: "note", label: "笔记条目", inherit: true },
  { key: "ai", label: "AI 消息", inherit: true },
  { key: "clock", label: "时钟/日期", inherit: false },
  { key: "lifeRing", label: "今日环主字", inherit: false },
  { key: "lifeRingSub", label: "今日环副字", inherit: false },
];

function fontSelectHtml(slot: (typeof FONT_SLOT_FIELDS)[number]): string {
  const id = `settingsFont${slot.key[0].toUpperCase()}${slot.key.slice(1)}`;
  const inheritOpt = slot.inherit ? `<option value="inherit">跟随默认</option>` : "";
  const opts = FONT_PRESET_IDS.map(
    (preset) => `<option value="${preset}">${FONT_PRESET_LABELS[preset]}</option>`,
  ).join("");
  return `
    <div class="dialog-field">
      <label for="${id}">${slot.label}</label>
      <select id="${id}" data-font-slot="${slot.key}">
        ${inheritOpt}${opts}
      </select>
    </div>`;
}

export const appearanceTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="appearance">
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
    <div class="dialog-section-title">字体</div>
    ${FONT_SLOT_FIELDS.map(fontSelectHtml).join("")}
  </div>`;

export type AppearanceState = {
  theme: AppTheme;
  blockOpacity: number;
  fonts: FontPrefs;
};

export function createAppearanceState(settings: AppSettings): AppearanceState {
  return {
    theme: settings.theme,
    blockOpacity: settings.ui.blockOpacity,
    fonts: { ...settings.ui.fonts },
  };
}

function readFontSelect(select: HTMLSelectElement): FontPresetId | FontBasePreset {
  return select.value as FontPresetId | FontBasePreset;
}

export function bindAppearanceTab(
  root: HTMLElement,
  getState: () => AppearanceState,
  setState: (patch: Partial<AppearanceState>) => void,
  onPreview: () => void,
) {
  const blockOpacityField = root.querySelector<HTMLElement>("#settingsBlockOpacityField")!;
  const blockOpacityInput = root.querySelector<HTMLInputElement>("#settingsBlockOpacity")!;
  const blockOpacityVal = root.querySelector<HTMLElement>("#settingsBlockOpacityVal")!;
  const themeBtns = root.querySelectorAll<HTMLButtonElement>("[data-theme]");
  const fontSelects = root.querySelectorAll<HTMLSelectElement>("[data-font-slot]");

  const readFonts = (): FontPrefs => {
    const next = { ...getState().fonts };
    fontSelects.forEach((select) => {
      const key = select.dataset.fontSlot as keyof FontPrefs;
      next[key] = readFontSelect(select) as never;
    });
    return next;
  };

  const syncBlockFieldVisibility = () => {
    blockOpacityField.hidden = !isTransparentTheme(getState().theme);
  };

  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme as AppTheme;
      setState({ theme });
      themeBtns.forEach((b) => b.classList.toggle("dialog-btn-primary", b.dataset.theme === theme));
      syncBlockFieldVisibility();
    });
  });

  blockOpacityInput.addEventListener("input", () => {
    const blockOpacity = Number(blockOpacityInput.value);
    blockOpacityVal.textContent = String(blockOpacity);
    setState({ blockOpacity, fonts: readFonts() });
    onPreview();
  });

  fontSelects.forEach((select) => {
    select.addEventListener("change", () => {
      setState({ fonts: readFonts() });
      onPreview();
    });
  });

  return {
    fill(settings: AppSettings) {
      const state = createAppearanceState(settings);
      setState(state);
      blockOpacityInput.value = String(state.blockOpacity);
      blockOpacityVal.textContent = String(state.blockOpacity);
      themeBtns.forEach((btn) => {
        btn.classList.toggle("dialog-btn-primary", btn.dataset.theme === state.theme);
      });
      fontSelects.forEach((select) => {
        const key = select.dataset.fontSlot as keyof FontPrefs;
        select.value = state.fonts[key];
      });
      syncBlockFieldVisibility();
    },
    read(): AppearanceState {
      return {
        theme: getState().theme,
        blockOpacity: Number(blockOpacityInput.value),
        fonts: readFonts(),
      };
    },
    resetFonts() {
      setState({ fonts: defaultFontPrefs() });
    },
  };
}
