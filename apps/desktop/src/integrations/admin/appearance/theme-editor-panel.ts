import { createChoiceRadio, mountToggleSwitch, setChoiceRadio } from "../../../ui/choice-control";
import { mountColorEditor } from "../../../ui/color-editor";
import { mountSliderField } from "../../../ui/slider-field";
import { createInsightDialog } from "../../../ui/insight-dialog";
import { mountFloatingPanel, type FloatingPanelHandle } from "../../../ui/floating-panel";
import { compositeHex, contrastRatio, hexToOklch } from "../../../ui/color-system/color";
import { resolveUiRoles } from "../../../ui/color-system/theme-resolve";
import { UI_THEME_ROLES, type ThemePreset, type UiThemeDocument, type UiThemeRoleId } from "../../../ui/color-system/theme-types";
import {
  applyThemePreset,
  createUserThemePreset,
  deleteThemePreset,
  listThemePresets,
  readAppliedTheme,
  renameThemePreset,
} from "./theme-repository";
import {
  beginThemeEdit,
  cancelThemeEdit,
  disposeThemeSession,
  getThemeEditSession,
  saveAndApply,
  savePreset,
  subscribeThemeEdit,
  switchThemeSection,
  updateThemeDraft,
} from "./theme-edit-session";
import { saveAndApplyCategoryScheme, listCategorySchemes, createCategoryScheme, saveCategoryScheme, deleteCategoryScheme, importLegacyCategorySchemes, type CategorySchemeRecord } from "./category-repository";
import { MAX_CATEGORY_SLOTS, allocateCategoryCanonicalHex, deriveCategoryScheme, LEGACY_CATEGORY_SLOTS, orderCategorySlots, startCategoryPalettePreview, stopCategoryPalettePreview } from "../../../ui/color-system/category";
import { mountArrangementWeekScenario } from "../tabs/task/arrangement-week-render";
import type { ColorScheme } from "../../../ui/color-system/types";
import { setDirtyStatus } from "../tab-host/dirty";
import { mountThemeBulkControls } from "./theme-bulk-controls";
import { startCategoryGrayCalibration, type CategoryGrayCalibrationHandle } from "./category-gray-calibration";
import "./theme-editor-panel.css";

type ThemeSection = "grayscale" | "theme" | "semantic";
const SECTION_LABELS: Record<ThemeSection, string> = { grayscale: "灰度与层次", theme: "主题配色", semantic: "语义与交互状态" };
const BASE_ROLES: UiThemeRoleId[] = ["surface.chrome", "surface.sidebar", "surface.page", "surface.card", "surface.control", "surface.inset", "text.primary", "text.secondary", "text.placeholder", "text.disabled", "border.subtle", "border.weekGrid"];
const SECTION_ROLES: Record<ThemeSection, UiThemeRoleId[]> = {
  grayscale: BASE_ROLES,
  // The same roles are edited as L-only in grayscale and full L/C/h here.
  // Do not restrict theme editing to the accent colors (SPEC-0006 G4).
  theme: [...BASE_ROLES, "brand.primary", "brand.primaryForeground", "brand.primaryHover", "state.selection.surface", "state.selection.foreground", "state.focus.ring", "state.focus.foreground"],
  semantic: ["state.neutral.hover", "state.hover.sidebar", "state.hover.page", "state.neutral.pressed", "state.disabled.surface", "state.disabled.foreground", "semantic.success.foreground", "semantic.success.surface", "semantic.warning.foreground", "semantic.warning.surface", "semantic.danger.foreground", "semantic.danger.surface", "semantic.info.foreground", "semantic.info.surface"],
};
const assignedRoles = new Set(Object.values(SECTION_ROLES).flat());
for (const role of Object.keys(UI_THEME_ROLES) as UiThemeRoleId[]) {
  if (!assignedRoles.has(role)) SECTION_ROLES.semantic.push(role);
}
const clone = <T>(value: T): T => structuredClone(value);
const pendingThemeDecisions = new Map<string, Promise<boolean>>();

function escapeHtml(text: string): string { return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!); }

function promptText(title: string, label: string, initial = ""): Promise<string | null> {
  const dialog = createInsightDialog({ title, bodyHtml: `<label class="color-management-dialog-field">${escapeHtml(label)}<input name="value" maxlength="80" required value="${escapeHtml(initial)}"></label>`, submitLabel: "确认" });
  const input = dialog.panel.querySelector<HTMLInputElement>("input[name=value]")!;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => { if (done) return; done = true; void dialog.close().then(() => resolve(value)); };
    dialog.bindChrome(() => finish(null));
    dialog.panel.addEventListener("submit", (event) => { event.preventDefault(); const value = input.value.trim(); if (value) finish(value); else dialog.setError("请输入名称。"); });
    void dialog.open().then(() => input.focus());
  });
}

function decideThemeSession(sessionId: string, mountTarget?: HTMLElement): Promise<boolean> {
  const pending = pendingThemeDecisions.get(sessionId);
  if (pending) return pending;
  const session = getThemeEditSession();
  if (!session || session.sessionId !== sessionId) return Promise.resolve(true);
  if (!session.dirty && !session.saving && !session.error) {
    cancelThemeEdit(sessionId);
    return Promise.resolve(true);
  }
  let finishOnDispose: ((value: boolean) => void) | null = null;
  const dialog = createInsightDialog({ title: "色彩编辑尚未保存", bodyHtml: "<p>保存草稿、放弃本次编辑，或继续编辑。</p>", submitLabel: "保存", cancelLabel: "继续编辑", extraActionsHtml: '<button type="button" class="insight-dialog-btn insight-dialog-btn-danger" data-action="discard">放弃修改</button>', mountTarget, onDispose: () => finishOnDispose?.(false) });
  const decision = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => { if (done) return; done = true; void dialog.close().then(() => resolve(value)); };
    finishOnDispose = finish;
    dialog.bindChrome(() => finish(false));
    dialog.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      dialog.setBusy(true);
      void disposeThemeSession(sessionId, "save").then((ok) => finish(ok), (error) => { dialog.setBusy(false); dialog.setError(`保存失败：${String(error)}`); });
    });
    dialog.panel.querySelector<HTMLButtonElement>('[data-action="discard"]')?.addEventListener("click", () => {
      void disposeThemeSession(sessionId, "discard").then((ok) => finish(ok), (error) => dialog.setError(`放弃失败：${String(error)}`));
    });
    void dialog.open();
  });
  pendingThemeDecisions.set(sessionId, decision);
  void decision.finally(() => pendingThemeDecisions.delete(sessionId));
  return decision;
}

