import { describe, expect, it } from "vitest";
import { continueMarkdownList, handleInsightComposerKeydown } from "../../ai/composer-md-list";

function enter(
  value: string,
  cursor: number,
  overrides: Partial<Parameters<typeof handleInsightComposerKeydown>[0]> = {},
) {
  return handleInsightComposerKeydown({
    key: "Enter",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    value,
    cursor,
    ...overrides,
  });
}

describe("handleInsightComposerKeydown", () => {
  it("plain text Enter submits without changing value", () => {
    const value = "hello world";
    const result = enter(value, value.length);
    expect(result).toEqual({ preventDefault: true, submit: true });
    expect(result.value).toBeUndefined();
    expect(result.cursor).toBeUndefined();
  });

  it("Shift+Enter on plain text inserts newline at cursor without submit", () => {
    const value = "hello world";
    const cursor = 5;
    const result = enter(value, cursor, { shiftKey: true });
    expect(result).toEqual({
      preventDefault: true,
      value: "hello\n world",
      cursor: 6,
    });
    expect(result.submit).toBeUndefined();
  });

  it("isComposing true does not preventDefault or submit", () => {
    const value = "hello";
    const result = enter(value, value.length, { isComposing: true });
    expect(result).toEqual({ preventDefault: false });
    expect(result.submit).toBeUndefined();
    expect(result.value).toBeUndefined();
  });

  it("keyCode 229 does not preventDefault or submit", () => {
    const value = "- foo";
    const result = enter(value, value.length, { keyCode: 229 });
    expect(result).toEqual({ preventDefault: false });
    expect(result.submit).toBeUndefined();
    expect(result.value).toBeUndefined();
  });

  it("unordered list Enter at line end continues marker without submit", () => {
    const value = "- foo";
    const cursor = value.length;
    expect(continueMarkdownList(value, cursor)).toEqual({
      kind: "continue",
      next: "- foo\n- ",
      cursor: 8,
    });
    expect(enter(value, cursor)).toEqual({
      preventDefault: true,
      value: "- foo\n- ",
      cursor: 8,
    });
    expect(enter(value, cursor).submit).toBeUndefined();
  });

  it("ordered dot list Enter increments number", () => {
    const one = "1. foo";
    expect(enter(one, one.length)).toEqual({
      preventDefault: true,
      value: "1. foo\n2. ",
      cursor: 10,
    });

    const two = "2. bar";
    expect(enter(two, two.length)).toEqual({
      preventDefault: true,
      value: "2. bar\n3. ",
      cursor: 10,
    });
  });

  it("ordered paren list Enter increments with same punct", () => {
    const value = "1) foo";
    expect(enter(value, value.length)).toEqual({
      preventDefault: true,
      value: "1) foo\n2) ",
      cursor: 10,
    });
  });

  it("star and plus markers continue with same marker", () => {
    const star = "* foo";
    expect(enter(star, star.length)).toEqual({
      preventDefault: true,
      value: "* foo\n* ",
      cursor: 8,
    });

    const plus = "+ foo";
    expect(enter(plus, plus.length)).toEqual({
      preventDefault: true,
      value: "+ foo\n+ ",
      cursor: 8,
    });
  });

  it("empty unordered list item Enter breaks list without submit", () => {
    const value = "- ";
    expect(continueMarkdownList(value, value.length)).toEqual({
      kind: "break",
      next: "",
      cursor: 0,
    });
    expect(enter(value, value.length)).toEqual({
      preventDefault: true,
      value: "",
      cursor: 0,
    });
    expect(enter(value, value.length).submit).toBeUndefined();
  });

  it("empty ordered list item Enter breaks list without submit", () => {
    const value = "1. ";
    expect(continueMarkdownList(value, value.length)).toEqual({
      kind: "break",
      next: "",
      cursor: 0,
    });
    expect(enter(value, value.length)).toEqual({
      preventDefault: true,
      value: "",
      cursor: 0,
    });
    expect(enter(value, value.length).submit).toBeUndefined();
  });

  it("Shift+Enter on non-empty list item continues without submit", () => {
    const value = "1. foo";
    const result = enter(value, value.length, { shiftKey: true });
    expect(result).toEqual({
      preventDefault: true,
      value: "1. foo\n2. ",
      cursor: 10,
    });
    expect(result.submit).toBeUndefined();
  });

  it("list continue at mid-line cursor preserves text before cursor", () => {
    const value = "- foo bar";
    const cursor = 4;
    expect(continueMarkdownList(value, cursor)).toEqual({
      kind: "continue",
      next: "- fo\n- o bar",
      cursor: 7,
    });
    expect(enter(value, cursor)).toEqual({
      preventDefault: true,
      value: "- fo\n- o bar",
      cursor: 7,
    });
  });

  it("Escape key is not handled", () => {
    const value = "- foo";
    const result = handleInsightComposerKeydown({
      key: "Escape",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
      value,
      cursor: value.length,
    });
    expect(result).toEqual({ preventDefault: false });
  });

  it("indented list Enter preserves indent on continuation", () => {
    const value = "  - foo";
    expect(enter(value, value.length)).toEqual({
      preventDefault: true,
      value: "  - foo\n  - ",
      cursor: 12,
    });
  });
});

describe("continueMarkdownList", () => {
  it("returns none for non-list lines", () => {
    expect(continueMarkdownList("plain text", 5)).toEqual({ kind: "none" });
  });

  it("break removes empty list line in multiline value", () => {
    const value = "intro\n- ";
    const cursor = value.length;
    expect(continueMarkdownList(value, cursor)).toEqual({
      kind: "break",
      next: "intro\n",
      cursor: 6,
    });
  });
});
