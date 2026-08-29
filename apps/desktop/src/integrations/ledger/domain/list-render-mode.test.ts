import { describe, expect, it } from "vitest";
import { LIST_FULL_MAX_COUNT } from "../constants";
import { resolveListRenderMode } from "./list-render-mode";

describe("resolveListRenderMode", () => {
  it("stays full through 10,000 and virtual at 10,001", () => {
    expect(resolveListRenderMode(LIST_FULL_MAX_COUNT, null)).toBe("full");
    expect(resolveListRenderMode(LIST_FULL_MAX_COUNT + 1, null)).toBe("virtual");
  });

  it("returns to full at or below 10,000 with no hysteresis", () => {
    expect(resolveListRenderMode(LIST_FULL_MAX_COUNT + 1, "virtual")).toBe("virtual");
    expect(resolveListRenderMode(LIST_FULL_MAX_COUNT, "virtual")).toBe("full");
    expect(resolveListRenderMode(5000, "virtual")).toBe("full");
  });

  it("stays full until count exceeds 10,000", () => {
    expect(resolveListRenderMode(500, "full")).toBe("full");
    expect(resolveListRenderMode(LIST_FULL_MAX_COUNT, "full")).toBe("full");
    expect(resolveListRenderMode(LIST_FULL_MAX_COUNT + 1, "full")).toBe("virtual");
  });
});