function roleContrastMarkup(theme: UiThemeDocument, grayscale = false): string {
  const resolved = resolveUiRoles(theme, { grayscalePreview: grayscale });
  const colorResolved = grayscale ? resolveUiRoles(theme) : resolved;
  const pairs: Array<[UiThemeRoleId, UiThemeRoleId, number, string]> = [
    ["text.primary", "surface.page", 4.5, "普通文字 / 页面"],
    ["text.primary", "surface.card", 4.5, "普通文字 / 卡片"],
    ["text.primary", "surface.control", 4.5, "普通文字 / 控件"],
    ["text.secondary", "surface.page", 4.5, "次级文字 / 页面"],
    ["text.placeholder", "surface.control", 4.5, "占位文字 / 控件"],
    ["brand.primaryForeground", "brand.primary", 4.5, "主按钮文字 / 主色"],
    ["state.selection.foreground", "state.selection.surface", 4.5, "选中文字 / 选中背景"],
    ["border.subtle", "surface.control", 3, "输入控件边界 / 控件背景"],
  ];
  const rows = pairs.flatMap(([fg, bg, minimum, label]) => {
    if (bg === "state.selection.surface") {
      return (["chrome", "sidebar", "page", "card", "control", "inset"] as const).map((context) => {
        const state = resolved.contexts[context];
        const colorState = colorResolved.contexts[context];
        const value = contrastRatio(state.selectedForeground, state.selected);
        const colorValue = contrastRatio(colorState.selectedForeground, colorState.selected);
        return `<div class="color-management-pair"><span>${label} / ${context}</span><strong>${value.toFixed(2)}:1</strong><small>${value >= minimum ? "符合" : "低于"} ${minimum}:1${grayscale ? ` · 原彩色 ${colorValue.toFixed(2)}:1` : ""}</small></div>`;
      });
    }
    const selectedBg = resolved.roles[bg].hex;
    const colorSelectedBg = colorResolved.roles[bg].hex;
    const selectedFg = fg === "state.selection.foreground" ? resolved.contexts.page.selectedForeground : resolved.roles[fg].hex;
    const colorSelectedFg = fg === "state.selection.foreground" ? colorResolved.contexts.page.selectedForeground : colorResolved.roles[fg].hex;
    const value = contrastRatio(selectedFg, selectedBg);
    const colorValue = contrastRatio(colorSelectedFg, colorSelectedBg);
    return [`<div class="color-management-pair"><span>${label}</span><strong>${value.toFixed(2)}:1</strong><small>${value >= minimum ? "符合" : "低于"} ${minimum}:1${grayscale ? ` · 原彩色 ${colorValue.toFixed(2)}:1` : ""}</small></div>`];
  });
  const page = resolved.roles["surface.page"].hex;
  const alpha = theme.stateRules.focusAlpha;
  if (theme.stateRules.focusEnabled === false) {
    rows.push(`<div class="color-management-pair"><span>焦点环</span><strong>已禁用</strong><small>不参与对比度报告；颜色与强度仍保留。</small></div>`);
  } else {
    const focus = compositeHex(resolved.roles["state.focus.ring"].hex, page, alpha);
    const focusRatio = contrastRatio(focus, page);
    const colorPage = colorResolved.roles["surface.page"].hex;
    const colorFocus = compositeHex(colorResolved.roles["state.focus.ring"].hex, colorPage, alpha);
    const colorFocusRatio = contrastRatio(colorFocus, colorPage);
    rows.push(`<div class="color-management-pair"><span>焦点环 / 页面（${Math.round(alpha * 100)}% 不透明度）</span><strong>${focusRatio.toFixed(2)}:1</strong><small>${focusRatio >= 3 ? "符合" : "低于"} 3:1${grayscale ? ` · 原彩色 ${colorFocusRatio.toFixed(2)}:1` : ""}</small></div>`);
  }
  return rows.join("") + `<p class="color-management-unchecked">${grayscale ? "当前数据为灰度预览结果；并列值为原彩色输出。" : "当前数据为原彩色输出结果。"}其他背景组合：未检查。检查只报告，不自动改色。</p>`;
}

