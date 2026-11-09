import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultUiPrefs, readSettings } from "../../core/data/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../..");
const UI_SRC = resolve(SRC, "ui");
const DATA_SRC = resolve(SRC, "core/data");
const PALETTE_KEYS = [
  "primary", "selected", "hover", "chrome", "sidebar", "page", "surface",
  "controlSurface", "sunken", "textPrimary", "textSecondary", "border", "danger",
] as const;
const CSS_VARS = {
  primary: "--insight-primary", selected: "--insight-selected-bg", hover: "--insight-hover-bg",
  chrome: "--insight-chrome-bg", sidebar: "--insight-sidebar-bg", page: "--insight-page-bg",
  surface: "--insight-surface-bg", controlSurface: "--insight-control-surface-bg",
  sunken: "--insight-sunken-bg", textPrimary: "--insight-text-primary",
  textSecondary: "--insight-text-secondary", border: "--insight-border-color", danger: "--insight-danger",
} as const;
const DERIVED_VARS = [
  "--insight-primary-hover", "--insight-text-placeholder", "--insight-text-disabled",
  "--insight-focus-ring", "--insight-danger-bg", "--insight-danger-surface",
  "--insight-titlebar", "--insight-tab-strip-bg", "--insight-sidebar",
  "--insight-content-bg", "--insight-tab-active-bg", "--insight-chat-list-bg",
  "--insight-card-bg", "--insight-composer-bg", "--insight-surface-subtle",
  "--insight-border-subtle", "--insight-tab-hover-bg", "--insight-nav-hover",
  "--insight-nav-active", "--insight-list-selected", "--insight-icon-default",
  "--insight-icon-active", "--insight-user-bubble", "--insight-md-code",
  "--insight-md-inline-code", "--insight-md-table-head", "--insight-md-table-border",
  "--insight-input-border",
] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function themeBlock(css: string, theme: "cold" | "warm" | "blue"): string {
  const start = css.indexOf("html[data-insight-theme=\"" + theme + "\"]");
  expect(start, theme + " theme block").toBeGreaterThanOrEqual(0);
  const bodyStart = css.indexOf("{", start);
  const bodyEnd = css.indexOf("}", bodyStart);
  expect(bodyEnd, theme + " theme block close").toBeGreaterThan(bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

describe("Insight single appearance contract", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps legacy insightStyle readable but omits it from the new model and serialization", async () => {
    const dataDir = "D:/insight-style-legacy";
    localStorage.setItem("orbita.data.bootstrap", JSON.stringify({ dataDir }));
    localStorage.setItem(
      "orbita.data.stores." + dataDir + ".settings.json",
      JSON.stringify({ version: 7, dataDir, ui: { insightStyle: "rounded", insightTheme: "cold" } }),
    );
    const loaded = await readSettings();
    expect(loaded.ui).not.toHaveProperty("insightStyle");
    expect(JSON.stringify(loaded)).not.toContain("insightStyle");
    expect(defaultUiPrefs()).not.toHaveProperty("insightStyle");
  });

  it("defines all thirteen base colors and shared derived aliases for every theme", () => {
    const css = read(resolve(UI_SRC, "insight-themes.css"));
    for (const theme of ["cold", "warm", "blue"] as const) {
      const block = themeBlock(css, theme);
      for (const key of PALETTE_KEYS) {
        expect(block, theme + " " + key).toMatch(new RegExp(CSS_VARS[key] + "\\s*:"));
      }
      for (const variable of DERIVED_VARS) {
        expect(css, theme + " " + variable).toMatch(new RegExp(variable + "\\s*:"));
      }
    }
  });

  it("derives semantic aliases without missing references or Insight variable cycles", () => {
    const css = read(resolve(UI_SRC, "insight-themes.css"));
    const declarations = [...css.matchAll(/(--insight-[\w-]+)\s*:\s*([^;]+);/g)];
    const graph = new Map<string, Set<string>>();
    for (const [, name, value] of declarations) {
      const refs = new Set((value.match(/var\((--insight-[\w-]+)/g) ?? []).map((ref) => ref.slice(4)));
      graph.set(name, new Set([...(graph.get(name) ?? []), ...refs]));
    }
    for (const [, refs] of graph) {
      for (const ref of refs) expect(graph.has(ref), "missing " + ref).toBe(true);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (name: string): void => {
      if (visiting.has(name)) throw new Error("Insight CSS variable cycle at " + name);
      if (visited.has(name)) return;
      visiting.add(name);
      for (const ref of graph.get(name) ?? []) visit(ref);
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of graph.keys()) visit(name);
  });

  it("keeps the current 232px rail default without style selection", () => {
    const source = read(resolve(HERE, "shell-geometry.ts"));
    expect(source).toMatch(/(?:themeRailDefaultWidth\(\)|RAIL_DEFAULT_WIDTH)[\s\S]{0,120}232/);
    expect(source).not.toContain("blueWhite");
    expect(source).not.toContain("rounded");
  });

  it("removes the retired style selector from shared Insight CSS and data models", () => {
    const files = [
      resolve(UI_SRC, "insight-themes.css"), resolve(UI_SRC, "admin-shell.css"),
      resolve(UI_SRC, "choice-control.css"), resolve(DATA_SRC, "types.ts"), resolve(DATA_SRC, "defaults.ts"),
    ];
    for (const file of files) expect(read(file), file).not.toContain("insightStyle");
    for (const file of [
      "insight-themes.css", "admin-shell.css", "choice-control.css",
      "insight-menu-adapter.css", "insight-forms-adapter.css", "insight-domain-adapter.css",
    ]) {
      expect(read(resolve(UI_SRC, file)), file).not.toContain("data-insight-style");
    }
  });
});
