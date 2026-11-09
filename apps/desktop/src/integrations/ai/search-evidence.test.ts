import { describe, expect, it } from "vitest";
import { searchEvidenceHtml, type ChatMessage } from "./adapter";

describe("searchEvidenceHtml", () => {
  it("does not show web search evidence for an ordinary local answer", () => {
    const message: ChatMessage = {
      role: "assistant",
      content: "今天记录了两餐。",
    };

    expect(searchEvidenceHtml(message)).toBe("");
  });

  it("shows search progress without displaying unfinished sources", () => {
    const message: ChatMessage = {
      role: "assistant",
      content: "",
      searchStatus: "searching",
      sources: [{ title: "Earlier result", url: "https://example.com/old" }],
    };

    const html = searchEvidenceHtml(message);
    expect(html).toContain("正在搜索网页…");
    expect(html).not.toContain("Earlier result");
  });

  it("escapes a search failure while making the lack of verification visible", () => {
    const html = searchEvidenceHtml({
      role: "assistant",
      content: "模型仍可回答",
      searchStatus: "failed:<img src=x onerror=alert(1)>",
    });

    expect(html).toContain("网页搜索未验证");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("renders safe source links from a persisted assistant message", () => {
    const savedMessage: ChatMessage = {
      role: "assistant",
      content: "根据查到的资料回答。",
      searchStatus: "verified",
      sources: [
        { title: "News <script>alert(1)</script>", url: "https://example.com/?a=1&b=2" },
        { title: "Unsafe", url: "javascript:alert(1)" },
        { title: "Local", url: "https://127.0.0.1/private" },
      ],
    };
    const restored = JSON.parse(JSON.stringify(savedMessage)) as ChatMessage;
    const html = searchEvidenceHtml(restored);

    expect(html).toContain("网页来源：");
    expect(html).toContain("href=\"https://example.com/?a=1&amp;b=2\"");
    expect(html).toContain("News &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("rel=\"noopener noreferrer\"");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("127.0.0.1");
    expect(html).not.toContain("<script>");
  });
});
