/** Stable child reconciliation — keeps connected nodes, avoids replaceChildren reparent churn. */
export function reconcileChildren(parent: HTMLElement, nextNodes: readonly HTMLElement[]): void {
  for (let i = 0; i < nextNodes.length; i++) {
    const node = nextNodes[i]!;
    const current = parent.children[i];
    if (current === node) continue;
    parent.insertBefore(node, current ?? null);
  }
  while (parent.children.length > nextNodes.length) {
    parent.lastElementChild?.remove();
  }
}
