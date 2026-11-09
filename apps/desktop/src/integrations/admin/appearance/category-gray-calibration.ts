import {
  getAppliedCategoryPalette,
  startCategoryPalettePreview,
  stopCategoryPalettePreview,
} from "../../../ui/color-system/category";
import { hexToOklch, oklchToHex } from "../../../ui/color-system/color";
import type { ColorScheme } from "../../../ui/color-system/types";
import type { Oklch } from "../../../ui/color-system/types";
import { mountColorEditor, type ColorEditorHandle } from "../../../ui/color-editor";
import { createInsightDialog } from "../../../ui/insight-dialog";
import { mountFloatingPanel, type FloatingPanelHandle } from "../../../ui/floating-panel";

export const CATEGORY_GRAY_LEVELS_STORAGE_KEY = "orbita.insight.categoryGrayLevels.v1";
export const CATEGORY_GRAY_CALIBRATION_OWNER = "category-gray-calibration";

const ROLES = ["main", "unfinishedBackground", "unfinishedTitle", "completed", "completedBackground"] as const;
export type CategoryGrayRoleId = (typeof ROLES)[number];
export type CategoryGrayLevels = Record<CategoryGrayRoleId, number>;

const ROLE_LABELS: Record<CategoryGrayRoleId, string> = {
  main: "未完成时间／左条",
  unfinishedBackground: "未完成背景",
  unfinishedTitle: "未完成标题",
  completed: "已完成标题／时间／左条",
  completedBackground: "已完成背景",
};

const DEFAULT_NEUTRAL: Oklch = { l: 0.6, c: 0, h: 0 };

function isValidL(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function readStoredCategoryGrayLevels(): CategoryGrayLevels | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CATEGORY_GRAY_LEVELS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; lightness?: unknown };
    if (parsed.schemaVersion !== 1 || !parsed.lightness || typeof parsed.lightness !== "object") return null;
    const lightness = parsed.lightness as Record<string, unknown>;
    const result = {} as CategoryGrayLevels;
    for (const role of ROLES) {
      const value = lightness[role];
      if (!isValidL(value)) return null;
      result[role] = value;
    }
    return result;
  } catch {
    return null;
  }
}

export function writeStoredCategoryGrayLevels(levels: CategoryGrayLevels): void {
  if (typeof localStorage === "undefined") throw new Error("本机存储不可用。");
  localStorage.setItem(CATEGORY_GRAY_LEVELS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, lightness: levels }));
}

function roleOklchFromHex(hex: string | undefined): Oklch {
  if (!hex) return DEFAULT_NEUTRAL;
  try {
    return hexToOklch(hex);
  } catch {
    return DEFAULT_NEUTRAL;
  }
}

export function buildCategoryGraySeedLevels(): { baseline: CategoryGrayLevels; chromaHue: Record<CategoryGrayRoleId, Pick<Oklch, "c" | "h">> } {
  const applied = getAppliedCategoryPalette();
  const first = applied.slots[0];
  const hexFor = (role: CategoryGrayRoleId): string | undefined => {
    if (!first) return undefined;
    if (role === "main") return first.main;
    if (role === "unfinishedBackground") return first.unfinishedBackground;
    if (role === "unfinishedTitle") return first.unfinishedTitle ?? first.main;
    if (role === "completed") return first.completed;
    return first.completedBackground;
  };
  const chromaHue = {} as Record<CategoryGrayRoleId, Pick<Oklch, "c" | "h">>;
  const baseline = {} as CategoryGrayLevels;
  for (const role of ROLES) {
    const ok = roleOklchFromHex(hexFor(role));
    chromaHue[role] = { c: ok.c, h: ok.h };
    baseline[role] = ok.l;
  }
  const stored = readStoredCategoryGrayLevels();
  if (stored) {
    for (const role of ROLES) baseline[role] = stored[role];
  }
  return { baseline, chromaHue };
}

function cloneLevels(levels: CategoryGrayLevels): CategoryGrayLevels {
  return { ...levels };
}

function levelsEqual(a: CategoryGrayLevels, b: CategoryGrayLevels): boolean {
  return ROLES.every((role) => Math.abs(a[role] - b[role]) < 1e-9);
}

function levelsToRoleHex(levels: CategoryGrayLevels, chromaHue: Record<CategoryGrayRoleId, Pick<Oklch, "c" | "h">>): Record<CategoryGrayRoleId, string> {
  const hex = {} as Record<CategoryGrayRoleId, string>;
  for (const role of ROLES) {
    hex[role] = oklchToHex({ l: levels[role], c: 0, h: chromaHue[role].h }).hex;
  }
  return hex;
}

function buildGrayPreviewScheme(levels: CategoryGrayLevels, chromaHue: Record<CategoryGrayRoleId, Pick<Oklch, "c" | "h">>): ColorScheme {
  const applied = structuredClone(getAppliedCategoryPalette());
  const roleHex = levelsToRoleHex(levels, chromaHue);
  applied.slots = applied.slots.map((slot) => ({
    ...slot,
    main: roleHex.main,
    unfinishedBackground: roleHex.unfinishedBackground,
    unfinishedTitle: roleHex.unfinishedTitle,
    completed: roleHex.completed,
    completedBackground: roleHex.completedBackground,
  }));
  return applied;
}

