import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../ai/render-markdown";

describe("renderMarkdown", () => {
  it("renders inline and block katex", () => {
    const inline = renderMarkdown("alpha $x^2$ beta");
    expect(inline).toContain("katex");
    const block = renderMarkdown("$$\na+b\n$$");
    expect(block).toContain("katex-display");
  });

  it("does not katex math inside inline code", () => {
    const html = renderMarkdown("see `$$` and `$$\\t \\t$$`");
    expect(html).not.toContain("orbita-katex");
    expect(html).toContain("<code>");
    expect(html).not.toMatch(/katex-display/);
  });
});
