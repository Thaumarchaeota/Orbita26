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

  it("centers clickable title with search host and no topbar filters", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
      renderBody: () => {},
      renderRail: () => {},
    });

    expect(host.querySelector('[data-role="finance-detail-topbar-filters"]')).toBeNull();
    expect(host.querySelector('[data-role="finance-detail-filter-toggle"]')).toBeNull();
    expect(host.querySelector('[data-role="finance-detail-import"]')).toBeNull();
    expect(shell.titleBtn.textContent).toBe("资产·明细");
    expect(shell.searchHost.getAttribute("data-role")).toBe("finance-search-host");
    shell.dispose();
  });

  it("exposes layout flip frame with stable width target", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
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
});
