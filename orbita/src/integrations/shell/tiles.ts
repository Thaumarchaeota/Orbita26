import { escAttr, escHtml } from "../../core/html";

export const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

export const EDIT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

const AVATAR_COLORS = ["#1565c0", "#3b82f6", "#6366f1", "#0ea5e9", "#0891b2", "#7c3aed"];

export function tileColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function tileInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

type PreviewItem = { name: string; iconSrc?: string };

function folderPreviewHtml(items: PreviewItem[]): string {
  const slots = [...items.slice(0, 4)];
  while (slots.length < 4) slots.push({ name: "" });
  return `<span class="folder-preview">${slots
    .map((item) => {
      if (!item.name) return `<span class="folder-preview-cell is-empty"></span>`;
      if (item.iconSrc) {
        return `<span class="folder-preview-cell"><img src="${escAttr(item.iconSrc)}" alt="" draggable="false"></span>`;
      }
      const c = tileColor(item.name);
      return `<span class="folder-preview-cell" style="--avatar-color:${c}">${escHtml(tileInitial(item.name))}</span>`;
    })
    .join("")}</span>`;
}

export function renderTile(
  item: { id: string; name: string; kind?: string } | null,
  attrs: Record<string, string>,
  emptyLabel = "添加",
  editMode = false,
  _draggable = false,
  iconSrc?: string,
  folderPreview?: PreviewItem[],
  slot?: number,
): string {
  if (!item) {
    const slotAttr = slot !== undefined ? ` data-slot="${slot}"` : "";
    return `
      <div class="launcher-tile is-empty" role="button" tabindex="0"${slotAttr} title="${escAttr(emptyLabel)}">
        <span class="launcher-avatar launcher-avatar-empty">${PLUS_SVG}</span>
        <span class="launcher-name">${escHtml(emptyLabel)}</span>
      </div>
    `;
  }

  if (item.kind === "folder" && folderPreview) {
    const deleteBtn = editMode
      ? `<span class="launcher-tile-delete" data-action="delete" aria-label="删除">×</span>`
      : "";
    const editBtn = editMode
      ? `<span class="launcher-tile-edit" data-action="edit-folder" aria-label="重命名">${EDIT_SVG}</span>`
      : "";
    return `
      <div class="launcher-tile is-folder${editMode ? " is-editing" : ""}" role="button" tabindex="0" data-id="${escAttr(item.id)}" data-kind="folder" title="${escAttr(item.name)}">
        ${deleteBtn}
        <span class="launcher-tile-main">
          <span class="launcher-avatar launcher-avatar-folder">${folderPreviewHtml(folderPreview)}</span>
          ${editBtn}
        </span>
        <span class="launcher-name">${escHtml(item.name)}</span>
      </div>
    `;
  }

  const color = tileColor(item.name);
  const initial = escHtml(tileInitial(item.name));
  const dataAttrs = Object.entries(attrs)
    .map(([k, v]) => `data-${k}="${escAttr(v)}"`)
    .join(" ");
  const deleteBtn = editMode
    ? `<span class="launcher-tile-delete" data-action="delete" aria-label="删除">×</span>`
    : "";
  const editBtn = editMode
    ? `<span class="launcher-tile-edit" data-action="edit" aria-label="修改">${EDIT_SVG}</span>`
    : "";
  const avatar = iconSrc
    ? `<span class="launcher-avatar launcher-avatar-img"><img src="${escAttr(iconSrc)}" alt="" draggable="false"></span>`
    : `<span class="launcher-avatar" style="--avatar-color:${color}">${initial}</span>`;
  const kindAttr = item.kind ? ` data-kind="${escAttr(item.kind)}"` : "";
  return `
    <div class="launcher-tile${editMode ? " is-editing" : ""}" role="button" tabindex="0" data-id="${escAttr(item.id)}"${kindAttr} ${dataAttrs} title="${escAttr(item.name)}">
      ${deleteBtn}
      <span class="launcher-tile-main">
        ${avatar}
        ${editBtn}
      </span>
      <span class="launcher-name">${escHtml(item.name)}</span>
    </div>
  `;
}
