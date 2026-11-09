import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
  await page.route('**/__travel-new-draft-qa',route=>route.fulfill({
    contentType:'text/html; charset=utf-8',
    body:`<!doctype html><meta charset="utf-8"><button id="new">新建出行</button><button id="ordinary">普通Item详情</button><aside id="detail"></aside>
    <script type="module">
    import { mountTravelRail } from '/src/integrations/admin/tabs/task/travel/rail.ts';
    window.writes=0;window.started=false;
    const state={currentSnapshot:null,saveState:'clean',queryGeneration:1,expectedDataDir:'isolated-fixture'};
    window.rail=mountTravelRail({host:document.querySelector('#detail'),getZone:()=>({baseOffset:'+00:00',replacements:[]}),getEditing:()=>false,
      controller:{getState:()=>state,setEditingSelection:()=>window.rail?.refresh(),getDraft:()=>undefined,abandonDrafts:()=>{}},
      onCreateFirstContent:async()=>{window.writes++;},onError:message=>{throw Error(message);}});
    document.querySelector('#new').onclick=async()=>{window.started=false;window.started=await window.rail.beginNewTripDraft();};
    document.querySelector('#ordinary').onclick=()=>{document.querySelector('#detail').innerHTML='<p>普通Item详情</p>';};
    window.ready=true;
    </script>`,
  }));
  await page.goto('http://127.0.0.1:1420/__travel-new-draft-qa');
  await page.waitForFunction(()=>window.ready===true);
  // Ordinary Item rendering replaces the same cached rail's host contents.
  for(let round=0;round<3;round++) {
    await page.locator('#ordinary').click();
    await page.locator('#new').click();
    await page.waitForFunction(()=>window.started===true);
    const text=await page.locator('#detail').textContent();
    for(const label of ['添加航班','添加火车','添加行程','添加检查点']) assert.ok(text.includes(label),`round ${round}: ${label} must be visible in the host`);
  }
  assert.equal(await page.evaluate(()=>window.writes),0,'opening a draft must not persist anything');
  assert.deepEqual(errors,[]);
  console.log('PASS: ordinary Item replaces host → new travel draft reappears, repeated 3 times; no writes.');
} finally {await browser.close();}
