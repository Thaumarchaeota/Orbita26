import { escAttr, escHtml } from "../../core/html";

export type TreeContainerKind = "folder" | "group";

export type TreeListRenderOpts<T> = {
  containerKind: TreeContainerKind;
  emptyLabel: string;
  expanded: Set<string>;
  items: T[];
  renderLeaf: (item: T, depth: number) => string;
  renderContainer: (item: T, depth: number, childrenHtml: string, open: boolean) => string;
  isContainer: (item: T) => boolean;
};

export function renderTreeList<T extends { id: string }>(opts: TreeListRenderOpts<T>): string {
  const { items, emptyLabel, expanded, renderLeaf, renderContainer, isContainer } = opts;
  if (!items.length) return `<div class="local-tree-empty">${emptyLabel}</div>`;

  const walk = (nodes: T[], depth: number): string =>
    nodes
      .map((item) => {
        if (isContainer(item)) {
          const open = expanded.has(item.id);
          const children = (item as { children?: T[] }).children ?? [];
          const childrenHtml = walk(children, depth + 1);
          return renderContainer(item, depth, childrenHtml, open);
        }
        return renderLeaf(item, depth);
      })
      .join("");

  return walk(items, 0);
}

export function renderTreeLeafRow(opts: {
  id: string;
  kind: string;
  depth: number;
  label: string;
  iconHtml: string;
  tip?: string;
  path?: string;
  url?: string;
}): string {
  const tipAttr = opts.tip ? ` data-tip="${escAttr(opts.tip)}"` : "";
  const pathAttr = opts.path ? ` data-path="${escAttr(opts.path)}"` : "";
  const urlAttr = opts.url ? ` data-url="${escAttr(opts.url)}"` : "";
  return `
    <button type="button" class="local-tree-row local-tree-leaf" data-id="${escAttr(opts.id)}" data-kind="${escAttr(opts.kind)}" style="--depth:${opts.depth}"${tipAttr}${pathAttr}${urlAttr}>
      <span class="local-tree-twistie is-leaf"></span>
      ${opts.iconHtml}
      <span class="local-tree-label">${escHtml(opts.label)}</span>
    </button>
    <div class="local-tree-after-slot" data-target-id="${escAttr(opts.id)}" aria-hidden="true"></div>
  `;
}

export function renderTreeContainerRow(opts: {
  id: string;
  containerKind: TreeContainerKind;
  depth: number;
  label: string;
  iconHtml: string;
  twistieHtml: string;
  open: boolean;
  childrenHtml: string;
  tip?: string;
}): string {
  const tipAttr = opts.tip ? ` data-tip="${escAttr(opts.tip)}"` : "";
  return `
    <div class="local-tree-group" data-group-id="${escAttr(opts.id)}">
      <button type="button" class="local-tree-row local-tree-folder${opts.open ? " is-expanded" : ""}" data-id="${escAttr(opts.id)}" data-kind="${escAttr(opts.containerKind)}" style="--depth:${opts.depth}"${tipAttr}>
        <span class="local-tree-twistie${opts.open ? " is-open" : ""}">${opts.twistieHtml}</span>
        ${opts.iconHtml}
        <span class="local-tree-label">${escHtml(opts.label)}</span>
      </button>
      <div class="local-tree-children-wrap${opts.open ? " is-open" : ""}">
        <div class="local-tree-children">${opts.childrenHtml}</div>
      </div>
      <div class="local-tree-after-slot" data-target-id="${escAttr(opts.id)}" aria-hidden="true"></div>
    </div>
  `;
}

export const TREE_CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>`;

export function toggleTreeContainerRow(
  row: HTMLElement,
  id: string,
  open: boolean,
  expanded: Set<string>,
  openIconHtml: string,
  closedIconHtml: string,
) {
  const group = row.closest<HTMLElement>(".local-tree-group");
  const wrap = group?.querySelector<HTMLElement>(".local-tree-children-wrap");
  const twistie = row.querySelector<HTMLElement>(".local-tree-twistie");
  const icon = row.querySelector<HTMLElement>(".local-tree-icon");
  if (open) expanded.add(id);
  else expanded.delete(id);
  row.classList.toggle("is-expanded", open);
  twistie?.classList.toggle("is-open", open);
  wrap?.classList.toggle("is-open", open);
  if (icon) icon.innerHTML = open ? openIconHtml : closedIconHtml;
}
