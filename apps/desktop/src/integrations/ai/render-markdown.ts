import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const cache = new Map<string, string>();
let cacheConversationId = "";

const KATEX_TAGS = [
  "math",
  "semantics",
  "mrow",
  "mi",
  "mo",
  "mn",
  "msup",
  "msub",
  "mfrac",
  "msqrt",
  "mtable",
  "mtr",
  "mtd",
  "mstyle",
  "mspace",
  "annotation",
  "mtext",
  "menclose",
  "mover",
  "munder",
  "munderover",
  "mpadded",
  "mphantom",
  "mroot",
  "mfenced",
  "msubsup",
  "mmultiscripts",
  "mlabeledtr",
];

const KATEX_ATTR = ["xmlns", "encoding", "display", "class", "style", "aria-hidden", "width", "height"];

function mapOutsideCode(text: string, fn: (chunk: string) => string): string {
  const fenceParts = text.split(/(```[\s\S]*?```)/);
  return fenceParts
    .map((part, i) => {
      if (i % 2 === 1 || part.startsWith("```")) return part;
      return part
        .split(/(`[^`]*`)/)
        .map((seg, j) => (j % 2 === 1 ? seg : fn(seg)))
        .join("");
    })
    .join("");
}

function renderKatexPlaceholders(text: string): { text: string; slots: string[] } {
  const slots: string[] = [];
  const hold = (html: string) => {
    const token = `<!--orbita-katex-${slots.length}-->`;
    slots.push(html);
    return token;
  };
  const mapped = mapOutsideCode(text, (chunk) => {
    let out = chunk.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
      try {
        return hold(
          `<span class="katex-block">${katex.renderToString(tex.trim(), { throwOnError: false, displayMode: true })}</span>`,
        );
      } catch {
        return `$$${tex}$$`;
      }
    });
    out = out.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, tex: string) => {
      try {
        return hold(katex.renderToString(tex.trim(), { throwOnError: false, displayMode: false }));
      } catch {
        return `$${tex}$`;
      }
    });
    return out;
  });
  return { text: mapped, slots };
}

function restoreKatexPlaceholders(html: string, slots: string[]): string {
  return html.replace(/<!--orbita-katex-(\d+)-->/g, (_, n: string) => slots[Number(n)] ?? "");
}

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
  const { text: withPlaceholders, slots } = renderKatexPlaceholders(text);
  const raw = restoreKatexPlaceholders(marked.parse(withPlaceholders, { async: false }) as string, slots);
  const html = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_TAGS: KATEX_TAGS,
    ADD_ATTR: KATEX_ATTR,
  });
  cache.set(key, html);
  return html;
}
