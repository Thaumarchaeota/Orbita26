import type { AppSettings, ThemePrefs } from "../../../core/settings";
import {
  FONT_PRESET_IDS,
  FONT_PRESET_LABELS,
  defaultFontPrefs,
  type FontBasePreset,
  type FontPrefs,
  type FontPresetId,
} from "../../../core/data/fonts";
import {
  GLASS_TINT_PRESETS,
  PALETTE_PRESETS,
  type OpaqueThemePrefs,
  type SurfaceMode,
  type TransparentThemePrefs,
} from "../../../core/data/theme-prefs";

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
  { key: "finance", label: "资产/记账", inherit: true },
  { key: "clock", label: "时钟/日期", inherit: false },
  { key: "lifeRing", label: "今日环主字", inherit: false },
  { key: "lifeRingSub", label: "今日环副字", inherit: false },
];

const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>`;
const CUSTOM_GRADIENT = "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)";

function fontSelectHtml(slot: (typeof FONT_SLOT_FIELDS)[number]): string {
  const key = String(slot.key);
  const id = `settingsFont${key[0].toUpperCase()}${key.slice(1)}`;
  const inheritOpt = slot.inherit ? `<option value="inherit">跟随默认</option>` : "";
  const opts = FONT_PRESET_IDS.map(
    (preset) => `<option value="${preset}">${FONT_PRESET_LABELS[preset]}</option>`,
  ).join("");
  return `
    <div class="dialog-field dialog-field-compact">
      <label for="${id}">${slot.label}</label>
      <div class="settings-select">
        <select id="${id}" data-font-slot="${slot.key}">
          ${inheritOpt}${opts}
        </select>
        <span class="settings-select-chevron">${CHEVRON_SVG}</span>
      </div>
    </div>`;
}

function paletteSwatchHtml(id: string, label: string, color: string, custom = false): string {
  const style = `style="background:${color}"`;
  return `<button type="button" class="settings-palette-swatch${custom ? " is-custom" : ""}" data-palette="${id}" data-tip="${label}" ${style} aria-label="${label}"></button>`;
}

function glassSwatchHtml(id: string, label: string, color: string, custom = false): string {
  const style = `style="background:${color}"`;
  return `<button type="button" class="settings-palette-swatch${custom ? " is-custom" : ""}" data-glass-tint="${id}" data-tip="${label}" ${style} aria-label="${label}"></button>`;
}

const paletteSwatchesHtml = [
  ...Object.entries(PALETTE_PRESETS).map(([id, p]) => paletteSwatchHtml(id, p.label, p.color)),
  paletteSwatchHtml("custom", "自定义", CUSTOM_GRADIENT, true),
].join("");

const glassTintSwatchesHtml = [
  ...Object.entries(GLASS_TINT_PRESETS).map(([id, p]) => glassSwatchHtml(id, p.label, p.color)),
  glassSwatchHtml("custom", "自定义", CUSTOM_GRADIENT, true),
].join("");

export const appearanceTabHtml = `
  <div class="settings-tab-panel is-active" data-tab-panel="appearance">
    <div class="settings-section settings-theme-section">
      <div class="settings-section-title">主题</div>
      <div class="settings-subtabs" id="settingsThemeModeTabs" role="tablist">
        <button type="button" class="settings-subtab is-active" data-theme-mode="opaque" role="tab" aria-selected="true">不透明</button>
        <button type="button" class="settings-subtab" data-theme-mode="transparent" role="tab" aria-selected="false">透明</button>
        <div class="settings-subtab-indicator"></div>
      </div>
      <div class="settings-subtab-panels" id="settingsThemeModePanels">
        <div class="settings-subtab-panel is-active" data-theme-mode-panel="opaque">
          <p class="settings-hint settings-theme-branch-hint">实底窗口：色板主色作用于边框、按钮与文字倾向。</p>
          <div class="dialog-field">
            <label>色板</label>
            <div class="settings-palette-row">
              ${paletteSwatchesHtml}
            </div>
          </div>
          <div class="dialog-field" id="settingsHueField" hidden>
            <label for="settingsHue">色相 <span id="settingsHueVal">212</span>°</label>
            <input id="settingsHue" type="range" min="0" max="360" value="212">
          </div>
          <div class="dialog-field">
            <label>明暗</label>
            <div class="settings-binary-row">
              <button type="button" class="dialog-btn" data-opaque-surface="light">浅色</button>
              <button type="button" class="dialog-btn" data-opaque-surface="dark">深色</button>
            </div>
          </div>
        </div>
        <div class="settings-subtab-panel" data-theme-mode-panel="transparent">
          <p class="settings-hint settings-theme-branch-hint">玻璃底色统一染色：栏目、对话框、弹出菜单；明暗决定底色深浅。</p>
          <div class="dialog-field">
            <label>玻璃底色</label>
            <div class="settings-palette-row" id="settingsGlassTintRow">
              ${glassTintSwatchesHtml}
            </div>
          </div>
          <div class="dialog-field" id="settingsGlassHueField" hidden>
            <label for="settingsGlassHue">色相 <span id="settingsGlassHueVal">222</span>°</label>
            <input id="settingsGlassHue" type="range" min="0" max="360" value="222">
          </div>
          <div class="dialog-field">
            <label>明暗</label>
            <div class="settings-binary-row">
              <button type="button" class="dialog-btn" data-transparent-surface="light">浅色</button>
              <button type="button" class="dialog-btn" data-transparent-surface="dark">深色</button>
            </div>
          </div>
          <div class="dialog-field">
            <label for="settingsBlockOpacity">区块不透明度 <span id="settingsBlockOpacityVal">12</span></label>
            <input id="settingsBlockOpacity" type="range" min="0" max="100" value="12">
            <div class="settings-opacity-hint">0 为全透明，100 为不透明</div>
          </div>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">字体</div>
      <div class="settings-field-inline settings-font-grid">
        ${FONT_SLOT_FIELDS.map(fontSelectHtml).join("")}
      </div>
    </div>
  </div>`;

export type AppearanceState = {
  themePrefs: ThemePrefs;
  blockOpacity: number;
  fonts: FontPrefs;
};

export function createAppearanceState(settings: AppSettings): AppearanceState {
  return {
    themePrefs: structuredClone(settings.ui.themePrefs),
    blockOpacity: settings.ui.blockOpacity,
    fonts: { ...settings.ui.fonts },
  };
}

function readFontSelect(select: HTMLSelectElement): FontPresetId | FontBasePreset {
  return select.value as FontPresetId | FontBasePreset;
}

type ThemePrefsPatch = Omit<Partial<ThemePrefs>, "opaque" | "transparent"> & {
  opaque?: Partial<OpaqueThemePrefs>;
  transparent?: Partial<TransparentThemePrefs>;
};

function patchThemePrefs(getState: () => AppearanceState, patch: ThemePrefsPatch): ThemePrefs {
  const cur = getState().themePrefs;
  return {
    mode: patch.mode ?? cur.mode,
    opaque: { ...cur.opaque, ...(patch.opaque ?? {}) },
    transparent: { ...cur.transparent, ...(patch.transparent ?? {}) },
  };
}

export function bindAppearanceTab(
  root: HTMLElement,
  getState: () => AppearanceState,
  setState: (patch: Partial<AppearanceState>) => void,
  onPreview: () => void,
) {
  const themeModeTabsEl = root.querySelector<HTMLElement>("#settingsThemeModeTabs")!;
  const themeModeIndicator = themeModeTabsEl.querySelector<HTMLElement>(".settings-subtab-indicator")!;
  const themeModeTabBtns = themeModeTabsEl.querySelectorAll<HTMLButtonElement>("[data-theme-mode]");
  const themeModePanels = root.querySelectorAll<HTMLElement>("[data-theme-mode-panel]");
  const opaqueSurfaceBtns = root.querySelectorAll<HTMLButtonElement>("[data-opaque-surface]");
  const transparentSurfaceBtns = root.querySelectorAll<HTMLButtonElement>("[data-transparent-surface]");
  const paletteBtns = root.querySelectorAll<HTMLButtonElement>("[data-palette]");
  const glassTintBtns = root.querySelectorAll<HTMLButtonElement>("[data-glass-tint]");
  const hueField = root.querySelector<HTMLElement>("#settingsHueField")!;
  const hueInput = root.querySelector<HTMLInputElement>("#settingsHue")!;
  const hueVal = root.querySelector<HTMLElement>("#settingsHueVal")!;
  const glassHueField = root.querySelector<HTMLElement>("#settingsGlassHueField")!;
  const glassHueInput = root.querySelector<HTMLInputElement>("#settingsGlassHue")!;
  const glassHueVal = root.querySelector<HTMLElement>("#settingsGlassHueVal")!;
  const blockOpacityInput = root.querySelector<HTMLInputElement>("#settingsBlockOpacity")!;
  const blockOpacityVal = root.querySelector<HTMLElement>("#settingsBlockOpacityVal")!;
  const fontSelects = root.querySelectorAll<HTMLSelectElement>("[data-font-slot]");

  const readFonts = (): FontPrefs => {
    const next = { ...getState().fonts };
    fontSelects.forEach((select) => {
      const key = select.dataset.fontSlot as keyof FontPrefs;
      next[key] = readFontSelect(select) as never;
    });
    return next;
  };

  const preview = () => {
    setState({ fonts: readFonts() });
    onPreview();
  };

  const moveThemeModeIndicator = (btn: HTMLButtonElement) => {
    const tabsRect = themeModeTabsEl.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    themeModeIndicator.style.width = `${btnRect.width}px`;
    themeModeIndicator.style.transform = `translateX(${btnRect.left - tabsRect.left}px)`;
    themeModeIndicator.style.opacity = "1";
  };

  const syncOpaqueSurfaceBtns = () => {
    const { opaque, mode } = getState().themePrefs;
    opaqueSurfaceBtns.forEach((btn) => {
      btn.classList.toggle("dialog-btn-primary", mode === "opaque" && btn.dataset.opaqueSurface === opaque.surface);
    });
  };

  const syncTransparentSurfaceBtns = () => {
    const { transparent, mode } = getState().themePrefs;
    transparentSurfaceBtns.forEach((btn) => {
      btn.classList.toggle(
        "dialog-btn-primary",
        mode === "transparent" && btn.dataset.transparentSurface === transparent.surface,
      );
    });
  };

  const syncGlassTintBtns = () => {
    const { transparent } = getState().themePrefs;
    glassTintBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.glassTint === transparent.tint);
    });
    glassHueField.hidden = transparent.tint !== "custom";
  };

  const syncPaletteBtns = () => {
    const { opaque } = getState().themePrefs;
    paletteBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.palette === opaque.palette);
    });
    hueField.hidden = opaque.palette !== "custom";
  };

  const switchThemeMode = (mode: ThemePrefs["mode"], applyPreview = true) => {
    themeModeTabBtns.forEach((btn) => {
      const on = btn.dataset.themeMode === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      if (on) moveThemeModeIndicator(btn);
    });
    themeModePanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.themeModePanel === mode);
    });
    setState({ themePrefs: patchThemePrefs(getState, { mode }) });
    syncOpaqueSurfaceBtns();
    syncTransparentSurfaceBtns();
    if (applyPreview) preview();
  };

  themeModeTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchThemeMode(btn.dataset.themeMode as ThemePrefs["mode"]);
    });
  });

  opaqueSurfaceBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const surface = btn.dataset.opaqueSurface as SurfaceMode;
      setState({
        themePrefs: patchThemePrefs(getState, { mode: "opaque", opaque: { surface } }),
      });
      switchThemeMode("opaque", false);
      preview();
    });
  });

  transparentSurfaceBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const surface = btn.dataset.transparentSurface as SurfaceMode;
      setState({
        themePrefs: patchThemePrefs(getState, { mode: "transparent", transparent: { surface } }),
      });
      switchThemeMode("transparent", false);
      preview();
    });
  });

  paletteBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const palette = btn.dataset.palette!;
      const preset = PALETTE_PRESETS[palette];
      const hue = preset?.h ?? getState().themePrefs.opaque.hue;
      setState({
        themePrefs: patchThemePrefs(getState, { opaque: { palette, hue } }),
      });
      syncPaletteBtns();
      if (getState().themePrefs.mode === "opaque") preview();
    });
  });

  glassTintBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tint = btn.dataset.glassTint!;
      const preset = GLASS_TINT_PRESETS[tint];
      const hue = preset?.h ?? getState().themePrefs.transparent.hue;
      setState({
        themePrefs: patchThemePrefs(getState, { transparent: { tint, hue } }),
      });
      syncGlassTintBtns();
      if (getState().themePrefs.mode === "transparent") preview();
    });
  });

  glassHueInput.addEventListener("input", () => {
    const hue = Number(glassHueInput.value);
    glassHueVal.textContent = String(hue);
    setState({ themePrefs: patchThemePrefs(getState, { transparent: { hue, tint: "custom" } }) });
    syncGlassTintBtns();
    if (getState().themePrefs.mode === "transparent") preview();
  });

  hueInput.addEventListener("input", () => {
    const hue = Number(hueInput.value);
    hueVal.textContent = String(hue);
    setState({ themePrefs: patchThemePrefs(getState, { opaque: { hue, palette: "custom" } }) });
    syncPaletteBtns();
    if (getState().themePrefs.mode === "opaque") preview();
  });

  blockOpacityInput.addEventListener("input", () => {
    const blockOpacity = Number(blockOpacityInput.value);
    blockOpacityVal.textContent = String(blockOpacity);
    setState({ blockOpacity });
    if (getState().themePrefs.mode === "transparent") preview();
  });

  fontSelects.forEach((select) => {
    select.addEventListener("change", () => preview());
  });

  const syncAll = () => {
    const { themePrefs } = getState();
    switchThemeMode(themePrefs.mode, false);
    syncOpaqueSurfaceBtns();
    syncTransparentSurfaceBtns();
    syncPaletteBtns();
    syncGlassTintBtns();
    requestAnimationFrame(() => {
      const active = themeModeTabsEl.querySelector<HTMLButtonElement>(".settings-subtab.is-active");
      if (active) moveThemeModeIndicator(active);
    });
  };

  return {
    fill(settings: AppSettings) {
      const state = createAppearanceState(settings);
      setState(state);
      blockOpacityInput.value = String(state.blockOpacity);
      blockOpacityVal.textContent = String(state.blockOpacity);
      hueInput.value = String(state.themePrefs.opaque.hue);
      hueVal.textContent = String(state.themePrefs.opaque.hue);
      glassHueInput.value = String(state.themePrefs.transparent.hue);
      glassHueVal.textContent = String(state.themePrefs.transparent.hue);
      fontSelects.forEach((select) => {
        const key = select.dataset.fontSlot as keyof FontPrefs;
        select.value = state.fonts[key];
      });
      syncAll();
    },
    read(): AppearanceState {
      return {
        themePrefs: getState().themePrefs,
        blockOpacity: Number(blockOpacityInput.value),
        fonts: readFonts(),
      };
    },
    resetFonts() {
      setState({ fonts: defaultFontPrefs() });
    },
  };
}
