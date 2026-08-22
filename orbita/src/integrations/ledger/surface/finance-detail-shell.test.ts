import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { mountFinanceDetailShell } from "./finance-detail-shell";

const surfaceDir = dirname(fileURLToPath(import.meta.url));
const ledgerCssPath = resolve(surfaceDir, "../ui/ledger.css");
const adminCssPath = resolve(surfaceDir, "../../../ui/admin-shell.css");

describe("finance detail shell layout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  });

  it("places topbar as stage sibling spanning main and rail", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
      renderFilter: () => {},
      renderBody: () => {},
      renderRail: () => {},
    });

    const root = host.querySelector<HTMLElement>('[data-role="finance-detail-root"]')!;
    const topbar = host.querySelector<HTMLElement>('[data-role="finance-detail-topbar"]')!;
    const stage = host.querySelector<HTMLElement>('[data-role="finance-detail-stage"]')!;
    expect(root.firstElementChild).toBe(topbar);
    expect(root.children[1]).toBe(stage);
    expect(stage.contains(host.querySelector('[data-role="finance-detail-rail"]'))).toBe(true);
    expect(stage.contains(host.querySelector('[data-role="finance-detail-page-main"]'))).toBe(true);
    shell.dispose();
  });

  it("keeps inline filters on desktop without filter toggle", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
      renderFilter: () => {},
      renderBody: () => {},
      renderRail: () => {},
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-role="finance-detail-filter-toggle"]')!;
    const inlineFilters = host.querySelector('[data-role="finance-detail-topbar-filters"]');
    expect(inlineFilters?.querySelector('[data-detail-filter-from-mount]')).toBeTruthy();
    expect(toggle.hidden).toBe(true);
    shell.dispose();
  });

  it("shows filter toggle on narrow width without clearing filter state", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
      renderFilter: (el) => {
        el.querySelector<HTMLButtonElement>('[data-role="detail-filter-clear"]')!.hidden = false;
      },
      renderBody: () => {},
      renderRail: () => {},
    });

    const root = host.querySelector<HTMLElement>('[data-role="finance-detail-root"]')!;
    expect(root.classList.contains("is-filter-narrow")).toBe(true);
    const toggle = host.querySelector<HTMLButtonElement>('[data-role="finance-detail-filter-toggle"]')!;
    expect(toggle.hidden).toBe(false);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[data-detail-filter-from-mount]')).toBeTruthy();
    shell.dispose();
  });

  it("exposes layout flip frame with stable width target", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
      renderFilter: () => {},
      renderBody: () => {},
      renderRail: () => {},
    });

    const flip = host.querySelector<HTMLElement>("[data-layout-flip]")!;
    expect(flip.classList.contains("finance-detail-flip-frame")).toBe(true);
    shell.dispose();
  });
});

describe("shell motion css guards", () => {
  it("ledger.css does not transition desktop rail grid columns", () => {
    const css = readFileSync(ledgerCssPath, "utf8");
    const block =
      css.match(
        /\.ledger-page\.has-rail:not\(\.is-narrow\) \.ledger-page-stage\s*\{[^}]+\}/s,
      )?.[0] ?? "";
    expect(block).not.toMatch(/transition:\s*--ledger-rail-col/);
    expect(block).not.toMatch(/transition:[^;]*gap/);
  });

  it("admin-shell.css does not transition sidebar width", () => {
    const css = readFileSync(adminCssPath, "utf8");
    const block = css.match(/\.admin-sidebar\s*\{[^}]+\}/s)?.[0] ?? "";
    expect(block).not.toMatch(/transition:\s*width/);
  });

  it("finance-chrome.css hides filter toggle until narrow breakpoint", () => {
    const chromeCssPath = resolve(surfaceDir, "../ui/finance-chrome.css");
    const css = readFileSync(chromeCssPath, "utf8");
    expect(css).toMatch(
      /\.ledger-page\.is-finance-detail \.finance-topbar-filter-toggle\s*\{[^}]*display:\s*none/,
    );
    expect(css).toMatch(
      /\.ledger-page\.is-finance-detail\.is-filter-narrow \.finance-topbar-filter-toggle\s*\{[^}]*display:\s*inline-flex/,
    );
  });
});
