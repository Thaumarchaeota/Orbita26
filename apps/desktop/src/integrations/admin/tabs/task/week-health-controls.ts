import { productivityCreateHealthPlan, productivityLinkHealthPlan, productivityListWeekHealth, productivityMutateHealthPlan, productivityReconcileSleepPlans, productivityUnlinkHealthPlan } from "../../../productivity/client";
import type { HealthPlanSnapshot, HealthPlanRequest, ItemTypeCatalogSnapshot, WeekHealthResponse, WeekHealthSource } from "../../../productivity/types";
import { createInsightDialog } from "../../../../ui/insight-dialog";
import { mountSelectField } from "../../../../ui/select-field";
import { showCommandMenuAt } from "../../../../ui/command-menu-popover";
import { getConfirmDialog } from "../../../shell/dialog";
import { ACTIVITY_TYPES } from "../health/activity-glyph";
import { healthCreateMeal } from "../../../journal/client";
import { mountDecoupledDateTimeRangePicker } from "../../../../ui/decoupled-datetime-range-picker";
import { mountDecoupledTimePicker } from "../../../../ui/decoupled-time-picker";
import { dateAt, minuteAt, type BusinessZone, instantForWall } from "./arrangement-model";

const ref=(r:{id:string;revision:number})=>({id:r.id,expectedRevision:r.revision});
export function createWeekHealthControls(opts:{root:string;alive:()=>boolean;catalog:()=>ItemTypeCatalogSnapshot|null;zone:()=>BusinessZone|null;refresh:()=>Promise<void>;error:(s:string)=>void;select:(id:string,action?:string)=>void;updatePlan?:(plan:HealthPlanSnapshot,start:string,end:string)=>Promise<HealthPlanSnapshot>}) {
  let data:WeekHealthResponse|null=null, generation=0, selected:string|null=null, reconcileKey="";
  const seen=new Set<string>(), sourceTimes=new Map<string,string>();
  const sourcesByRange=new Map<string,Map<string,number>>();
  const dialogs=new Set<ReturnType<typeof createInsightDialog>>();
  let menuHandle: ReturnType<typeof showCommandMenuAt> | null = null;
  const active=()=>opts.alive();
  const assertActive=()=>{if(!active())throw new Error("数据目录或页面已变化");};
  const request=(s:HealthPlanSnapshot):HealthPlanRequest=>({expectedDataDir:opts.root,item:ref(s.item),action:ref(s.action)});
  function choose(title:string,options:{value:string;label:string}[]):Promise<string|null>{
    return new Promise(resolve=>{
      let settled=false;
      const dialog=createInsightDialog({title,bodyHtml:'<div data-health-select></div>',submitLabel:"确定",onDispose:()=>{field.dispose();if(!settled){settled=true;resolve(null);} dialogs.delete(dialog);}});
      dialogs.add(dialog);
      const field=mountSelectField(dialog.body.querySelector<HTMLElement>("[data-health-select]")!,{label:title,options,multiple:false,search:true,value:null,onChange:()=>{}});
      const finish=(value:string|null)=>{if(settled)return;settled=true;field.dispose();dialog.dispose();dialogs.delete(dialog);resolve(value);};
      dialog.bindChrome(()=>finish(null));
      dialog.panel.addEventListener("submit",e=>{e.preventDefault();const value=field.getValue();if(!value){dialog.setError("请选择");return;}finish(value);});
      void dialog.open();
    });
  }
  async function link(plan:HealthPlanSnapshot):Promise<HealthPlanSnapshot|null>{
    assertActive();
    const used=new Set(data?.plans.filter(p=>p.item.id!==plan.item.id).map(p=>`${p.detail.healthKind}:${p.detail.healthId}`));
    const sources=(data?.sources??[]).filter(s=>!used.has(`${s.kind}:${s.id}`)&&(plan.detail.kind==="activity"?s.kind==="activity":s.kind==="sleep-night"||s.kind==="nap"));
    const zone=opts.zone();
    const when=(t:number)=>{if(!zone)return new Date(t).toISOString();const m=minuteAt(t,zone);return `${dateAt(t,zone)} ${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;};
    const id=await choose(plan.detail.kind==="activity"?"选择 Garmin 活动并完成":"选择实际睡眠并完成",sources.map(s=>({value:`${s.kind}:${s.id}`,label:`${s.title} · ${when(s.start)}–${when(s.end)}`})));
    if(!id)return null; assertActive();
    const source=sources.find(s=>`${s.kind}:${s.id}`===id)!;
    const result=await productivityLinkHealthPlan({...request(plan),source:{kind:source.kind as "sleep-night"|"nap"|"activity",id:source.id,expectedRevision:source.revision}});
    await opts.refresh();return result;
  }
  async function unlink(plan:HealthPlanSnapshot){assertActive();const result=await productivityUnlinkHealthPlan(request(plan));await opts.refresh();return result;}
  function acceptPlan(plan:HealthPlanSnapshot):void{if(!data)return;const index=data.plans.findIndex(p=>p.item.id===plan.item.id);if(index>=0)data.plans[index]=plan;}
  async function mutate(plan:HealthPlanSnapshot,operation:HealthPlanRequest["operation"],start?:string,end?:string){
    assertActive();
    if(operation==="update"&&opts.updatePlan){if(!start||!end)throw new Error("请填写完整的健康计划时间");return opts.updatePlan(plan,start,end);}
    const result=await productivityMutateHealthPlan({...request(plan),operation,start,end});acceptPlan(result);
    // The canonical receipt owns success; a later read failure cannot turn a committed write into a retry (SPEC-0015 §6.2).
    try{await opts.refresh();}catch(error){opts.error(`健康计划已保存，页面刷新失败：${String(error)}`);}return result;
  }
  async function edit(plan:HealthPlanSnapshot){
    assertActive();
    const zone=opts.zone();if(!zone)return;
    const value=(t:string)=>{const ms=Date.parse(t),m=minuteAt(ms,zone);return {date:dateAt(ms,zone),time:`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`};};
    const start=value(plan.action.plannedStartAt!),end=value(plan.action.plannedEndAt!);
    let draft={startDate:start.date,startTime:start.time,endDate:end.date,endTime:end.time};
    const dialog=createInsightDialog({title:"编辑健康计划",bodyHtml:'<div data-range></div>',submitLabel:"保存",onDispose:()=>{picker.dispose();dialogs.delete(dialog);}});dialogs.add(dialog);
    const picker=mountDecoupledDateTimeRangePicker({defaultTrigger:{container:dialog.body.querySelector<HTMLElement>("[data-range]")!},value:draft,onChange:v=>{draft=v;}});
    const dispose=()=>{picker.dispose();dialog.dispose();dialogs.delete(dialog);};dialog.bindChrome(dispose);
    dialog.panel.addEventListener("submit",e=>{e.preventDefault();dialog.setBusy(true);void(async()=>{
      const a=draft.startTime.split(":").map(Number),b=draft.endTime.split(":").map(Number);
      await mutate(plan,"update",new Date(instantForWall(draft.startDate,a[0]*60+a[1],zone)).toISOString(),new Date(instantForWall(draft.endDate,b[0]*60+b[1],zone)).toISOString());dispose();
    })().catch(e=>{dialog.setBusy(false);dialog.setError(String(e));});});void dialog.open();
  }
  async function create(kind:"sleep"|"activity",start:string,end:string,activityType?:string){
    assertActive();
    const chosen=kind==="activity"?(activityType??await choose("运动类型",ACTIVITY_TYPES)):undefined;
    if(kind==="activity"&&!chosen)return;assertActive();
    const catalog=opts.catalog();
    const result=await productivityCreateHealthPlan({expectedDataDir:opts.root,kind,start,end,activityType:chosen??undefined,catalog:catalog?ref(catalog):undefined});
    await opts.refresh();if(active()){selected=`plan:${result.item.id}`;opts.select(selected,result.action.id);}
  }
  async function meal(start:string){
    assertActive();
    const zone=opts.zone();if(!zone)return;
    const date=dateAt(Date.parse(start),zone),m=minuteAt(Date.parse(start),zone);
    let time=`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
    const dialog=createInsightDialog({title:"记录饮食",bodyHtml:'<label>名称<input data-title class="insight-dialog-input" required></label><div data-slot></div><div data-time></div>',submitLabel:"创建",onDispose:()=>{slot.dispose();picker.dispose();dialogs.delete(dialog);}});dialogs.add(dialog);
    const slot=mountSelectField(dialog.body.querySelector<HTMLElement>("[data-slot]")!,{label:"餐次",multiple:false,search:false,value:"other",options:[{value:"breakfast",label:"早餐"},{value:"lunch",label:"午餐"},{value:"dinner",label:"晚餐"},{value:"late_night",label:"夜宵"},{value:"coffee",label:"咖啡"},{value:"beverage",label:"饮料"},{value:"snack",label:"零食"},{value:"other",label:"其他"}],onChange:()=>{}});
    const picker=mountDecoupledTimePicker({defaultTrigger:{container:dialog.body.querySelector<HTMLElement>("[data-time]")!},value:time,onChange:v=>{time=v;}});
    const dispose=()=>{slot.dispose();picker.dispose();dialog.dispose();dialogs.delete(dialog);};dialog.bindChrome(dispose);
    dialog.panel.addEventListener("submit",e=>{e.preventDefault();dialog.setBusy(true);void(async()=>{
      assertActive();if(!/^\d{2}:\d{2}$/.test(time))throw new Error("请填写明确时间");
      const title=dialog.body.querySelector<HTMLInputElement>("[data-title]")!.value.trim();if(!title)throw new Error("请填写名称");
      // Health Meal's established writer interprets explicit atHm in Beijing.
      const [hour,minute]=time.split(":").map(Number),instant=instantForWall(date,hour*60+minute,zone);
      const beijing=new Date(instant+8*3_600_000).toISOString();
      await healthCreateMeal({expectedDataDir:opts.root,title,startedAt:new Date(instant).toISOString(),slot:slot.getValue()!,foods:[],source:"manual",atHm:beijing.slice(11,16)});
      await opts.refresh();dispose();
    })().catch(e=>{dialog.setBusy(false);dialog.setError(String(e));});});void dialog.open();
  }
  async function load(start:string,end:string):Promise<HealthPlanSnapshot[]>{
    const turn=++generation;const next=await productivityListWeekHealth({expectedDataDir:opts.root,start,end});if(!active()||turn!==generation)return [];
    data=next;
    const notices:string[]=[];
    const nextSources=new Map(next.sources.map(s=>[`${s.kind}:${s.id}`,s.revision]));
    const range=`${start}/${end}`,previousSources=sourcesByRange.get(range);
    if(previousSources)for(const [key,revision] of previousSources){
      const notice=`${opts.root}:${key}:${revision}:deleted`;
      if(!nextSources.has(key)&&!seen.has(notice)){seen.add(notice);notices.push("健康记录已不在当前范围或已删除，周视图已更新。");}
    }
    sourcesByRange.set(range,nextSources);
    for(const p of next.plans)if(p.detail.invalidSource){const key=`${opts.root}:${p.item.id}:${p.item.revision}:invalid`;if(!seen.has(key)){seen.add(key);notices.push("关联的健康记录已失效，请手动重新选择。完成状态已保留。");}}
    for(const s of next.sources){const key=`${opts.root}:${s.kind}:${s.id}`,time=`${s.start}/${s.end}`,prior=sourceTimes.get(key);if(prior!==undefined&&prior!==time&&!seen.has(`${key}:${time}`)){seen.add(`${key}:${time}`);notices.push("健康来源记录已修正，周视图已显示最新时间。");}sourceTimes.set(key,time);}
    if(notices.length)void getConfirmDialog()("健康记录变化",[...new Set(notices)].join("\n"),undefined,{info:true});
    const plans=next.plans.filter(p=>p.detail.kind==="sleep"&&p.detail.autoMatchEnabled&&!p.detail.healthId&&p.item.status==="进行中");
    const sources=next.sources.filter((s):s is WeekHealthSource&{kind:"sleep-night"}=>s.kind==="sleep-night");
    const key=JSON.stringify([plans.map(p=>[p.item.id,p.item.revision,p.action.revision]),sources.map(s=>[s.id,s.revision])]);
    if(!plans.length||!sources.length||key===reconcileKey)return [];reconcileKey=key;
    if(!active()||turn!==generation)return [];
    const changed=await productivityReconcileSleepPlans({expectedDataDir:opts.root,plans:plans.map(p=>({item:ref(p.item),action:ref(p.action)})),sources:sources.map(s=>({kind:s.kind,id:s.id,expectedRevision:s.revision}))});
    if(!active()||turn!==generation)return [];
    for(const p of changed){const i=next.plans.findIndex(old=>old.item.id===p.item.id);if(i>=0)next.plans[i]=p;}return changed;
  }
  async function loadActivityPauses(start:string,end:string,isCurrent:()=>boolean):Promise<boolean>{
    const turn=generation, baseline=data;
    if(!baseline || !active() || !isCurrent())return false;
    const response=await productivityListWeekHealth({expectedDataDir:opts.root,start,end,includeActivityPauses:true});
    if(!active() || !isCurrent() || turn!==generation || data!==baseline)return false;
    const activities=new Map(response.sources.filter(s=>s.kind==="activity").map(s=>[s.id,s]));
    let changed=false;
    baseline.sources=baseline.sources.map(source=>{
      const incoming=source.kind==="activity"?activities.get(source.id):undefined;
      if(!incoming || incoming.revision!==source.revision)return source;
      changed=true;return {...source,segments:incoming.segments};
    });
    return changed;
  }
  function menu(id:string,x:number,y:number){
    if(!active())return;
    menuHandle?.dispose();menuHandle=null;
    const plan=data?.plans.find(p=>`plan:${p.item.id}`===id);selected=id;opts.select(id,plan?.action.id);
    if(!plan)return;
    menuHandle=showCommandMenuAt(x,y,[{value:"link",label:plan.detail.healthId?"重新选择实际记录":"关联实际记录并完成"},{value:"unlink",label:"撤销完成 / 解除关联",disabled:!plan.detail.healthId},{value:"edit",label:"编辑计划时间"},...(plan.detail.kind==="activity"?[{value:"cancel",label:"取消运动",disabled:!!plan.detail.healthId}]:[]),{value:"delete",label:"删除计划",danger:true}],value=>{void(async()=>{
      if(value==="link")await link(plan);else if(value==="unlink")await unlink(plan);else if(value==="edit")await edit(plan);else if(value==="delete"){if(await getConfirmDialog()("删除健康计划","将删除计划及其安排，实际健康记录会保留。",undefined,{danger:true}))await mutate(plan,"delete");}else if(value==="cancel")await mutate(plan,"cancel");
    })().catch(e=>opts.error(String(e)));},{onClose:()=>{menuHandle=null;}});
  }
  return {getData:()=>data,getSelected:()=>selected,load,loadActivityPauses,create,meal,menu,link,unlink,mutate,acceptPlan,
    find:(item:string)=>data?.plans.find(p=>p.item.id===item),
    select:(id:string)=>{selected=id;const p=data?.plans.find(p=>`plan:${p.item.id}`===id);opts.select(id,p?.action.id);},
    dispose(){generation++;data=null;menuHandle?.dispose();menuHandle=null;for(const d of dialogs)d.dispose();dialogs.clear();},
  };
}
