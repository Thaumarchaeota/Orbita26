import { compositeHex, normalizeHex, hexToOklch, oklchToHex } from "./color";
import type { CategoryRoles, CategorySlot, ColorScheme } from "./types";

/** A preset may contain the nine legacy groups plus additional groups, up to this count. */
export const MAX_CATEGORY_SLOTS = 24;

export const LEGACY_CATEGORY_SLOTS: readonly CategorySlot[] = [
  { id: "category-red", name: "红色", canonicalHex: "#E44755", main: "#E44755", unfinishedBackground: "#FFE3E7", unfinishedTitle: "#E44755", completed: "#C47E87", completedBackground: "#FFF0F2" },
  { id: "category-orange", name: "橙色", canonicalHex: "#E87524", main: "#E87524", unfinishedBackground: "#FFE9D5", completed: "#C59370", completedBackground: "#FFF3E9" },
  { id: "category-gold", name: "金色", canonicalHex: "#C59612", main: "#C59612", unfinishedBackground: "#FFF2BF", completed: "#AE9B61", completedBackground: "#FFF9E5" },
  { id: "category-green", name: "绿色", canonicalHex: "#28A65D", main: "#28A65D", unfinishedBackground: "#DDF7E6", completed: "#78AC8B", completedBackground: "#EFFAF3" },
  { id: "category-teal", name: "青绿", canonicalHex: "#12A594", main: "#12A594", unfinishedBackground: "#D5F7EF", completed: "#6DAFA3", completedBackground: "#EBFAF6" },
  { id: "category-sky", name: "天蓝", canonicalHex: "#159DD1", main: "#159DD1", unfinishedBackground: "#DBF3FF", completed: "#70AAC2", completedBackground: "#EEF9FF" },
  { id: "category-blue", name: "蓝色", canonicalHex: "#4879ED", main: "#4879ED", unfinishedBackground: "#E2ECFF", completed: "#879FD0", completedBackground: "#F0F5FF" },
  { id: "category-violet", name: "紫色", canonicalHex: "#A052E0", main: "#A052E0", unfinishedBackground: "#F0DFFF", completed: "#AE8BC9", completedBackground: "#F8EFFF" },
  { id: "category-rose", name: "玫瑰", canonicalHex: "#DF4E99", main: "#DF4E99", unfinishedBackground: "#FFDFEF", completed: "#C686A8", completedBackground: "#FFF0F7" },
];

/** Five-role rows stay in code order: unfinishedBackground, main, unfinishedTitle, completedBackground, completed. Named rows follow the preset table columns. */
type CategoryRoleHexRow = readonly [string, string, string, string, string] | {
  main: string;
  unfinishedBackground: string;
  unfinishedTitle: string;
  completed: string;
  completedBackground: string;
  glowPrimary: string;
  glowSecondary: string;
  glowPrimaryOpacity: number;
  glowSecondaryOpacity: number;
};

