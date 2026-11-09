import { renderMarkdown } from "./render-markdown";

function closeUnclosedFences(text: string): string {
  const fenceRe = /```/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) count++;
  if (count % 2 === 1) return text + "\n```";
  return text;
}

function closeUnclosedInlineCode(text: string): string {
  const parts = text.split("`");
  if (parts.length % 2 === 0) return text;
  return text + "`";
}

function closeUnclosedBlockMath(text: string): string {
  const matches = text.match(/\$\$/g);
  if (matches && matches.length % 2 === 1) return text + "\n$$";
  return text;
}

function closeTrailingInlineMath(text: string): string {
  const strippedBlocks = text.replace(/\$\$[\s\S]*?\$\$/g, "");
  const singles = strippedBlocks.replace(/\$\$/g, "");
  const count = (singles.match(/(?<!\\)\$/g) ?? []).length;
  if (count % 2 === 1) return text + "$";
  return text;
}

function prepareStreamingMarkdown(text: string): string {
  let t = text;
  t = closeUnclosedFences(t);
  t = closeUnclosedInlineCode(t);
  t = closeUnclosedBlockMath(t);
  t = closeTrailingInlineMath(t);
  return t;
}

export type IncrementalMdState = {
  stableHtml: string;
  stableLen: number;
  fadeNew: boolean;
};

export function renderIncrementalMarkdown(
  fullText: string,
  index: number,
  prev: IncrementalMdState | null,
): IncrementalMdState {
  const prepared = prepareStreamingMarkdown(fullText);
  const html = renderMarkdown(prepared, index);
  const fadeNew = (!prev || prev.stableLen === 0) && fullText.length > 0;
  return { stableHtml: html, stableLen: fullText.length, fadeNew };
}

export function renderFinalMarkdown(fullText: string, index: number): string {
  return renderMarkdown(fullText, index);
}
