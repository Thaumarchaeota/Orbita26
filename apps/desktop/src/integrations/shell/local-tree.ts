import type { LocalEntry, LocalFileLeaf, LocalGroup } from "../../core/data/types";
import {
  getTreeChildren,
  insertTreeNode,
  locateTreeNode,
  moveTreeNode,
  removeTreeNode,
  reorderTreeSiblings,
  type TreeDropPosition,
  type TreeOps,
} from "../../core/tree-ops";

export type LocalDropPosition = TreeDropPosition;

function containsDescendant(node: LocalEntry, targetId: string): boolean {
  if (node.kind !== "group") return false;
  for (const c of node.children) {
    if (c.id === targetId) return true;
    if (c.kind === "group" && containsDescendant(c, targetId)) return true;
  }
  return false;
}

function liftGroupChildren(node: LocalEntry): LocalEntry[] {
  if (node.kind !== "group") return [node];
  return node.children.flatMap((c) => (c.kind === "group" ? liftGroupChildren(c) : [c]));
}

function updateGroupChildren(
  nodes: LocalEntry[],
  groupId: string,
  children: LocalEntry[],
): LocalEntry[] {
  return nodes.map((n) => {
    if (n.id === groupId && n.kind === "group") return { ...n, children };
    if (n.kind === "group") return { ...n, children: updateGroupChildren(n.children, groupId, children) };
    return n;
  });
}

const localTreeOps: TreeOps<LocalEntry> = {
  containerKind: "group",
  recursive: true,
  getChildren: (node) => (node.kind === "group" ? node.children : []),
  setChildren: (node, children) => (node.kind === "group" ? { ...node, children } : node),
  containsDescendant: (node, targetId) => containsDescendant(node, targetId),
  canDropInto: (source, target) =>
    target.kind === "group" &&
    source.id !== target.id &&
    (source.kind !== "group" || !containsDescendant(source, target.id)),
};

export function locateLocalEntry(tree: LocalEntry[], id: string) {
  return locateTreeNode(tree, id, localTreeOps);
}

export function getChildrenList(tree: LocalEntry[], parentId: string | null): LocalEntry[] {
  return getTreeChildren(tree, parentId, localTreeOps);
}

export function moveLocalNode(
  tree: LocalEntry[],
  sourceId: string,
  targetId: string | null,
  position: LocalDropPosition,
): LocalEntry[] {
  return moveTreeNode(tree, sourceId, targetId, position, localTreeOps);
}

export function removeLocalEntry(tree: LocalEntry[], id: string): LocalEntry[] {
  const loc = locateLocalEntry(tree, id);
  if (!loc) return tree;

  const { tree: without, removed } = removeTreeNode(tree, loc.parentId, loc.index, localTreeOps);
  if (removed.kind !== "group") return without;

  let next = without;
  const lifted = liftGroupChildren(removed);
  for (let i = 0; i < lifted.length; i++) {
    next = insertTreeNode(next, loc.parentId, loc.index + i, lifted[i]!, localTreeOps);
  }
  return next;
}

export function addLocalGroup(tree: LocalEntry[], name: string, parentId: string | null): LocalEntry[] {
  const group: LocalGroup = {
    kind: "group",
    id: crypto.randomUUID(),
    name: name.trim() || "分组",
    children: [],
  };
  if (!parentId) return [...tree, group];
  const parent = locateLocalEntry(tree, parentId);
  if (!parent || parent.node.kind !== "group") return [...tree, group];
  return updateGroupChildren(tree, parentId, [...parent.node.children, group]);
}

export function addLocalLeaf(tree: LocalEntry[], leaf: LocalFileLeaf, parentId: string | null): LocalEntry[] {
  if (!parentId) return [...tree, leaf];
  const parent = locateLocalEntry(tree, parentId);
  if (!parent || parent.node.kind !== "group") return [...tree, leaf];
  return updateGroupChildren(tree, parentId, [...parent.node.children, leaf]);
}

export function updateLocalGroupName(tree: LocalEntry[], id: string, name: string, color?: string): LocalEntry[] {
  const walk = (nodes: LocalEntry[]): LocalEntry[] =>
    nodes.map((n) => {
      if (n.id === id && n.kind === "group") {
        const item = { ...n, name: name.trim() };
        if (color) item.color = color;
        else delete item.color;
        return item;
      }
      if (n.kind === "group") return { ...n, children: walk(n.children) };
      return n;
    });
  return walk(tree);
}

export function updateLocalLeaf(
  tree: LocalEntry[],
  id: string,
  name: string,
  path: string,
  color?: string,
): LocalEntry[] {
  const walk = (nodes: LocalEntry[]): LocalEntry[] =>
    nodes.map((n) => {
      if (n.id === id && n.kind !== "group") {
        const item = { ...n, name: name.trim(), path: path.trim() };
        if (color) item.color = color;
        else delete item.color;
        return item;
      }
      if (n.kind === "group") return { ...n, children: walk(n.children) };
      return n;
    });
  return walk(tree);
}

export function flattenLocalLeaves(tree: LocalEntry[]): LocalFileLeaf[] {
  const out: LocalFileLeaf[] = [];
  const walk = (nodes: LocalEntry[]) => {
    for (const n of nodes) {
      if (n.kind === "group") walk(n.children);
      else out.push(n);
    }
  };
  walk(tree);
  return out;
}

export function reorderLocalSiblings(
  tree: LocalEntry[],
  parentId: string | null,
  orderedIds: string[],
): LocalEntry[] {
  return reorderTreeSiblings(tree, parentId, orderedIds, localTreeOps);
}