function renderEditor(host: HTMLElement, snapshot: NonNullable<ReturnType<typeof getThemeEditSession>>, refresh: (next: typeof snapshot) => void): (() => void) {
  const { draft } = snapshot;
  const isGray = snapshot.focusedSection === "grayscale";
  const roles = SECTION_ROLES[snapshot.focusedSection];
  const disposers: Array<() => void> = [];
  const roleEditors = new Map<UiThemeRoleId, ReturnType<typeof mountColorEditor>>();
  let syncSelectionMode: ((mode: "relative" | "custom") => void) | undefined;
  host.innerHTML = `<nav class="color-management-editor-sections" role="tablist">${Object.entries(SECTION_LABELS).map(([key, label]) => `<button type="button" role="tab" data-section="${key}" aria-selected="${key === snapshot.focusedSection}">${label}</button>`).join("")}</nav>
    <div class="color-management-editor-scroll">
      <p class="color-management-editor-note">${isGray ? "灰度预览只在解析时暂时移除色度；原始 C/h 保留。调整的 L 会写入同一草稿。" : "主题预览只影响 Insight 当前窗口；保存、应用或取消决定最终去向。"}</p>
      ${snapshot.focusedSection === "theme" ? '<div data-theme-bulk-controls></div>' : ""}
      <div class="color-management-editor-body"><div class="color-management-role-list"></div></div>
      ${snapshot.focusedSection === "theme" ? '<section class="color-management-generator"><h3>根据主色生成相关颜色</h3><p>先比较候选值并勾选需要覆盖的角色；未选中的值保持不变。</p><button type="button" data-action="preview-generated">查看候选</button><div data-generated-candidates hidden></div></section>' : ""}
      <div class="color-management-contrast"><h3>${isGray ? "灰度预览 / 原彩色输出配对检查" : "原彩色输出配对检查"}</h3>${roleContrastMarkup(draft, isGray)}</div>
      ${snapshot.error ? `<p class="color-management-error" role="alert">${escapeHtml(snapshot.error)}</p>` : ""}
    </div>
    <footer class="color-management-editor-actions"><button type="button" data-action="cancel">取消</button><button type="button" data-action="save">保存</button><button type="button" class="is-primary" data-action="save-apply">保存并应用</button></footer>`;
  const list = host.querySelector<HTMLElement>(".color-management-role-list")!;
  for (const role of roles) {
    const group = role === "surface.chrome" ? "区域背景" : role === "text.primary" ? "文字与边界" : role === "brand.primary" ? "主色与选中／焦点" : null;
    if (group) {
      const heading = document.createElement("h3"); heading.className = "color-management-role-group"; heading.textContent = group; list.append(heading);
    }
    const card = document.createElement("section"); card.className = "color-management-role";
    if (role === "state.focus.ring" && !isGray) card.dataset.focusRole = "true";
    const editorHost = document.createElement("div");
    if (role === "state.selection.surface" && !isGray) {
      const selection = draft.selection ?? { mode: "custom" as const, lightnessDelta: -0.04 };
      card.innerHTML = `<p>${escapeHtml(UI_THEME_ROLES[role].purpose)}</p><div class="color-management-selection-modes" role="radiogroup" aria-label="选中背景模式"><label data-selection-mode="relative" aria-label="按所在区域背景相对明度">按所在区域背景相对明度</label><label data-selection-mode="custom" aria-label="自定义 HEX / OKLCH">自定义 HEX / OKLCH</label></div><div data-selection-delta></div><div data-selection-custom></div>`;
      const relativeRadio = createChoiceRadio(selection.mode === "relative");
      const customRadio = createChoiceRadio(selection.mode === "custom");
      card.querySelector<HTMLElement>('[data-selection-mode="relative"]')!.append(relativeRadio);
      card.querySelector<HTMLElement>('[data-selection-mode="custom"]')!.append(customRadio);
      const deltaHost = card.querySelector<HTMLElement>("[data-selection-delta]")!;
      const customHost = card.querySelector<HTMLElement>("[data-selection-custom]")!;
      const customEditor = mountColorEditor(customHost, { label: "自定义选中背景", value: draft.colors[role].oklch, onChange(value) {
        const activeDraft = getThemeEditSession()?.draft ?? draft;
        const next = updateThemeDraft(snapshot.sessionId, { colors: { ...activeDraft.colors, [role]: { oklch: value } }, selection: { ...(activeDraft.selection ?? { mode: "custom", lightnessDelta: -0.04 }), mode: "custom" } });
        refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft)}`;
      } });
      const deltaSlider = mountSliderField({ label: "选中背景明度偏移 ΔL（百分点）", min: -100, max: 100, step: 0.1, value: selection.lightnessDelta * 100, disabled: selection.mode !== "relative", onChange(value) {
        const activeDraft = getThemeEditSession()?.draft ?? draft;
        const next = updateThemeDraft(snapshot.sessionId, { selection: { ...(activeDraft.selection ?? { mode: "relative", lightnessDelta: -0.04 }), mode: "relative", lightnessDelta: value / 100 } });
        refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft)}`;
      } });
      deltaHost.append(deltaSlider.element);
      const syncSelectionControls = (mode: "relative" | "custom") => {
        setChoiceRadio(relativeRadio, mode === "relative");
        setChoiceRadio(customRadio, mode === "custom");
        relativeRadio.setAttribute("aria-label", "按所在区域背景相对明度");
        customRadio.setAttribute("aria-label", "自定义 HEX / OKLCH");
        deltaSlider.element.querySelectorAll("input").forEach((input) => { (input as HTMLInputElement).disabled = mode !== "relative"; });
        customHost.hidden = mode !== "custom";
      };
      const setSelectionMode = (mode: "relative" | "custom") => {
        const activeDraft = getThemeEditSession()?.draft ?? draft;
        const next = updateThemeDraft(snapshot.sessionId, { selection: { ...(activeDraft.selection ?? { mode, lightnessDelta: -0.04 }), mode } });
        syncSelectionControls(mode);
        refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft)}`;
      };
      syncSelectionMode = syncSelectionControls;
      relativeRadio.addEventListener("click", () => setSelectionMode("relative"));
      customRadio.addEventListener("click", () => setSelectionMode("custom"));
      syncSelectionControls(selection.mode);
      list.append(card); roleEditors.set(role, customEditor); disposers.push(() => { customEditor.dispose(); deltaSlider.dispose(); });
      continue;
    }
    const editor = mountColorEditor(editorHost, { label: UI_THEME_ROLES[role].label, value: draft.colors[role].oklch, lightnessOnly: isGray, onChange(value) {
      const activeDraft = getThemeEditSession()?.draft ?? draft;
      const current = activeDraft.colors[role].oklch;
      const nextValue = isGray ? { ...current, l: value.l } : value;
      const next = updateThemeDraft(snapshot.sessionId, { colors: { ...activeDraft.colors, [role]: { oklch: nextValue } } });
      refresh(next);
      const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
      if (contrast) contrast.innerHTML = `<h3>${isGray ? "灰度预览 / 原彩色输出配对检查" : "原彩色输出配对检查"}</h3>${roleContrastMarkup(next.draft, isGray)}`;
    } });
    card.innerHTML = `<p>${escapeHtml(UI_THEME_ROLES[role].purpose)}</p>`;
    card.append(editorHost); list.append(card); roleEditors.set(role, editor); disposers.push(() => editor.dispose());
    if (role === "state.focus.ring" && !isGray) {
      const toggleHost = document.createElement("div"); toggleHost.className = "color-management-focus-card-toggle";
      const toggleLabel = document.createElement("span"); toggleLabel.textContent = "启用焦点环";
      const toggleMount = document.createElement("span"); toggleHost.append(toggleLabel, toggleMount); card.append(toggleHost);
      const toggle = mountToggleSwitch(toggleMount, { checked: draft.stateRules.focusEnabled !== false, role: "focus-ring-enabled", onChange(enabled) {
        const activeDraft = getThemeEditSession()?.draft ?? draft;
        const next = updateThemeDraft(snapshot.sessionId, { stateRules: { ...activeDraft.stateRules, focusEnabled: enabled } });
        refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft, false)}`;
      } });
      disposers.push(() => toggle.dispose());
    }
  }
  if (snapshot.focusedSection === "theme") {
    const controls = mountThemeBulkControls(host.querySelector<HTMLElement>("[data-theme-bulk-controls]")!, {
      roleIds: roles,
      readDraft: () => getThemeEditSession()?.draft ?? draft,
      onChange(colors) {
        const next = updateThemeDraft(snapshot.sessionId, { colors });
        for (const [role, editor] of roleEditors) editor.setValue(next.draft.colors[role].oklch);
        refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft)}`;
      },
    });
    disposers.push(() => controls.dispose());
  }
  if (snapshot.focusedSection === "semantic") {
    const rules = document.createElement("section"); rules.className = "color-management-state-rules";
    rules.innerHTML = "<h3>交互状态混合强度 (%)</h3>";
    for (const key of ["hoverAlpha", "pressedAlpha", "disabledAlpha", "focusAlpha"] as const) {
      const label = key === "hoverAlpha" ? "控件与浮层悬停" : key === "pressedAlpha" ? "按下" : key === "disabledAlpha" ? "禁用" : "焦点";
      const row = document.createElement("div"); const caption = document.createElement("span"); caption.textContent = label;
      const slider = mountSliderField({ label: `${label}强度 (%)`, min: 0, max: 100, step: 1, value: draft.stateRules[key] * 100, onChange(value) {
        const stateRules = { ...(getThemeEditSession()?.draft ?? draft).stateRules, [key]: value / 100 };
        const next = updateThemeDraft(snapshot.sessionId, { stateRules });
        refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft, false)}`;
      } });
      row.append(caption, slider.element); rules.append(row); disposers.push(() => slider.dispose());
    }
    list.append(rules);
  }
  host.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => button.addEventListener("click", () => refresh(switchThemeSection(snapshot.sessionId, button.dataset.section as ThemeSection))));
  host.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.addEventListener("click", () => { cancelThemeEdit(snapshot.sessionId); });
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.addEventListener("click", () => { void savePreset(snapshot.sessionId).catch(() => {}); });
  host.querySelector<HTMLButtonElement>('[data-action="save-apply"]')!.addEventListener("click", () => { void saveAndApply(snapshot.sessionId).catch(() => {}); });
  if (snapshot.focusedSection === "theme") {
    const trigger = host.querySelector<HTMLButtonElement>('[data-action="preview-generated"]')!;
    const target = host.querySelector<HTMLElement>("[data-generated-candidates]")!;
    trigger.addEventListener("click", () => {
      const currentDraft = getThemeEditSession()?.draft ?? draft;
      const primary = currentDraft.colors["brand.primary"].oklch;
      const hueColor = (l: number, c: number, h: number) => ({ oklch: { l: Math.max(0, Math.min(1, l)), c: Math.max(0, Math.min(0.5, c)), h: (h + 360) % 360 } });
      const candidate: Partial<Record<UiThemeRoleId, { oklch: { l: number; c: number; h: number } }>> = {
        "brand.primaryHover": hueColor(primary.l - 0.1, primary.c * 0.92, primary.h),
        "brand.primaryForeground": (() => {
          const brandHex = resolveUiRoles(currentDraft).roles["brand.primary"].hex;
          const white = "#FFFFFF";
          const dark = resolveUiRoles(currentDraft).roles["text.primary"].hex;
          return { oklch: hexToOklch(contrastRatio(white, brandHex) >= contrastRatio(dark, brandHex) ? white : dark) };
        })(),
        "state.selection.surface": hueColor(0.94, Math.min(0.08, primary.c * 0.32), primary.h),
        "state.selection.foreground": clone(currentDraft.colors["brand.primary"]),
        "state.focus.ring": clone(currentDraft.colors["brand.primary"]),
        "state.focus.foreground": clone(currentDraft.colors["text.primary"]),
      };
      target.hidden = false;
      target.innerHTML = `<div class="color-management-candidate-list">${Object.entries(candidate).map(([id, color]) => {
        const role = id as UiThemeRoleId;
        const currentResolved = resolveUiRoles(currentDraft);
        const before = role === "state.selection.surface" ? currentResolved.contexts.page.selected : currentResolved.roles[role].hex;
        const candidateTheme = role === "state.selection.surface"
          ? { ...currentDraft, colors: { ...currentDraft.colors, [role]: color! }, selection: { ...(currentDraft.selection ?? { mode: "custom", lightnessDelta: -0.04 }), mode: "custom" as const } }
          : { ...currentDraft, colors: { ...currentDraft.colors, [role]: color! } };
        const afterResolved = resolveUiRoles(candidateTheme);
        const after = role === "state.selection.surface" ? afterResolved.contexts.page.selected : afterResolved.roles[role].hex;
        const paired: Partial<Record<UiThemeRoleId, [UiThemeRoleId, number]>> = {
          "brand.primaryHover": ["surface.page", 3], "brand.primaryForeground": ["brand.primary", 4.5], "state.selection.surface": ["state.selection.foreground", 4.5],
          "state.selection.foreground": ["state.selection.surface", 4.5], "state.focus.ring": ["surface.page", 3],
          "state.focus.foreground": ["brand.primary", 4.5],
        };
        const [backgroundRole, threshold] = paired[role]!;
        const ratio = role === "state.selection.surface"
          ? contrastRatio(resolveUiRoles(currentDraft).roles["state.selection.foreground"].hex, after)
          : role === "state.selection.foreground"
          ? Math.min(...Object.values(afterResolved.contexts).map((context) => contrastRatio(after, context.selected)))
          : contrastRatio(after, resolveUiRoles(currentDraft).roles[backgroundRole].hex);
        return `<label><input type="checkbox" data-candidate="${role}"><span>${escapeHtml(UI_THEME_ROLES[role].label)}</span><i style="background:${before}"></i><span>→</span><i style="background:${after}"></i><small>${ratio.toFixed(2)}:1 / ${escapeHtml(UI_THEME_ROLES[backgroundRole].label)} · ${threshold}:1</small></label>`;
      }).join("")}<button type="button" data-action="apply-generated">确认所选</button><button type="button" data-action="dismiss-generated">取消</button></div>`;
      target.querySelector<HTMLButtonElement>('[data-action="apply-generated"]')!.addEventListener("click", () => {
        const colors = { ...(getThemeEditSession()?.draft ?? draft).colors };
        let selection = (getThemeEditSession()?.draft ?? draft).selection;
        for (const input of target.querySelectorAll<HTMLInputElement>("[data-candidate]:checked")) { const role = input.dataset.candidate as UiThemeRoleId; colors[role] = candidate[role]!; if (role === "state.selection.surface") selection = { ...(selection ?? { mode: "custom", lightnessDelta: -0.04 }), mode: "custom" }; }
        const next = updateThemeDraft(snapshot.sessionId, { colors, selection });
        for (const [role, editor] of roleEditors) editor.setValue(next.draft.colors[role].oklch);
        syncSelectionMode?.(next.draft.selection?.mode ?? "custom");
        refresh(next);
        target.hidden = true; refresh(next);
        const contrast = host.querySelector<HTMLElement>(".color-management-contrast");
        if (contrast) contrast.innerHTML = `<h3>原彩色输出配对检查</h3>${roleContrastMarkup(next.draft)}`;
      });
      target.querySelector<HTMLButtonElement>('[data-action="dismiss-generated"]')!.addEventListener("click", () => { target.hidden = true; });
    });
  }
  return () => disposers.forEach((dispose) => dispose());
}

