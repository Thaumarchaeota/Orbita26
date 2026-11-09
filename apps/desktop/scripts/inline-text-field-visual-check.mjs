import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Exercise the real component with production page CSS, not CSS-free DOM mocks.
const browser = await chromium.launch({ headless: true });
const phase = process.env.INLINE_FIELD_QA_PHASE || 'after';
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 400 } });
  await page.route('**/__inline-field-qa', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html data-insight-theme="cold"><head><meta charset="utf-8">
      <link rel="stylesheet" href="/src/ui/theme-base.css">
      <link rel="stylesheet" href="/src/ui/admin-shell.css">
      <link rel="stylesheet" href="/src/integrations/admin/timeline/timeline.css">
      <link rel="stylesheet" href="/src/integrations/admin/tabs/task/task.css">
      </head><body><div class="insight-task-page">
      <aside class="arrangement-detail-rail" style="width:520px;margin:20px">
        <div class="arrangement-detail-head"><div class="arrangement-detail-title"><div data-item-title-host></div></div>
          <button type="button" id="ordinary-action">普通按钮</button></div>
        <p>实验室安排 · 工作</p><p>计划时间：未安排</p>
      </aside></div><script type="module">
      import { mountInlineTextField } from '/src/ui/inline-text-field.ts';
      window.field = mountInlineTextField({container:document.querySelector('[data-item-title-host]'),
        value:'周小组会',placeholder:'添加标题',onCommit: value => { window.saved = value; }});
      window.ready = true;
      </script></body></html>`,
  }));
  await page.goto('http://127.0.0.1:1420/__inline-field-qa');
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate(() => document.fonts.ready);
  const read = (selector) => page.locator(selector).evaluate((node) => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    return { fontSize: css.fontSize, fontWeight: css.fontWeight, lineHeight: css.lineHeight, cursor: css.cursor,
      border: css.borderTopWidth, padding: css.padding, background: css.backgroundColor,
      x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const display = '.orbita-inline-text-field__display';
  const input = '.orbita-inline-text-field__input';
  const before = await read(display);
  const screenshot = join(tmpdir(), `orbita-inline-field-${phase}.png`);
  await page.screenshot({ path: screenshot });
  await page.locator(display).click();
  const editing = await read(input);
  console.log(JSON.stringify({ phase, screenshot, display: before, editing }, null, 2));
  await page.locator(input).fill('修改后的标题');
  await page.locator(input).press('Escape');
  assert.equal(await page.locator(display).textContent(), '周小组会');
  for (const style of [before, editing]) {
    assert.equal(style.fontSize, '20px', 'title must inherit the page-title size');
    assert.equal(style.fontWeight, '600');
    assert.equal(style.border, '0px', 'inline text must not inherit ordinary button borders');
    assert.equal(style.padding, '0px');
    assert.equal(style.background, 'rgba(0, 0, 0, 0)');
  }
  for (const dimension of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(before[dimension] - editing[dimension]) <= 0.5, `${dimension} changes on edit`);
  }
  const ordinary = await read('#ordinary-action');
  assert.equal(ordinary.border, '1px', 'ordinary page buttons must retain their border');
  assert.equal(before.cursor, 'text', 'editable text must show the text cursor');
  // Obtain a real glyph boundary from the browser, then click it using the mouse.
  const clickBoundary = async (offset) => {
    const point = await page.locator(display).evaluate((node, index) => {
      const range = document.createRange();
      range.setStart(node.firstChild, index);
      range.collapse(true);
      const box = range.getBoundingClientRect();
      return { x: box.x + 0.1, y: box.y + box.height / 2 };
    }, offset);
    await page.mouse.click(point.x, point.y);
    const caret = await page.locator(input).evaluate((node) => node.selectionStart);
    assert.equal(caret, offset, `click at glyph boundary ${offset} must preserve the caret`);
    await page.locator(input).press('Escape');
  };
  for (const offset of [0, 1, 2, 4]) await clickBoundary(offset);
  await page.evaluate(() => window.field.setValue('Weekly sync'));
  for (const offset of [0, 3, 7, 11]) await clickBoundary(offset);
  await page.evaluate(() => window.field.setValue('周小组会'));
  // Chromium's legacy caretRangeFromPoint path must work too.
  await page.evaluate(() => Object.defineProperty(document, 'caretPositionFromPoint', { value: undefined, configurable: true }));
  await clickBoundary(2);
  // Keyboard activation has no pointer coordinate and starts at the end.
  await page.locator(display).focus();
  await page.locator(display).press('Enter');
  assert.equal(await page.locator(input).evaluate((node) => node.selectionStart), 4);
  await page.locator(input).press('Escape');
  // Placeholder glyphs must never produce offsets in an empty value.
  await page.evaluate(() => window.field.setValue(''));
  await clickBoundary(0);
  await page.evaluate(() => window.field.setReadOnly(true));
  assert.equal(await page.locator(display).textContent(), '');
  assert.equal((await read(display)).cursor, 'default');
  console.log('PASS: production cascade, geometry, Escape, text cursor, mouse caret boundaries, legacy caret API, keyboard and empty/read-only states.');
} finally {
  await browser.close();
}
