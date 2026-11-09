import { applyCategoryPalette, getAppliedCategoryPalette } from "../../../ui/color-system/category";
import { BUILTIN_CATEGORY_SCHEMES, MAX_CATEGORY_SLOTS, deriveCategoryScheme, LEGACY_CATEGORY_SLOTS } from "../../../ui/color-system/category";
import { hexToOklch } from "../../../ui/color-system/color";
import type { ColorScheme } from "../../../ui/color-system/types";

const KEY = "orbita.insight.categorySchemes.v1";
const LEGACY_KEY = "orbita.insight.colorLab.v1";
export type CategorySchemeRecord = { id: string; name: string; revision: number; scheme: ColorScheme };
export type CategorySchemeLibrary = { schemaVersion: 1; engineVersion: 1; libraryRevision: number; schemes: CategorySchemeRecord[] };
export type CategorySchemeOrigin = "builtin" | "user";

const clone = <T>(value: T): T => structuredClone(value);
const builtins: readonly CategorySchemeRecord[] = BUILTIN_CATEGORY_SCHEMES.map((scheme) => ({
  id: scheme.id,
  name: scheme.name,
  revision: 1,
  scheme: clone(scheme),
}));

function validScheme(value: unknown): value is ColorScheme {
  if (!value || typeof value !== "object") return false;
  const scheme = value as Partial<ColorScheme>;
  const allowedScheme = new Set(["id", "name", "slots", "designSlots", "completion", "corrections"]);
  if (Object.keys(scheme).some((key) => !allowedScheme.has(key))) return false;
  if (typeof scheme.id !== "string" || !scheme.id || typeof scheme.name !== "string" || !scheme.name.trim() || scheme.name.length > 80 || !Array.isArray(scheme.slots) || scheme.slots.length > MAX_CATEGORY_SLOTS || (scheme.designSlots !== undefined && (!Array.isArray(scheme.designSlots) || scheme.designSlots.length < 1 || scheme.designSlots.length > MAX_CATEGORY_SLOTS))) return false;
  if (!scheme.completion || ![scheme.completion.lightness, scheme.completion.chroma, scheme.completion.fillAlpha, scheme.completion.borderAlpha].every(Number.isFinite)) return false;
  if (Object.keys(scheme.completion).some((key) => !["lightness", "chroma", "fillAlpha", "borderAlpha"].includes(key))) return false;
  if (scheme.completion.lightness < -0.5 || scheme.completion.lightness > 0.5 || scheme.completion.chroma < -0.3 || scheme.completion.chroma > 0.3 || scheme.completion.fillAlpha < 0 || scheme.completion.fillAlpha > 1 || scheme.completion.borderAlpha < 0 || scheme.completion.borderAlpha > 1) return false;
  const validOklch = (color: unknown): boolean => Boolean(color && typeof color === "object" && !Object.keys(color).some((key) => !["l", "c", "h"].includes(key)) && Number.isFinite((color as { l: number }).l) && (color as { l: number }).l >= 0 && (color as { l: number }).l <= 1 && Number.isFinite((color as { c: number }).c) && (color as { c: number }).c >= 0 && (color as { c: number }).c <= 0.5 && Number.isFinite((color as { h: number }).h) && (color as { h: number }).h >= 0 && (color as { h: number }).h <= 360);
  const optionalHex = (hex: unknown) => hex === undefined || (typeof hex === "string" && /^#[\da-f]{6}$/i.test(hex));
  const optionalOpacity = (value: unknown) => value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
  if (scheme.slots.some((slot) => !slot || typeof slot.id !== "string" || typeof slot.name !== "string" || !/^#[\da-f]{6}$/i.test(slot.canonicalHex) || ![slot.main, slot.unfinishedBackground, slot.completed, slot.completedBackground].every((hex) => typeof hex === "string" && /^#[\da-f]{6}$/i.test(hex)) || !optionalHex(slot.unfinishedTitle) || !optionalHex(slot.glowPrimary) || !optionalHex(slot.glowSecondary) || !optionalOpacity(slot.glowPrimaryOpacity) || !optionalOpacity(slot.glowSecondaryOpacity))) return false;
  const design = scheme.designSlots ?? [];
  const ids = new Set(design.map((slot) => slot?.id));
  if (ids.size !== design.length) return false;
  const correctionKeys = new Set(["main", "unfinishedBackground", "unfinishedTitle", "completed", "completedBackground", "glowPrimary", "glowSecondary"]);
  return design.every((slot) => {
    if (!slot) return false;
    if (Object.keys(slot).some((key) => !["id", "name", "canonicalHex", "base", "unfinishedBackground", "unfinishedTitle", "completed", "completedBackground", "glowPrimary", "glowSecondary", "glowPrimaryOpacity", "glowSecondaryOpacity", "correction"].includes(key))) return false;
    if (typeof slot.name !== "string" || !slot.name.trim() || slot.name.length > 80) return false;
    if (slot.correction && Object.entries(slot.correction).some(([key, hex]) => !correctionKeys.has(key) || typeof hex !== "string" || !/^#[\da-f]{6}$/i.test(hex))) return false;
    if (typeof slot.id !== "string" || !slot.id || (slot.canonicalHex !== undefined && (typeof slot.canonicalHex !== "string" || !/^#[\da-f]{6}$/i.test(slot.canonicalHex)))) return false;
    return [slot.base, slot.unfinishedBackground, slot.completed, slot.completedBackground].every(validOklch) && (slot.unfinishedTitle === undefined || validOklch(slot.unfinishedTitle)) && (slot.glowPrimary === undefined || validOklch(slot.glowPrimary)) && (slot.glowSecondary === undefined || validOklch(slot.glowSecondary)) && optionalOpacity(slot.glowPrimaryOpacity) && optionalOpacity(slot.glowSecondaryOpacity);
  }) && (!scheme.corrections || Object.entries(scheme.corrections).every(([id, correction]) => ids.has(id) && Object.entries(correction).every(([key, hex]) => correctionKeys.has(key) && typeof hex === "string" && /^#[\da-f]{6}$/i.test(hex))));
}

function validateLibrary(value: unknown): CategorySchemeLibrary {
  if (!value || typeof value !== "object") throw new Error("分类方案库格式无法识别，原始数据已保留。");
  const library = value as Partial<CategorySchemeLibrary>;
  if (Object.keys(library).some((key) => !["schemaVersion", "engineVersion", "libraryRevision", "schemes"].includes(key))) throw new Error("分类方案库包含未知字段，原始数据已保留。");
  if (library.schemaVersion !== 1 || library.engineVersion !== 1 || !Number.isSafeInteger(library.libraryRevision) || library.libraryRevision! < 0 || !Array.isArray(library.schemes)) throw new Error("分类方案库版本无法识别，原始数据已保留。");
  const ids = new Set<string>();
  for (const item of library.schemes) {
    if (!item || Object.keys(item).some((key) => !["id", "name", "revision", "scheme"].includes(key)) || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || !Number.isSafeInteger(item.revision) || item.revision < 1 || !validScheme(item.scheme) || item.scheme.id !== item.id) throw new Error("分类方案库包含无效方案，原始数据已保留。");
    ids.add(item.id);
  }
  return { ...(library as CategorySchemeLibrary), schemes: library.schemes.map((item) => ({ ...item, scheme: deriveCategoryScheme(clone(item.scheme)) })) };
}

function readLibrary(): CategorySchemeLibrary {
  if (typeof localStorage === "undefined") throw new Error("本机存储不可用。");
  const raw = localStorage.getItem(KEY);
  if (!raw) return { schemaVersion: 1, engineVersion: 1, libraryRevision: 0, schemes: [] };
  if (new Blob([raw]).size > 1024 * 1024) throw new Error("分类方案库超过 1 MiB，原始数据已保留。");
  return validateLibrary(JSON.parse(raw));
}

function writeLibrary(library: CategorySchemeLibrary): void {
  const encoded = JSON.stringify(library);
  if (new Blob([encoded]).size > 1024 * 1024) throw new Error("分类方案库超过 1 MiB。");
  localStorage.setItem(KEY, encoded);
}

export function listCategorySchemes(): { builtins: readonly CategorySchemeRecord[]; users: CategorySchemeRecord[]; applied: ColorScheme } {
  return { builtins: clone(builtins), users: clone(readLibrary().schemes), applied: getAppliedCategoryPalette() };
}

export function createCategoryScheme(name: string, source: ColorScheme = getAppliedCategoryPalette()): CategorySchemeRecord {
  const clean = name.trim();
  const legacySourceValid = !source.designSlots && Array.isArray(source.slots) && LEGACY_CATEGORY_SLOTS.every((legacy) => {
    const slot = source.slots.find((item) => item.id === legacy.id);
    return Boolean(slot && [slot.main, slot.unfinishedBackground, slot.completed, slot.completedBackground].every((color) => typeof color === "string" && /^#[\da-f]{6}$/i.test(color)));
  }) && Boolean(source.completion && [source.completion.lightness, source.completion.chroma, source.completion.fillAlpha, source.completion.borderAlpha].every(Number.isFinite));
  if (!clean || clean.length > 80 || (!validScheme(source) && !legacySourceValid)) throw new Error("方案名称或方案数据无效。");
  const editable = source.designSlots?.length ? clone(source) : {
    ...clone(source),
    // Legacy slots are already final colors; copying them must not apply the
    // completion rule twice (SPEC-0006 legacy appearance compatibility).
    completion: { lightness: 0, chroma: 0, fillAlpha: 1, borderAlpha: 1 },
    designSlots: (LEGACY_CATEGORY_SLOTS.every((legacy) => source.slots.some((slot) => slot.id === legacy.id)) ? source.slots : (() => { throw new Error("旧分类方案缺少兼容颜色槽，无法复制。"); })()).map((slot) => {
      const legacy = LEGACY_CATEGORY_SLOTS.find((item) => item.id === slot.id);
      if (!legacy && !/^#[\da-f]{6}$/i.test(slot.canonicalHex)) throw new Error("颜色组缺少兼容色键，无法复制。");
      const correction = {
        ...(slot.glowPrimary ? { glowPrimary: slot.glowPrimary } : {}),
        ...(slot.glowSecondary ? { glowSecondary: slot.glowSecondary } : {}),
      };
      return { id: slot.id, name: slot.name || legacy?.name || "颜色", canonicalHex: legacy?.canonicalHex ?? slot.canonicalHex, base: hexToOklch(slot.main), unfinishedBackground: hexToOklch(slot.unfinishedBackground), unfinishedTitle: hexToOklch(slot.unfinishedTitle ?? slot.main), completed: hexToOklch(slot.completed), completedBackground: hexToOklch(slot.completedBackground), ...(Object.keys(correction).length ? { correction } : {}), ...(slot.glowPrimaryOpacity !== undefined ? { glowPrimaryOpacity: slot.glowPrimaryOpacity } : {}), ...(slot.glowSecondaryOpacity !== undefined ? { glowSecondaryOpacity: slot.glowSecondaryOpacity } : {}) };
    }),
  };
  const id = crypto.randomUUID();
  return { id, name: clean, revision: 1, scheme: { ...editable, id, name: clean } };
}

export function saveCategoryScheme(record: CategorySchemeRecord): CategorySchemeRecord {
  if (!validScheme(record.scheme) || record.scheme.id !== record.id || !record.name.trim() || record.name.length > 80) throw new Error("分类方案无效。");
  const current = readLibrary();
  const existing = current.schemes.find((item) => item.id === record.id);
  if (record.id.startsWith("system-") || (existing && existing.revision !== record.revision)) throw new Error("分类方案已被其他修改更新，请重新读取后再保存。");
  const saved = { ...clone(record), revision: existing ? existing.revision + 1 : Math.max(1, record.revision) };
  const schemes = existing ? current.schemes.map((item) => item.id === saved.id ? saved : item) : [...current.schemes, saved];
  writeLibrary({ ...current, libraryRevision: current.libraryRevision + 1, schemes });
  return clone(saved);
}

export function deleteCategoryScheme(id: string): void {
  if (id.startsWith("system-")) throw new Error("内置方案不能删除。");
  const current = readLibrary();
  if (!current.schemes.some((item) => item.id === id)) return;
  writeLibrary({ ...current, libraryRevision: current.libraryRevision + 1, schemes: current.schemes.filter((item) => item.id !== id) });
}

export async function applyCategoryScheme(record: CategorySchemeRecord): Promise<void> {
  if (!validScheme(record.scheme)) throw new Error("分类方案无效。");
  // Imported/applied snapshots may still be the four-role slots-only shape.
  // Normalize only for this explicit application; reading never rewrites storage.
  const source = record.scheme.designSlots?.length ? clone(record.scheme) : createCategoryScheme(record.name, record.scheme).scheme;
  const derived = deriveCategoryScheme(source);
  const legacyIds = new Set(LEGACY_CATEGORY_SLOTS.map((legacy) => legacy.id));
  const slots = LEGACY_CATEGORY_SLOTS.map((legacy) => {
    const slot = derived.slots.find((item) => item.id === legacy.id);
    const design = derived.designSlots?.find((item) => item.id === legacy.id);
    if (!slot || !design || slot.canonicalHex.toUpperCase() !== legacy.canonicalHex) throw new Error("应用方案必须包含九个兼容色槽。");
    return slot;
  });
  const extras = derived.slots.filter((slot) => !legacyIds.has(slot.id));
  if (slots.length + extras.length > MAX_CATEGORY_SLOTS) throw new Error("颜色组不能超过 24 个。");
  const canonicalHexes = new Set<string>();
  for (const slot of [...slots, ...extras]) {
    const hex = slot.canonicalHex.toUpperCase();
    if (canonicalHexes.has(hex)) throw new Error("颜色组的兼容色键重复。");
    canonicalHexes.add(hex);
  }
  const ordered = [...slots, ...extras];
  const designSlots = ordered.map((slot) => derived.designSlots!.find((item) => item.id === slot.id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const canonical = { ...derived, id: record.id, name: record.name, slots: ordered, designSlots, corrections: undefined };
  await applyCategoryPalette(canonical);
}

export async function saveAndApplyCategoryScheme(record: CategorySchemeRecord): Promise<CategorySchemeRecord> {
  const saved = saveCategoryScheme(record);
  try {
    await applyCategoryScheme(saved);
  } catch (error) {
    throw Object.assign(new Error(`方案已保存、应用失败：${String(error)}`), { savedScheme: saved });
  }
  return saved;
}

export function importLegacyCategorySchemes(): number {
  if (typeof localStorage === "undefined") throw new Error("本机存储不可用。");
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) throw new Error("没有找到旧 Color Lab 数据。");
  if (new Blob([raw]).size > 1024 * 1024) throw new Error("旧 Color Lab 数据超过 1 MiB，未导入。");
  const parsed = JSON.parse(raw) as { categorySchemes?: unknown };
  if (!Array.isArray(parsed.categorySchemes)) throw new Error("旧数据中没有可导入的分类方案；原始数据已保留。");
  const current = readLibrary();
  const ids = new Set(current.schemes.map((item) => item.id));
  const imported = parsed.categorySchemes.flatMap((value): CategorySchemeRecord[] => {
    if (!validScheme(value)) return [];
    const scheme = clone(value);
    const id = `import-${crypto.randomUUID()}`;
    scheme.id = id;
    scheme.name = `${scheme.name}（导入）`;
    if (ids.has(id)) return [];
    return [{ id, name: scheme.name, revision: 1, scheme }];
  });
  if (!imported.length) throw new Error("没有可导入的完整分类方案；旧数据已保留。");
  writeLibrary({ ...current, libraryRevision: current.libraryRevision + 1, schemes: [...current.schemes, ...imported] });
  return imported.length;
}

export function defaultCategorySchemeDraft(name = "我的分类方案"): CategorySchemeRecord {
  const record = createCategoryScheme(name, {
    id: "legacy-default", name, slots: LEGACY_CATEGORY_SLOTS.map((slot) => ({ ...slot })),
    designSlots: LEGACY_CATEGORY_SLOTS.map((slot) => ({ id: slot.id, name: slot.name, canonicalHex: slot.canonicalHex, base: hexToOklch(slot.main), unfinishedBackground: hexToOklch(slot.unfinishedBackground), unfinishedTitle: hexToOklch(slot.unfinishedTitle ?? slot.main), completed: hexToOklch(slot.completed), completedBackground: hexToOklch(slot.completedBackground) })),
    completion: { lightness: -0.12, chroma: -0.025, fillAlpha: 0.16, borderAlpha: 0.28 },
  });
  return record;
}
