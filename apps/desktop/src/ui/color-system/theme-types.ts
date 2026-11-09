import type { Oklch } from "./types";

/** Public roles consumed by the Insight theme resolver. Add roles here only with an explicit surface/consumer mapping. */
export const UI_THEME_ROLES = {
  "surface.chrome": { label: "一级栏与外壳", purpose: "一级导航栏、标题栏与应用外框背景", legacy: "chrome" },
  "surface.sidebar": { label: "二级侧栏", purpose: "二级导航与列表侧栏背景", legacy: "sidebar" },
  "surface.page": { label: "主内容区", purpose: "主页面底色；上方卡片与控件使用各自独立的表面角色", legacy: "page" },
  "surface.card": { label: "卡片与浮层", purpose: "卡片、对话框和浮层背景", legacy: "surface" },
  "surface.control": { label: "控件", purpose: "输入控件背景", legacy: "controlSurface" },
  "surface.inset": { label: "内嵌表面", purpose: "内嵌输入区与凹面背景", legacy: "sunken" },
  "text.primary": { label: "主要文字", purpose: "正文与主要内容", legacy: "textPrimary" },
  "text.secondary": { label: "次要文字", purpose: "说明文字与次要内容", legacy: "textSecondary" },
  "text.placeholder": { label: "占位文字", purpose: "输入提示文字" },
  "text.disabled": { label: "禁用文字", purpose: "不可用控件文字" },
  "border.subtle": { label: "细边界", purpose: "控件、卡片与分隔线边界", legacy: "border" },
  "border.weekGrid": { label: "周视图网格", purpose: "周视图整点横线、半小时线和日列竖线。整点与半小时仍按既有比例减淡。" },
  "brand.primary": { label: "品牌主色", purpose: "主要操作与品牌强调", legacy: "primary" },
  "brand.primaryForeground": { label: "主色前景", purpose: "实心主色按钮与标记上的前景" },
  "brand.primaryHover": { label: "主色悬停", purpose: "主要操作悬停颜色" },
  "state.selection.surface": { label: "选中背景", purpose: "导航、选项和列表选中背景", legacy: "selected" },
  "state.selection.foreground": { label: "选中文字", purpose: "选中背景上的文字" },
  "state.focus.ring": { label: "焦点环", purpose: "键盘焦点环颜色" },
  "state.focus.foreground": { label: "焦点文字", purpose: "焦点状态上的文字" },
  "state.neutral.hover": { label: "一级栏悬浮", purpose: "一级栏图标与标签栏未激活标签的悬浮底色", legacy: "hover" },
  "state.hover.sidebar": { label: "二级栏悬浮", purpose: "二级栏行的悬浮底色" },
  "state.hover.page": { label: "主背景悬浮", purpose: "主内容区列表行的悬浮底色" },
  "state.neutral.pressed": { label: "中性按下", purpose: "中性控件按下状态的混合前景" },
  "state.disabled.surface": { label: "禁用背景种子", purpose: "禁用状态背景混合的源色" },
  "state.disabled.foreground": { label: "禁用文字", purpose: "禁用状态前景颜色" },
  "semantic.success.foreground": { label: "绿色主色", purpose: "成功文字与实心成功按钮" },
  "semantic.success.surface": { label: "绿色副色", purpose: "成功浅底" },
  "semantic.warning.foreground": { label: "黄色主色", purpose: "警告文字与实心警告按钮" },
  "semantic.warning.surface": { label: "黄色副色", purpose: "警告浅底" },
  "semantic.danger.foreground": { label: "红色主色", purpose: "危险文字与实心危险按钮", legacy: "danger" },
  "semantic.danger.surface": { label: "红色副色", purpose: "危险浅底，如菜单悬浮和错误条" },
  "semantic.info.foreground": { label: "信息文字", purpose: "信息与中性提示" },
  "semantic.info.surface": { label: "信息背景", purpose: "信息浅色背景" },
} as const satisfies Record<string, { label: string; purpose: string; legacy?: string }>;

export type UiThemeRoleId = keyof typeof UI_THEME_ROLES;
export type UiThemeSourceColor = Readonly<{ oklch: Oklch }>;
export type UiThemeMetadata = Readonly<{ id: string; name: string; revision: number; updatedAt: string }>;
export type UiThemeDocument = Readonly<{
  schemaVersion: 1;
  engineVersion: 1;
  metadata: UiThemeMetadata;
  colors: Readonly<Record<UiThemeRoleId, UiThemeSourceColor>>;
  stateRules: Readonly<{ hoverAlpha: number; pressedAlpha: number; disabledAlpha: number; focusAlpha: number; focusEnabled?: boolean }>;
  /** Optional for compatibility; absent legacy documents retain their stored selection color. */
  selection?: Readonly<{ mode: "relative" | "custom"; lightnessDelta: number }>;
}>;

export type ResolvedColor = Readonly<{ hex: string; oklch: Oklch; mapped: boolean }>;
export type ResolvedUiTheme = Readonly<{
  roles: Readonly<Record<UiThemeRoleId, ResolvedColor>>;
  legacy: Readonly<Record<"primary" | "selected" | "hover" | "chrome" | "sidebar" | "page" | "surface" | "controlSurface" | "sunken" | "textPrimary" | "textSecondary" | "border" | "danger", string>>;
  cssVariables: Readonly<Record<string, string>>;
  contexts: Readonly<Record<"chrome" | "sidebar" | "page" | "card" | "control" | "inset", Readonly<{ hover: string; pressed: string; selected: string; selectedForeground: string; focus: string; focusForeground: string; disabled: string; disabledForeground: string }>>>;
  contrastPairs: Readonly<Record<string, Readonly<{ foreground: string; background: string; ratio: number }>>>;
}>;

export type ThemePreset = Readonly<{ id: string; name: string; revision: number; builtin: boolean; sourceDeleted?: true; legacyImported?: true; theme: UiThemeDocument }>;
export type AppliedUiThemeSnapshot = Readonly<{ schemaVersion: 1; presetId: string | null; presetName: string; revision: number; appliedAt: string; theme: UiThemeDocument }>;
export type UiThemeSettings = Readonly<{ insightThemePresets: readonly ThemePreset[]; appliedInsightTheme: AppliedUiThemeSnapshot; insightThemeLibraryRevision: number }>;
