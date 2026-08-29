import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps");

describe("Finance sidecar lifecycle entrypoints", () => {
  it("Panel shell main does not invoke ensure_ledger_sidecar", () => {
    const shellMain = readFileSync(resolve(appsDir, "shell/main.ts"), "utf8");
    expect(shellMain).not.toMatch(/ensure_ledger_sidecar/);
  });

  it("Insight admin main invokes ensure_ledger_sidecar in Tauri", () => {
    const adminMain = readFileSync(resolve(appsDir, "admin/main.ts"), "utf8");
    expect(adminMain).toMatch(/ensure_ledger_sidecar/);
    expect(adminMain).toMatch(/isTauri\(\)/);
  });
});
