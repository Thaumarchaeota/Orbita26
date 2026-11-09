import { escAttr, escHtml } from "../../../../core/html";
import { dateAt, layoutDay, minuteAt, type BusinessZone, type LayoutFragment, type PlanFragment } from "./arrangement-model";
import "./task.css";
import "./arrangement-week-polish.css";

export type ArrangementWeekBlockInput = {
  kind: "action" | "checkpoint" | "session";
  id: string;
  start: number;
  end: number;
  realStart: boolean;
  realEnd: boolean;
  left: number;
  width: number;
  dense: boolean;
  insetPx?: number;
  actualIntervals?: readonly { start: number; end: number }[];
  labelStart?: number;
  labelEnd?: number;
  ended?: boolean;
  selected?: boolean;
  preview?: boolean;
  title?: string;
  sourceColor?: string;
  color?: string;
  titleColor?: string;
  background?: string;
  flight?: { departureCode: string; arrivalCode: string };
  checkpointTime?: string;
  pointPreview?: boolean;
};

export type ArrangementWeekRenderInput = {
  date: string;
  zone: BusinessZone;
  hourPx: number;
  blocks: readonly ArrangementWeekBlockInput[];
};

export type ArrangementWeekScenarioInput = {
  date: string;
  hourPx: number;
  blocks: readonly {
    id: string;
    startMinute: number;
    endMinute: number;
    sessionId?: string | null;
    ended?: boolean;
    selected?: boolean;
    title?: string;
    color: string;
    background: string;
  }[];
};

const fmt = (minute: number) => {
  const local = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}`;
};
const DAY_MS = 86_400_000;
export const actionTextLayout = (height: number) => ({
  showTitle: height >= 25,
  showTime: height >= 45,
  titleLines: Math.max(1, Math.min(3, Math.floor((height - 8 - (height >= 45 ? 20 : 0)) / 16.8))),
});

function arrangementStripeHash(value: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function arrangementStripeStops(id: string): string {
  const topCenter = 4 + arrangementStripeHash(id, 0x13579bdf) % 9;
  const topRadius = 3 + arrangementStripeHash(id, 0x9e3779b9) % 4;
  const deepCenter = 44 + arrangementStripeHash(id, 0x7f4a7c15) % 13;
  const deepRadius = 7 + arrangementStripeHash(id, 0x2468ace0) % 6;
  const bottomCenter = 88 + arrangementStripeHash(id, 0x31415926) % 9;
  const bottomRadius = 3 + arrangementStripeHash(id, 0x27182818) % 4;
  const soft = "var(--arrangement-stripe-soft)";
  const main = "var(--arrangement-color)";
  const stops = `${soft} ${Math.max(0, topCenter - topRadius)}%, ${soft} ${topCenter + topRadius}%, ${main} ${deepCenter - deepRadius}%, ${main} ${deepCenter + deepRadius}%, ${soft} ${bottomCenter - bottomRadius}%, ${soft} ${Math.min(100, bottomCenter + bottomRadius)}%`;
  return `;--arrangement-stripe-stops:${stops}`;
}

function wallMinute(instant: number, date: string, zone: BusinessZone): number {
  return minuteAt(instant, zone) + ((instant % 60_000 + 60_000) % 60_000) / 60_000 + (Date.parse(`${dateAt(instant, zone)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS * 1440;
}

