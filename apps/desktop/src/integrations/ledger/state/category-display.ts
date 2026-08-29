import type { AccountRecord } from "../types";

function splitBrief(labelPath: string[]): { label_path: string[]; brief: string } {
  if (!labelPath.length) return { label_path: [], brief: "" };
  const path = [...labelPath];
  const last = path[path.length - 1];
  const i = last.lastIndexOf("_");
  if (i >= 0) {
    return {
      label_path: [...path.slice(0, -1), last.slice(0, i).trim()],
      brief: last.slice(i + 1).trim(),
    };
  }
  return { label_path: path, brief: "" };
}

export function deriveLabelFields(label: string): { label_path: string[]; brief: string } {
  const raw = (label || "").trim();
  if (!raw) return { label_path: [], brief: "" };
  const parts = raw.split(":").map((p) => p.trim()).filter(Boolean);
  return splitBrief(parts);
}

export function displayPath(item: AccountRecord): string[] {
  if (item.label_path?.length) return [...item.label_path];
  return item.name.split(":").slice(1);
}

export function accountDisplayLabel(item: AccountRecord): string {
  const path = displayPath(item).filter((part) => Boolean(part?.trim()));
  const last = path.length ? path[path.length - 1]! : "";
  if (last) return last;
  return (item.label || item.name || "").trim() || "—";
}

export function accountDisplaySubtitle(item: AccountRecord): string {
  return (item.name || "").trim();
}

export function groupByLabelPath(items: AccountRecord[]): Map<string, AccountRecord[]> {
  const groups = new Map<string, AccountRecord[]>();
  for (const item of items) {
    const key = displayPath(item)[0] || item.name.split(":").pop() || "其他";
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

export function categoryChipLabel(item: AccountRecord): string {
  const path = displayPath(item);
  const last = path.length ? path[path.length - 1] : "";
  const nameLast = item.name.split(":").pop() || "";
  return last || item.label || nameLast;
}

export function applyLabel(cat: AccountRecord, value: string): void {
  const label = (value || "").trim();
  cat.label = label;
  const { label_path, brief } = deriveLabelFields(label);
  cat.label_path = label_path;
  cat.brief = brief;
}
