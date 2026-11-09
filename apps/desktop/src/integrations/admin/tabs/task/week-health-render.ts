import { escAttr } from "../../../../core/html";
import type { HealthPlanSnapshot, WeekHealthResponse, WeekHealthSource } from "../../../productivity/types";
import { activityTypeGlyph, activityGlyph } from "../health/activity-glyph";
import { dateAt, minuteAt, type BusinessZone } from "./arrangement-model";
import { itemTypeColorRoles } from "./item-type-palette";
import { mealSlotLabel, normalizeMealSlot } from "../../../../core/data/meals";
import { mealIconAssetUrl } from "../health/meal-icons";
import { renderWeekTimeBubble } from "./week-time-bubble";
import {
  timelineGlowCssVars,
  timelinePlannedDashSvg,
  timelineSegmentClassNames,
  timelineSegmentFadePx,
} from "../../../../ui/timeline-line-decoration";
import "./week-health.css";

const LANE = 24, HIT = 24, FUSE = 6, RADIUS = 8, MIN_LINE = 8;
const MIN_ACTIVITY_PAUSE_PX = 0.3;
type Span = { start: number; end: number; actual: boolean; awake?: boolean };
export type HealthLine = {
  id: string; kind: string; plan?: HealthPlanSnapshot; source?: WeekHealthSource;
  start: number; end: number; lane: number; spans: Span[]; occupied: { start: number; end: number }[]; color: string;
};
const svg = activityGlyph;
function mealIcon(iconKey: string | null | undefined): string {
  // External SVG images cannot inherit color; the mask uses the existing Health role color.
  const url = escAttr(mealIconAssetUrl(iconKey).replace(/'/g, "%27"));
  return `<span class="week-health-meal-icon" aria-hidden="true" style="--meal-icon-url:url('${url}')"></span>`;
}
function actualSpans(source: WeekHealthSource, hourPx: number): Span[] {
  let gaps: { start: number; end: number }[] = [];
  if ((source.kind === "sleep-night" || source.kind === "activity") && Array.isArray(source.segments)) {
    for (const raw of source.segments) {
      const s = raw as Record<string,unknown>;
      const start = Number(s.start ?? s.startUtc) * 1000, end = Number(s.end ?? s.endUtc) * 1000;
      if ((source.kind === "activity" || s.level === "awake" || s.stage === "awake" || s.level === 0) && Number.isFinite(start) && Number.isFinite(end) && end > start &&
        (source.kind !== "activity" || (end - start) * hourPx / 3_600_000 >= MIN_ACTIVITY_PAUSE_PX)) gaps.push({ start, end });
    }
  }
  gaps.sort((a,b)=>a.start-b.start || a.end-b.end);
  const merged: typeof gaps = [];
  for (const gap of gaps) { const tail=merged[merged.length-1]; if (tail && gap.start<=tail.end) tail.end=Math.max(tail.end,gap.end); else merged.push({...gap}); }
  let cursor=source.start; const spans: Span[]=[];
  for (const gap of merged) {
    const start=Math.max(source.start,gap.start),end=Math.min(source.end,gap.end);
    if(end<=cursor || start>=source.end) continue;
    if(start>cursor) spans.push({start:cursor,end:start,actual:true});
    spans.push({start,end,actual:true,awake:true});
    cursor=Math.max(cursor,end);
  }
  if(cursor<source.end) spans.push({start:cursor,end:source.end,actual:true});
  return spans;
}
export function healthLines(data: WeekHealthResponse | null, hourPx: number, targets: Map<string,{ color?: string }>, travelInset?: (start: number, end: number) => number): HealthLine[] {
  if (!data) return [];
  const linked=new Set(data.plans.filter(p=>!p.detail.invalidSource).map(p=>`${p.detail.healthKind}:${p.detail.healthId}`));
  const lines: HealthLine[]=[];
  const roleColor=(kind:string)=>data.catalog?.itemTypes.find(n=>n.systemRole===kind)?.effectiveColor ?? "#87909a";
  const add=(id:string,plan:HealthPlanSnapshot|undefined,source:WeekHealthSource|undefined)=>{
    const kind=plan?.detail.kind ?? (source?.kind==="nap"||source?.kind==="sleep-night"?"sleep":source!.kind);
    const spans:Span[]=[];
    const ps=Date.parse(plan?.action.plannedStartAt??""),pe=Date.parse(plan?.action.plannedEndAt??"");
    if(Number.isFinite(ps)&&Number.isFinite(pe)&&!(kind==="activity"&&source))spans.push({start:ps,end:pe,actual:false});
    if(source) spans.push(...actualSpans(source, hourPx));
    if(!spans.length && source?.kind!=="meal")return;
    const start=Math.min(...spans.map(s=>s.start),source?.start??Infinity),end=Math.max(...spans.map(s=>s.end),source?.end??-Infinity);
    const pad=HIT/2/hourPx*3_600_000;
    const occupied=spans.map(s=>({start:s.start-pad,end:s.end+pad}));
    if(source?.kind==="meal")occupied.push({start:source.start-pad,end:source.start+pad});
    // The plan and actual union occupies one fixed lane, without reserving their intervening blank time.
    lines.push({id,kind,plan,source,start,end,lane:0,spans,occupied,color:targets.get(`item:${plan?.item.id}`)?.color??roleColor(kind)});
  };
  for(const plan of data.plans) add(`plan:${plan.item.id}`,plan,data.sources.find(s=>s.id===plan.detail.healthId&&s.kind===plan.detail.healthKind));
  for(const source of data.sources)if(!linked.has(`${source.kind}:${source.id}`))add(`source:${source.kind}:${source.id}`,undefined,source);
  lines.sort((a,b)=>a.start-b.start||a.end-b.end||(a.plan?.item.id??a.source!.id).localeCompare(b.plan?.item.id??b.source!.id));
  const lanes:HealthLine[][]=[];
  for(const line of lines){
    // Travel occupies the leftmost lanes; allocate Health in the same column
    // space so overlapping Health lines cannot collide after the offset.
    let lane=Math.ceil(Math.max(0,...line.occupied.map(span=>travelInset?.(span.start,span.end)??0))/LANE);
    while(lanes[lane]?.some(other=>other.occupied.some(a=>line.occupied.some(b=>a.start<b.end&&b.start<a.end))))lane++;
    line.lane=lane;(lanes[lane]??=[]).push(line);
  }
  return lines;
}
export function healthInset(lines:HealthLine[],start:number,end:number):number {
  return Math.max(0,...lines.filter(l=>l.occupied.some(s=>s.start<end&&s.end>start)).map(l=>(l.lane+1)*LANE));
}
function endpointIcons(line: HealthLine): number[] {
  const times: number[] = [];
  const add = (t: number) => { if (Number.isFinite(t)) times.push(t); };
  if (line.kind === "sleep") {
    if (line.source?.kind === "nap") add(line.source.start);
    else if (line.source) { add(line.source.start); add(line.source.end); }
    else if (line.plan) {
      add(Date.parse(line.plan.action.plannedStartAt ?? ""));
      add(Date.parse(line.plan.action.plannedEndAt ?? ""));
    }
  } else if (line.kind === "activity") {
    if (line.source) add(line.source.start);
    else if (line.plan) add(Date.parse(line.plan.action.plannedStartAt ?? ""));
  }
  return times.sort((a, b) => a - b);
}

export function renderHealthLines(lines:HealthLine[],day:{date:string;start:number;end:number},zone:BusinessZone,hourPx:number,selected:string|null,dragEndpoint?:{actionId:string;edge:"start"|"end"}):string{
  // Each column includes its next-day tail; wall-time boundaries come from the
  // caller's business zone (SPEC-0009).
  const dayEnd=day.end;
  // Preserve sub-minute event boundaries without changing the displayed time labels.
  const y=(t:number)=>(minuteAt(t,zone)+((t%60_000+60_000)%60_000)/60_000+(Date.parse(`${dateAt(t,zone)}T00:00:00Z`)-Date.parse(`${day.date}T00:00:00Z`))/86_400_000*1440)/60*hourPx;
  const when=(t:number)=>{const m=minuteAt(t,zone);return `${dateAt(t,zone)} ${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;};
  return lines.map(line=>{
    if(!line.occupied.some(s=>s.start<dayEnd&&s.end>=day.start))return "";
    const attrs=`data-health-id="${escAttr(line.id)}"${line.plan?` data-health-action="${escAttr(line.plan.action.id)}"`:""}`;
    const roles=itemTypeColorRoles(line.color),color=roles.main;
    const classes=`week-health-event orbita-timeline-line-group${selected===line.id?" is-selected":""}${line.plan?.item.status==="取消"?" is-cancelled":""}`;
    const glowVars=timelineGlowCssVars(roles.glowPrimary, roles.glowPrimaryOpacity);
    const glowStyle=`--glow-primary:${escAttr(roles.glowPrimary)};--glow-opacity:${roles.glowPrimaryOpacity};--orbita-timeline-glow-primary:${escAttr(glowVars["--orbita-timeline-glow-primary"])};--orbita-timeline-glow-opacity:${escAttr(glowVars["--orbita-timeline-glow-opacity"])}`;
    let html="";
    const planTimes=line.plan?`计划 ${when(Date.parse(line.plan.action.plannedStartAt!))}–${when(Date.parse(line.plan.action.plannedEndAt!))}`:"";
    const actualTimes=line.source?`实际 ${when(line.source.start)}–${when(line.source.end)}`:"";
    // Inset and the minimum visible stub are screen pixels. hourPx carries zoom,
    // so the same duration grows into a line only after it clears the icon.
    const msPerPx=3_600_000/hourPx, radiusMs=RADIUS*msPerPx, minMs=MIN_LINE*msPerPx;
    const icons=endpointIcons(line);
    const shown=icons.length>=2&&icons[icons.length-1]-icons[0]-2*radiusMs<minMs?[icons[0]]:icons;
    const hidden=new Set(icons.filter(t=>!shown.includes(t)));
    const spanStart=icons[0]??line.start, spanEnd=line.kind==="activity"||line.source?.kind==="nap"?line.end:(icons[icons.length-1]??line.end);
    const connectorShort=shown.length>0&&spanEnd-spanStart-shown.length*radiusMs<minMs;
    if(line.kind!=="meal")for(const span of line.spans){if(span.start>=dayEnd||span.end<=day.start)continue;
      const cuts=[Math.max(day.start,span.start),Math.min(dayEnd,span.end),...line.spans.flatMap(s=>[s.start,s.end]).filter(t=>t>Math.max(day.start,span.start)&&t<Math.min(dayEnd,span.end))].sort((a,b)=>a-b);
      for(let i=1;i<cuts.length;i++){if(cuts[i]<=cuts[i-1])continue;const midpoint=(cuts[i]+cuts[i-1])/2;
        const planned=line.spans.some(s=>!s.actual&&s.start<=midpoint&&midpoint<s.end),actual=line.spans.some(s=>s.actual&&s.start<=midpoint&&midpoint<s.end);
        if(!span.actual&&actual)continue;
        let from=cuts[i-1], to=cuts[i], fadeStart=false, fadeEnd=false;
        if(connectorShort&&from>=spanStart-1&&to<=spanEnd+1)continue;
        for(const t of shown){if(Math.abs(from-t)<1){from=t+radiusMs;fadeStart=true;}if(Math.abs(to-t)<1){to=t-radiusMs;fadeEnd=true;}}
        if(!(to>from))continue;
        const title=[...(planned?[planTimes]:[]),...(actual?[actualTimes]:[])].join("\n");
        const a=y(from),b=y(to);
        const fade=timelineSegmentFadePx(b-a);
        const dash=span.actual?"":timelinePlannedDashSvg();
        const stroke=span.awake?roles.unfinishedBackground:color;
        const segmentClass=`week-health-segment ${timelineSegmentClassNames({ actual: span.actual, fadeStart, fadeEnd, awake: span.awake })}`;
        const pauseLayer=line.kind==="activity"&&span.awake?"z-index:1;":"";
        html+=`<span class="${segmentClass}" ${attrs} style="top:${a}px;height:${Math.max(1,b-a)}px;${pauseLayer}--health-fade:${fade}px;--orbita-timeline-fade:${fade}px;color:${escAttr(stroke)}" title="${escAttr(title)}">${dash}</span>`;
      }
    }
    const points:{t:number;actual:boolean;label:string;icon?:string}[]=[];
    if(line.kind==="meal"&&line.source) { const category=normalizeMealSlot(line.source.slot); points.push({t:line.source.start,actual:true,label:`${mealSlotLabel(category)} · ${line.source.title} · ${when(line.source.start)}`,icon:mealIcon(line.source.iconKey)}); }
    else {
      const icons=line.kind==="sleep"?[svg('<path d="M4 5h6l-6 7h6M14 12h6l-6 7h6"/>'),svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>')]:[activityTypeGlyph(line.source?.activityType??line.plan?.detail.activityType),""];
      if(line.plan&&!(line.kind==="activity"&&line.source)) { points.push({t:Date.parse(line.plan.action.plannedStartAt!),actual:false,label:`计划开始 ${when(Date.parse(line.plan.action.plannedStartAt!))}`,icon:line.source?undefined:icons[0]});points.push({t:Date.parse(line.plan.action.plannedEndAt!),actual:false,label:`计划结束 ${when(Date.parse(line.plan.action.plannedEndAt!))}`,icon:line.source?undefined:icons[1]}); }
      if(line.source){points.push({t:line.source.start,actual:true,label:`实际开始 ${when(line.source.start)}`,icon:icons[0]});if(line.source.kind!=="nap")points.push({t:line.source.end,actual:true,label:`实际结束 ${when(line.source.end)}`,icon:icons[1]});}
    }
    points.sort((a,b)=>a.t-b.t);
    const groups:typeof points[]=[];
    for(const p of points.filter(p=>p.t>=day.start&&p.t<dayEnd)){const tail=groups[groups.length-1];if(tail&&Math.abs(y(p.t)-y(tail[0].t))<=FUSE)tail.push(p);else groups.push([p]);}
    for(const group of groups){const p=group.find(p=>p.actual&&p.icon)??group.find(p=>p.actual)??group[0];if(p.t<day.start||p.t>=dayEnd)continue;
      if(p.icon&&hidden.has(p.t))continue;
      if(line.kind==="activity"&&connectorShort&&!p.icon)continue;
      const plannedPoint=group.find(point=>!point.actual);
      const edge=line.plan&&plannedPoint?(plannedPoint.label.startsWith("计划开始")?"start":"end"):null;
      html+=`<button type="button" class="week-health-point orbita-timeline-point${group.some(p=>p.actual)?" is-actual":""}${p.icon?" has-icon":""}${line.kind==="activity"&&p.icon?" is-activity-icon":""}" ${attrs}${edge?` data-health-plan-edge data-action-id="${escAttr(line.plan!.action.id)}" data-edge="${edge}"`:""} style="top:${y(p.t)}px;color:${escAttr(color)}" title="${escAttr(group.map(p=>p.label).join("\n"))}">${p.icon??""}</button>`;
    }
    if (dragEndpoint && line.plan?.action.id === dragEndpoint.actionId) {
      const instant = Date.parse(dragEndpoint.edge === "start" ? line.plan.action.plannedStartAt! : line.plan.action.plannedEndAt!);
      if (instant >= day.start && instant < dayEnd) {
        html += renderWeekTimeBubble(instant, zone, y(instant), "var(--health-color)");
      }
    }
    const dragLayer = dragEndpoint && line.plan?.action.id === dragEndpoint.actionId ? "z-index:9;" : "";
    return `<div class="${classes}" style="left:${line.lane*LANE}px;${dragLayer}--health-color:${escAttr(color)};${glowStyle}">${html}</div>`;
  }).join("");
}