/** Shared block markup; callers own the surrounding grid and all event handling. */
export function renderArrangementWeekBlocks(input: ArrangementWeekRenderInput): string {
  return input.blocks.map((part) => {
    const preview = !!part.preview;
    const startMinute = wallMinute(part.start, input.date, input.zone);
    const endMinute = wallMinute(part.end, input.date, input.zone);
    const top = startMinute / 60 * input.hourPx;
    const wallSpan = endMinute - startMinute;
    if (wallSpan <= 0) throw new Error(`${input.date} 的业务时间无法按墙上刻度投影`);
    const height = part.kind === "checkpoint" ? 48 : Math.max(12, wallSpan / 60 * input.hourPx);
    const inset = part.insetPx ?? 0;
    const width = `calc(${part.width * 100}% - ${8+inset*part.width}px)`;
    const style = `top:${top}px;height:${height}px;left:calc(${part.left * 100}% + ${4+inset*(1-part.left)}px);width:${inset?`max(12px,${width})`:width}`;
    const projection = `data-start-minute="${startMinute}" data-duration-minutes="${wallSpan}" data-layout-left="${part.left}" data-layout-width="${part.width}" data-health-inset="${inset}"`;
    const dateAttr = escAttr(input.date);
    if (part.kind === "session") return `<div class="arrangement-session${part.selected ? " is-selected" : ""}${preview ? " is-preview" : ""}" data-session-id="${preview ? "" : escAttr(part.id)}" data-date="${dateAttr}" ${projection} style="${style}">
      ${part.realStart ? `<span class="arrangement-handle top" data-edge="start"></span>` : ""}${part.realEnd ? `<span class="arrangement-handle bottom" data-edge="end"></span>` : ""}</div>`;
    if (part.kind === "checkpoint") return `<div class="arrangement-action is-checkpoint${part.ended ? " is-ended" : ""}${part.selected ? " is-selected" : ""}${part.dense ? " is-dense" : ""}${preview ? " is-preview" : ""}"${preview ? " aria-hidden=\"true\"" : ` data-checkpoint-id="${escAttr(part.id)}"` }${part.sourceColor ? ` data-source-color="${escAttr(part.sourceColor)}"` : ""} data-date="${dateAttr}" ${projection} style="${style};--arrangement-color:${escAttr(part.color ?? "#87909a")};--arrangement-title-color:${escAttr(part.titleColor ?? "var(--insight-text-primary)")};--arrangement-background:${escAttr(part.background ?? "color-mix(in srgb, var(--arrangement-color) 16%, var(--insight-control-surface-bg))")}${arrangementStripeStops(part.id)}" title="${escAttr(part.title ?? "")} ${escAttr(part.checkpointTime ?? "")}">
      <div class="arrangement-checkpoint-copy"><span class="arrangement-checkpoint-checkbox-host" data-checkpoint-id="${preview ? "" : escAttr(part.id)}"></span><span class="arrangement-checkpoint-text"><span class="arrangement-checkpoint-title">${escHtml(part.title ?? "")}</span><span class="arrangement-checkpoint-time">${escHtml(part.checkpointTime ?? "")}</span></span></div></div>`;
    const color = part.color ?? "#87909a";
    const labelStart = part.labelStart !== undefined && part.labelEnd !== undefined && part.labelEnd > part.labelStart
      ? wallMinute(part.labelStart, input.date, input.zone) : startMinute;
    const labelEnd = part.labelStart !== undefined && part.labelEnd !== undefined && part.labelEnd > part.labelStart
      ? wallMinute(part.labelEnd, input.date, input.zone) : endMinute;
    const actual = part.actualIntervals?.length ? part.actualIntervals : undefined;
    // Project interval edges on the same business-wall scale as the surrounding fragment (ADR 0020).
    const ranges = actual?.map((interval) => ({
      start: Math.max(0, Math.min(100, (wallMinute(Math.max(part.start, interval.start), input.date, input.zone) - startMinute) / wallSpan * 100)),
      end: Math.max(0, Math.min(100, (wallMinute(Math.min(part.end, interval.end), input.date, input.zone) - startMinute) / wallSpan * 100)),
    })).filter((range) => range.end > range.start) ?? [];
    const fill = "var(--arrangement-background, color-mix(in srgb, var(--arrangement-color) 16%, var(--insight-control-surface-bg)))";
    const stops = (paint: string) => ["transparent 0%", ...ranges.flatMap((range) => [
      `transparent ${range.start}%`, `${paint} ${range.start}%`, `${paint} ${range.end}%`, `transparent ${range.end}%`,
    ]), "transparent 100%"].join(",");
    const actualStyle = actual ? `;--arrangement-actual-fill:linear-gradient(to bottom,${stops(fill)});--arrangement-actual-mask:linear-gradient(to bottom,${stops("black")})` : "";
    const textLayout = actionTextLayout(height);
    const text = part.flight
      ? `<div class="arrangement-flight-copy"><span class="arrangement-flight-code">${escHtml(part.flight.departureCode || "—")}</span><span class="arrangement-flight-time">${fmt(startMinute)}</span><span class="arrangement-flight-direction" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M8 1v12M4.5 9.5 8 13l3.5-3.5" /></svg></span><span class="arrangement-flight-code">${escHtml(part.flight.arrivalCode || "—")}</span><span class="arrangement-flight-time">${fmt(endMinute)}</span></div>`
      : part.dense ? "" : `<span class="arrangement-action-title" style="-webkit-line-clamp:${textLayout.titleLines}"${textLayout.showTitle ? "" : " hidden"}>${escHtml(part.title ?? "")}</span><small${textLayout.showTime ? "" : " hidden"}>${fmt(labelStart)}–${fmt(labelEnd)}</small>`;
    const backgroundStyle = part.flight ? "" : part.background ? `;--arrangement-background:${escAttr(part.background)}` : "";
    const titleStyle = part.flight || !part.titleColor ? "" : `;--arrangement-title-color:${escAttr(part.titleColor)}`;
    const stripeStyle = part.flight ? "" : arrangementStripeStops(part.id);
    return `<div class="arrangement-action${actual ? " has-actual-intervals" : ""}${part.flight ? " is-flight" : ""}${part.ended ? " is-ended" : ""}${part.selected ? " is-selected" : ""}${part.dense ? " is-dense" : ""}${preview ? " is-preview" : ""}"${preview ? " aria-hidden=\"true\"" : ` data-action-id="${escAttr(part.id)}"` }${part.sourceColor ? ` data-source-color="${escAttr(part.sourceColor)}"` : ""} data-date="${dateAttr}" ${projection} style="${style};--arrangement-color:${escAttr(color)}${titleStyle}${backgroundStyle}${stripeStyle}${actualStyle}" title="${escAttr(part.title ?? "")} ${fmt(labelStart)}–${fmt(labelEnd)}">
      ${part.realStart ? `<span class="arrangement-handle top" data-edge="start"></span>` : ""}<div class="arrangement-action-copy">${text}</div>${part.realEnd ? `<span class="arrangement-handle bottom" data-edge="end"></span>` : ""}</div>`;
  }).join("");
}

