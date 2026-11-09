import { setDirtyStatus } from "../tab-host/dirty";
import { getSettings } from "../../../core/settings";
import { acquireThemePreview, type ThemePreviewLease } from "../insight-theme-preview";
import { applyInsightThemeSnapshot } from "../insight-theme";
import { listThemePresets, makeAppliedSnapshot, readThemeState, saveThemeState, type ThemeState } from "./theme-repository";
import { resolveUiRoles } from "../../../ui/color-system/theme-resolve";
import { validateUiThemeDocument } from "../../../ui/color-system/theme-validation";
import type { AppliedUiThemeSnapshot, ThemePreset, UiThemeDocument } from "../../../ui/color-system/theme-types";

export type ThemeEditSection = "grayscale" | "theme" | "semantic";
export type ThemeEditSessionSnapshot = Readonly<{
  sessionId: string;
  presetId: string;
  baseRevision: number;
  initialAppliedSnapshot: AppliedUiThemeSnapshot;
  draft: UiThemeDocument;
  focusedSection: ThemeEditSection;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}>;
type MutableSession = {
  sessionId: string; presetId: string; baseRevision: number; initialAppliedSnapshot: AppliedUiThemeSnapshot;
  expectedDataDir: string; draft: UiThemeDocument; focusedSection: ThemeEditSection; dirty: boolean; saving: boolean; error: string | null;
};
const EMPTY_DIRTY = { dirty: false, inFlight: false, failed: false } as const;
let active: MutableSession | null = null;
let previewLease: ThemePreviewLease | null = null;
let listeners = new Set<(snapshot: ThemeEditSessionSnapshot | null) => void>();
let dirtyOwnerKey = "settings";
let sessionGeneration = 0;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const snapshot = (): ThemeEditSessionSnapshot | null => active ? clone(active) : null;
function notify(): void {
  const current = snapshot();
  setDirtyStatus(dirtyOwnerKey, active ? { dirty: active.dirty, inFlight: active.saving, failed: Boolean(active.error) } : EMPTY_DIRTY);
  listeners.forEach((listener) => listener(current));
}
function releasePreview(): void { previewLease?.release(); previewLease = null; }
function previewDraft(): void {
  releasePreview();
  if (!active) return;
  previewLease = acquireThemePreview(active.sessionId, resolveUiRoles(active.draft, { grayscalePreview: active.focusedSection === "grayscale" }));
}
function requireSession(sessionId: string): MutableSession {
  if (!active || active.sessionId !== sessionId) throw new Error("主题编辑会话已结束。");
  return active;
}
function withRevision(theme: UiThemeDocument, presetId: string, name: string, revision: number): UiThemeDocument {
  return validateUiThemeDocument({ ...theme, metadata: { id: presetId, name, revision, updatedAt: new Date().toISOString() } });
}
function presetFor(state: ThemeState, id: string): ThemePreset | undefined { return state.insightThemePresets.find((preset) => preset.id === id); }

export function bindThemeEditDirtyOwner(ownerKey: string): () => void {
  dirtyOwnerKey = ownerKey;
  notify();
  return () => {
    if (dirtyOwnerKey !== ownerKey) return;
    setDirtyStatus(ownerKey, EMPTY_DIRTY);
    dirtyOwnerKey = "settings";
  };
}

export function beginThemeEdit(presetId: string, section: ThemeEditSection): ThemeEditSessionSnapshot {
  if (active) throw new Error("当前已有一个主题编辑会话。");
  const state = readThemeState();
  const preset = listThemePresets().find((item) => item.id === presetId);
  if (!preset) throw new Error("主题不存在。");
  active = {
    sessionId: crypto.randomUUID(), presetId, baseRevision: preset.revision,
    expectedDataDir: getSettings().dataDir,
    initialAppliedSnapshot: clone(state.appliedInsightTheme), draft: clone(preset.theme),
    focusedSection: section, dirty: false, saving: false, error: null,
  };
  previewDraft();
  notify();
  sessionGeneration++;
  return snapshot()!;
}

export function updateThemeDraft(sessionId: string, patch: Partial<UiThemeDocument>): ThemeEditSessionSnapshot {
  const session = requireSession(sessionId);
  if (session.saving) throw new Error("主题正在保存，请等待保存结果。");
  session.draft = validateUiThemeDocument({
    ...session.draft, ...patch,
    metadata: { ...session.draft.metadata, ...(patch.metadata ?? {}) },
    colors: { ...session.draft.colors, ...(patch.colors ?? {}) },
    stateRules: { ...session.draft.stateRules, ...(patch.stateRules ?? {}) },
  });
  session.dirty = true;
  session.error = null;
  previewDraft();
  notify();
  return snapshot()!;
}

export function switchThemeSection(sessionId: string, section: ThemeEditSection): ThemeEditSessionSnapshot {
  const session = requireSession(sessionId);
  if (session.saving) throw new Error("主题正在保存，请等待保存结果。");
  session.focusedSection = section;
  session.error = null;
  previewDraft();
  notify();
  return snapshot()!;
}