export type CategoryGrayCalibrationHandle = {
  isDirty(): boolean;
  requestClose(): Promise<boolean>;
  dispose(): void;
};

export function startCategoryGrayCalibration(options: {
  assignFloating: (panel: FloatingPanelHandle | null) => void;
  onError: (message: string) => void;
  onClearError: () => void;
  onEnded: () => void;
}): CategoryGrayCalibrationHandle {
  const { baseline, chromaHue } = buildCategoryGraySeedLevels();
  let savedBaseline = cloneLevels(baseline);
  let workingLevels = cloneLevels(baseline);
  const editorDisposers: ColorEditorHandle[] = [];
  let floating: FloatingPanelHandle | null = null;
  let disposed = false;

  const pushCategoryPreview = () => {
    startCategoryPalettePreview(CATEGORY_GRAY_CALIBRATION_OWNER, buildGrayPreviewScheme(workingLevels, chromaHue));
  };

  const persistWorking = () => {
    writeStoredCategoryGrayLevels(workingLevels);
    savedBaseline = cloneLevels(workingLevels);
    options.onClearError();
  };

  const tearDown = () => {
    if (disposed) return;
    disposed = true;
    stopCategoryPalettePreview(CATEGORY_GRAY_CALIBRATION_OWNER);
    editorDisposers.splice(0).forEach((editor) => editor.dispose());
    floating?.dispose();
    floating = null;
    options.assignFloating(null);
    options.onEnded();
  };

  const confirmDisposition = (): Promise<boolean> => {
    if (!isDirty()) return Promise.resolve(true);
    let finishOnDispose: ((value: boolean) => void) | null = null;
    const dialog = createInsightDialog({
      title: "色彩编辑尚未保存",
      bodyHtml: "<p>保存草稿、放弃本次编辑，或继续编辑。</p>",
      submitLabel: "保存",
      cancelLabel: "继续编辑",
      extraActionsHtml: '<button type="button" class="insight-dialog-btn insight-dialog-btn-danger" data-action="discard">放弃修改</button>',
      mountTarget: floating?.element,
      onDispose: () => finishOnDispose?.(false),
    });
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        void dialog.close().then(() => resolve(value));
      };
      finishOnDispose = finish;
      dialog.bindChrome(() => finish(false));
      dialog.panel.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
          persistWorking();
          finish(true);
        } catch (error) {
          dialog.setError(`保存失败：${String(error)}`);
          options.onError(`保存失败：${String(error)}`);
        }
      });
      dialog.panel.querySelector<HTMLButtonElement>('[data-action="discard"]')?.addEventListener("click", () => finish(true));
      void dialog.open();
    });
  };

  const isDirty = () => !levelsEqual(workingLevels, savedBaseline);

  const content = document.createElement("div");
  content.className = "color-management-gray-calibration";
  content.innerHTML = `<div class="color-management-gray-calibration-editors" data-gray-editors></div><div class="color-management-gray-calibration-actions"><button type="button" data-gray-save>保存</button><button type="button" data-gray-close>关闭</button></div>`;
  const editorsHost = content.querySelector<HTMLElement>("[data-gray-editors]")!;

  for (const role of ROLES) {
    const editorHost = document.createElement("div");
    editorsHost.append(editorHost);
    const editor = mountColorEditor(editorHost, {
      label: ROLE_LABELS[role],
      value: { l: workingLevels[role], c: chromaHue[role].c, h: chromaHue[role].h },
      lightnessOnly: true,
      onChange: (value) => {
        workingLevels = { ...workingLevels, [role]: value.l };
        try {
          pushCategoryPreview();
          options.onClearError();
        } catch (error) {
          options.onError(`分类灰度预览失败：${String(error)}`);
        }
      },
    });
    editorDisposers.push(editor);
  }

  try {
    pushCategoryPreview();
    options.onClearError();
  } catch (error) {
    options.onError(`分类灰度预览失败：${String(error)}`);
  }

  const requestClose = async (): Promise<boolean> => {
    if (disposed) return true;
    if (!(await confirmDisposition())) return false;
    tearDown();
    return true;
  };

  floating = mountFloatingPanel({
    title: "分类灰度",
    content,
    maxHeight: 480,
    constrainFullHeight: true,
    onCloseRequest: () => { void requestClose(); },
  });
  floating.element.classList.add("color-management-floating-editor", "color-management-gray-floating-editor");
  options.assignFloating(floating);

  content.querySelector<HTMLButtonElement>("[data-gray-save]")!.addEventListener("click", () => {
    try {
      persistWorking();
    } catch (error) {
      options.onError(`保存失败：${String(error)}`);
    }
  });
  content.querySelector<HTMLButtonElement>("[data-gray-close]")!.addEventListener("click", () => { void requestClose(); });

  return {
    isDirty,
    requestClose,
    dispose: () => { tearDown(); },
  };
}
