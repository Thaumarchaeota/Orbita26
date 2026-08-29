import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDetailItemCard } from "./render-cards";
import { CARD_DETAIL_FIXTURES } from "./fixtures";
import type { Entry } from "../types";

const surfaceDir = dirname(fileURLToPath(import.meta.url));

const STYLE_FILES = [
  "card-detail-surface.css",
  "composer-shell.css",
  "finance-rail-audit.css",
  "finance-rail.css",
];

describe("CardDetail surface style guard", () => {
  for (const file of STYLE_FILES) {
    it(`${file} does not hardcode font-family`, () => {
      const css = readFileSync(join(surfaceDir, file), "utf8");
      expect(css).not.toMatch(/font-family\s*:/i);
    });
  }

  it("card-detail-surface.css uses full-width gutter, not centered max-width track", () => {
    const css = readFileSync(join(surfaceDir, "card-detail-surface.css"), "utf8");
    expect(css).not.toMatch(/720px/);
    expect(css).not.toMatch(/cds-card-max-width/);
    expect(css).not.toMatch(/margin:\s*0\s+auto/);
  });

  it("card-detail-surface.css uses stripe CSS variables only", () => {
    const css = readFileSync(join(surfaceDir, "card-detail-surface.css"), "utf8");
    const stripeBlock = css.match(/\.cds-card\.cds-stripe-expense[\s\S]*?border-left-color:[^;]+;/g)?.join("\n") ?? "";
    expect(stripeBlock).toMatch(/var\(--cds-stripe-expense\)/);
    expect(css).not.toMatch(/\.cds-card\.cds-stripe-expense[^}]*#[0-9a-f]{3,8}/i);
  });

  it("card-detail-surface.css disables browser scroll anchoring on cds-scroll", () => {
    const css = readFileSync(join(surfaceDir, "card-detail-surface.css"), "utf8");
    expect(css).toMatch(/\.cds-scroll[^}]*overflow-anchor:\s*none/);
  });

  it("card-detail-surface.css uses shared txn grid with time column and container narrow layout", () => {
    const css = readFileSync(join(surfaceDir, "card-detail-surface.css"), "utf8");
    expect(css).toMatch(/container-name:\s*cds-detail/);
    expect(css).toMatch(/@container cds-detail/);
    expect(css).not.toMatch(/5\.5em/);
    expect(css).not.toMatch(/minmax\(11ch,\s*14ch\)/);
    const txnGrid = css.match(/\.cds-txn-card \.cds-card-identity\s*\{[^}]+\}/s)?.[0] ?? "";
    expect(txnGrid).toMatch(/minmax\(5\.5ch,\s*7ch\)/);
    expect(txnGrid).toMatch(/1\.25fr/);
    expect(css).toMatch(/\.cds-txn-card \.cds-field-time[^}]*grid-column:\s*1/);
    expect(css).toMatch(/\.cds-txn-card \.cds-field-remark[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.cds-txn-card \.cds-field-payee[^}]*grid-column:\s*3/);
    const narrowBlock =
      css.match(/@container cds-detail \(max-width: 520px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(narrowBlock).toMatch(/grid-template-rows:\s*auto auto/);
    expect(narrowBlock).toMatch(/\.cds-txn-card \.cds-field-payee[^}]*grid-row:\s*2/);
    expect(narrowBlock).toMatch(/\.cds-txn-card \.cds-inline-tags[^}]*grid-row:\s*2/);
  });
});

describe("Finance detail chrome contract", () => {
  it("finance-chrome.css keeps continuous shell without separate filter card", () => {
    const chromePath = join(surfaceDir, "..", "ui", "finance-chrome.css");
    const css = readFileSync(chromePath, "utf8");
    expect(css).toMatch(/\.finance-topbar-filters/);
    expect(css).toMatch(/position:\s*sticky/);
    const filterInnerBlock = css.match(/\.finance-chrome-filter-inner\s*\{[^}]+\}/s)?.[0] ?? "";
    expect(filterInnerBlock).not.toMatch(/border-radius/);
    expect(css).not.toMatch(/\.finance-chrome-body[^}]*margin-top:\s*8px/);
  });

  it("finance-chrome.css uses only named finance layer vars for z-index", () => {
    const chromePath = join(surfaceDir, "..", "ui", "finance-chrome.css");
    const css = readFileSync(chromePath, "utf8");
    expect(css).not.toMatch(/z-index:\s*\d/);
    expect(css).toMatch(/z-index:\s*var\(--finance-layer-chrome\)/);
    expect(css).not.toMatch(/isolation:\s*isolate/);
  });
});

