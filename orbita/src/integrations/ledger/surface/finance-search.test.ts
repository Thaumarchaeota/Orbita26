import { describe, expect, it } from "vitest";
import { CARD_DETAIL_FIXTURES } from "./fixtures";
import {
  buildFinanceSearchIndex,
  collectFinanceSearchCompletions,
  normalizeFinanceSearchText,
  queryFinanceSearch,
  stepFinanceSearchMatch,
} from "./finance-search";

describe("finance search index", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeFinanceSearchText("  Hello\tWorld  ")).toBe("hello world");
  });

  it("matches payee within filtered items only", () => {
    const items = CARD_DETAIL_FIXTURES.slice(0, 4);
    const index = buildFinanceSearchIndex(items);
    const hits = queryFinanceSearch(index, items, "盒马", "payee-remark").hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("txn_fixture_20260809_01");
    expect(hits[0]?.fields.has("payee")).toBe(true);
  });

  it("matches account scope independently", () => {
    const items = CARD_DETAIL_FIXTURES;
    const index = buildFinanceSearchIndex(items);
    const hits = queryFinanceSearch(index, items, "assets:cash", "account").hits;
    expect(hits.some((hit) => hit.id === "txn_fixture_20260809_03")).toBe(true);
  });

  it("matches tag scope case-insensitively", () => {
    const items = CARD_DETAIL_FIXTURES;
    const index = buildFinanceSearchIndex(items);
    const hits = queryFinanceSearch(index, items, "餐饮", "tag").hits;
    expect(hits.length).toBeGreaterThan(0);
  });

  it("matches amount tokens without changing item order", () => {
    const items = CARD_DETAIL_FIXTURES;
    const index = buildFinanceSearchIndex(items);
    const hits = queryFinanceSearch(index, items, "128.5", "amount").hits;
    expect(hits.some((hit) => hit.id === "txn_fixture_20260809_01")).toBe(true);
    expect(hits.map((hit) => hit.id)).not.toEqual(items.map((item) => item.id));
  });

  it("returns empty for blank query", () => {
    const items = CARD_DETAIL_FIXTURES;
    const index = buildFinanceSearchIndex(items);
    expect(queryFinanceSearch(index, items, "   ", "all").hits).toEqual([]);
  });

  it("limits completions to six unique values", () => {
    const items = CARD_DETAIL_FIXTURES;
    const index = buildFinanceSearchIndex(items);
    const completions = collectFinanceSearchCompletions(index, "e", "all", 6);
    expect(completions.length).toBeLessThanOrEqual(6);
    expect(new Set(completions.map(normalizeFinanceSearchText)).size).toBe(completions.length);
  });
});

describe("finance search navigation", () => {
  it("steps forward and backward with wrap-around", () => {
    expect(stepFinanceSearchMatch(-1, 3, 1)).toBe(0);
    expect(stepFinanceSearchMatch(0, 3, 1)).toBe(1);
    expect(stepFinanceSearchMatch(0, 3, -1)).toBe(2);
    expect(stepFinanceSearchMatch(2, 3, 1)).toBe(0);
  });

  it("returns -1 when there are no hits", () => {
    expect(stepFinanceSearchMatch(-1, 0, 1)).toBe(-1);
  });
});
