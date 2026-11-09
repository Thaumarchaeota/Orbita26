import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:900,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__travel-unified-qa',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html>
    <html data-insight-theme="cold"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/src/ui/theme-base.css"><link rel="stylesheet" href="/src/ui/admin-shell.css">
    <link rel="stylesheet" href="/src/integrations/admin/timeline/timeline.css"><link rel="stylesheet" href="/src/integrations/admin/tabs/task/task.css">
    </head><body><div class="insight-task-page"><aside class="arrangement-detail-rail" id="rail" style="width:520px;margin:20px"></aside></div>
    <button id="outside">外部焦点</button><script type="module">
    import { mountTravelRail } from '/src/integrations/admin/tabs/task/travel/rail.ts';
    import { loadSettings } from '/src/core/data/settings.ts';
    await loadSettings();
    const time='2026-10-28T08:00:00Z',end='2026-10-28T09:00:00Z';
    const point=(id,at,role,front,rear)=>({pointId:id,plannedAtUtc:at,attachmentKind:'action',role,
      ownerActionId:rear||front,ownerCheckpointId:null,frontActionId:front,rearActionId:rear,
      actionLabel:role==='start'?'起飞':'到达',location:role==='start'?'首都机场':'虹桥机场',note:null,
      actualFrontEndAtUtc:null,actualRearStartAtUtc:null,actualAtUtc:null});
    window.snapshot={item:{id:'trip-1',revision:1,listId:null,title:'周末出行',completed:false,status:'active',cancelled:false},
      profile:{itemId:'trip-1',schemaVersion:1,cancelledAtUtc:null,createdAtUtc:time,updatedAtUtc:time},
      actions:[{id:'action-1',revision:1,title:'航班',nameLinkMode:'unlinked',plannedStartAt:time,plannedEndAt:end,ended:false,transportationId:'transport-1',
        actual:{start:{atUtc:null},end:{atUtc:null},intervalId:null,closedStartAtUtc:null,closedEndAtUtc:null},createdAtUtc:time,updatedAtUtc:time}],
      checkpoints:[],points:[],canonicalPoints:[point('p-start',time,'start',null,'action-1'),point('p-end',end,'end','action-1',null)],
      segments:[{actionId:'action-1',transportationId:'transport-1',plannedStartAt:time,plannedEndAt:end}],
      transportations:[{id:'transport-1',itemId:'trip-1',schemaVersion:1,transportationType:'flight',name:'航班资料',note:'原备注',serviceNumber:'CA123',
        operator:null,vehicleModel:null,aircraftRegistration:null,licensePlate:null,carriage:null,seat:null,departureName:null,arrivalName:null,
        departureCode:null,arrivalCode:null,departureTerminal:null,arrivalTerminal:null,departureGate:null,arrivalGate:null,sourceSnapshot:null}],
      memberRefs:{item:{id:'trip-1',revision:1},actions:[{id:'action-1',revision:1}],checkpoints:[]},
      capabilities:{canEditStructure:true,canEditPlan:true,canEditText:true,canChangeTransportationType:true,canRecordActual:true,canFinish:true,canCancel:true,canAppend:true}};
    const drafts=new Map();window.writes=[];window.queries=0;window.editing=false;window.creates=0;window.finishes=[];
    const state={currentSnapshot:window.snapshot,saveState:'clean',queryGeneration:1,expectedDataDir:'isolated-fixture'};
    const controller={getState:()=>state,getPlanEditGeneration:()=>1,queueEditPlan:(item,payload)=>window.writes.push({item,plan:payload}),getDraft:(_id,key)=>drafts.get(key),setTextDraft:(_id,key,value)=>drafts.set(key,value),
      queueTextCommit:(item,key,build)=>window.writes.push({item,key,payload:build(drafts.get(key))}),
      setEditingSelection:()=>{},loadTrip:async()=>{},abandonDrafts:()=>drafts.clear(),queryFlight:async()=>{window.queries++;return{candidates:[],fetchedAtUtc:'2026-10-28T00:00:00Z'};},
      enqueueMutation:()=>{},queueSetActual:()=>{},queueAppend:()=>{},queueFinish:item=>window.finishes.push(item),queueCancel:()=>{},queueDeleteTrip:()=>{}};
    window.rail=mountTravelRail({host:document.querySelector('#rail'),controller,getZone:()=>({baseOffset:'+00:00',replacements:[]}),getEditing:()=>window.editing,
      getDefaultQueryDate:()=> '2026-10-28',onEnterEdit:()=>{window.editing=true;window.rail.refresh();},onExitEdit:()=>{window.editing=false;window.rail.refresh();},
      onCreateFirstContent:async()=>{window.creates++;},onError:message=>{window.lastError=message;}});
    window.rail.setItem('trip-1');window.ready=true;
    </script></body></html>`}));
  await page.goto('http://127.0.0.1:1420/__travel-unified-qa');
  await page.waitForFunction(()=>window.ready===true);
  await page.locator('.travel-rail-point-row').first().waitFor({timeout:5000}).catch(async(error)=>{
    throw Error(`${error.message}; diagnostics: ${JSON.stringify(await page.evaluate(()=>({lastError:window.lastError,body:document.body.textContent}))) }; pageErrors: ${errors.join('; ')}`);
  });
  const field=(key)=>page.locator(`[data-travel-field="${key}"]`);
  const title=field('item:title').locator('.orbita-inline-text-field__display');
  const font=locator=>locator.evaluate(node=>getComputedStyle(node).fontSize);
  assert.equal(await font(title),'20px');
  assert.equal(await page.locator('.travel-rail-settings').count(),0);
  assert.equal(await page.getByText('复制两端',{exact:true}).count(),0);
  const finishButton=()=>page.getByRole('button',{name:'完成',exact:true});
  assert.equal(await finishButton().isDisabled(),true);
  assert.match(await finishButton().getAttribute('title'),/实际时间未填写.*首都机场.*虹桥机场/);
  await page.evaluate(()=>{
    window.snapshot.canonicalPoints[0].actualRearStartAtUtc='2026-10-28T08:00:00Z';
    window.snapshot.canonicalPoints[1].actualFrontEndAtUtc='2026-10-28T09:00:00Z';
    window.snapshot.actions[0].actual.start.atUtc='2026-10-28T08:00:00Z';window.snapshot.actions[0].actual.end.atUtc='2026-10-28T09:00:00Z';
    window.rail.refresh();
  });
  assert.equal(await finishButton().isDisabled(),false);
  await page.evaluate(()=>{
    window.snapshot.checkpoints.push({id:'cp-test',plannedAtUtc:'2026-10-28T10:00:00Z',actualAtUtc:null});
    window.snapshot.canonicalPoints.push({pointId:'cp-test',attachmentKind:'checkpoint',plannedAtUtc:'2026-10-28T10:00:00Z',actualAtUtc:null});window.rail.refresh();
  });
  assert.equal(await finishButton().isDisabled(),true);
  await page.evaluate(()=>{window.snapshot.checkpoints.pop();window.snapshot.canonicalPoints.pop();window.snapshot.canonicalPoints[0].frontActionId='previous';window.snapshot.actions.push({id:'previous',plannedStartAt:'2026-10-28T07:00:00Z',plannedEndAt:'2026-10-28T08:00:00Z',actual:{start:{atUtc:'2026-10-28T07:00:00Z'},end:{atUtc:null}}});window.rail.refresh();});
  assert.equal(await finishButton().isDisabled(),true);
  await page.evaluate(()=>{window.snapshot.canonicalPoints[0].actualFrontEndAtUtc='2026-10-28T07:59:00Z';window.snapshot.actions[1].actual.end.atUtc='2026-10-28T07:59:00Z';window.rail.refresh();});
  assert.equal(await finishButton().isDisabled(),false);
  await page.evaluate(()=>{window.snapshot.actions.pop();window.snapshot.canonicalPoints[0].frontActionId=null;window.snapshot.canonicalPoints[0].actualFrontEndAtUtc=null;window.rail.refresh();});
  for (const width of [280,320,520]) {
    await page.locator('#rail').evaluate((node,width)=>{node.style.width=`${width}px`;},width);
    const finish=page.getByRole('button',{name:'完成',exact:true});
    await finish.waitFor({state:'visible'});
    const bounds=await page.locator('#rail').boundingBox();
    const buttonBounds=await finish.boundingBox();
    assert.ok(buttonBounds.x>=bounds.x&&buttonBounds.x+buttonBounds.width<=bounds.x+bounds.width+1,`finish clipped at rail width ${width}`);
    await finish.click();
  }
  assert.deepEqual(await page.evaluate(()=>window.finishes),['trip-1','trip-1','trip-1']);
  assert.equal(await font(page.locator('.travel-rail-point-body').first()),'14px');
  const location=field('point:p-start:location');
  assert.equal(await location.locator('.orbita-inline-text-field__display').isDisabled(),false);
  assert.equal(await page.locator('[aria-label="修改计划时间"]').count(),2);
  await location.locator('.orbita-inline-text-field__display').click();
  const editor=location.locator('.orbita-inline-text-field__input');
  assert.equal(await editor.inputValue(),'首都机场');
  assert.equal(await font(editor),'14px');
  await editor.press('ControlOrMeta+A');await editor.press('Backspace');
  await page.locator('#outside').click();
  assert.equal(await location.locator('.orbita-inline-text-field__display').textContent(),'地点');
  await location.locator('.orbita-inline-text-field__display').click();
  assert.equal(await editor.inputValue(),'');
  await editor.fill('新地点');await editor.press('Enter');
  assert.ok(await page.evaluate(()=>window.writes.some(x=>x.key==='point:p-start:location'&&x.payload.location==='新地点')));
  const name=field('transportation:transport-1:name');
  await name.locator('.orbita-inline-text-field__display').click();
  await name.locator('.orbita-inline-text-field__input').fill('新航班资料');
  await name.locator('.orbita-inline-text-field__input').press('Enter');
  assert.ok(await page.evaluate(()=>window.writes.some(x=>x.key==='transportation:transport-1:name'&&x.payload.name==='新航班资料')));
  const layout=async()=>page.locator('.travel-rail').evaluate(node=>[...node.querySelectorAll('.travel-rail-point-row,.travel-rail-segment,.orbita-inline-text-field')].map(x=>x.className));
  const before=await layout();
  await page.evaluate(()=>{window.editing=true;window.rail.refresh();});assert.deepEqual(await layout(),before);
  await page.evaluate(()=>{window.editing=false;window.rail.refresh();});assert.deepEqual(await layout(),before);
  await page.locator('.travel-rail-point-circle').first().click();
  await page.locator('.travel-rail-actual-popover').waitFor();
  await page.keyboard.press('Escape');
  assert.ok((await page.locator('.travel-rail').textContent()).includes('查询航班'));
  await page.evaluate(()=>{Object.assign(window.snapshot.capabilities,{canEditText:false,canEditStructure:false,canEditPlan:false,canRecordActual:false,canAppend:false,canChangeTransportationType:false});window.rail.refresh();});
  assert.equal(await title.isDisabled(),true);
  const pointDisplay=field('point:p-start:location').locator('.orbita-inline-text-field__display');
  assert.equal(await pointDisplay.isDisabled(),true);
  await page.evaluate(()=>{window.snapshot.item.completed=true;window.snapshot.capabilities.canFinish=false;window.rail.refresh();});
  assert.equal(await page.locator('.travel-rail-head-actions').getByText('已完成',{exact:true}).count(),1);
  assert.equal(await finishButton().count(),0);
  assert.deepEqual(errors,[]);
  const screenshot=join(tmpdir(),'orbita-travel-unified-rail.png');await page.screenshot({path:screenshot});
  console.log(JSON.stringify({screenshot,writes:await page.evaluate(()=>window.writes.length)},null,2));
  console.log('PASS: unified rail editing, placeholders, queue callbacks, typography, independent week mode, actual entry, flight entry, and capability guards.');
} finally {await browser.close();}