/** Read-only N×2 adapter. It uses the production layoutDay and block renderer (SPEC-0006 §4.5/§7). */
function scenarioRenderInput(input: ArrangementWeekScenarioInput): ArrangementWeekRenderInput {
  const midnight = Date.parse(`${input.date}T00:00:00Z`);
  const raw: Array<PlanFragment & { presentation: ArrangementWeekScenarioInput["blocks"][number] }> = input.blocks.map((block) => ({
    kind: "action", id: block.id, date: input.date, start: midnight + block.startMinute * 60_000, end: midnight + block.endMinute * 60_000,
    realStart: true, realEnd: true, sessionId: block.sessionId ?? null, presentation: block,
  }));
  const laid = layoutDay(raw).filter((part) => part.kind === "action") as Array<LayoutFragment & { presentation: ArrangementWeekScenarioInput["blocks"][number] }>;
  return { date: input.date, zone: { baseOffset: "+00:00", replacements: [] }, hourPx: input.hourPx,
    blocks: laid.map((part) => ({ ...part, ...part.presentation })) };
}

export type ArrangementWeekRendererHandle = { update(input: ArrangementWeekRenderInput): void; dispose(): void };
export type ArrangementWeekScenarioRendererHandle = { update(input: ArrangementWeekScenarioInput): void; dispose(): void };
export function mountArrangementWeekRenderer(host: HTMLElement, input: ArrangementWeekRenderInput): ArrangementWeekRendererHandle {
  const priorClasses = new Set(["arrangement-week", "arrangement-day", "arrangement-week-block-layer"].filter((name) => host.classList.contains(name)));
  const styleProps = ["width", "flex", "--arrangement-hour-height", "--arrangement-grid-height"];
  const priorStyles = new Map(styleProps.map((name) => [name, { value: host.style.getPropertyValue(name), priority: host.style.getPropertyPriority(name) }]));
  host.classList.add("arrangement-week", "arrangement-day", "arrangement-week-block-layer");
  host.style.width = "100%";
  host.style.flex = "none";
  let disposed = false;
  const update = (next: ArrangementWeekRenderInput) => {
    if (disposed) return;
    host.style.setProperty("--arrangement-hour-height", `${next.hourPx}px`);
    host.style.setProperty("--arrangement-grid-height", `${28 * next.hourPx}px`);
    host.innerHTML = renderArrangementWeekBlocks(next);
  };
  update(input);
  return { update, dispose: () => {
    if (disposed) return;
    disposed = true;
    host.replaceChildren();
    for (const name of ["arrangement-week", "arrangement-day", "arrangement-week-block-layer"]) if (!priorClasses.has(name)) host.classList.remove(name);
    for (const name of styleProps) {
      const prior = priorStyles.get(name)!;
      if (prior.value) host.style.setProperty(name, prior.value, prior.priority);
      else host.style.removeProperty(name);
    }
  } };
}

export function mountArrangementWeekScenario(host: HTMLElement, input: ArrangementWeekScenarioInput): ArrangementWeekScenarioRendererHandle {
  const renderer = mountArrangementWeekRenderer(host, scenarioRenderInput(input));
  return { update: (next) => renderer.update(scenarioRenderInput(next)), dispose: () => renderer.dispose() };
}
