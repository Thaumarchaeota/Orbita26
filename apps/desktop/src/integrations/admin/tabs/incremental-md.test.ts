import { describe, expect, it } from "vitest";
import { renderFinalMarkdown, renderIncrementalMarkdown } from "../../ai/incremental-md";

describe("renderIncrementalMarkdown", () => {
  it("closes an unfinished fence so marked can parse", () => {
    const first = renderIncrementalMarkdown("```js\nconst x = 1", 0, null);
    expect(first.stableHtml).toContain("code");
    expect(first.fadeNew).toBe(true);
  });

  it("does not wrap html in a span and does not re-flag fade after first visible", () => {
    const first = renderIncrementalMarkdown("hello", 1, null);
    expect(first.stableHtml).not.toContain("insight-chat-fade-in");
    const second = renderIncrementalMarkdown("hello world", 1, first);
    expect(second.fadeNew).toBe(false);
    expect(second.stableHtml).not.toContain("<span class=");
  });

  it("final render does not append closing fences to finished text", () => {
    const html = renderFinalMarkdown("plain", 2);
    expect(html).toContain("plain");
  });

  it("closes unclosed block math while streaming", () => {
    const state = renderIncrementalMarkdown("$$\nx^2", 3, null);
    expect(state.stableHtml).toContain("katex");
  });

  it("closes trailing inline math dollar while streaming", () => {
    const state = renderIncrementalMarkdown("alpha $x", 4, null);
    expect(state.stableHtml).toContain("katex");
  });
});