function makeCard(preset: ThemePreset, appliedId: string | null, onEdit: (preset: ThemePreset, section: ThemeSection) => void, onChanged: () => void): HTMLElement {
  const card = document.createElement("article"); card.className = "color-management-theme-card";
  const radio = createChoiceRadio(preset.id === appliedId);
  radio.setAttribute("aria-label", `应用主题 ${preset.name}`);
  radio.disabled = Boolean(preset.sourceDeleted || preset.legacyImported);
  const resolved = resolveUiRoles(preset.theme);
  const swatches = ["surface.chrome", "surface.sidebar", "surface.page", "surface.card", "brand.primary", "semantic.success.foreground", "semantic.warning.foreground", "semantic.danger.foreground"] as const;
  const immutableSource = preset.builtin || preset.sourceDeleted || preset.legacyImported;
  const provenance = preset.builtin ? "系统预设 · 只读" : preset.sourceDeleted ? "来源已删除 · 当前快照只读，可复制" : preset.legacyImported ? "旧色彩设置 · 快照只读，可复制" : "用户预设";
  card.innerHTML = `<div class="color-management-card-head"><div><h2></h2><p>${provenance}</p></div><div class="color-management-card-actions"></div></div><div class="color-management-swatches"></div><div class="color-management-edit-areas"></div>`;
  card.querySelector("h2")!.textContent = preset.name;
  const head = card.querySelector<HTMLElement>(".color-management-card-head")!;
  head.prepend(radio);
  const actionHost = card.querySelector<HTMLElement>(".color-management-card-actions")!;
  const addAction = (label: string, action: () => void, disabled = false) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = disabled; button.addEventListener("click", action); actionHost.append(button); };
  radio.addEventListener("click", () => { if (preset.id !== appliedId) void applyThemePreset(preset.id).then(onChanged).catch((error) => showInlineError(card, `应用失败：${String(error)}`)); });
  addAction("复制", async () => {
    const name = await promptText("复制主题", "新主题名称", `${preset.name} 副本`); if (!name) return;
    const theme = { ...clone(preset.theme), metadata: { ...preset.theme.metadata, id: crypto.randomUUID(), name, revision: 1, updatedAt: new Date().toISOString() } };
    try { await createUserThemePreset({ id: theme.metadata.id, name, theme }); onChanged(); } catch (error) { showInlineError(card, String(error)); }
  });
  if (!immutableSource) {
    addAction("重命名", async () => { const name = await promptText("重命名主题", "主题名称", preset.name); if (!name) return; try { await renameThemePreset(preset.id, name); onChanged(); } catch (error) { showInlineError(card, String(error)); } });
    addAction("删除", async () => { if (!(await confirmDeleteTheme(preset.name))) return; try { await deleteThemePreset(preset.id); onChanged(); } catch (error) { showInlineError(card, String(error)); } });
  }
  const swatchHost = card.querySelector<HTMLElement>(".color-management-swatches")!;
  for (const role of swatches) { const swatch = document.createElement("i"); swatch.title = UI_THEME_ROLES[role].label; swatch.style.backgroundColor = resolved.roles[role].hex; swatchHost.append(swatch); }
  const editHost = card.querySelector<HTMLElement>(".color-management-edit-areas")!;
  for (const section of Object.keys(SECTION_LABELS) as ThemeSection[]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `${SECTION_LABELS[section]} · 编辑`; button.addEventListener("click", () => onEdit(preset, section)); editHost.append(button);
  }
  return card;
}

function showInlineError(host: HTMLElement, message: string): void {
  let error = host.querySelector<HTMLElement>(".color-management-error");
  if (!error) { error = document.createElement("p"); error.className = "color-management-error"; error.setAttribute("role", "alert"); host.append(error); }
  error.textContent = message;
}

