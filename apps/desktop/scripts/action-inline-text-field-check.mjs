import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Mount the actual Item detail renderer; only domain data and saves are fake.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__action-inline-qa', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html data-insight-theme="cold"><head><meta charset="utf-8">
      <link rel="stylesheet" href="/src/ui/theme-base.css">
      <link rel="stylesheet" href="/src/ui/admin-shell.css">
      <link rel="stylesheet" href="/src/integrations/admin/timeline/timeline.css">
      <link rel="stylesheet" href="/src/integrations/admin/tabs/task/task.css">
      </head><body><div class="insight-task-page"><aside class="arrangement-detail-rail" id="detail" style="width:520px;margin:20px"></aside></div>
      <button id="outside" type="button">外部焦点</button><script type="module">
      import { mountArrangementDetail } from '/src/integrations/admin/tabs/task/arrangement-detail.ts';
      const createdAtUtc = '2026-10-27T01:00:00.000Z';
      window.saves = []; window.saveFails = false;
      const item = {id:'item-a',revision:1,title:'周小组会',status:'进行中',priority:'none',tagIds:[],createdAtUtc,updatedAtUtc:createdAtUtc};
      window.action = {id:'action-a',revision:1,title:'准备材料',nameLinkMode:'unlinked',targetKind:'item',targetId:'item-a',
        plannedStartAt:null,plannedEndAt:null,sessionId:'session-a',ended:false,executionState:'未开始',intervals:[],createdAtUtc,updatedAtUtc:createdAtUtc};
      window.target = {kind:'item',id:'item-a',title:item.title,path:item.title,color:'#000000',available:true,archived:false};
      window.selection = {kind:'item',id:'item-a'};
      window.data = {actions:[window.action],checkpoints:[],sessions:[{id:'session-a',title:'工作时间',plannedStartAt:'2026-10-27T01:00:00.000Z',plannedEndAt:'2026-10-27T02:00:00.000Z',revision:1,createdAtUtc,updatedAtUtc:createdAtUtc}],items:[item],projects:[],lists:[],itemTypes:[],tags:[],
        zone:{baseOffset:'+00:00',replacements:[]},targets:new Map([['item:item-a',window.target]])};
      const noop = async () => {};
      window.detail = mountArrangementDetail({host:document.querySelector('#detail'),getData:()=>window.data,
        getSelection:()=>window.selection,week:()=>false,onSelect:()=>{},
        onSaveAction:async(id,field,value)=>{window.saves.push({id,field,value});if(window.saveFails)throw Error('isolated save failure');if(field==='title')window.action.title=value;},
        onSaveSession:noop,onSaveItem:noop,onSaveThingChoice:noop,onExecute:noop,onDelete:noop,onCreateAction:noop,onLifecycle:noop,
        onError:message=>{window.lastError=message;}});
      window.ready = true;
      </script></body></html>`,
  }));
  await page.goto('http://127.0.0.1:1420/__action-inline-qa');
  await page.waitForFunction(() => window.ready === true, null, { timeout: 10000 }).catch((error) => {
    throw Error(`${error.message}; page errors: ${errors.join('; ')}`);
  });
  const host = page.locator('[data-action-title-host="action-a"]');
  const display = host.locator('.orbita-inline-text-field__display');
  const input = host.locator('.orbita-inline-text-field__input');
  await display.waitFor({ timeout: 5000 });
  const style = await display.evaluate((node) => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    return {fontSize:css.fontSize,border:css.borderTopWidth,padding:css.padding,cursor:css.cursor,width:box.width,height:box.height};
  });
  assert.equal(style.fontSize, '14px');
  assert.equal(style.border, '0px');
  assert.equal(style.padding, '0px');
  assert.equal(style.cursor, 'text');
  const linkGap = await page.locator('[data-link="action-a"]').evaluate((node) => {
    const text = node.previousElementSibling.querySelector('.orbita-inline-text-field__display');
    const range = document.createRange();range.selectNodeContents(text);
    return node.getBoundingClientRect().left - range.getBoundingClientRect().right;
  });
  assert.ok(linkGap <= 8, 'link control must stay next to the name');
  await display.click();
  assert.equal(await input.getAttribute('maxlength'), '12');
  const editorStyle = await input.evaluate((node) => {
    const css=getComputedStyle(node),box=node.getBoundingClientRect();
    return {fontSize:css.fontSize,width:box.width,height:box.height,border:css.borderTopWidth};
  });
  assert.equal(editorStyle.fontSize, style.fontSize);
  assert.equal(editorStyle.border, '0px');
  assert.ok(Math.abs(editorStyle.width-style.width)<=1, 'editing the same name must not push the link control sideways');
  assert.equal(editorStyle.height, style.height);
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  assert.equal(await input.inputValue(), '');
  assert.equal(await input.getAttribute('placeholder'), '添加名称');
  await page.locator('#outside').click();
  await page.waitForFunction(() => window.saves.some((save) => save.field === 'title' && save.value === ''));
  await page.waitForFunction(() => !document.querySelector('[data-action-title-host] .orbita-inline-text-field__input'));
  assert.equal(await display.textContent(), '添加名称');
  const emptyStyle = await display.evaluate((node) => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    return {color:css.color,token:getComputedStyle(document.documentElement).getPropertyValue('--insight-text-placeholder').trim(),
      width:box.width,height:box.height};
  });
  assert.ok(emptyStyle.width > 20 && emptyStyle.height >= 18, 'empty name must retain a real clickable area');
  assert.notEqual(emptyStyle.color, await host.evaluate((node) => getComputedStyle(node).color), 'placeholder must be visually distinct');
  await display.click();
  assert.equal(await input.inputValue(), '');
  await input.fill('重新命名');
  await input.press('Enter');
  await page.waitForFunction(() => window.action.title === '重新命名');
  await page.waitForTimeout(30);
  assert.equal(await display.textContent(), '重新命名');
  assert.equal(await page.locator('[data-link="action-a"]').count(), 1);
  // Failed empty saves must keep the draft editable rather than restore stale text.
  await page.evaluate(() => { window.saveFails = true; });
  await display.click();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await page.locator('#outside').click();
  await page.waitForFunction(() => window.lastError);
  await page.waitForTimeout(30);
  assert.equal(await display.textContent(), '添加名称');
  await display.click();
  assert.equal(await input.inputValue(), '');
  await input.press('Escape');
  await page.evaluate(() => { window.target.archived=true;window.detail.render(); });
  assert.equal(await display.isDisabled(), true);
  assert.equal(await display.textContent(), '');
  const screenshot = join(tmpdir(), 'orbita-action-inline-field.png');
  await page.evaluate(() => { window.target.archived=false;window.detail.render(); });
  await page.screenshot({ path:screenshot });
  await page.evaluate(() => { window.selection={kind:'session',id:'session-a'};window.detail.render(); });
  await display.waitFor({ timeout: 3000 });
  assert.equal(await display.textContent(), '添加名称');
  await display.click();
  assert.equal(await input.inputValue(), '');
  await input.press('Escape');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({screenshot,style,emptyStyle},null,2));
  console.log('PASS: real Item Action renderer, shared field, Backspace-to-empty, gray clickable placeholder, save/retry, readonly, and link control.');
} finally {
  await browser.close();
}