export function getThemeEditSession(): ThemeEditSessionSnapshot | null { return snapshot(); }
export function subscribeThemeEdit(listener: (value: ThemeEditSessionSnapshot | null) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}
export function hasDirtyThemeEdit(): boolean { return Boolean(active && (active.dirty || active.saving || active.error)); }
export function canDisposeThemeEdit(): boolean { return !active || (!active.dirty && !active.saving && !active.error); }

function finishSession(): void {
  releasePreview();
  active = null;
  sessionGeneration++;
  notify();
}

async function commitDraft(session: MutableSession, apply: boolean, name?: string): Promise<ThemePreset> {
  const generation = sessionGeneration;
  const sessionId = session.sessionId;
  const draft = clone(session.draft);
  const state = readThemeState();
  const currentPreset = presetFor(state, session.presetId);
  if (currentPreset && currentPreset.revision !== session.baseRevision) throw new Error("该主题已被其他修改更新，请重新打开后再保存。");
  const isUserPreset = Boolean(currentPreset);
  const id = isUserPreset ? session.presetId : `theme-${crypto.randomUUID()}`;
  const presetName = (name ?? (isUserPreset ? currentPreset!.name : `${draft.metadata.name} 副本`)).trim();
  if (!presetName || presetName.length > 80) throw new Error("主题名称长度必须为 1–80 个字符。");
  const revision = isUserPreset ? currentPreset!.revision + 1 : 1;
  const theme = withRevision(draft, id, presetName, revision);
  const saved: ThemePreset = { id, name: presetName, revision, builtin: false, theme };
  const presets = isUserPreset
    ? state.insightThemePresets.map((item) => item.id === id ? saved : item)
    : [...state.insightThemePresets, saved];
  const applied = apply ? makeAppliedSnapshot(saved, state.appliedInsightTheme.revision + 1) : state.appliedInsightTheme;
  await saveThemeState({ ...state, insightThemePresets: presets, appliedInsightTheme: applied, insightThemeLibraryRevision: state.insightThemeLibraryRevision + 1 }, state.insightThemeLibraryRevision, session.expectedDataDir);
  if (active?.sessionId === sessionId && sessionGeneration === generation) applyInsightThemeSnapshot(applied);
  return saved;
}

export async function savePreset(sessionId: string, name?: string): Promise<ThemePreset> {
  const session = requireSession(sessionId);
  if (session.saving) throw new Error("主题正在保存，请等待保存结果。");
  session.saving = true; session.error = null; notify();
  try {
    const saved = await commitDraft(session, false, name);
    if (active?.sessionId === sessionId) finishSession();
    return saved;
  } catch (error) {
    if (active?.sessionId === sessionId) {
      session.saving = false; session.error = error instanceof Error ? error.message : String(error);
      try { applyInsightThemeSnapshot(readThemeState().appliedInsightTheme); previewDraft(); } catch { releasePreview(); }
      notify();
    }
    throw error;
  }
}

export async function saveAndApply(sessionId: string, name?: string): Promise<AppliedUiThemeSnapshot> {
  const session = requireSession(sessionId);
  if (session.saving) throw new Error("主题正在保存，请等待保存结果。");
  session.saving = true; session.error = null; notify();
  try {
    await commitDraft(session, true, name);
    const applied = readThemeState().appliedInsightTheme;
    if (active?.sessionId === sessionId) finishSession();
    return applied;
  } catch (error) {
    if (active?.sessionId === sessionId) {
      session.saving = false; session.error = error instanceof Error ? error.message : String(error);
      try { applyInsightThemeSnapshot(readThemeState().appliedInsightTheme); previewDraft(); } catch { releasePreview(); }
      notify();
    }
    throw error;
  }
}

export function cancelThemeEdit(sessionId: string): void {
  const session = requireSession(sessionId);
  if (session.saving) throw new Error("主题正在保存，请等待保存结果。");
  const latestApplied = readThemeState().appliedInsightTheme;
  finishSession();
  applyInsightThemeSnapshot(latestApplied);
}

export async function disposeThemeSession(sessionId: string, decision: "save" | "discard" | "keep-editing"): Promise<boolean> {
  const session = requireSession(sessionId);
  if (session.saving && decision !== "keep-editing") return false;
  if (decision === "keep-editing") return false;
  if (decision === "discard") { cancelThemeEdit(sessionId); return true; }
  try { await savePreset(sessionId); return true; }
  catch { return false; }
}

export function releaseThemeEditForHostChange(): void {
  if (!active) return;
  releasePreview();
  sessionGeneration++;
  active.error = "当前页面或数据目录已更改；草稿仍保留，但预览已结束。";
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("orbita:settings-changed", () => {
    if (!active || active.saving) return;
    releasePreview();
    active.error = "设置已更改；主题草稿仍保留，临时预览已结束。";
    notify();
  });
  window.addEventListener("orbita:data-dir-changed", releaseThemeEditForHostChange);
}
