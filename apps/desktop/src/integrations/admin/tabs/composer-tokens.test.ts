import { describe, expect, it } from "vitest";
import { contextWindowForModel, estimateTokens } from "../../ai/composer-tokens";

describe("estimateTokens", () => {
  it("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("4 characters returns 1 (ceil n/4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("ceil division for partial groups", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("abcdefghi")).toBe(3);
  });
});

describe("contextWindowForModel", () => {
  it("detects 32k models", () => {
    expect(contextWindowForModel("foo-32k-bar")).toBe(32000);
    expect(contextWindowForModel("MODEL-32K")).toBe(32000);
  });

  it("detects 64k models", () => {
    expect(contextWindowForModel("foo-64k-bar")).toBe(64000);
  });

  it("detects 128k models", () => {
    expect(contextWindowForModel("foo-128k-bar")).toBe(128000);
  });

  it("gpt-4o, claude, deepseek default to 128000", () => {
    expect(contextWindowForModel("gpt-4o")).toBe(128000);
    expect(contextWindowForModel("claude-3-opus")).toBe(128000);
    expect(contextWindowForModel("deepseek-chat")).toBe(128000);
  });

  it("unknown model defaults to 128000", () => {
    expect(contextWindowForModel("some-random-model")).toBe(128000);
  });
});
