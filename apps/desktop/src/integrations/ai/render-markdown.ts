import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const cache = new Map<string, string>();
let cacheConversationId = "";

export function clearMarkdownCache(conversationId?: string) {
  if (conversationId === undefined || conversationId === cacheConversationId) {
    cache.clear();
    cacheConversationId = conversationId ?? "";
  }
}

export function setMarkdownCacheConversation(conversationId: string) {
  if (conversationId !== cacheConversationId) {
    cache.clear();
    cacheConversationId = conversationId;
  }
}

export function renderMarkdown(text: string, index?: number): string {
  if (!text) return "";
  const key = index !== undefined ? `${index}:${text.length}:${text}` : text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const raw = marked.parse(text, { async: false }) as string;
  const html = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
  });
  cache.set(key, html);
  return html;
}
