import { chromium } from "playwright";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptDir, "..");

async function waitFrames(page, count = 2) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => resolve(undefined));
        }),
    );
  }
}

async function main() {
  const server = await createServer({
    root,
    server: { port: 1520, strictPort: true, host: "127.0.0.1" },
  });
  await server.listen();
  const base = server.resolvedUrls?.local?.[0] ?? "http://127.0.0.1:1520";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];

  try {
    await page.goto(`${base}/cds-harness.html`, { waitUntil: "networkidle" });
    await waitFrames(page, 4);

    const mid = await page.evaluate(() => {
      const h = window.__CDS_HARNESS__?.();
      return h ? h.scrollMid() : -1;
    });
    if (mid < 0) errors.push("harness missing");

    const syncCards = await page.evaluate(() => {
      const scroll = document.getElementById("cds-scroll");
      if (!scroll) return -1;
      scroll.scrollTop = 18000;
      scroll.dispatchEvent(new Event("scroll"));
      return scroll.querySelectorAll(".cds-card-wrap").length;
    });
    if (syncCards <= 0) errors.push(`sync scroll rendered no cards (${syncCards})`);

    const rapid = await page.evaluate(() => {
      const h = window.__CDS_HARNESS__?.();
      return h ? h.rapidScroll() : { passes: 0, cardsAfter: 0 };
    });
    if (rapid.cardsAfter <= 0) {
      errors.push(`rapid scroll left no cards (${rapid.cardsAfter})`);
    }
    if (rapid.passes < 9) errors.push(`rapid scroll passes ${rapid.passes}`);

    await waitFrames(page, 2);

    const scroll = page.locator("#cds-scroll");

    const nudges = [18, 16, -14, -10, 20, -6];
    for (const delta of nudges) {
      const before = await scroll.evaluate((el) => el.scrollTop);
      const target = before + delta;
      await scroll.evaluate((el, t) => {
        el.scrollTop = t;
        el.dispatchEvent(new Event("scroll"));
      }, target);
      await waitFrames(page, 2);
      const after = await scroll.evaluate((el) => el.scrollTop);
      if (after !== target) {
        errors.push(`scrollTop rewrite: wanted ${target}, got ${after}`);
      }
    }

    const maxScroll = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight);
    if (await scroll.evaluate((el) => el.scrollTop) > maxScroll - 4) {
      errors.push("scroll jumped to document end");
    }
    if (await scroll.evaluate((el) => el.scrollTop) < 20) {
      errors.push("scroll jumped to document start");
    }

    const box = await scroll.boundingBox();
    if (box) {
      const thumbX = box.x + box.width - 4;
      const startY = box.y + box.height * 0.42;
      await page.mouse.move(thumbX, startY);
      await page.mouse.down();
      for (let step = 1; step <= 8; step++) {
        const before = await scroll.evaluate((el) => el.scrollTop);
        await page.mouse.move(thumbX, startY + step * 18, { steps: 4 });
        await waitFrames(page, 2);
        const after = await scroll.evaluate((el) => el.scrollTop);
        const delta = after - before;
        if (Math.abs(delta) > 180) {
          errors.push(`thumb drag jump step ${step}: delta ${delta}`);
        }
        if (after >= maxScroll - 2 && step < 4) {
          errors.push(`thumb drag reached end early at step ${step}`);
        }
      }
      await page.mouse.up();
    } else {
      errors.push("scroll container not visible");
    }

    await page.evaluate(() => window.__CDS_HARNESS_DISPOSE__?.());
  } finally {
    await browser.close();
    await server.close();
  }

  if (errors.length) {
    console.error("cds-scroll-chromium FAILED");
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log("cds-scroll-chromium OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
