import { readBookmarks, writeBookmarks } from "../../core/data/client";
import type { BookmarkEntry, BookmarkLink } from "../../core/data/types";

export type { BookmarkEntry, BookmarkLink };
export type Bookmark = BookmarkLink;

const DEFAULT_BOOKMARKS: BookmarkEntry[] = [
  { kind: "link", id: "github", name: "GitHub", url: "https://github.com" },
  { kind: "link", id: "gmail", name: "Gmail", url: "https://mail.google.com" },
  { kind: "link", id: "dida", name: "滴答", url: "https://dida365.com" },
  { kind: "link", id: "bkeasy", name: "BKeasy", url: "http://127.0.0.1:8000" },
  { kind: "link", id: "bilibili", name: "B站", url: "https://www.bilibili.com" },
  { kind: "link", id: "zhihu", name: "知乎", url: "https://www.zhihu.com" },
  { kind: "link", id: "youtube", name: "YouTube", url: "https://www.youtube.com" },
  { kind: "link", id: "notion", name: "Notion", url: "https://www.notion.so" },
];

let cache: BookmarkEntry[] | null = null;

export async function initBookmarks(): Promise<BookmarkEntry[]> {
  const items = await readBookmarks();
  cache = items.length ? items : [...DEFAULT_BOOKMARKS];
  if (!items.length) await writeBookmarks(cache);
  return cache;
}

export function loadBookmarks(): BookmarkEntry[] {
  if (!cache) throw new Error("bookmarks not loaded");
  return cache;
}

export function saveBookmarks(bookmarks: BookmarkEntry[]): void {
  cache = bookmarks;
  void writeBookmarks(bookmarks);
}

export function updateBookmark(
  id: string,
  name: string,
  url: string,
  icon?: string,
): BookmarkEntry[] {
  const bookmarks = loadBookmarks();
  const next = bookmarks.map((b) => {
    if (b.kind === "folder") return b;
    if (b.id !== id) return b;
    const item: BookmarkLink = {
      ...b,
      name: name.trim(),
      url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`,
    };
    if (icon) item.icon = icon;
    return item;
  });
  saveBookmarks(next);
  return next;
}

export function updateBookmarkInFolder(
  folderId: string,
  id: string,
  name: string,
  url: string,
  icon?: string,
): BookmarkEntry[] {
  const bookmarks = loadBookmarks();
  const next = bookmarks.map((b) => {
    if (b.kind !== "folder" || b.id !== folderId) return b;
    return {
      ...b,
      children: b.children.map((c) => {
        if (c.id !== id) return c;
        const item: BookmarkLink = {
          ...c,
          name: name.trim(),
          url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`,
        };
        if (icon) item.icon = icon;
        return item;
      }),
    };
  });
  saveBookmarks(next);
  return next;
}
