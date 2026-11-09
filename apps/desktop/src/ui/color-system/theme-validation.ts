import { UI_THEME_ROLES, type UiThemeDocument, type UiThemeRoleId, type UiThemeSettings } from "./theme-types";

export const MAX_THEME_SETTINGS_BYTES = 1024 * 1024;
const ownKeysMatch = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是对象。`);
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  if (!ownKeysMatch(value, keys) || keys.some((key) => !(key in value))) throw new Error(`${label}含未知或缺失字段。`);
};

export function validateUiThemeDocument(value: unknown): UiThemeDocument {
  const theme = object(value, "主题");
  exact(theme, ["schemaVersion", "engineVersion", "metadata", "colors", "stateRules", ...(Object.prototype.hasOwnProperty.call(theme, "selection") ? ["selection"] : [])], "主题");
  if (theme.schemaVersion !== 1 || theme.engineVersion !== 1) throw new Error("不支持的主题版本。");
  const metadata = object(theme.metadata, "主题元数据");
  exact(metadata, ["id", "name", "revision", "updatedAt"], "主题元数据");
  if (typeof metadata.id !== "string" || !metadata.id.trim() || metadata.id.length > 128) throw new Error("主题 ID 无效。");
  if (typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 80) throw new Error("主题名称无效。");
  if (!Number.isSafeInteger(metadata.revision) || (metadata.revision as number) < 1) throw new Error("主题版本号无效。");
  if (typeof metadata.updatedAt !== "string" || metadata.updatedAt.length > 64) throw new Error("主题更新时间无效。");
  const colors = object(theme.colors, "主题颜色");
  const seed = colors["state.neutral.hover"];
  if (seed && typeof seed === "object") {
    for (const role of ["state.hover.sidebar", "state.hover.page"] as const) {
      if (!(role in colors)) colors[role] = structuredClone(seed);
    }
  }
  // Old documents stored one border for every line. Copy it so the week grid
  // keeps its previous color until the user edits the new role. Reading does not rewrite settings.
  const border = colors["border.subtle"];
  if (border && typeof border === "object" && !("border.weekGrid" in colors)) colors["border.weekGrid"] = structuredClone(border);
  const roleIds = Object.keys(UI_THEME_ROLES) as UiThemeRoleId[];
  exact(colors, roleIds, "主题颜色");
  for (const roleId of roleIds) {
    const entry = object(colors[roleId], `主题颜色 ${roleId}`);
    exact(entry, ["oklch"], `主题颜色 ${roleId}`);
    const oklch = object(entry.oklch, `主题颜色 ${roleId} OKLCH`);
    exact(oklch, ["l", "c", "h"], `主题颜色 ${roleId} OKLCH`);
    const { l, c, h } = oklch;
    if (![l, c, h].every((part) => typeof part === "number" && Number.isFinite(part))) throw new Error(`主题颜色 ${roleId} 数值无效。`);
    if ((l as number) < 0 || (l as number) > 1 || (c as number) < 0 || (c as number) > 0.5 || (h as number) < 0 || (h as number) >= 360) throw new Error(`主题颜色 ${roleId} 超出范围。`);
  }
  const stateRules = object(theme.stateRules, "主题状态规则");
  exact(stateRules, ["hoverAlpha", "pressedAlpha", "disabledAlpha", "focusAlpha", ...(Object.prototype.hasOwnProperty.call(stateRules, "focusEnabled") ? ["focusEnabled"] : [])], "主题状态规则");
  for (const name of ["hoverAlpha", "pressedAlpha", "disabledAlpha", "focusAlpha"] as const) {
    const v = stateRules[name];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`主题状态规则 ${name} 无效。`);
  }
  if (stateRules.focusEnabled !== undefined && typeof stateRules.focusEnabled !== "boolean") throw new Error("主题状态规则 focusEnabled 无效。");
  if (theme.selection !== undefined) {
    const selection = object(theme.selection, "主题选中背景");
    exact(selection, ["mode", "lightnessDelta"], "主题选中背景");
    if (selection.mode !== "relative" && selection.mode !== "custom") throw new Error("主题选中背景模式无效。");
    if (typeof selection.lightnessDelta !== "number" || !Number.isFinite(selection.lightnessDelta) || selection.lightnessDelta < -1 || selection.lightnessDelta > 1) throw new Error("主题选中背景明度偏移无效。");
  }
  return value as UiThemeDocument;
}

export function validateThemeSettingsSize(value: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_THEME_SETTINGS_BYTES) throw new Error("主题设置超过 1 MiB。请减少预设后重试。");
}

export function validateUiThemeSettings(value: unknown): UiThemeSettings {
  const settings = object(value, "主题设置");
  exact(settings, ["insightThemePresets", "appliedInsightTheme", "insightThemeLibraryRevision"], "主题设置");
  if (!Array.isArray(settings.insightThemePresets) || !Number.isSafeInteger(settings.insightThemeLibraryRevision) || (settings.insightThemeLibraryRevision as number) < 0) throw new Error("主题库版本或预设列表无效。");
  const ids = new Set<string>();
  for (const raw of settings.insightThemePresets) {
    const preset = object(raw, "主题预设");
    exact(preset, ["id", "name", "revision", "builtin", "theme"], "主题预设");
    if (typeof preset.id !== "string" || !preset.id.trim() || preset.id.length > 128 || ids.has(preset.id)) throw new Error("主题预设 ID 无效或重复。");
    if (typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 80 || preset.builtin !== false || !Number.isSafeInteger(preset.revision) || (preset.revision as number) < 1) throw new Error("用户主题预设元数据无效。");
    ids.add(preset.id);
    validateUiThemeDocument(preset.theme);
  }
  const applied = object(settings.appliedInsightTheme, "已应用主题快照");
  exact(applied, ["schemaVersion", "presetId", "presetName", "revision", "appliedAt", "theme"], "已应用主题快照");
  if (applied.schemaVersion !== 1 || (applied.presetId !== null && (typeof applied.presetId !== "string" || applied.presetId.length > 128))
    || typeof applied.presetName !== "string" || !applied.presetName.trim() || applied.presetName.length > 80
    || !Number.isSafeInteger(applied.revision) || (applied.revision as number) < 1 || typeof applied.appliedAt !== "string" || applied.appliedAt.length > 64) {
    throw new Error("已应用主题快照元数据无效。");
  }
  validateUiThemeDocument(applied.theme);
  validateThemeSettingsSize(settings);
  return value as UiThemeSettings;
}
