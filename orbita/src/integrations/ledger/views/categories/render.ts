import type { AccountRecord } from "../../types";
import { escapeHtml } from "../../utils";
import { getCategories, isCategoryModified } from "../../state/categories";
import { displayPath } from "../../state/category-display";

type TreeNode = {
  children: Map<string, TreeNode>;
  leaves: Array<{ item: AccountRecord; title: string }>;
};

function buildCategoryTree(items: AccountRecord[]): TreeNode {
  const root: TreeNode = { children: new Map(), leaves: [] };
  for (const item of items) {
    const segments = displayPath(item);
    if (!segments.length) {
      root.leaves.push({
        item,
        title: item.name.split(":").pop() || item.name,
      });
      continue;
    }
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i];
      if (!node.children.has(key)) {
        node.children.set(key, { children: new Map(), leaves: [] });
      }
      node = node.children.get(key)!;
    }
    node.leaves.push({ item, title: segments[segments.length - 1] });
  }
  return root;
}

function renderCategoryLeaf({ item, title }: { item: AccountRecord; title: string }): string {
  const mod = isCategoryModified(item.id) ? " categories-modified" : "";
  const brief = item.brief
    ? `<span class="categories-chip-brief">${escapeHtml(item.brief)}</span>`
    : "";
  const labelPh = item.label ? "" : " is-placeholder";
  return `<div class="categories-leaf${mod}" data-category-id="${escapeHtml(item.id)}">
    <span class="categories-chip categories-editable${labelPh}" data-id="${escapeHtml(item.id)}" data-field="label" title="${escapeHtml(item.name)}">
      <span class="categories-chip-title">${escapeHtml(title || "备注")}</span>
      ${brief}
    </span>
    <span class="categories-name-advanced categories-editable" data-id="${escapeHtml(item.id)}" data-field="name">${escapeHtml(item.name)}</span>
  </div>`;
}

function renderCategoryNode(node: TreeNode, depth: number): string {
  const parts: string[] = [];
  for (const [title, child] of node.children) {
    parts.push(`<div class="categories-group" style="--depth:${depth}">
      <div class="categories-group-title">${escapeHtml(title)}</div>
      ${renderCategoryNode(child, depth + 1)}
    </div>`);
  }
  if (node.leaves.length) {
    parts.push(`<div class="categories-leaves">${node.leaves.map(renderCategoryLeaf).join("")}</div>`);
  }
  return parts.join("");
}

export function renderCategoryColumn(prefix: string, container: HTMLElement): void {
  const items = getCategories().filter((c) => c.name.startsWith(prefix));
  const tree = buildCategoryTree(items);
  container.innerHTML = renderCategoryNode(tree, 0);
}

export function updateCategoryRowVisual(id: string): void {
  const row = document.querySelector(`.categories-leaf[data-category-id="${id}"]`);
  if (!row) return;
  row.classList.toggle("categories-modified", isCategoryModified(id));
}

export function renderCategoriesView(
  expensesEl: HTMLElement,
  incomeEl: HTMLElement,
): void {
  renderCategoryColumn("Expenses:", expensesEl);
  renderCategoryColumn("Income:", incomeEl);
}