const CATEGORY_ROLE_PRESETS: readonly { id: string; name: string; rows: readonly CategoryRoleHexRow[] }[] = [
  { id: "system-default", name: "默认", rows: [
    { main: "#4196EE", unfinishedBackground: "#DAEBFF", unfinishedTitle: "#417CBC", completed: "#ACC8E8", completedBackground: "#E8F3FF", glowPrimary: "#5DA8FA", glowSecondary: "#A8A3F2", glowPrimaryOpacity: 0.62, glowSecondaryOpacity: 0.36 },
    { main: "#03A3C8", unfinishedBackground: "#D9F3FA", unfinishedTitle: "#0987A6", completed: "#9FCEDE", completedBackground: "#E3F5FC", glowPrimary: "#32B6D9", glowSecondary: "#77C5F0", glowPrimaryOpacity: 0.64, glowSecondaryOpacity: 0.37 },
    { main: "#04AA9A", unfinishedBackground: "#E8F7F3", unfinishedTitle: "#028D7F", completed: "#9FD1C8", completedBackground: "#E3F6F3", glowPrimary: "#34BDAF", glowSecondary: "#72D0CE", glowPrimaryOpacity: 0.63, glowSecondaryOpacity: 0.38 },
    { main: "#52AA58", unfinishedBackground: "#EBF7E7", unfinishedTitle: "#4D8A50", completed: "#B0CFB0", completedBackground: "#E9F5E9", glowPrimary: "#70BE77", glowSecondary: "#A5D68D", glowPrimaryOpacity: 0.68, glowSecondaryOpacity: 0.42 },
    { main: "#9FC333", unfinishedBackground: "#F4F8E3", unfinishedTitle: "#88A92F", completed: "#C8D89A", completedBackground: "#F4F8E6", glowPrimary: "#B3CE46", glowSecondary: "#DFDA6E", glowPrimaryOpacity: 0.76, glowSecondaryOpacity: 0.47 },
    { main: "#DBB72B", unfinishedBackground: "#FCF5E6", unfinishedTitle: "#C79F26", completed: "#E2C97E", completedBackground: "#FAF1DE", glowPrimary: "#E2BF37", glowSecondary: "#F3AE61", glowPrimaryOpacity: 0.83, glowSecondaryOpacity: 0.52 },
    { main: "#E8A33C", unfinishedBackground: "#FCF0DA", unfinishedTitle: "#D69035", completed: "#E5BF86", completedBackground: "#FAEFE0", glowPrimary: "#F0B34F", glowSecondary: "#F5A16A", glowPrimaryOpacity: 0.77, glowSecondaryOpacity: 0.46 },
    { main: "#EA8C3A", unfinishedBackground: "#FCEDE0", unfinishedTitle: "#D87D34", completed: "#E7B88A", completedBackground: "#FAEEE4", glowPrimary: "#ED894C", glowSecondary: "#F4B083", glowPrimaryOpacity: 0.69, glowSecondaryOpacity: 0.40 },
    { main: "#E26951", unfinishedBackground: "#FFF0EA", unfinishedTitle: "#B45D4B", completed: "#E6B9AF", completedBackground: "#FFEDE9", glowPrimary: "#EC806D", glowSecondary: "#F1A0AD", glowPrimaryOpacity: 0.68, glowSecondaryOpacity: 0.39 },
    { main: "#E46373", unfinishedBackground: "#FFE6E7", unfinishedTitle: "#B55862", completed: "#E6B7BA", completedBackground: "#FFECED", glowPrimary: "#E87F91", glowSecondary: "#D995C7", glowPrimaryOpacity: 0.66, glowSecondaryOpacity: 0.39 },
    { main: "#D16AA8", unfinishedBackground: "#FFE4F2", unfinishedTitle: "#A75D88", completed: "#E0B8CD", completedBackground: "#FDECF5", glowPrimary: "#D77FB2", glowSecondary: "#B995E2", glowPrimaryOpacity: 0.65, glowSecondaryOpacity: 0.39 },
    { main: "#A57ADF", unfinishedBackground: "#F1E9FF", unfinishedTitle: "#8668B1", completed: "#CBBDE3", completedBackground: "#F4EEFE", glowPrimary: "#AF91E8", glowSecondary: "#8CADF1", glowPrimaryOpacity: 0.66, glowSecondaryOpacity: 0.39 },
    { main: "#939393", unfinishedBackground: "#E9E9E9", unfinishedTitle: "#797979", completed: "#C5C5C5", completedBackground: "#F1F1F1", glowPrimary: "#A6ADB6", glowSecondary: "#CAD0D8", glowPrimaryOpacity: 0.76, glowSecondaryOpacity: 0.45 },
  ] },
  { id: "system-candy", name: "糖果", rows: [
    ["#DCEAFF", "#6D95CE", "#607BA3", "#EAF2FF", "#B3C7E4"], ["#C8F1FF", "#43A1BC", "#468396", "#DFF6FE", "#A4CDDA"], ["#BEF7E8", "#4CA592", "#4C8679", "#E0F8F1", "#A6D0C4"],
    ["#CDF5D3", "#66A472", "#5C8562", "#E6F7E8", "#B1CEB5"], ["#E9EEBF", "#939953", "#797E4E", "#F1F4E0", "#C5C9A6"], ["#F4EABB", "#A2944D", "#847A4B", "#F6F2DF", "#CDC6A3"],
    ["#FFE5C2", "#B68A4A", "#927449", "#FCEFDF", "#D7C1A4"], ["#FFE3D4", "#CA7E51", "#A06B4D", "#FFEEE4", "#DFBDAA"], ["#FFE1DD", "#CF776B", "#A4675E", "#FFEDEA", "#E2BAB4"],
    ["#FFE0E5", "#CE7486", "#A46470", "#FFECEF", "#E1B9BF"], ["#FFDEF4", "#C077AB", "#99668A", "#FEEBF8", "#DABAD0"], ["#EDE4FF", "#9D84CB", "#806FA0", "#F3EEFF", "#C9BFE0"],
    ["#E9E9E9", "#939393", "#797979", "#F1F1F1", "#C5C5C5"],
  ] },
  { id: "system-vivid", name: "鲜艳", rows: [
    ["#DCEBFF", "#3C92FF", "#2177DE", "#E9F2FF", "#A8C8F3"], ["#C6F2FF", "#04A4C3", "#0287A2", "#DEF6FE", "#91D1E3"], ["#C2F6EA", "#04AB94", "#028D7B", "#DFF8F2", "#93D4C6"],
    ["#D3F4D3", "#21B039", "#2B9037", "#E7F7E7", "#A9D2AA"], ["#E7EEC5", "#919D03", "#788202", "#F0F4E0", "#C3CB97"], ["#F3EAC1", "#AA9303", "#8C7902", "#F6F2DE", "#D1C692"],
    ["#FFE5C1", "#C38503", "#A26E02", "#FCEFDE", "#E0C092"], ["#FFE3D4", "#E46B03", "#BD5802", "#FFEEE4", "#EBB99D"], ["#FFE1DD", "#FE463C", "#CD4238", "#FFEDEA", "#EFB4AC"],
    ["#FFE1E3", "#FC416B", "#CC3E5B", "#FFECED", "#EFB3B8"], ["#FFDEF2", "#E251B9", "#B84996", "#FFEBF7", "#E5B4D3"], ["#F1E2FF", "#B667F2", "#9559C3", "#F6EDFF", "#D2B9E9"],
    ["#E9E9E9", "#939393", "#797979", "#F1F1F1", "#C5C5C5"],
  ] },
  { id: "system-deep", name: "深海", rows: [
    ["#DBEBFF", "#6496D5", "#567CAB", "#EAF2FE", "#B2C7E2"], ["#CFEFFD", "#29A1C8", "#3284A1", "#E5F4FB", "#A7CCDB"], ["#CDF2F0", "#04A8A6", "#028B89", "#E5F6F5", "#A4CFCD"],
    ["#D5F1E0", "#48A977", "#448A64", "#E8F5ED", "#AECEBA"], ["#E4EED2", "#879D55", "#71814C", "#EFF4E7", "#BFCAAB"], ["#EFEACE", "#A0944D", "#837B46", "#F4F2E4", "#CBC6A5"],
    ["#F7E7CD", "#B58B41", "#93743E", "#F8F0E4", "#D5C2A5"], ["#FEE3D2", "#C48152", "#9F6C49", "#FCEFE6", "#DDBEAA"], ["#FFE2DA", "#CC7A63", "#A56756", "#FDEEE9", "#E0BCB1"],
    ["#FFE1E1", "#CF757A", "#A76367", "#FDEDED", "#E1BABB"], ["#FEDFEE", "#C5769F", "#A06483", "#FBEDF3", "#DCBACA"], ["#E9E6FF", "#9586D2", "#7A70A9", "#F1F0FD", "#C5C0E1"],
    ["#E9E9E9", "#939393", "#797979", "#F1F1F1", "#C5C5C5"],
  ] },
];