describe("CardDetail ledger editor layout", () => {
  it("fixtures are committed-shaped with at least 20 transactions", () => {
    const txns = CARD_DETAIL_FIXTURES.filter((item) => item.kind === "transaction");
    expect(txns.length).toBeGreaterThanOrEqual(20);
  });

  it("renders identity row with inline tags and no type pill", () => {
    const txn = CARD_DETAIL_FIXTURES.find((item) => item.id === "txn_fixture_20260809_01")!;
    const wrap = renderDetailItemCard(txn);
    expect(wrap.querySelector('[data-role="txn-date"]')).toBeFalsy();
    expect(wrap.querySelector('[data-role="txn-flag"]')).toBeFalsy();
    expect(wrap.querySelector('[data-role="txn-time"]')).toBeTruthy();
    expect(wrap.querySelector('[data-role="txn-payee"]')).toBeTruthy();
    expect(wrap.querySelector('[data-role="txn-remark"]')).toBeTruthy();
    const identity = wrap.querySelector('[data-role="txn-identity"]')!;
    const roles = [...identity.children].map((el) => el.getAttribute("data-role"));
    expect(roles).toEqual([
      "txn-time",
      "txn-remark",
      "txn-payee",
      "txn-tags",
      "delete-btn",
    ]);
    expect(wrap.querySelector('[data-role="txn-type"]')).toBeNull();
    expect(wrap.querySelector('[data-role="txn-balance"]')).toBeNull();
    expect(wrap.querySelector('[data-role="delete-btn"]')).toBeTruthy();
    expect(wrap.querySelector('[data-role="txn-tags"]')).toBeTruthy();
    expect(wrap.querySelector('[data-role="tag-overflow"]')?.textContent).toBe("+2");
    const posting = wrap.querySelector('[data-role="posting"]')!;
    expect(posting.querySelector('[data-role="posting-account"]')).toBeTruthy();
    expect(posting.querySelector('[data-role="posting-amount"]')).toBeTruthy();
    expect(posting.querySelector('[data-role="posting-currency"]')).toBeTruthy();
    expect(posting.querySelector('[data-role="posting-cost"]')).toBeTruthy();
  });

  it("does not mark temporarily unbalanced postings as field errors", () => {
    const txn: Entry = {
      kind: "transaction",
      id: "txn_test_unbalanced",
      source_file: "ledger/2026.bean",
      source_line: 0,
      type: "expense",
      date: "2026-08-09",
      flag: "*",
      payee: "测试",
      remark: "编辑中未配平",
      tags: "",
      seq: "z9",
      postings: [
        { account: "Expenses:Food", amount: 10, currency: "CNY" },
        { account: "Assets:Cash", amount: -9, currency: "CNY" },
      ],
    };
    const wrap = renderDetailItemCard(txn);
    expect(wrap.querySelector(".cds-posting-amount.is-err")).toBeFalsy();
    expect(wrap.querySelector('[data-role="posting-error"]')).toBeFalsy();
  });

  it("renders pad and balance as single-line cards", () => {
    const pad = CARD_DETAIL_FIXTURES.find((item) => item.kind === "pad")!;
    const balance = CARD_DETAIL_FIXTURES.find((item) => item.id === "balance_fixture_20260807")!;
    const padWrap = renderDetailItemCard(pad);
    const balanceWrap = renderDetailItemCard(balance);
    expect(padWrap.classList.contains("is-readonly")).toBe(true);
    expect(balanceWrap.classList.contains("is-readonly")).toBe(true);
    expect(padWrap.querySelector('[data-role="pad-postings"]')).toBeNull();
    expect(balanceWrap.querySelector('[data-role="balance-postings"]')).toBeNull();
    expect(padWrap.querySelector('[data-role="pad-source"]')).toBeTruthy();
    expect(balanceWrap.querySelector('[data-role="balance-amount"]')).toBeTruthy();
  });

  it("marks empty identity fields with empty slot chrome", () => {
    const txn = CARD_DETAIL_FIXTURES.find((item) => item.id === "txn_fixture_20260808_02")!;
    const wrap = renderDetailItemCard(txn);
    const payee = wrap.querySelector('[data-role="txn-payee"]')!;
    expect(payee.classList.contains("is-ghost")).toBe(true);
    expect(wrap.querySelector('[data-role="txn-tags"]')!.classList.contains("is-ghost")).toBe(true);
  });
});
