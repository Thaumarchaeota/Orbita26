export const FONT_PRESET_IDS = [
  "system",
  "ubuntu",
  "inter",
  "serif",
  "harding",
  "helvetica",
  "gillSans",
  "cambria",
  "bahnschrift",
] as const;

export type FontBasePreset = (typeof FONT_PRESET_IDS)[number];
export type FontPresetId = FontBasePreset | "inherit";

export const FONT_STACKS: Record<FontBasePreset, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  ubuntu: 'Ubuntu, "PingFang SC", "Microsoft YaHei", sans-serif',
  inter: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Noto Serif SC", "Songti SC", serif',
  harding: '"Harding Text Web", "PingFang SC", "Microsoft YaHei", serif',
  helvetica: 'Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  gillSans: '"Gill Sans MT", "PingFang SC", "Microsoft YaHei", sans-serif',
  cambria: 'Cambria, "Noto Serif SC", "Songti SC", serif',
  bahnschrift: 'Bahnschrift, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

export const FONT_PRESET_LABELS: Record<FontBasePreset, string> = {
  system: "系统默认",
  ubuntu: "Ubuntu",
  inter: "Inter",
  serif: "衬线",
  harding: "Harding",
  helvetica: "Helvetica",
  gillSans: "Gill Sans",
  cambria: "Cambria",
  bahnschrift: "Bahnschrift",
};

export type FontPrefs = {
  base: FontBasePreset;
  launcher: FontPresetId;
  fileTree: FontPresetId;
  literature: FontPresetId;
  note: FontPresetId;
  ai: FontPresetId;
  clock: FontBasePreset;
};

export function defaultFontPrefs(): FontPrefs {
  return {
    base: "system",
    launcher: "inherit",
    fileTree: "inherit",
    literature: "harding",
    note: "inherit",
    ai: "inherit",
    clock: "ubuntu",
  };
}

function isFontBasePreset(value: string): value is FontBasePreset {
  return value in FONT_STACKS;
}

export function normalizeFontPreset(value: unknown, fallback: FontPresetId): FontPresetId {
  if (value === "inherit") return "inherit";
  if (typeof value === "string" && isFontBasePreset(value)) return value;
  return fallback;
}

export function normalizeFontBasePreset(value: unknown, fallback: FontBasePreset): FontBasePreset {
  if (typeof value === "string" && isFontBasePreset(value)) return value;
  return fallback;
}

export function normalizeFontPrefs(raw: Partial<FontPrefs> | undefined): FontPrefs {
  const base = defaultFontPrefs();
  if (!raw) return base;
  return {
    base: normalizeFontBasePreset(raw.base, base.base),
    launcher: normalizeFontPreset(raw.launcher, base.launcher),
    fileTree: normalizeFontPreset(raw.fileTree, base.fileTree),
    literature: normalizeFontPreset(raw.literature, base.literature),
    note: normalizeFontPreset(raw.note, base.note),
    ai: normalizeFontPreset(raw.ai, base.ai),
    clock: normalizeFontBasePreset(raw.clock, base.clock),
  };
}

export function resolveFontStack(preset: FontPresetId, baseStack: string): string {
  if (preset === "inherit") return baseStack;
  return FONT_STACKS[preset];
}

export function applyFontPrefs(fonts: FontPrefs, root: HTMLElement = document.documentElement) {
  const baseStack = FONT_STACKS[fonts.base];
  root.style.setProperty("--font-base", baseStack);
  root.style.setProperty("--font-launcher", resolveFontStack(fonts.launcher, baseStack));
  root.style.setProperty("--font-file-tree", resolveFontStack(fonts.fileTree, baseStack));
  root.style.setProperty("--font-literature", resolveFontStack(fonts.literature, baseStack));
  root.style.setProperty("--font-note", resolveFontStack(fonts.note, baseStack));
  root.style.setProperty("--font-ai", resolveFontStack(fonts.ai, baseStack));
  root.style.setProperty("--font-clock", FONT_STACKS[fonts.clock]);
}
