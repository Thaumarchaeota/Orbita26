import { compositeHex, contrastRatio, hexToOklch, oklchToHex } from "./color";
import { UI_THEME_ROLES, type ResolvedColor, type ResolvedUiTheme, type UiThemeDocument, type UiThemeRoleId } from "./theme-types";

const contexts = ["chrome", "sidebar", "page", "card", "control", "inset"] as const;
const sourceRoleByContext = {
  chrome: "surface.chrome", sidebar: "surface.sidebar", page: "surface.page", card: "surface.card", control: "surface.control", inset: "surface.inset",
} as const satisfies Record<(typeof contexts)[number], UiThemeRoleId>;
const withAlpha = (hex: string, alpha: number) => {
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
};

export function resolveUiRoles(theme: UiThemeDocument, options: { grayscalePreview?: boolean } = {}): ResolvedUiTheme {
  const roles = {} as Record<UiThemeRoleId, ResolvedColor>;
  for (const role of Object.keys(UI_THEME_ROLES) as UiThemeRoleId[]) {
    const source = theme.colors[role].oklch;
    const input = options.grayscalePreview ? { ...source, c: 0 } : { ...source };
    const converted = oklchToHex(input);
    roles[role] = { hex: converted.hex, oklch: input, mapped: converted.mapped };
  }
  const color = (role: UiThemeRoleId) => roles[role].hex;
  const selectionRule = theme.selection;
  const state = {} as Record<(typeof contexts)[number], ResolvedUiTheme["contexts"][(typeof contexts)[number]]>;
  for (const context of contexts) {
    const base = color(sourceRoleByContext[context]);
    const selection = selectionRule?.mode === "relative"
      ? oklchToHex({ ...roles[sourceRoleByContext[context]].oklch, l: Math.max(0, Math.min(1, roles[sourceRoleByContext[context]].oklch.l + selectionRule.lightnessDelta)) }).hex
      : color("state.selection.surface");
    // Chrome, sidebar, and page hovers are direct fills. Mixing them through hoverAlpha made the two rails share one seed.
    const hover = context === "chrome" ? color("state.neutral.hover")
      : context === "sidebar" ? color("state.hover.sidebar")
      : context === "page" ? color("state.hover.page")
      : compositeHex(color("state.hover.page"), base, theme.stateRules.hoverAlpha);
    state[context] = {
      hover,
      pressed: compositeHex(color("state.neutral.pressed"), base, theme.stateRules.pressedAlpha),
      selected: selection, selectedForeground: color("state.selection.foreground"),
      focus: theme.stateRules.focusEnabled === false ? "transparent" : withAlpha(color("state.focus.ring"), theme.stateRules.focusAlpha), focusForeground: color("state.focus.foreground"),
      disabled: compositeHex(color("state.disabled.surface"), base, theme.stateRules.disabledAlpha),
      disabledForeground: color("state.disabled.foreground"),
    };
  }
  const legacy = {
    primary: color("brand.primary"), selected: state.page.selected, hover: state.page.hover,
    chrome: color("surface.chrome"), sidebar: color("surface.sidebar"), page: color("surface.page"),
    surface: color("surface.card"), controlSurface: color("surface.control"), sunken: color("surface.inset"),
    textPrimary: color("text.primary"), textSecondary: color("text.secondary"), border: color("border.subtle"),
    danger: color("semantic.danger.foreground"),
  } as const;
  const pairs = {
    primary: [color("brand.primaryForeground"), color("brand.primary")],
    pageText: [color("text.primary"), color("surface.page")],
    cardText: [color("text.primary"), color("surface.card")],
    secondaryText: [color("text.secondary"), color("surface.card")],
    selection: [color("state.selection.foreground"), state.page.selected],
    focus: [color("state.focus.foreground"), color("state.focus.ring")],
    danger: [color("semantic.danger.foreground"), color("semantic.danger.surface")],
    success: [color("semantic.success.foreground"), color("semantic.success.surface")],
    warning: [color("semantic.warning.foreground"), color("semantic.warning.surface")],
    info: [color("semantic.info.foreground"), color("semantic.info.surface")],
  } as const;
  const contrastPairs = Object.fromEntries(Object.entries(pairs).map(([key, [foreground, background]]) => [key, { foreground, background, ratio: contrastRatio(foreground, background) }]));
  const cssVariables: Record<string, string> = {
    "--insight-primary": legacy.primary, "--insight-primary-hover": color("brand.primaryHover"),
    "--insight-selected-bg": legacy.selected, "--insight-hover-bg": legacy.hover,
    "--insight-pressed-bg": state.page.pressed,
    "--insight-chrome-bg": legacy.chrome, "--insight-sidebar-bg": legacy.sidebar, "--insight-page-bg": legacy.page,
    "--insight-surface-bg": legacy.surface, "--insight-control-surface-bg": legacy.controlSurface, "--insight-sunken-bg": legacy.sunken,
    "--insight-text-primary": legacy.textPrimary, "--insight-text-secondary": legacy.textSecondary,
    "--insight-text-placeholder": color("text.placeholder"), "--insight-text-disabled": color("text.disabled"),
    "--insight-border-color": legacy.border, "--insight-border-subtle": legacy.border,
    "--insight-week-grid": color("border.weekGrid"),
    "--insight-danger": legacy.danger, "--insight-danger-bg": color("semantic.danger.surface"), "--insight-danger-surface": color("semantic.danger.surface"),
    "--insight-success": color("semantic.success.foreground"), "--insight-success-bg": color("semantic.success.surface"),
    "--insight-warning": color("semantic.warning.foreground"), "--insight-warning-bg": color("semantic.warning.surface"),
    "--insight-info": color("semantic.info.foreground"), "--insight-info-bg": color("semantic.info.surface"),
    "--insight-focus-ring": theme.stateRules.focusEnabled === false ? "transparent" : withAlpha(color("state.focus.ring"), theme.stateRules.focusAlpha),
    "--insight-titlebar": legacy.chrome, "--insight-tab-strip-bg": legacy.chrome, "--insight-sidebar": legacy.sidebar,
    "--insight-content-bg": legacy.page, "--insight-tab-active-bg": legacy.page, "--insight-chat-list-bg": legacy.sidebar,
    "--insight-card-bg": legacy.surface, "--insight-composer-bg": legacy.controlSurface, "--insight-surface-subtle": legacy.sunken,
    "--insight-nav-active": state.sidebar.selected,
    "--insight-list-selected": state.sidebar.selected, "--insight-icon-default": legacy.textSecondary, "--insight-icon-active": legacy.primary,
    "--insight-user-bubble": legacy.primary, "--insight-user-bubble-text": color("brand.primaryForeground"),
    "--insight-md-code": legacy.sunken, "--insight-md-inline-code": legacy.sunken, "--insight-md-table-head": legacy.sunken,
    "--insight-md-table-border": legacy.border, "--insight-input-border": legacy.border,
    "--insight-control-hover": state.control.hover, "--insight-control-pressed": state.control.pressed,
    "--insight-control-selected": state.control.selected, "--insight-on-primary": color("brand.primaryForeground"),
    "--insight-tab-hover-bg": state.chrome.hover, "--insight-nav-hover": state.sidebar.hover,
    "--insight-surface-page": legacy.page, "--insight-surface-panel": legacy.surface,
    "--insight-surface-elevated": legacy.surface, "--insight-surface-sunken": legacy.sunken,
    "--insight-divider": legacy.border,
  };
  const legacyAliases: Record<string, string> = {
    "--admin-chrome": legacy.chrome, "--admin-accent": legacy.primary, "--admin-accent-hover": color("brand.primaryHover"),
    "--admin-accent-bg": state.chrome.selected, "--admin-surface": legacy.surface, "--admin-border": legacy.border,
    "--admin-text": legacy.textPrimary, "--admin-muted": legacy.textSecondary, "--admin-hover": legacy.hover,
  };
  Object.assign(cssVariables, legacyAliases);
  for (const context of contexts) {
    const value = state[context];
    const prefix = `--insight-state-${context}`;
    cssVariables[`--insight-hover-${context}`] = value.hover;
    cssVariables[`--insight-pressed-${context}`] = value.pressed;
    cssVariables[`${prefix}-selected`] = value.selected;
    cssVariables[`${prefix}-selected-foreground`] = value.selectedForeground;
    cssVariables[`${prefix}-focus`] = value.focus;
    cssVariables[`${prefix}-focus-foreground`] = value.focusForeground;
    cssVariables[`${prefix}-disabled`] = value.disabled;
    cssVariables[`${prefix}-disabled-foreground`] = value.disabledForeground;
  }
  return { roles, legacy, cssVariables, contexts: state, contrastPairs };
}

export function sourceColorFromHex(hex: string) {
  return { oklch: hexToOklch(hex) } as const;
}
