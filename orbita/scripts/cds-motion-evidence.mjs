import { chromium } from "playwright";
import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptDir, "..");
const outDir = path.join(root, "..", "docs", "plans", "evidence", "v0.0.17-finance-ui", "phase-c");

async function waitFrames(page, count = 2) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
  }
}

async function runHarness(page) {
  await page.goto("http://127.0.0.1:1521/cds-motion-harness.html", { waitUntil: "networkidle" });
  await waitFrames(page, 2);
  return page.evaluate(async () => window.__CDS_MOTION_HARNESS__?.());
}

async function tryTauriCdp() {
  const port = Number(process.env.ORBITA_CDP_PORT || "9333");
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!res.ok) return null;
    const targets = await res.json();
    const pageTarget = targets.find(
      (t) => t.type === "page" && /admin|1420|finance|ledger/i.test(`${t.title} ${t.url}`),
    ) || targets.find((t) => t.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) return null;
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page =
      context?.pages().find((p) => /admin|finance|ledger/i.test(p.url())) ?? context?.pages()[0];
    if (!page) {
      await browser.close();
      return null;
    }
    await page.evaluate(() => {
      localStorage.setItem("orbitaCdsMotionDiag", "1");
    });
    return { browser, page, source: `tauri-cdp:${port}` };
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  let result = null;
  let source = "chromium-harness";

  const tauri = await tryTauriCdp();
  if (tauri) {
    source = tauri.source;
    try {
      result = await tauri.page.evaluate(async () => {
        if (typeof window.__CDS_MOTION_SURFACE_DIAG__ === "function") {
          const surface = await window.__CDS_MOTION_SURFACE_DIAG__();
          return {
            reducedMotion: surface.reducedMotion,
            scenarios: [
              {
                scenario: "tauri-surface-delete",
                reducedMotion: surface.reducedMotion,
                transitionDuration: surface.transitionDuration,
                events: surface.events,
                classes: surface.cardClasses,
              },
            ],
          };
        }
        if (typeof window.__CDS_MOTION_HARNESS__ === "function") {
          return window.__CDS_MOTION_HARNESS__();
        }
        return {
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          scenarios: [],
          note: "Open Insight Finance detail with localStorage.orbitaCdsMotionDiag=1",
        };
      });
      await tauri.page.screenshot({
        path: path.join(outDir, "tauri-motion-snapshot.png"),
        fullPage: true,
      });
    } finally {
      await tauri.browser.close();
    }
  }

  if (!result || !result.scenarios?.length) {
    const server = await createServer({
      root,
      server: { port: 1521, strictPort: true, host: "127.0.0.1" },
    });
    await server.listen();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      result = await runHarness(page);
      await page.screenshot({ path: path.join(outDir, "harness-motion-snapshot.png"), fullPage: true });
    } finally {
      await browser.close();
      await server.close();
    }
  }

  const report = { capturedAt: new Date().toISOString(), source, ...result };
  fs.writeFileSync(path.join(outDir, "motion-events.json"), JSON.stringify(report, null, 2));

  for (const scenario of result?.scenarios ?? []) {
    if (!scenario.classes?.includes("is-modified") && scenario.scenario === "modified-yellow") {
      errors.push("modified-yellow missing is-modified");
    }
    if (scenario.scenario === "unbalanced-red" && !scenario.events.includes("class:is-unbalanced")) {
      errors.push("unbalanced-red missing is-unbalanced");
    }
    if (scenario.scenario === "new-enter" && !scenario.classes?.includes("is-new")) {
      errors.push("new-enter missing is-new");
    }
    if (scenario.scenario === "delete-red" && !scenario.classes?.includes("is-deleted")) {
      errors.push("delete-red missing is-deleted");
    }
    if (
      !scenario.reducedMotion &&
      scenario.scenario.startsWith("delete") &&
      scenario.events.length === 0
    ) {
      errors.push(`${scenario.scenario}: no transition events while reducedMotion=false`);
    }
  }

  if (errors.length) {
    console.error("cds-motion-evidence FAILED");
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`cds-motion-evidence OK (${source}) -> ${path.join(outDir, "motion-events.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
