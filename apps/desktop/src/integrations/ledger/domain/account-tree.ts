import type { AccountGroup, AccountRecord } from "../types";
import { accountDisplayLabel } from "../state/accounts";
import { getAccountRecords } from "../state/accounts";

export type AccountTreeNode = {
  id: string;
  name: string;
  label: string;
  isLeaf: boolean;
  children: AccountTreeNode[];
};

const FILTER_GROUPS: AccountGroup[] = ["assets", "liabilities", "expenses", "income"];

export function accountMatchesPrefix(account: string, prefix: string): boolean {
  return account === prefix || account.startsWith(`${prefix}:`);
}

export function expandAccountSelection(selected: ReadonlySet<string>): Set<string> {
  const all = FILTER_GROUPS.flatMap((g) => getAccountRecords(g).map((r) => r.name));
  const expanded = new Set<string>();
  for (const prefix of selected) {
    for (const name of all) {
      if (accountMatchesPrefix(name, prefix)) expanded.add(name);
    }
    expanded.add(prefix);
  }
  return expanded;
}

function insertPath(root: Map<string, AccountTreeNode>, parts: string[], fullName: string, label: string): void {
  let currentMap = root;
  let path = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    path = path ? `${path}:${part}` : part;
    const existing = currentMap.get(path);
    if (existing) {
      if (i === parts.length - 1) {
        existing.name = fullName;
        existing.label = label;
        existing.isLeaf = true;
      }
      currentMap = new Map(existing.children.map((c) => [c.id, c]));
      continue;
    }
    const node: AccountTreeNode = {
      id: path,
      name: i === parts.length - 1 ? fullName : path,
      label: i === parts.length - 1 ? label : part,
      isLeaf: i === parts.length - 1,
      children: [],
    };
    const parent = [...root.values()].find((n) => n.id === path.split(":").slice(0, -1).join(":") || n.id === path);
    void parent;
    currentMap.set(path, node);
    currentMap = new Map();
  }
}

export function buildAccountForest(groups: AccountGroup[] = FILTER_GROUPS): AccountTreeNode[] {
  const records: AccountRecord[] = groups.flatMap((g) => getAccountRecords(g));
  const nodeById = new Map<string, AccountTreeNode>();

  for (const rec of records) {
    const segments = rec.name.split(":");
    let path = "";
    for (let i = 0; i < segments.length; i++) {
      path = i === 0 ? segments[i]! : `${path}:${segments[i]}`;
      const isLeaf = i === segments.length - 1;
      let node = nodeById.get(path);
      if (!node) {
        node = {
          id: path,
          name: isLeaf ? rec.name : path,
          label: isLeaf ? accountDisplayLabel(rec) : segments[i]!,
          isLeaf,
          children: [],
        };
        nodeById.set(path, node);
        if (i > 0) {
          const parentPath = segments.slice(0, i).join(":");
          const parent = nodeById.get(parentPath);
          if (parent && !parent.children.some((c) => c.id === path)) parent.children.push(node);
        }
      } else if (isLeaf) {
        node.name = rec.name;
        node.label = accountDisplayLabel(rec);
        node.isLeaf = true;
      }
    }
  }

  const roots: AccountTreeNode[] = [];
  for (const node of nodeById.values()) {
    const colonCount = (node.id.match(/:/g) || []).length;
    if (colonCount === 0 || !nodeById.has(node.id.split(":").slice(0, -1).join(":"))) {
      if (!roots.some((r) => r.id === node.id)) roots.push(node);
    }
  }

  const sortTree = (nodes: AccountTreeNode[]): void => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);
  return roots;
}

export function collectTreeCheckState(
  node: AccountTreeNode,
  selected: ReadonlySet<string>,
): "checked" | "indeterminate" | "unchecked" {
  const selfSelected = selected.has(node.name) || selected.has(node.id);
  if (!node.children.length) return selfSelected ? "checked" : "unchecked";
  const childStates = node.children.map((c) => collectTreeCheckState(c, selected));
  if (childStates.every((s) => s === "checked")) return "checked";
  const any = selfSelected || childStates.some((s) => s !== "unchecked");
  return any ? "indeterminate" : "unchecked";
}
