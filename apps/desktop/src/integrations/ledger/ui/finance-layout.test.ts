import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { FINANCE_RAIL_DRAWER_MAX_WIDTH, mountFinanceLayout } from "./finance-layout";

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "ledger.css");

describe("finance-layout grid contract", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  });

  it("mounts stage with grid class and rail as sibling of main", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountFinanceLayout(host, {
      showRail: true,
      mainHtml: `<div class="ledger-page-body" id="ledger-page-body"></div>`,
    });
    const stage = host.querySelector<HTMLElement>(".ledger-page-stage")!;
    const main = host.querySelector<HTMLElement>(".ledger-page-main")!;
    const rail = host.querySelector<HTMLElement>(".ledger-page-rail")!;
    expect(stage.classList.contains("ledger-page-grid")).toBe(true);
    expect(stage.contains(main)).toBe(true);
    expect(stage.contains(rail)).toBe(true);
    expect(main.nextElementSibling).toBe(rail);
  });

  it("ledger.css does not use absolute positioning for page rail", () => {
    const css = readFileSync(cssPath, "utf8");
    const railBlock = css.match(/\.ledger-page-rail\s*\{[^}]+\}/s)?.[0] ?? "";
    expect(railBlock).not.toMatch(/position:\s*absolute/);
    expect(railBlock).not.toMatch(/translateX/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--ledger-rail-col\)/);
    expect(css).toMatch(/@property\s+--ledger-rail-col/);
    expect(css).toMatch(/--ledger-rail-col:\s*0px/);
  });

  it("desktop rail toggle updates collapsed class", () => {
    const host = document.createElement("div");
    const toggle = document.createElement("button");
    document.body.append(host, toggle);
    const layout = mountFinanceLayout(host, {
      showRail: true,
      mainHtml: `<div class="ledger-page-body" id="ledger-page-body"></div>`,
    });
    layout.mountRailToggle(toggle, new AbortController().signal);
    const root = host.querySelector<HTMLElement>(".ledger-page")!;
    expect(root.classList.contains("is-rail-collapsed")).toBe(false);
    toggle.click();
    expect(root.classList.contains("is-rail-collapsed")).toBe(true);
    toggle.click();
    expect(root.classList.contains("is-rail-collapsed")).toBe(false);
    layout.dispose();
  });

  it("keeps ordinary page chrome out of a competing z-index stack", () => {
    const css = readFileSync(cssPath, "utf8");
    const filterBlock = css.match(/\.ledger-page-filter\s*\{[^}]+\}/s)?.[0] ?? "";
    const bodyBlock = css.match(/\.ledger-page-body\s*\{[^}]+\}/s)?.[0] ?? "";
    expect(filterBlock).not.toMatch(/z-index/);
    expect(bodyBlock).not.toMatch(/z-index/);
  });

  it("defaults the narrow composer rail to a closed drawer and closes it with Escape", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: FINANCE_RAIL_DRAWER_MAX_WIDTH,
    });
    const host = document.createElement("div");
    const toggle = document.createElement("button");
    document.body.append(host, toggle);
    const layout = mountFinanceLayout(host, {
      showRail: true,
      mainHtml: `<div class="ledger-page-body" id="ledger-page-body"></div>`,
    });
    layout.mountRailToggle(toggle, new AbortController().signal);

    const root = host.querySelector<HTMLElement>(".ledger-page")!;
    const rail = host.querySelector<HTMLElement>(".ledger-page-rail")!;
    expect(root.classList.contains("is-narrow")).toBe(true);
    expect(root.classList.contains("is-rail-drawer-open")).toBe(false);
    expect(rail.getAttribute("aria-hidden")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(root.classList.contains("is-rail-drawer-open")).toBe(true);
    expect(rail.getAttribute("aria-hidden")).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.classList.contains("is-rail-drawer-open")).toBe(false);
    expect(document.activeElement).toBe(toggle);
    layout.dispose();
  });

  it("does not keep the rail open when the viewport enters narrow mode", () => {
    const host = document.createElement("div");
    const toggle = document.createElement("button");
    document.body.append(host, toggle);
    const layout = mountFinanceLayout(host, {
      showRail: true,
      mainHtml: `<div class="ledger-page-body" id="ledger-page-body"></div>`,
    });
    layout.mountRailToggle(toggle, new AbortController().signal);
    toggle.click();

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: FINANCE_RAIL_DRAWER_MAX_WIDTH,
    });
    window.dispatchEvent(new Event("resize"));

    const root = host.querySelector<HTMLElement>(".ledger-page")!;
    expect(root.classList.contains("is-narrow")).toBe(true);
    expect(root.classList.contains("is-rail-drawer-open")).toBe(false);
    layout.dispose();
  });
});
