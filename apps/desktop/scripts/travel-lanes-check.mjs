import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__travel-lanes-qa',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html>
  <html data-insight-theme="cold"><head><meta charset="utf-8">
  <link rel="stylesheet" href="/src/ui/theme-base.css"><link rel="stylesheet" href="/src/ui/admin-shell.css">
  <link rel="stylesheet" href="/src/integrations/admin/timeline/timeline.css"><link rel="stylesheet" href="/src/integrations/admin/tabs/task/task.css">
  </head><body><div class="insight-task-page"><div id="week" style="width:1300px;height:900px"></div></div><script type="module">
  import { mountArrangementWeek } from '/src/integrations/admin/tabs/task/arrangement-week.ts';
  import { loadSettings } from '/src/core/data/settings.ts';
  await loadSettings();
  const iso=(hour)=>'2026-10-28T'+String(hour).padStart(2,'0')+':00:00.000Z';
  const at=(hour)=>Date.parse(iso(hour));
  const point=(id,hour,role)=>({pointId:id,plannedAtUtc:iso(hour),attachmentKind:'action',role,ownerActionId:'stage',ownerCheckpointId:null,frontActionId:role==='end'?'stage':null,rearActionId:role==='start'?'stage':null,actionLabel:null,location:null,note:null,actualFrontEndAtUtc:null,actualRearStartAtUtc:null,actualAtUtc:null});
  window.snapshot={item:{id:'trip',revision:1,title:'出行',completed:false,status:'active',cancelled:false},actions:[{id:'stage',revision:1,title:'行程',plannedStartAt:iso(8),plannedEndAt:iso(10),ended:false,actual:{start:{atUtc:null},end:{atUtc:null}}}],checkpoints:[],transportations:[],canonicalPoints:[point('start',8,'start'),point('end',10,'end')],segments:[{actionId:'stage',transportationId:null,plannedStartAt:iso(8),plannedEndAt:iso(10)}],capabilities:{canEditPlan:true}};
  const list={items:[{itemId:'trip',item:{id:'trip',revision:1}}],canonicalPoints:window.snapshot.canonicalPoints,segments:window.snapshot.segments};
  const ordinary={id:'ordinary',revision:1,title:'普通事项',targetKind:'item',targetId:'ordinary-item',plannedStartAt:iso(8),plannedEndAt:iso(10),intervals:[],ended:false};
  const data={actions:[ordinary],sessions:[],targets:new Map([['item:ordinary-item',{id:'ordinary-item',title:'普通事项',kind:'item',available:true,archived:false,color:'#6688aa'}]]),zone:{baseOffset:'+00:00',replacements:[]}};
  const health={plans:[],sources:[{id:'sleep',kind:'sleep-night',start:at(8),end:at(10),title:'睡眠'},{id:'exercise',kind:'activity',start:at(8),end:at(10),title:'运动',activityType:'running'}]};
  window.handle=mountArrangementWeek({host:document.querySelector('#week'),getData:()=>data,getHealth:()=>health,getDay:()=> '2026-10-28',getSelection:()=>null,onDay:()=>{},onSelect:()=>{},onCreate:async()=>{},onMove:async()=>{},onError:message=>{throw Error(message);},captureActionBaseline:()=>({}),getTravelListWeek:()=>list,getTravelSnapshot:()=>window.snapshot,getTravelEditMode:()=>({editingItemId:null,selectedItemId:null}),getTravelController:()=>({getPlanEditGeneration:()=>1})});
  window.ready=true;
  </script></body></html>`}));
  await page.goto('http://127.0.0.1:1420/__travel-lanes-qa');
  await page.waitForFunction(()=>window.ready===true);
  const inspect=()=>page.evaluate(()=>{
    const day=document.querySelector('.arrangement-day[data-date="2026-10-28"]');
    return {travel:[...day.querySelectorAll('.travel-week-trip')].map(n=>parseFloat(n.style.left)),health:[...day.querySelectorAll('.week-health-event')].map(n=>parseFloat(n.style.left)),ordinary:[...day.querySelectorAll('[data-action-id="ordinary"]')].map(n=>({left:n.style.left,inset:n.style.getPropertyValue('--health-inset'),css:n.getAttribute('style')}))};
  });
  const samples=[];
  for(const direction of [null,'out','in','in','in','in','in','reset']){
    if(direction)await page.locator('[data-zoom="'+direction+'"]').click();
    const state=await inspect();samples.push(state);
    assert.deepEqual(state.travel,[0]);
    assert.equal(state.health.length,2);
    assert.ok(state.health.every(x=>x>=24),JSON.stringify(state));
    assert.equal(new Set(state.health).size,2);
    assert.ok(state.ordinary.length>0,JSON.stringify(state));
    assert.ok(state.ordinary.every(x=>Number(x.left.match(/\+ ([\d.]+)px/)?.[1])>=72),JSON.stringify(state));
  }
  assert.deepEqual(errors,[]);
  const actual=await page.evaluate(async()=>{
    const {buildTravelTripLines}=await import('/src/integrations/admin/tabs/task/travel/week-model.ts');
    const {renderTravelLinesForDay}=await import('/src/integrations/admin/tabs/task/travel/week-render.ts');
    const snap=structuredClone(window.snapshot);snap.item.completed=true;
    const start='2026-10-28T12:00:00.000Z',end='2026-10-28T14:00:00.000Z';
    snap.actions[0].actual={start:{atUtc:start},end:{atUtc:end}};
    snap.canonicalPoints[0].actualRearStartAtUtc=start;snap.canonicalPoints[1].actualFrontEndAtUtc=end;
    const build=(snapshots,hourPx=56)=>buildTravelTripLines({list:{items:snapshots.map(s=>({itemId:s.item.id})),segments:[],canonicalPoints:[]},snapshotForItem:id=>snapshots.find(s=>s.item.id===id),zone:{baseOffset:'+00:00',replacements:[]},hourPx});
    const line=build([snap])[0];
    const partial=structuredClone(snap);partial.actions[0].actual.end.atUtc=null;partial.canonicalPoints[1].actualFrontEndAtUtc=null;
    const partialLine=build([partial])[0];
    const html=renderTravelLinesForDay([partialLine],{date:'2026-10-28',start:Date.parse('2026-10-28T00:00:00Z'),end:Date.parse('2026-10-29T00:00:00Z')},{baseOffset:'+00:00',replacements:[]},56,null,null);
    const host=document.createElement('div');host.innerHTML=html;
    const empty=structuredClone(partial);empty.actions[0].actual.start.atUtc=null;empty.canonicalPoints[0].actualRearStartAtUtc=null;
    const other=structuredClone(snap);other.item.id='other';
    other.actions[0].actual.start.atUtc='2026-10-28T14:20:00.000Z';other.actions[0].actual.end.atUtc='2026-10-28T15:00:00.000Z';
    other.canonicalPoints[0].actualRearStartAtUtc=other.actions[0].actual.start.atUtc;other.canonicalPoints[1].actualFrontEndAtUtc=other.actions[0].actual.end.atUtc;
    return {start:line.start,end:line.end,points:line.points.map(p=>p.atMs),partialSegments:partialLine.segments.length,partialPoints:partialLine.points.length,partialConnectors:host.querySelectorAll('[data-travel-connector]').length,empty:build([empty]).length,small:build([snap,other],56*.67).map(l=>l.lane),large:build([snap,other],112).map(l=>l.lane)};
  });
  assert.equal(actual.start,Date.parse('2026-10-28T12:00:00Z'));
  assert.equal(actual.end,Date.parse('2026-10-28T14:00:00Z'));
  assert.deepEqual(actual.points,[actual.start,actual.end]);
  assert.equal(actual.partialSegments,0);assert.equal(actual.partialPoints,1);assert.equal(actual.partialConnectors,0);assert.equal(actual.empty,0);
  assert.deepEqual(actual.small,[0,1]);assert.deepEqual(actual.large,[0,0]);
  console.log(JSON.stringify({zoomSamples:samples.length,actual}));
  console.log('PASS: actual week mount keeps Travel leftmost, Health lanes distinct and ordinary blocks clear across all zoom levels.');
} finally {await browser.close();}
