import { readBookmarks, writeBookmarks } from "../../core/data/client";
import type { BookmarkEntry, BookmarkLink } from "../../core/data/types";
import { createLauncherStore } from "./launcher-store";

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

function normalizeUrl(url: string): string {
  const t = url.trim();
  return t.startsWith("http") ? t : `https://${t}`;
}

const store = createLauncherStore<BookmarkLink, BookmarkEntry>({
  name: "bookmarks",
  read: readBookmarks,
  write: writeBookmarks,
  defaults: DEFAULT_BOOKMARKS,
  applyPayload: (leaf, name, url, icon) => {
    const item: BookmarkLink = { ...leaf, name: name.trim(), url: normalizeUrl(url) };
    if (icon) item.icon = icon;
    return item;
  },
});

export const initBookmarks = store.init;
export const loadBookmarks = store.load;
export const saveBookmarks = store.save;
export const updateBookmark = store.updateLeaf;
export const updateBookmarkInFolder = store.updateLeafInFolder;
