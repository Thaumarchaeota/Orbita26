import { describe, expect, it } from "vitest";
import { composerTextareaStyle } from "../../ai/composer-autosize";

const base = {
  expanded: true,
  lineHeight: 20,
  minHeight: 40,
  maxLines: 5,
  paddingTop: 8,
  paddingBottom: 8,
};

const maxHeight = 20 * 5 + 8 + 8;

describe("composerTextareaStyle", () => {
  it("collapsed uses minHeight with overflow hidden", () => {
    expect(
      composerTextareaStyle({
        ...base,
        expanded: false,
        scrollHeight: 200,
      }),
    ).toEqual({ height: "40px", overflowY: "hidden" });
  });

  it("expanded grows with scrollHeight up to cap", () => {
    expect(
      composerTextareaStyle({ ...base, scrollHeight: 72 }),
    ).toEqual({ height: "72px", overflowY: "hidden" });
  });

  it("expanded stays at minHeight when content is within idle lines", () => {
    expect(
      composerTextareaStyle({ ...base, scrollHeight: 36 }),
    ).toEqual({ height: "40px", overflowY: "hidden" });
  });

  it("expanded caps at maxLines*lineHeight+padding with overflow auto", () => {
    expect(
      composerTextareaStyle({ ...base, scrollHeight: 200 }),
    ).toEqual({ height: `${maxHeight}px`, overflowY: "auto" });
  });

  it("expanded at exactly maxHeight stays hidden overflow", () => {
    expect(
      composerTextareaStyle({ ...base, scrollHeight: maxHeight }),
    ).toEqual({ height: `${maxHeight}px`, overflowY: "hidden" });
  });

  it("height drops when scrollHeight shrinks (fewer lines)", () => {
    const tall = composerTextareaStyle({ ...base, scrollHeight: 100 });
    const short = composerTextareaStyle({ ...base, scrollHeight: 60 });
    expect(tall.height).toBe("100px");
    expect(short.height).toBe("60px");
    expect(parseInt(short.height, 10)).toBeLessThan(parseInt(tall.height, 10));
  });
});
