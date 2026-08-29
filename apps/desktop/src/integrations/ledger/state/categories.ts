import { deriveLabelFields } from "./category-display";
import type { AccountRecord, AccountsResponse, CategoryModel } from "../types";

let categories: AccountRecord[] = [];
let baseline: AccountRecord[] = [];

function normalizeCategory(c: AccountRecord): AccountRecord {
  const item: AccountRecord = { ...c, label_path: [...(c.label_path || [])] };
  if (item.brief === undefined && item.label) {
    const derived = deriveLabelFields(item.label);
    item.label_path = derived.label_path;
    item.brief = derived.brief;
  } else {
    item.brief = item.brief || "";
  }
  return item;
}

function cloneCategories(list: AccountRecord[]): AccountRecord[] {
  return list.map(normalizeCategory);
}

export function loadCategoriesFromAccounts(acc: AccountsResponse): void {
  categories = cloneCategories([...(acc.expenses || []), ...(acc.income || [])]);
  baseline = cloneCategories(categories);
}

export function getCategories(): AccountRecord[] {
  return categories;
}

export function getCategoriesBaseline(): AccountRecord[] {
  return baseline;
}

export function findCategory(id: string): AccountRecord | undefined {
  return categories.find((c) => c.id === id);
}

function categorySnapshot(list: AccountRecord[]): string {
  return JSON.stringify(
    list.map((c) => ({
      id: c.id,
      name: c.name,
      label: c.label || "",
      open_date: c.open_date,
      extra: c.extra || "",
    })),
  );
}

export function isCategoriesDirty(): boolean {
  return categorySnapshot(categories) !== categorySnapshot(baseline);
}

export function isCategoryModified(id: string): boolean {
  const cur = findCategory(id);
  const base = baseline.find((c) => c.id === id);
  if (!cur || !base) return false;
  return cur.name !== base.name || (cur.label || "") !== (base.label || "");
}

export function categoriesForCommit(): CategoryModel[] {
  return categories
    .filter((c) => isCategoryModified(c.id))
    .map((c) => ({
      id: c.id,
      source_file: c.source_file,
      source_line: c.source_line,
      name: c.name,
      label: c.label || "",
      open_date: c.open_date || "2026-01-01",
      extra: c.extra || "",
    }));
}

export function resetCategoriesBaseline(): void {
  baseline = cloneCategories(categories);
}