function confirmDeleteTheme(name: string): Promise<boolean> {
  const dialog = createInsightDialog({ title: "删除主题", bodyHtml: `<p>删除“${escapeHtml(name)}”主题预设？已应用的外观快照不会改变。</p>`, submitLabel: "删除", dangerSubmit: true });
  return new Promise((resolve) => {
    let done = false; const finish = (value: boolean) => { if (done) return; done = true; void dialog.close().then(() => resolve(value)); };
    dialog.bindChrome(() => finish(false));
    dialog.panel.addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
    void dialog.open();
  });
}

function categoryColors(scheme: ColorScheme): string[] {
  return orderCategorySlots(scheme).map((slot) => slot.main);
}

export type ThemeManagementHandle = { canDispose(): Promise<boolean>; dispose(): void };

export function mountThemeEditorPanel(root: HTMLElement): ThemeManagementHandle {
  root.classList.add("color-management-root");
  root.innerHTML = `<section class="color-management-section"><header><p class="color-management-eyebrow">INSIGHT / 设置</p><h1>色彩管理</h1><p>UI 主题与分类配色分开保存。编辑预览仅作用于当前 Insight 窗口；主题只包含颜色，不包含圆角和字号。</p></header><div class="color-management-theme-list"></div></section>
    <section class="color-management-section color-management-category-section"><header class="color-management-category-section-header"><div><h2>分类配色</h2><p>独立于 UI 主题和分类目录。每个方案最多 24 个颜色组，每组五个角色；原有九个兼容色键保持不变。</p></div><button type="button" data-category-gray-open>调整灰度</button></header><div class="color-management-category-list"></div><div class="color-management-category-editor" hidden></div><p class="color-management-category-error" role="status" hidden></p></section>`;
  const themeList = root.querySelector<HTMLElement>(".color-management-theme-list")!;
  const categoryList = root.querySelector<HTMLElement>(".color-management-category-list")!;
  const categoryEditor = root.querySelector<HTMLElement>(".color-management-category-editor")!;
  const categoryError = root.querySelector<HTMLElement>(".color-management-category-error")!;
  const ownerKey = root.closest<HTMLElement>("[data-surface]")?.dataset.surface ?? "settings";
  let floating: FloatingPanelHandle | null = null;
  let editorCleanup: (() => void) | null = null;
  let lastRenderedSession = "";
  let categoryDraft: CategorySchemeRecord | null = null;
  let categoryDirty = false;
  let categoryBusy = false;
  const categoryPreviewOwner = `category-editor:${crypto.randomUUID()}`;
  let categoryScenarioDispose: (() => void) | null = null;
  const categoryColorDisposers: Array<() => void> = [];
  const categoryCompletionDisposers: Array<() => void> = [];
  let grayCalibration: CategoryGrayCalibrationHandle | null = null;
  let disposed = false;

  const renderThemes = () => {
    if (disposed) return;
    try {
      const appliedId = readAppliedTheme().presetId;
      const presets = listThemePresets();
      // Keep the full registry for legacy settings, but offer only the two
      // current starting points in the picker (SPEC-0006, 2026-10-18).
      const visible = presets.filter((preset) => !preset.builtin || preset.id === "legacy:cold" || preset.id === "legacy:warm");
      themeList.replaceChildren(...visible.map((preset) => makeCard(preset, appliedId, openEditor, renderThemes)));
      const hiddenApplied = presets.find((preset) => preset.id === appliedId && !visible.includes(preset));
      if (hiddenApplied) {
        const note = document.createElement("p");
        note.className = "color-management-legacy-applied";
        note.textContent = `当前仍使用原有主题“${hiddenApplied.name}”；选择 Cold、Warm 或自建主题后切换。`;
        themeList.prepend(note);
      }
    } catch (error) {
      themeList.replaceChildren();
      showInlineError(themeList, `主题配置无法读取，原始设置已保留：${String(error)}`);
    }
  };
  const openEditor = async (preset: ThemePreset, section: ThemeSection) => {
    if (grayCalibration) { showCategoryError("先关闭分类灰度调整，再打开主题编辑。"); return; }
    if (categoryDraft && !(await closeCategoryEditor())) return;
    let existing = getThemeEditSession();
    if (existing && existing.presetId !== preset.id) {
      if (!(await decideThemeSession(existing.sessionId, floating?.element))) return;
      existing = getThemeEditSession();
    }
    const snapshot = existing ? switchThemeSection(existing.sessionId, section) : beginThemeEdit(preset.id, section);
    if (!floating) {
      const content = document.createElement("div");
      floating = mountFloatingPanel({ title: `编辑主题：${preset.name}`, content, maxHeight: 640, constrainFullHeight: true, onCloseRequest: () => { if (getThemeEditSession()) void decideThemeSession(getThemeEditSession()!.sessionId, floating?.element).then((ok) => { if (!ok) return; editorCleanup?.(); editorCleanup = null; floating?.dispose(); floating = null; lastRenderedSession = ""; renderThemes(); }); else void closeCategoryEditor(); } });
      floating.element.classList.add("color-management-floating-editor");
      floating.element.classList.add("color-management-theme-floating-editor");
    }
    floating.setTitle(`编辑主题：${preset.name} · ${SECTION_LABELS[section]}`);
    const host = floating.content.firstElementChild instanceof HTMLElement ? floating.content.firstElementChild : document.createElement("div");
    host.classList.add("color-management-editor-host");
    if (!host.isConnected) floating.content.replaceChildren(host);
    editorCleanup?.(); editorCleanup = renderEditor(host, snapshot, (next) => {
      if (!floating || getThemeEditSession()?.sessionId !== next.sessionId) return;
      if (lastRenderedSession !== `${next.sessionId}:${next.focusedSection}`) paintSession(next);
    });
    lastRenderedSession = `${snapshot.sessionId}:${snapshot.focusedSection}`;
  };
  const paintSession = (snapshot: NonNullable<ReturnType<typeof getThemeEditSession>>) => {
    if (!floating) return;
    if (lastRenderedSession === `${snapshot.sessionId}:${snapshot.focusedSection}`) {
      const host = floating.content.firstElementChild as HTMLElement | null;
      if (!host) return;
      let error = host.querySelector<HTMLElement>(".color-management-error");
      if (snapshot.error) {
        if (!error) { error = document.createElement("p"); error.className = "color-management-error"; error.setAttribute("role", "alert"); host.append(error); }
        error.textContent = snapshot.error;
      } else error?.remove();
      host.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((control) => {
        if (snapshot.saving) {
          if (control.dataset.themeSaveDisabled === undefined) control.dataset.themeSaveDisabled = control.disabled ? "1" : "0";
          control.disabled = true;
        } else if (control.dataset.themeSaveDisabled !== undefined) {
          control.disabled = control.dataset.themeSaveDisabled === "1";
          delete control.dataset.themeSaveDisabled;
        }
      });
      return;
    }
    const host = floating.content.firstElementChild as HTMLElement | null;
    if (!host) return;
    editorCleanup?.(); editorCleanup = renderEditor(host, snapshot, paintSession);
    lastRenderedSession = `${snapshot.sessionId}:${snapshot.focusedSection}`;
    floating.setTitle(`编辑主题：${snapshot.draft.metadata.name} · ${SECTION_LABELS[snapshot.focusedSection]}`);
  };
  const unsubscribeTheme = subscribeThemeEdit((snapshot) => {
    if (snapshot) {
      themeList.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = snapshot.saving; });
      paintSession(snapshot);
    }
    else {
      editorCleanup?.(); editorCleanup = null;
      if (floating) { floating.dispose(); floating = null; }
      lastRenderedSession = "";
      renderThemes();
    }
  });

  const setCategoryStatus = (dirty: boolean, failed = false) => { categoryDirty = dirty; setDirtyStatus(ownerKey, { dirty: dirty || getThemeEditSession()?.dirty === true, inFlight: categoryBusy || getThemeEditSession()?.saving === true, failed: failed || Boolean(getThemeEditSession()?.error) }); };
  const showCategoryError = (message: string) => {
    categoryError.textContent = message; categoryError.hidden = !message; categoryError.classList.remove("is-success");
    const editorStatus = categoryEditor.querySelector<HTMLElement>("[data-category-editor-error]");
    if (editorStatus) { editorStatus.textContent = message; editorStatus.hidden = !message; }
    setCategoryStatus(categoryDirty, !!message);
  };
  const showCategoryStatus = (message: string) => { categoryError.textContent = message; categoryError.hidden = !message; categoryError.classList.add("is-success"); setCategoryStatus(categoryDirty); };
  const openGrayCalibration = () => {
    if (getThemeEditSession()) { showCategoryError("先保存或取消主题编辑，再打开分类灰度调整。"); return; }
    if (categoryDraft) { showCategoryError("先保存或取消分类配色编辑，再打开分类灰度调整。"); return; }
    if (floating) { showCategoryError("先关闭当前色彩编辑浮窗，再打开分类灰度调整。"); return; }
    if (grayCalibration) return;
    showCategoryError("");
    grayCalibration = startCategoryGrayCalibration({
      assignFloating: (panel) => { floating = panel; },
      onError: showCategoryError,
      onClearError: () => showCategoryError(""),
      onEnded: () => { grayCalibration = null; },
    });
  };
  const confirmCategoryDisposition = async (): Promise<boolean> => {
    if (!categoryDirty) return true;
    if (categoryBusy || !categoryDraft) return false;
    let finishOnDispose: ((value: boolean) => void) | null = null;
    const dialog = createInsightDialog({ title: "分类配色尚未保存", bodyHtml: "<p>保存方案库草稿、放弃修改，或继续编辑。</p>", submitLabel: "保存", cancelLabel: "继续编辑", extraActionsHtml: '<button type="button" class="insight-dialog-btn insight-dialog-btn-danger" data-action="discard">放弃修改</button>', mountTarget: floating?.element, onDispose: () => finishOnDispose?.(false) });
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: boolean) => { if (done) return; done = true; void dialog.close().then(() => resolve(value)); };
      finishOnDispose = finish;
      dialog.bindChrome(() => finish(false));
      dialog.panel.addEventListener("submit", (event) => {
        event.preventDefault();
        try { categoryDraft!.name = categoryEditor.querySelector<HTMLInputElement>("[data-category-name]")?.value.trim() ?? categoryDraft!.name; categoryDraft!.scheme.name = categoryDraft!.name; const saved = saveCategoryScheme(categoryDraft!); categoryDraft = saved; categoryDirty = false; setCategoryStatus(false); renderCategories(); finish(true); }
        catch (error) { dialog.setError(`保存失败：${String(error)}`); }
      });
      dialog.panel.querySelector<HTMLButtonElement>('[data-action="discard"]')?.addEventListener("click", () => { categoryDraft = null; categoryDirty = false; categoryEditor.hidden = true; setCategoryStatus(false); renderCategories(); finish(true); });
      void dialog.open();
    });
  };
  const categoryEditorHome = categoryEditor.parentElement!;
  const refreshCategoryPreview = (scheme: ColorScheme) => {
    const derived = deriveCategoryScheme(clone(scheme));
    startCategoryPalettePreview(categoryPreviewOwner, derived);
    const host = categoryEditor.querySelector<HTMLElement>("[data-category-scenario]");
    if (host) {
      categoryScenarioDispose?.();
      host.replaceChildren();
      const scenario = mountArrangementWeekScenario(host, { date: "2026-10-17", hourPx: 8, blocks: derived.slots.flatMap((slot, i) => [
        { id: `category-draft-${slot.id}-open`, startMinute: 9 * 60 + i * 5, endMinute: 9 * 60 + 35 + i * 5, title: `${slot.name} · 未完成`, color: slot.main, titleColor: slot.unfinishedTitle, background: slot.unfinishedBackground },
        { id: `category-draft-${slot.id}-done`, startMinute: 11 * 60 + i * 5, endMinute: 11 * 60 + 35 + i * 5, title: `${slot.name} · 已完成`, ended: true, color: slot.completed, background: slot.completedBackground },
      ]) });
      categoryScenarioDispose = () => scenario.dispose();
    }
  };
  const closeCategoryEditor = async (): Promise<boolean> => {
    if (categoryDraft && !(await confirmCategoryDisposition())) return false;
    stopCategoryPalettePreview(categoryPreviewOwner);
    categoryScenarioDispose?.(); categoryScenarioDispose = null;
    categoryColorDisposers.splice(0).forEach((dispose) => dispose());
    categoryCompletionDisposers.splice(0).forEach((dispose) => dispose());
    categoryDraft = null; categoryDirty = false; categoryEditor.hidden = true;
    if (floating) { floating.dispose(); floating = null; }
    categoryEditorHome.append(categoryEditor);
    setCategoryStatus(false);
    renderCategories();
    return true;
  };
  const renderCategories = () => {
    for (const oldCard of categoryList.querySelectorAll<HTMLElement>('[data-scenario="shared-arrangement-week-render"]')) (oldCard as HTMLElement & { _scenarioDisposer?: () => void })._scenarioDisposer?.();
    categoryList.replaceChildren();
    let library: ReturnType<typeof listCategorySchemes>;
    try { library = listCategorySchemes(); }
    catch (error) { showCategoryError(String(error)); return; }
    showCategoryError("");
    const cardRecords: Array<{ record: CategorySchemeRecord; builtin: boolean; provenance?: boolean }> = [
      ...library.builtins.map((record) => ({ record, builtin: true })),
      ...library.users.map((record) => ({ record, builtin: false })),
    ];
    if (library.applied && !cardRecords.some(({ record }) => record.id === library.applied.id)) {
      const provenance = document.createElement("p"); provenance.className = "color-management-category-provenance"; provenance.textContent = "当前已应用快照来源已删除或未保存；可复制快照继续编辑。"; categoryList.append(provenance);
      const snapshot: CategorySchemeRecord = { id: library.applied.id, name: library.applied.name, revision: 1, scheme: clone(library.applied) };
      cardRecords.unshift({ record: snapshot, builtin: true, provenance: true });
    }
    for (const { record, builtin, provenance = false } of cardRecords) {
      const card = document.createElement("article"); card.className = "color-management-category-card";
      const colors = categoryColors(record.scheme);
      card.innerHTML = `<div class="color-management-category-card-heading"><div><h3></h3><p></p></div><div class="color-management-card-actions"></div></div><div class="color-management-category-swatches"></div><div class="color-management-category-scenario"></div>`;
      card.querySelector("h3")!.textContent = record.name;
      const isApplied = record.id === library.applied.id;
      card.querySelector("p")!.textContent = `${provenance ? "当前已应用快照来源已删除或未保存 · 只读可复制" : builtin ? "内置 / 只读" : "用户方案"}${isApplied ? " · 当前已应用" : ""}`;
      const swatches = card.querySelector<HTMLElement>(".color-management-category-swatches")!;
      colors.forEach((color) => { const dot = document.createElement("i"); dot.style.background = color; swatches.append(dot); });
      const preview = card.querySelector<HTMLElement>(".color-management-category-scenario")!;
      const previewScheme = deriveCategoryScheme(clone(record.scheme));
      const ordered = orderCategorySlots(previewScheme);
      const scenario = mountArrangementWeekScenario(preview, { date: "2026-10-17", hourPx: 8, blocks: ordered.map((slot, i) => ({ id: `category-preview-${slot.id}`, startMinute: 9 * 60 + i * 5, endMinute: 9 * 60 + 35 + i * 5, title: slot.name, color: slot.main, titleColor: slot.unfinishedTitle ?? slot.main, background: slot.unfinishedBackground })) });
      card.dataset.scenario = "shared-arrangement-week-render";
      (card as HTMLElement & { _scenarioDisposer?: () => void })._scenarioDisposer = () => scenario.dispose();
      const actions = card.querySelector<HTMLElement>(".color-management-card-actions")!;
      const action = (label: string, callback: () => void, disabled = false) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = disabled; button.addEventListener("click", callback); actions.append(button); };
      action(provenance || builtin ? "复制并编辑" : "编辑", () => { void startCategoryDraft(record, provenance || builtin); });
      action("应用", () => { void (async () => { if (categoryDraft && !(await closeCategoryEditor())) return; categoryBusy = true; setCategoryStatus(categoryDirty); try { const { applyCategoryScheme } = await import("./category-repository"); await applyCategoryScheme(record); renderCategories(); } catch (error) { showCategoryError(`应用失败：${String(error)}`); } finally { categoryBusy = false; setCategoryStatus(categoryDirty); } })(); }, isApplied);
      if (!builtin) action("删除", () => { try { deleteCategoryScheme(record.id); renderCategories(); } catch (error) { showCategoryError(String(error)); } });
      categoryList.append(card);
    }
    const actions = document.createElement("div"); actions.className = "color-management-category-library-actions";
    const create = document.createElement("button"); create.type = "button"; create.textContent = "新建分类方案"; create.addEventListener("click", () => startCategoryDraft(createCategoryScheme("我的分类方案")));
    const importLegacy = document.createElement("button"); importLegacy.type = "button"; importLegacy.textContent = "从旧 Color Lab 导入"; importLegacy.addEventListener("click", () => { try { const count = importLegacyCategorySchemes(); showCategoryError(`已导入 ${count} 个分类方案。`); renderCategories(); } catch (error) { showCategoryError(String(error)); } });
    actions.append(create, importLegacy); categoryList.append(actions);
  };

  const startCategoryDraft = async (record: CategorySchemeRecord, forceCopy = false) => {
    if (grayCalibration) { showCategoryError("先关闭分类灰度调整，再打开分类配色编辑器。"); return; }
    if (getThemeEditSession()) { showCategoryError("先保存或取消主题编辑，再打开分类配色编辑器。"); return; }
    if (categoryDraft && !(await closeCategoryEditor())) return;
    categoryDraft = clone(record); categoryDirty = false; categoryEditor.hidden = false; showCategoryError("");
    categoryList.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
    const isNew = forceCopy || record.id.startsWith("system-") || record.id.startsWith("applied-") || record.id === "legacy-default";
    if (isNew) categoryDraft = createCategoryScheme(`${record.name} 副本`, record.scheme);
    categoryEditor.innerHTML = `<header><h3>编辑分类方案</h3><label>方案名称 <input type="text" data-category-name maxlength="80"></label></header><p class="color-management-category-error" data-category-editor-error role="alert" hidden></p><div class="color-management-category-edit-slots"></div><section class="color-management-category-completion"><h4>完成态调整</h4><div data-completion-controls></div></section><h4>密集安排预览</h4><div class="color-management-category-scenario" data-category-scenario></div><div class="color-management-category-edit-actions"><button type="button" data-category-add>增加颜色组</button><button type="button" data-category-save>保存</button><button type="button" data-category-apply>保存并应用</button><button type="button" data-category-cancel>取消</button></div>`;
    categoryEditor.querySelector<HTMLInputElement>("[data-category-name]")!.value = categoryDraft.name;
    const slotsHost = categoryEditor.querySelector<HTMLElement>(".color-management-category-edit-slots")!;
    const paintSlots = () => {
      categoryColorDisposers.splice(0).forEach((dispose) => dispose());
      slotsHost.replaceChildren();
      const current = categoryDraft!.scheme;
      for (const slot of current.designSlots ?? []) {
        const row = document.createElement("section"); row.className = "color-management-category-edit-slot";
        const heading = document.createElement("strong"); heading.textContent = slot.name; row.append(heading);
        const sourceFields = ["base", "unfinishedBackground", "unfinishedTitle", "completed", "completedBackground"] as const;
        const sourceLabels = ["主色种子", "未完成背景种子", "未完成标题种子", "完成色种子", "完成背景种子"] as const;
        sourceFields.forEach((field, index) => {
          const editorHost = document.createElement("div"); row.append(editorHost);
          const editor = mountColorEditor(editorHost, { label: sourceLabels[index]!, value: field === "unfinishedTitle"
            ? (slot.unfinishedTitle ?? hexToOklch(current.slots.find((item) => item.id === slot.id)?.unfinishedTitle ?? current.slots.find((item) => item.id === slot.id)?.main ?? "#87909A"))
            : slot[field], onChange(value) {
            const latest = categoryDraft!.scheme;
            const correctionField = field === "base" ? "main" : field;
            const designSlots = latest.designSlots!.map((item) => {
              if (item.id !== slot.id) return item;
              const correction = { ...item.correction }; delete correction[correctionField];
              return { ...item, [field]: value, correction: Object.keys(correction).length ? correction : undefined };
            });
            categoryDraft!.scheme = deriveCategoryScheme({ ...latest, designSlots }); categoryDirty = true;
            refreshCategoryPreview(categoryDraft!.scheme); setCategoryStatus(true);
          } });
          categoryColorDisposers.push(() => editor.dispose());
        });
        const derived = current.slots.find((item) => item.id === slot.id)!;
        const correctionRows = [
          ["main", "主色校正", derived.main],
          ["unfinishedBackground", "未完成背景校正", derived.unfinishedBackground],
          ["unfinishedTitle", "未完成标题校正", derived.unfinishedTitle],
          ["completed", "完成色校正", derived.completed],
          ["completedBackground", "完成背景校正", derived.completedBackground],
        ] as const;
        for (const [field, labelText, fallback] of correctionRows) {
          const correctionRow = document.createElement("div"); correctionRow.className = "color-management-category-correction";
          const label = document.createElement("label"); label.textContent = labelText;
          const input = document.createElement("input"); input.type = "color"; input.value = slot.correction?.[field] ?? fallback; input.setAttribute("aria-label", `${slot.name}${labelText}`);
          input.addEventListener("input", () => { const latest = categoryDraft!.scheme; const designSlots = latest.designSlots!.map((item) => item.id === slot.id ? { ...item, correction: { ...item.correction, [field]: input.value.toUpperCase() } } : item); categoryDraft!.scheme = deriveCategoryScheme({ ...latest, designSlots }); categoryDirty = true; refreshCategoryPreview(categoryDraft!.scheme); setCategoryStatus(true); });
          const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "清除"; clear.disabled = !slot.correction?.[field];
          clear.addEventListener("click", () => { const latest = categoryDraft!.scheme; const designSlots = latest.designSlots!.map((item) => { if (item.id !== slot.id) return item; const correction = { ...item.correction }; delete correction[field]; return { ...item, correction: Object.keys(correction).length ? correction : undefined }; }); categoryDraft!.scheme = deriveCategoryScheme({ ...latest, designSlots }); categoryDirty = true; paintSlots(); refreshCategoryPreview(categoryDraft!.scheme); setCategoryStatus(true); });
          correctionRow.append(label, input, clear); row.append(correctionRow);
        }
        if (!LEGACY_CATEGORY_SLOTS.some((legacy) => legacy.id === slot.id)) {
          const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除颜色组";
          remove.addEventListener("click", () => { const latest = categoryDraft!.scheme; categoryDraft!.scheme = deriveCategoryScheme({ ...latest, designSlots: latest.designSlots!.filter((item) => item.id !== slot.id) }); categoryDirty = true; paintSlots(); refreshCategoryPreview(categoryDraft!.scheme); setCategoryStatus(true); });
          row.append(remove);
        }
        slotsHost.append(row);
      }
      categoryEditor.querySelector<HTMLButtonElement>("[data-category-add]")!.disabled = current.designSlots!.length >= MAX_CATEGORY_SLOTS;
    };
    const completionHost = categoryEditor.querySelector<HTMLElement>("[data-completion-controls]")!;
    const completionLabels = { lightness: "完成明度偏移", chroma: "完成色度偏移", fillAlpha: "完成填充透明度", borderAlpha: "完成边框透明度" } as const;
    for (const key of Object.keys(completionLabels) as Array<keyof ColorScheme["completion"]>) {
      const label = document.createElement("div");
      const title = document.createElement("span"); title.textContent = completionLabels[key];
      const slider = mountSliderField({ label: completionLabels[key], min: key === "lightness" ? -0.5 : key === "chroma" ? -0.3 : 0, max: key === "lightness" ? 0.5 : key === "chroma" ? 0.3 : 1, step: 0.005, value: categoryDraft.scheme.completion[key], onChange(value) {
        categoryDraft!.scheme = deriveCategoryScheme({ ...categoryDraft!.scheme, completion: { ...categoryDraft!.scheme.completion, [key]: value } });
        categoryDirty = true; refreshCategoryPreview(categoryDraft!.scheme); setCategoryStatus(true);
      } });
      categoryCompletionDisposers.push(() => slider.dispose());
      label.append(title, slider.element); completionHost.append(label);
    }
    const readRecord = (): CategorySchemeRecord => { const name = categoryEditor.querySelector<HTMLInputElement>("[data-category-name]")!.value.trim(); if (!name) throw new Error("请输入方案名称。"); categoryDraft!.name = name; categoryDraft!.scheme.name = name; return categoryDraft!; };
    const content = document.createElement("div"); content.append(categoryEditor);
    floating = mountFloatingPanel({ title: `编辑分类配色：${categoryDraft.name}`, content, onCloseRequest: () => { void closeCategoryEditor(); } });
    floating.element.classList.add("color-management-floating-editor");
    paintSlots(); refreshCategoryPreview(categoryDraft.scheme);
    categoryEditor.querySelector<HTMLInputElement>("[data-category-name]")!.addEventListener("input", (event) => { categoryDraft!.name = (event.currentTarget as HTMLInputElement).value; categoryDirty = true; setCategoryStatus(true); });
    categoryEditor.querySelector<HTMLButtonElement>("[data-category-add]")!.addEventListener("click", () => {
      const latest = categoryDraft!.scheme; if (latest.designSlots!.length >= MAX_CATEGORY_SLOTS) return;
      const id = `experimental-${crypto.randomUUID()}`; const hue = Math.random() * 360;
      const canonicalHex = allocateCategoryCanonicalHex([...latest.slots.map((slot) => slot.canonicalHex), ...latest.designSlots!.flatMap((slot) => slot.canonicalHex ? [slot.canonicalHex] : [])]);
      const added = { id, name: `颜色 ${latest.designSlots!.length + 1}`, canonicalHex, base: { l: 0.68, c: 0.13, h: hue }, unfinishedBackground: { l: 0.96, c: 0.02, h: hue }, unfinishedTitle: { l: 0.68, c: 0.13, h: hue }, completed: { l: 0.54, c: 0.08, h: hue }, completedBackground: { l: 0.98, c: 0.01, h: hue } };
      categoryDraft!.scheme = deriveCategoryScheme({ ...latest, designSlots: [...latest.designSlots!, added] }); categoryDirty = true; paintSlots(); refreshCategoryPreview(categoryDraft!.scheme); setCategoryStatus(true);
    });
    categoryEditor.querySelector<HTMLButtonElement>("[data-category-save]")!.addEventListener("click", () => { try { categoryDraft = saveCategoryScheme(readRecord()); categoryDirty = false; void closeCategoryEditor().then(() => showCategoryStatus("方案已保存；当前正式配色未改变。")); } catch (error) { showCategoryError(String(error)); } });
    categoryEditor.querySelector<HTMLButtonElement>("[data-category-apply]")!.addEventListener("click", () => {
      try {
        const record = readRecord();
        categoryBusy = true; setCategoryStatus(categoryDirty);
        void saveAndApplyCategoryScheme(record).then(() => { categoryDirty = false; return closeCategoryEditor(); }).catch((error: unknown) => {
          // The library and applied appearance are separate keys. Keep the saved
          // revision after a partial failure so retry does not conflict with itself.
          if (error && typeof error === "object" && "savedScheme" in error) categoryDraft = (error as { savedScheme: CategorySchemeRecord }).savedScheme;
          showCategoryError(String(error));
        }).finally(() => { categoryBusy = false; setCategoryStatus(categoryDirty); });
      } catch (error) { categoryBusy = false; showCategoryError(String(error)); }
    });
    categoryEditor.querySelector<HTMLButtonElement>("[data-category-cancel]")!.addEventListener("click", () => { categoryDirty = false; void closeCategoryEditor(); });
  };

  root.querySelector<HTMLButtonElement>("[data-category-gray-open]")!.addEventListener("click", openGrayCalibration);
  renderThemes(); renderCategories();
  const setThemeDirty = () => setCategoryStatus(categoryDirty, Boolean(getThemeEditSession()?.error));
  const unsubscribeDirty = subscribeThemeEdit(setThemeDirty);
  return {
    async canDispose() {
      if (categoryBusy) return false;
      if (grayCalibration && !(await grayCalibration.requestClose())) return false;
      if (!(await confirmCategoryDisposition())) return false;
      return true;
    },
    dispose() {
      disposed = true; unsubscribeTheme(); unsubscribeDirty();
      grayCalibration?.dispose(); grayCalibration = null;
      editorCleanup?.(); floating?.dispose(); floating = null;
      stopCategoryPalettePreview(categoryPreviewOwner);
      categoryScenarioDispose?.(); categoryScenarioDispose = null;
      categoryColorDisposers.splice(0).forEach((dispose) => dispose());
      categoryCompletionDisposers.splice(0).forEach((dispose) => dispose());
      for (const card of categoryList.querySelectorAll<HTMLElement>('[data-scenario="shared-arrangement-week-render"]')) (card as HTMLElement & { _scenarioDisposer?: () => void })._scenarioDisposer?.();
      categoryEditor.replaceChildren(); categoryList.replaceChildren(); themeList.replaceChildren();
      setDirtyStatus(ownerKey, { dirty: false, inFlight: false, failed: false });
    },
  };
}
