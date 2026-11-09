import { getSettings, loadSettings, patchSettings } from "../../../core/settings";
import type { UiPrefs } from "../../../core/data/types";
import { importLegacyTheme } from "../../../ui/color-system/theme-legacy";
import { UI_THEME_PRESETS } from "../../../ui/color-system/theme-presets";
import { validateUiThemeDocument, validateUiThemeSettings } from "../../../ui/color-system/theme-validation";
import type { AppliedUiThemeSnapshot, ThemePreset, UiThemeSettings } from "../../../ui/color-system/theme-types";
import { applyInsightThemeSnapshot, enqueueInsightSettingsWrite } from "../insight-theme";

export type ThemeState = Readonly<UiThemeSettings>;
const BUILTIN_IDS = new Set(UI_THEME_PRESETS.map((preset) => preset.id));
let cachedState: ThemeState | null = null;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function asSettings(value: Partial<UiPrefs> | undefined): ThemeState {
  if (value?.insightThemePresets === undefined && value?.appliedInsightTheme === undefined && value?.insightThemeLibraryRevision === undefined) {
    const settings = getSettings();
    const imported = importLegacyTheme({ theme: settings.ui.insightTheme, palette: settings.ui.insightPalette });
    const theme = validateUiThemeDocument(imported.theme);
    return {
      insightThemePresets: [],
      appliedInsightTheme: { schemaVersion: 1, presetId: imported.presetId, presetName: theme.metadata.name, revision: 1, appliedAt: "", theme },
      insightThemeLibraryRevision: 0,
    };
  }
  if (!value?.insightThemePresets || !value.appliedInsightTheme || !Number.isSafeInteger(value.insightThemeLibraryRevision)) {
    throw new Error("主题设置不完整或版本未知。原始设置已保留，请导出后处理。");
  }
  const state = {
    insightThemePresets: value.insightThemePresets,
    appliedInsightTheme: value.appliedInsightTheme,
    insightThemeLibraryRevision: value.insightThemeLibraryRevision,
  } as ThemeState;
  return validateUiThemeSettings(state);
}

export function readThemeState(): ThemeState {
  cachedState = asSettings(getSettings().ui);
  return cachedState;
}
export function listThemePresets(): readonly ThemePreset[] {
  const state = readThemeState();
  const applied = state.appliedInsightTheme;
  const userPresets = state.insightThemePresets;
  const appliedPreset = applied.presetId && ![...BUILTIN_IDS].includes(applied.presetId) && !userPresets.some((preset) => preset.id === applied.presetId)
    ? [{ id: applied.presetId, name: applied.presetName, revision: applied.revision, builtin: false, ...(applied.presetId.startsWith("legacy:imported-") ? { legacyImported: true as const } : { sourceDeleted: true as const }), theme: applied.theme } as const]
    : [];
  return [...UI_THEME_PRESETS, ...userPresets, ...appliedPreset];
}
export function readAppliedTheme(): AppliedUiThemeSnapshot { return readThemeState().appliedInsightTheme; }

function ensureThemeSettings(state: ThemeState): void {
  validateUiThemeSettings(state);
  for (const preset of state.insightThemePresets) {
    if (BUILTIN_IDS.has(preset.id) || !preset.id.trim() || preset.name.trim().length < 1 || preset.name.length > 80) throw new Error("用户主题名称或 ID 无效。");
    validateUiThemeDocument(preset.theme);
  }
}

export async function saveThemeState(state: ThemeState, expectedLibraryRevision?: number, expectedDataDir?: string): Promise<ThemeState> {
  // Presets and the complete applied snapshot share one AppSettings write so an apply cannot outlive a failed library save; see SPEC-0006 §1/§4.
  ensureThemeSettings(state);
  try {
    await enqueueInsightSettingsWrite(async () => {
      const current = getSettings();
      if (expectedDataDir && current.dataDir !== expectedDataDir) throw new Error("数据目录已更改，主题草稿保留，请重新打开后保存。");
      if (expectedLibraryRevision !== undefined && (current.ui.insightThemeLibraryRevision ?? 0) !== expectedLibraryRevision) throw new Error("主题库已被其他修改更新，请刷新后重试。");
      await patchSettings({ ui: {
        insightThemePresets: [...state.insightThemePresets],
        appliedInsightTheme: state.appliedInsightTheme,
        insightThemeLibraryRevision: state.insightThemeLibraryRevision,
      } as Partial<UiPrefs> });
    });
  } catch (error) {
    await loadSettings().catch(() => undefined);
    cachedState = null;
    throw error;
  }
  cachedState = state;
  return state;
}

