import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { mountFinanceDetailShell } from "./finance-detail-shell";

const surfaceDir = dirname(fileURLToPath(import.meta.url));
const detailEntryPath = resolve(surfaceDir, "../views/detail/index.ts");
const detailShellPath = join(surfaceDir, "finance-detail-shell.ts");
const composerPath = join(surfaceDir, "cds-composer.ts");

const FORBIDDEN_ENTRY_IMPORTS = ["page-shell", "finance-layout", "views/import/modal", "entry-form-advanced", "entry-form-tags"];
const FORBIDDEN_SHELL_PATTERNS = [
  /\.innerHTML\s*=/,
  /insertAdjacentHTML\s*\(/,
  /getElementById\s*\(/,
  /querySelector\s*\(\s*["'`]#/,
  /querySelectorAll\s*\(\s*["'`]#/,
  /id\s*=\s*["']ledger-page-/,
  /id\s*=\s*["']save-btn/,
];

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Finance detail entry boundary", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  });

  it("detail/index.ts does not import page-shell or finance-layout", () => {
    const source = readSource(detailEntryPath);
    for (const fragment of FORBIDDEN_ENTRY_IMPORTS) {
      expect(source).not.toContain(fragment);
    }
    expect(source).toContain("finance-detail-shell");
    expect(source).toContain("card-detail-surface");
  });

  it("cds-composer.ts does not import legacy form modules", () => {
    const source = readSource(composerPath);
    for (const fragment of ["entry-form-advanced", "entry-form-tags", "views/form/"]) {
      expect(source).not.toContain(fragment);
    }
    expect(source).toContain("cds-composer-advanced");
    expect(source).toContain("cds-tag-input");
  });

  it("finance-detail-shell.ts avoids innerHTML and legacy global IDs", () => {
    const source = readSource(detailShellPath);
    for (const pattern of FORBIDDEN_SHELL_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toMatch(/data-role/);
    expect(source).toMatch(/createElement/);
  });

  it("mounts chrome, body and rail via held data-role roots", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let bodyMount: HTMLElement | null = null;
    let railMount: HTMLElement | null = null;

    const shell = mountFinanceDetailShell(host, {
      title: "资产·明细",
      onBack: () => {},
      renderBody: (el) => {
        bodyMount = el;
      },
      renderRail: (el) => {
        railMount = el;
      },
    });

    expect(host.querySelector("#ledger-page-body")).toBeNull();
    expect(host.querySelector("#save-btn")).toBeNull();
    expect(host.querySelector('[data-role="finance-detail-root"]')).toBeTruthy();
    expect(host.querySelector('[data-role="finance-detail-body"]')).toBe(bodyMount);
    expect(host.querySelector('[data-role="finance-detail-rail-mount"]')).toBe(railMount);
    expect(host.querySelector('[data-role="finance-search-host"]')).toBeTruthy();
    expect(shell.saveBtn.getAttribute("data-role")).toBe("finance-detail-save");
    shell.dispose();
  });
});
