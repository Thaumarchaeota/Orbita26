import type { LocalEntry, LocalFileLeaf, LocalGroup } from "../../core/data/types";

export type LocalDropPosition = "before" | "after" | "into";

type Loc = { parentId: string | null; index: number; node: LocalEntry };

function findLoc(nodes: LocalEntry[], id: string, parentId: string | null): Loc | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.id === id) return { parentId, index: i, node };
    if (node.kind === "group") {
      const sub = findLoc(node.children, id, node.id);
      if (sub) return sub;
    }
  }
  return null;
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

function removeFromParent(tree: LocalEntry[], parentId: string | null, index: number): {
  tree: LocalEntry[];
  removed: LocalEntry;
} {
  if (parentId === null) {
    const next = [...tree];
    const [removed] = next.splice(index, 1);
    return { tree: next, removed: removed! };
  }
  const parent = findLoc(tree, parentId, null);
  if (!parent || parent.node.kind !== "group") throw new Error("parent not found");
  const kids = [...parent.node.children];
  const [removed] = kids.splice(index, 1);
  return { tree: updateGroupChildren(tree, parentId, kids), removed: removed! };
}

function insertIntoParent(
  tree: LocalEntry[],
  parentId: string | null,
  index: number,
  node: LocalEntry,
): LocalEntry[] {
  if (parentId === null) {
    const next = [...tree];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return next;
  }
  const parent = findLoc(tree, parentId, null);
  if (!parent || parent.node.kind !== "group") return tree;
  const kids = [...parent.node.children];
  kids.splice(Math.max(0, Math.min(index, kids.length)), 0, node);
  return updateGroupChildren(tree, parentId, kids);
}

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

export function locateLocalEntry(tree: LocalEntry[], id: string): Loc | null {
  return findLoc(tree, id, null);
}

export function getChildrenList(tree: LocalEntry[], parentId: string | null): LocalEntry[] {
  if (parentId === null) return tree;
  const loc = findLoc(tree, parentId, null);
  if (!loc || loc.node.kind !== "group") return [];
  return loc.node.children;
}

export function moveLocalNode(
  tree: LocalEntry[],
  sourceId: string,
  targetId: string | null,
  position: LocalDropPosition,
): LocalEntry[] {
  const src = findLoc(tree, sourceId, null);
  if (!src) return tree;

  if (!targetId) {
    const { tree: without, removed } = removeFromParent(tree, src.parentId, src.index);
    if (position === "before") return insertIntoParent(without, null, 0, removed);
    return insertIntoParent(without, null, without.length, removed);
  }

  if (src.node.kind === "group" && containsDescendant(src.node, targetId)) return tree;
  if (sourceId === targetId) return tree;

  const tgt = findLoc(tree, targetId, null);
  if (!tgt) return tree;

  const fromIndex = src.index;
  const fromParentId = src.parentId;

  let toParentId: string | null;
  let toIndex: number;

  if (position === "into") {
    if (tgt.node.kind !== "group") return tree;
    toParentId = tgt.node.id;
    toIndex = tgt.node.children.length;
  } else {
    toParentId = tgt.parentId;
    toIndex = position === "before" ? tgt.index : tgt.index + 1;
    if (fromParentId === toParentId && fromIndex < toIndex) toIndex--;
  }

  const { tree: without, removed } = removeFromParent(tree, fromParentId, fromIndex);
  return insertIntoParent(without, toParentId, toIndex, removed);
}

export function removeLocalEntry(tree: LocalEntry[], id: string): LocalEntry[] {
  const loc = findLoc(tree, id, null);
  if (!loc) return tree;

  const { tree: without, removed } = removeFromParent(tree, loc.parentId, loc.index);
  if (removed.kind !== "group") return without;

  let next = without;
  const lifted = liftGroupChildren(removed);
  for (let i = 0; i < lifted.length; i++) {
    next = insertIntoParent(next, loc.parentId, loc.index + i, lifted[i]!);
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
  const parent = findLoc(tree, parentId, null);
  if (!parent || parent.node.kind !== "group") return [...tree, group];
  return updateGroupChildren(tree, parentId, [...parent.node.children, group]);
}

export function addLocalLeaf(tree: LocalEntry[], leaf: LocalFileLeaf, parentId: string | null): LocalEntry[] {
  if (!parentId) return [...tree, leaf];
  const parent = findLoc(tree, parentId, null);
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
  const list = getChildrenList(tree, parentId);
  const map = new Map(list.map((n) => [n.id, n]));
  const ordered = orderedIds.map((id) => map.get(id)).filter((n): n is LocalEntry => !!n);
  if (parentId === null) return ordered;
  return updateGroupChildren(tree, parentId, ordered);
}