export function createUserThemePreset(input: { id: string; name: string; theme: ThemeState["appliedInsightTheme"]["theme"] }): Promise<ThemePreset> {
  const state = readThemeState();
  if (!input.id.trim() || listThemePresets().some((preset) => preset.id === input.id)) return Promise.reject(new Error("主题 ID 已存在或无效。"));
  if (!input.name.trim() || input.name.length > 80) return Promise.reject(new Error("主题名称长度必须为 1–80 个字符。"));
  const now = new Date().toISOString();
  const theme = validateUiThemeDocument({ ...input.theme, metadata: { ...input.theme.metadata, id: input.id, name: input.name.trim(), revision: 1, updatedAt: now } });
  const preset: ThemePreset = { id: input.id, name: input.name.trim(), revision: 1, builtin: false, theme };
  return saveThemeState({ ...state, insightThemePresets: [...state.insightThemePresets, preset], insightThemeLibraryRevision: state.insightThemeLibraryRevision + 1 }, state.insightThemeLibraryRevision).then(() => preset);
}

export async function renameThemePreset(id: string, name: string): Promise<ThemePreset> {
  const state = readThemeState();
  const previous = state.insightThemePresets.find((preset) => preset.id === id);
  if (!previous) throw new Error("只可重命名已保存的用户主题。");
  if (!name.trim() || name.length > 80) throw new Error("主题名称长度必须为 1–80 个字符。");
  const revision = previous.revision + 1;
  const theme = validateUiThemeDocument({ ...previous.theme, metadata: { ...previous.theme.metadata, name: name.trim(), revision, updatedAt: new Date().toISOString() } });
  const updated: ThemePreset = { ...previous, name: name.trim(), revision, theme };
  await saveThemeState({ ...state, insightThemePresets: state.insightThemePresets.map((preset) => preset.id === id ? updated : preset), insightThemeLibraryRevision: state.insightThemeLibraryRevision + 1 }, state.insightThemeLibraryRevision);
  return updated;
}

export async function deleteThemePreset(id: string): Promise<void> {
  if (BUILTIN_IDS.has(id)) throw new Error("内置主题不能删除。");
  const state = readThemeState();
  if (!state.insightThemePresets.some((preset) => preset.id === id)) throw new Error("主题不存在。");
  await saveThemeState({ ...state, insightThemePresets: state.insightThemePresets.filter((preset) => preset.id !== id), insightThemeLibraryRevision: state.insightThemeLibraryRevision + 1 }, state.insightThemeLibraryRevision);
}

export async function applyThemePreset(id: string): Promise<AppliedUiThemeSnapshot> {
  const state = readThemeState();
  const preset = [...UI_THEME_PRESETS, ...state.insightThemePresets].find((candidate) => candidate.id === id);
  if (!preset) throw new Error("主题不存在或尚未保存。");
  const snapshot: AppliedUiThemeSnapshot = {
    schemaVersion: 1, presetId: preset.id, presetName: preset.name, revision: state.appliedInsightTheme.revision + 1,
    appliedAt: new Date().toISOString(), theme: clone(validateUiThemeDocument(preset.theme)),
  };
  await saveThemeState({ ...state, appliedInsightTheme: snapshot }, state.insightThemeLibraryRevision);
  applyInsightThemeSnapshot(snapshot);
  return snapshot;
}

export async function reloadThemeSettings(): Promise<ThemeState> {
  await loadSettings();
  cachedState = null;
  return readThemeState();
}

export function makeAppliedSnapshot(preset: ThemePreset, revision: number): AppliedUiThemeSnapshot {
  return { schemaVersion: 1, presetId: preset.id, presetName: preset.name, revision, appliedAt: new Date().toISOString(), theme: clone(validateUiThemeDocument(preset.theme)) };
}
