export type TreeDropPosition = "before" | "after" | "into";

export type TreeLoc<N> = { parentId: string | null; index: number; node: N };

export type TreeOps<N extends { id: string; kind: string }> = {
  containerKind: string;
  recursive: boolean;
  getChildren: (node: N) => N[];
  setChildren: (node: N, children: N[]) => N;
  canDropInto?: (source: N, target: N) => boolean;
  containsDescendant?: (node: N, targetId: string) => boolean;
};

function findLoc<N extends { id: string; kind: string }>(
  nodes: N[],
  id: string,
  parentId: string | null,
  ops: TreeOps<N>,
): TreeLoc<N> | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.id === id) return { parentId, index: i, node };
    if (node.kind === ops.containerKind) {
      const kids = ops.getChildren(node);
      if (ops.recursive) {
        const sub = findLoc(kids, id, node.id, ops);
        if (sub) return sub;
      } else {
        for (let j = 0; j < kids.length; j++) {
          const child = kids[j]!;
          if (child.id === id) return { parentId: node.id, index: j, node: child };
        }
      }
    }
  }
  return null;
}

function updateContainerChildren<N extends { id: string; kind: string }>(
  nodes: N[],
  containerId: string,
  children: N[],
  ops: TreeOps<N>,
): N[] {
  return nodes.map((n) => {
    if (n.id === containerId && n.kind === ops.containerKind) return ops.setChildren(n, children);
    if (ops.recursive && n.kind === ops.containerKind) {
      return ops.setChildren(n, updateContainerChildren(ops.getChildren(n), containerId, children, ops));
    }
    return n;
  });
}

export function locateTreeNode<N extends { id: string; kind: string }>(
  tree: N[],
  id: string,
  ops: TreeOps<N>,
): TreeLoc<N> | null {
  return findLoc(tree, id, null, ops);
}

export function removeTreeNode<N extends { id: string; kind: string }>(
  tree: N[],
  parentId: string | null,
  index: number,
  ops: TreeOps<N>,
): { tree: N[]; removed: N } {
  if (parentId === null) {
    const next = [...tree];
    const [removed] = next.splice(index, 1);
    return { tree: next, removed: removed! };
  }
  const parent = findLoc(tree, parentId, null, ops);
  if (!parent || parent.node.kind !== ops.containerKind) throw new Error("parent not found");
  const kids = [...ops.getChildren(parent.node)];
  const [removed] = kids.splice(index, 1);
  return { tree: updateContainerChildren(tree, parentId, kids, ops), removed: removed! };
}

export function insertTreeNode<N extends { id: string; kind: string }>(
  tree: N[],
  parentId: string | null,
  index: number,
  node: N,
  ops: TreeOps<N>,
): N[] {
  if (parentId === null) {
    const next = [...tree];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return next;
  }
  const parent = findLoc(tree, parentId, null, ops);
  if (!parent || parent.node.kind !== ops.containerKind) return tree;
  const kids = [...ops.getChildren(parent.node)];
  kids.splice(Math.max(0, Math.min(index, kids.length)), 0, node);
  return updateContainerChildren(tree, parentId, kids, ops);
}

export function moveTreeNode<N extends { id: string; kind: string }>(
  tree: N[],
  sourceId: string,
  targetId: string | null,
  position: TreeDropPosition,
  ops: TreeOps<N>,
): N[] {
  const src = findLoc(tree, sourceId, null, ops);
  if (!src) return tree;

  if (!targetId) {
    const { tree: without, removed } = removeTreeNode(tree, src.parentId, src.index, ops);
    if (position === "before") return insertTreeNode(without, null, 0, removed, ops);
    return insertTreeNode(without, null, without.length, removed, ops);
  }

  if (sourceId === targetId) return tree;
  if (ops.containsDescendant?.(src.node, targetId)) return tree;

  const tgt = findLoc(tree, targetId, null, ops);
  if (!tgt) return tree;

  if (position === "into") {
    if (tgt.node.kind !== ops.containerKind) return tree;
    if (ops.canDropInto && !ops.canDropInto(src.node, tgt.node)) return tree;
  }

  const fromIndex = src.index;
  const fromParentId = src.parentId;

  let toParentId: string | null;
  let toIndex: number;

  if (position === "into") {
    if (tgt.node.kind !== ops.containerKind) return tree;
    toParentId = tgt.node.id;
    toIndex = ops.getChildren(tgt.node).length;
  } else {
    toParentId = tgt.parentId;
    toIndex = position === "before" ? tgt.index : tgt.index + 1;
    if (fromParentId === toParentId && fromIndex < toIndex) toIndex--;
  }

  const { tree: without, removed } = removeTreeNode(tree, fromParentId, fromIndex, ops);
  return insertTreeNode(without, toParentId, toIndex, removed, ops);
}

export function getTreeChildren<N extends { id: string; kind: string }>(
  tree: N[],
  parentId: string | null,
  ops: TreeOps<N>,
): N[] {
  if (parentId === null) return tree;
  const loc = findLoc(tree, parentId, null, ops);
  if (!loc || loc.node.kind !== ops.containerKind) return [];
  return ops.getChildren(loc.node);
}

export function reorderTreeSiblings<N extends { id: string; kind: string }>(
  tree: N[],
  parentId: string | null,
  orderedIds: string[],
  ops: TreeOps<N>,
): N[] {
  const list = getTreeChildren(tree, parentId, ops);
  const map = new Map(list.map((n) => [n.id, n]));
  const ordered = orderedIds.map((id) => map.get(id)).filter((n): n is N => !!n);
  if (parentId === null) return ordered;
  return updateContainerChildren(tree, parentId, ordered, ops);
}