export function createCategorySchemeFromRoles(id: string, name: string, rows: readonly CategoryRoleHexRow[]): ColorScheme {
  if (rows.length < LEGACY_CATEGORY_SLOTS.length || rows.length > MAX_CATEGORY_SLOTS) throw new Error("分类预设颜色组数量必须在 9 到 24 之间。");
  const taken = LEGACY_CATEGORY_SLOTS.map((slot) => slot.canonicalHex);
  const designSlots = rows.map((row, index) => {
    const role = Array.isArray(row)
      ? (() => {
        const [unfinishedBackground, main, unfinishedTitle, completedBackground, completed] = row.map((value) => normalizeHex(value)) as [string, string, string, string, string];
        return { main, unfinishedBackground, unfinishedTitle, completed, completedBackground, glowPrimary: undefined as string | undefined, glowSecondary: undefined as string | undefined, glowPrimaryOpacity: undefined as number | undefined, glowSecondaryOpacity: undefined as number | undefined };
      })()
      : {
        main: normalizeHex(row.main),
        unfinishedBackground: normalizeHex(row.unfinishedBackground),
        unfinishedTitle: normalizeHex(row.unfinishedTitle),
        completed: normalizeHex(row.completed),
        completedBackground: normalizeHex(row.completedBackground),
        glowPrimary: normalizeHex(row.glowPrimary),
        glowSecondary: normalizeHex(row.glowSecondary),
        glowPrimaryOpacity: row.glowPrimaryOpacity,
        glowSecondaryOpacity: row.glowSecondaryOpacity,
      };
    const { main, unfinishedBackground, unfinishedTitle, completed, completedBackground, glowPrimary, glowSecondary, glowPrimaryOpacity, glowSecondaryOpacity } = role;
    const legacy = LEGACY_CATEGORY_SLOTS[index];
    const canonicalHex = legacy ? legacy.canonicalHex : allocateCategoryCanonicalHex(taken);
    if (!legacy) taken.push(canonicalHex);
    return {
      id: legacy?.id ?? `category-extra-${index + 1}`,
      name: legacy?.name ?? `颜色 ${index + 1}`,
      canonicalHex,
      base: hexToOklch(main),
      unfinishedBackground: hexToOklch(unfinishedBackground),
      unfinishedTitle: hexToOklch(unfinishedTitle),
      completed: hexToOklch(completed),
      completedBackground: hexToOklch(completedBackground),
      ...(glowPrimary && glowSecondary ? { glowPrimary: hexToOklch(glowPrimary), glowSecondary: hexToOklch(glowSecondary), glowPrimaryOpacity, glowSecondaryOpacity } : {}),
      correction: { main, unfinishedBackground, unfinishedTitle, completed, completedBackground, ...(glowPrimary && glowSecondary ? { glowPrimary, glowSecondary } : {}) },
    };
  });
  // Completions stay identity so authored HEX is not mixed with the old starter formula.
  return deriveCategoryScheme({ id, name, slots: [], designSlots, completion: { lightness: 0, chroma: 0, fillAlpha: 1, borderAlpha: 1 } });
}

