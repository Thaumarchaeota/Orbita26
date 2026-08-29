export const FILE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`;

export const TOOLBAR_ADD_FILE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/><line x1="16" y1="17" x2="20" y2="17"/><line x1="18" y1="15" x2="18" y2="19"/></svg>`;

export const TOOLBAR_ADD_FOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V6.5A2 2 0 0 1 5 4.5h4.5L11 6h8a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5z"/><line x1="16" y1="17" x2="20" y2="17"/><line x1="18" y1="15" x2="18" y2="19"/></svg>`;

export const TOOLBAR_ADD_GROUP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v6a2 2 0 0 0 2 2h9"/><path d="M5 9.5V8a2 2 0 0 1 2-2h2.5L10 7.5"/><path d="M11 14h5"/><path d="M11 17h3"/><path d="M14 5h5.5L21 7.5V17a2 2 0 0 1-2 2h-8"/><path d="M14 5v2.5h2.5"/></svg>`;

export const TOOLBAR_RECYCLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

export const FOLDER_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v9A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V7.5z"/></svg>`;

export const FOLDER_OPEN_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 9.5A2.5 2.5 0 0 1 5.5 7H9l1.2 1.2H18.5A2.5 2.5 0 0 1 21 10.7v7.8A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V9.5z"/><path d="M3 10.5 21 10.5V18.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V10.5z" fill-opacity=".72"/></svg>`;

export type LocalItemIconKind = "file" | "folder" | "folder-open";

export function localItemIcon(kind: LocalItemIconKind, extraClass = "", style = ""): string {
  const isFolder = kind !== "file";
  const svg = kind === "folder-open" ? FOLDER_OPEN_SVG : kind === "folder" ? FOLDER_SVG : FILE_SVG;
  const cls = `local-item-icon${isFolder ? " is-folder" : " is-file"}${extraClass ? ` ${extraClass}` : ""}`;
  return `<span class="${cls}"${style}>${svg}</span>`;
}

export function applyShellIcon(container: HTMLElement, dataUrl: string) {
  const icon = container.querySelector<HTMLElement>(".local-file-icon, .local-item-icon");
  if (!icon) return;
  icon.classList.remove("is-file", "is-folder");
  icon.classList.add("is-shell-icon");
  icon.style.backgroundImage = `url("${dataUrl}")`;
  icon.innerHTML = "";
}