export const BUILTIN_CATEGORY_SCHEMES: readonly ColorScheme[] = CATEGORY_ROLE_PRESETS.map((preset) => createCategorySchemeFromRoles(preset.id, preset.name, preset.rows));

const storageKey = "orbita.insight.categoryAppearance.v1";
const defaultScheme = (): ColorScheme => structuredClone(BUILTIN_CATEGORY_SCHEMES[0]!);
let applied = defaultScheme();
let revision = 0;
let appearanceError: string | null = null;
let preview: { owner: string; scheme: ColorScheme } | null = null;
const listeners = new Set<(revision: number) => void>();
let loaded = false;

function hydrate(): void {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; engineVersion?: unknown; scheme?: unknown };
    if (parsed.schemaVersion !== 1 || parsed.engineVersion !== 1 || !isScheme(parsed.scheme)) { appearanceError = "已应用分类配色格式无法识别，当前使用兼容默认方案；原始数据已保留。"; return; }
    applied = parsed.scheme;
  } catch {
    appearanceError = "已应用分类配色无法读取，当前使用兼容默认方案；原始数据已保留。";
  }
}
function isScheme(value: unknown, _allowExtra = false): value is ColorScheme {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ColorScheme>;
  if (typeof v.id !== "string" || typeof v.name !== "string" || !Array.isArray(v.slots) || v.slots.length < LEGACY_CATEGORY_SLOTS.length || v.slots.length > MAX_CATEGORY_SLOTS) return false;
  const unique = new Set(v.slots.map((slot) => slot?.id));
  const canonicals = new Set(v.slots.map((slot) => slot?.canonicalHex?.toUpperCase()));
  const slotKeys = new Set(["id", "name", "canonicalHex", "main", "unfinishedBackground", "unfinishedTitle", "completed", "completedBackground", "glowPrimary", "glowSecondary", "glowPrimaryOpacity", "glowSecondaryOpacity", "mainForeground", "unfinishedForeground", "completedForeground"]);
  const optionalHex = (hex: unknown) => hex === undefined || (typeof hex === "string" && /^#[\da-f]{6}$/i.test(hex));
  const optionalOpacity = (value: unknown) => value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
  if (unique.size !== v.slots.length || canonicals.size !== v.slots.length || v.slots.some((slot) => !slot || Object.keys(slot).some((key) => !slotKeys.has(key)) || typeof slot.id !== "string" || typeof slot.name !== "string" || !/^#[\da-f]{6}$/i.test(slot.canonicalHex) || ![slot.main, slot.unfinishedBackground, slot.completed, slot.completedBackground].every((hex) => typeof hex === "string" && /^#[\da-f]{6}$/i.test(hex)) || !optionalHex(slot.unfinishedTitle) || !optionalHex(slot.glowPrimary) || !optionalHex(slot.glowSecondary) || !optionalOpacity(slot.glowPrimaryOpacity) || !optionalOpacity(slot.glowSecondaryOpacity))) return false;
  return LEGACY_CATEGORY_SLOTS.every((fixed) => {
    const slot = v.slots!.find((candidate) => candidate.id === fixed.id);
    return slot?.canonicalHex.toUpperCase() === fixed.canonicalHex;
  });
}

/** Stable identity for a new color group. Distinct from every canonical already in use. */
export function allocateCategoryCanonicalHex(taken: readonly string[]): string {
  const used = new Set(taken.map((hex) => hex.toUpperCase()));
  for (let i = 1; i <= 0xffffff; i++) {
    const hex = `#${i.toString(16).padStart(6, "0").toUpperCase()}`;
    if (!used.has(hex)) return hex;
  }
  throw new Error("没有可用的颜色组编号。");
}

/** Legacy groups stay in their original order; additional groups follow. */
export function orderCategorySlots(scheme: ColorScheme): CategorySlot[] {
  const slots = scheme.slots ?? [];
  const legacy = LEGACY_CATEGORY_SLOTS.map((fixed) => slots.find((slot) => slot.id === fixed.id) ?? fixed);
  const extras = slots.filter((slot) => !LEGACY_CATEGORY_SLOTS.some((fixed) => fixed.id === slot.id));
  return [...legacy, ...extras];
}

export function listEffectiveCategorySlots(): CategorySlot[] {
  hydrate();
  return orderCategorySlots(preview?.scheme ?? applied);
}

export function getAppliedCategoryPalette(): ColorScheme { hydrate(); return structuredClone(applied); }
export function getCategoryAppearanceError(): string | null { hydrate(); return appearanceError; }
export async function applyCategoryPalette(scheme: ColorScheme): Promise<void> {
  hydrate();
  stopCategoryPalettePreview();
  if (!isScheme(scheme)) throw new Error("分类方案必须包含九个兼容色槽，且颜色组不超过 24 个。");
  const next = structuredClone(scheme);
  const record = JSON.stringify({ schemaVersion: 1, engineVersion: 1, appliedAt: new Date().toISOString(), scheme: next });
  if (new Blob([record]).size > 1024 * 1024) throw new Error("分类配色方案超过 1 MiB。");
  if (typeof localStorage === "undefined") throw new Error("本机存储不可用。");
  localStorage.setItem(storageKey, record);
  applied = next;
  appearanceError = null;
  revision++;
  listeners.forEach((listener) => listener(revision));
}
export async function resetCategoryPalette(): Promise<void> {
  hydrate();
  stopCategoryPalettePreview();
  if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
  applied = defaultScheme();
  appearanceError = null;
  revision++;
  listeners.forEach((listener) => listener(revision));
}
export function subscribeCategoryAppearance(listener: (revision: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function startCategoryPalettePreview(owner: string, scheme: ColorScheme): void {
  if (!owner.trim() || !isScheme(scheme, true)) throw new Error("分类预览需要有效 owner 和完整方案。");
  preview = { owner, scheme: structuredClone(scheme) };
  revision++;
  listeners.forEach((listener) => listener(revision));
}
export function stopCategoryPalettePreview(owner?: string): void {
  if (!preview || (owner && preview.owner !== owner)) return;
  preview = null;
  revision++;
  listeners.forEach((listener) => listener(revision));
}

function categoryGlowDefaults(main: string): Pick<CategoryRoles, "glowPrimary" | "glowSecondary" | "glowPrimaryOpacity" | "glowSecondaryOpacity"> {
  return { glowPrimary: main, glowSecondary: main, glowPrimaryOpacity: 0.5, glowSecondaryOpacity: 0.5 };
}

export function resolveCategoryRoles(hex: string, palette?: ColorScheme): CategoryRoles {
  const canonical = (() => { try { return normalizeHex(hex); } catch { return "#87909A"; } })();
  const selected = palette ?? preview?.scheme ?? getAppliedCategoryPalette();
  const slot = selected.slots.find((entry) => entry.canonicalHex.toUpperCase() === canonical)
    ?? selected.slots.find((entry) => LEGACY_CATEGORY_SLOTS.some((fixed) => fixed.id === entry.id && fixed.canonicalHex.toUpperCase() === canonical));
  if (!slot) {
    const main = canonical;
    const unfinishedBackground = compositeHex(main, "#FFFFFF", 0.16);
    const completed = compositeHex("#65717D", main, 0.42);
    return { name: "自定义", main, unfinishedBackground, unfinishedTitle: main, completed, completedBackground: compositeHex(completed, "#FFFFFF", 0.08), ...categoryGlowDefaults(main), mainForeground: contrastForeground(main) };
  }
  const mainColor = slot.main;
  return { name: slot.name, main: mainColor, unfinishedBackground: slot.unfinishedBackground, unfinishedTitle: slot.unfinishedTitle ?? mainColor, completed: slot.completed, completedBackground: slot.completedBackground, glowPrimary: slot.glowPrimary || mainColor, glowSecondary: slot.glowSecondary || mainColor, glowPrimaryOpacity: slot.glowPrimaryOpacity ?? 0.5, glowSecondaryOpacity: slot.glowSecondaryOpacity ?? 0.5, mainForeground: contrastForeground(mainColor), unfinishedForeground: contrastForeground(slot.unfinishedBackground), completedForeground: contrastForeground(slot.completedBackground) };
}

const hueOffsets = [0, 37, 74, 111, 148, 185, 222, 259, 296];
export function createCategoryStarter(style: "bright" | "soft" | "muted", slotCount = 9): ColorScheme {
  const count = Math.max(3, Math.min(MAX_CATEGORY_SLOTS, Math.floor(slotCount)));
  const factors = style === "bright" ? { l: 0.62, c: 0.19 } : style === "soft" ? { l: 0.78, c: 0.12 } : { l: 0.68, c: 0.07 };
  const taken = LEGACY_CATEGORY_SLOTS.map((slot) => slot.canonicalHex);
  const designSlots = Array.from({ length: count }, (_, i) => {
    const base = { l: factors.l, c: factors.c, h: (hueOffsets[i % hueOffsets.length]! + Math.floor(i / hueOffsets.length) * 17) % 360 };
    const derive = (l: number, c: number) => ({ l: Math.min(1, Math.max(0, l)), c: Math.min(0.5, Math.max(0, c)), h: base.h });
    const canonicalHex = i < 9 ? LEGACY_CATEGORY_SLOTS[i]!.canonicalHex : allocateCategoryCanonicalHex(taken);
    if (i >= 9) taken.push(canonicalHex);
    return { id: i < 9 ? LEGACY_CATEGORY_SLOTS[i]!.id : `category-extra-${i + 1}`, name: i < 9 ? LEGACY_CATEGORY_SLOTS[i]!.name : `颜色 ${i + 1}`, canonicalHex, base, unfinishedBackground: derive(0.96, factors.c * 0.16), completed: derive(factors.l - 0.14, factors.c * 0.62), completedBackground: derive(0.98, factors.c * 0.06) };
  });
  return deriveCategoryScheme({ id: `scheme-${style}-${Date.now().toString(36)}`, name: style === "bright" ? "明亮起点" : style === "soft" ? "柔和起点" : "低彩度起点", slots: [], designSlots, completion: { lightness: -0.12, chroma: -0.025, fillAlpha: 0.16, borderAlpha: 0.28 } });
}

export function deriveCategoryScheme(scheme: ColorScheme): ColorScheme {
  const design = scheme.designSlots ?? [];
  if (!design.length) return scheme;
  const slots = design.map((source) => {
    const derived = (role: "base" | "unfinishedBackground" | "unfinishedTitle" | "completed" | "completedBackground" | "glowPrimary" | "glowSecondary") => {
      // Old design slots have no unfinishedTitle source; use base only as the
      // temporary derivation input, then the caller below applies final-main
      // compatibility when the source was genuinely absent.
      const original = source[role] ?? source.base;
      const completion = scheme.completion;
      const adjusted = role === "completed" || role === "completedBackground"
        ? { ...original, l: original.l + completion.lightness, c: original.c + completion.chroma }
        : original;
      const correction = source.correction?.[role === "base" ? "main" : role];
      return correction ?? oklchToHex(adjusted).hex;
    };
    const main = derived("base");
    const unfinishedBackground = derived("unfinishedBackground");
    // The fifth role was added after applied snapshots existed. Missing source
    // and correction data intentionally follows the final main color.
    const unfinishedTitle = source.correction?.unfinishedTitle
      ?? (source.unfinishedTitle ? derived("unfinishedTitle") : main);
    const completedBackground = source.correction?.completedBackground
      ?? compositeHex(derived("completedBackground"), "#FFFFFF", scheme.completion.fillAlpha);
    const completed = source.correction?.completed
      ?? compositeHex(derived("completed"), completedBackground, scheme.completion.borderAlpha);
    const legacy = LEGACY_CATEGORY_SLOTS.find((slot) => slot.id === source.id);
    const glowPrimary = source.correction?.glowPrimary ?? (source.glowPrimary ? oklchToHex(source.glowPrimary).hex : undefined);
    const glowSecondary = source.correction?.glowSecondary ?? (source.glowSecondary ? oklchToHex(source.glowSecondary).hex : undefined);
    return { id: source.id, name: source.name, canonicalHex: source.canonicalHex ?? legacy?.canonicalHex ?? main, main, unfinishedBackground, unfinishedTitle, completed, completedBackground, ...(glowPrimary ? { glowPrimary } : {}), ...(glowSecondary ? { glowSecondary } : {}), ...(source.glowPrimaryOpacity !== undefined ? { glowPrimaryOpacity: source.glowPrimaryOpacity } : {}), ...(source.glowSecondaryOpacity !== undefined ? { glowSecondaryOpacity: source.glowSecondaryOpacity } : {}) };
  });
  return { ...scheme, slots };
}
function contrastForeground(hex: string): string {
  const c = hex.toUpperCase();
  const luminance = c.slice(1).match(/../g)!.map((v) => Number.parseInt(v, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const l = luminance[0]! * 0.2126 + luminance[1]! * 0.7152 + luminance[2]! * 0.0722;
  return l > 0.38 ? "#1B2430" : "#FFFFFF";
}
