const RING_SIZE = 102;
const RING_STROKE = 10;
const RING_PAD = 7;
const RING_VIEW_BOX = `-${RING_PAD} -${RING_PAD} ${RING_SIZE + RING_PAD * 2} ${RING_SIZE + RING_PAD * 2}`;
const STAGE_ANIM_STEP = 0.32;
const STAGE_KEYS = ["deep", "light", "rem"] as const;
const STAGE_COLORS: Record<(typeof STAGE_KEYS)[number], string> = {
  deep: "var(--sleep-stage-deep)",
  light: "var(--sleep-stage-light)",
  rem: "var(--sleep-stage-rem)",
};
const STAGE_LABELS: Record<(typeof STAGE_KEYS)[number], string> = {
  deep: "深睡",
  light: "浅睡",
  rem: "REM",
};
const STAGE_HIT_STROKE = 20;
const STAGE_PAINT_ORDER: (typeof STAGE_KEYS)[number][] = ["rem", "light", "deep"];

export type SleepStages = {
  deep: number;
  light: number;
  rem: number;
  awake?: number;
};

export function sleepStageTotalSeconds(stages: SleepStages): number {
  return (stages.deep || 0) + (stages.light || 0) + (stages.rem || 0);
}

export function formatSleepHours(seconds: number): string {
  if (seconds <= 0) return "--";
  const h = seconds / 3600;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

export function formatSleepStageDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function formatSleepCenter(seconds: number): string {
  if (seconds <= 0) return "0m";
  return formatSleepStageDuration(seconds);
}

export function buildSleepTip(nightSec: number, score: number | null | undefined, napSec: number): string {
  return [
    `夜间睡眠：${formatSleepStageDuration(nightSec)}`,
    `睡眠评分：${score ?? 0}`,
    `小睡：${formatSleepStageDuration(napSec)}`,
  ].join("\n");
}

export function lifeRingHtml(opts: {
  colorVar: string;
  ratio: number;
  value: string;
  label: string;
  tip?: string;
}): string {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, Math.min(1, opts.ratio));
  const offset = c * (1 - ratio);
  const fillLen = c * ratio;
  const cx = RING_SIZE / 2;
  const arc = `rotate(-90 ${cx} ${cx})`;
  const tip = opts.tip ?? `${opts.label}：${opts.value}`;
  const interactive = ratio > 0 ? " life-ring-svg--interactive" : "";
  const progress = ratio > 0
    ? `<g class="life-ring-segment" data-tip="${tip}" data-tip-follow>
        <circle class="life-ring-stage-hit" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="transparent" stroke-width="${STAGE_HIT_STROKE}"
          stroke-dasharray="${fillLen} 999" stroke-dashoffset="0" stroke-linecap="round" transform="${arc}"/>
        <circle class="life-ring-progress life-ring-progress--animate" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"
          stroke="var(${opts.colorVar})" stroke-dasharray="${c}" stroke-dashoffset="${c}" stroke-linecap="round"
          style="--ring-c:${c};--ring-off:${offset}" transform="${arc}"/>
      </g>`
    : `<circle class="life-ring-progress life-ring-progress--animate" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"
        stroke="var(${opts.colorVar})" stroke-dasharray="${c}" stroke-dashoffset="${c}" stroke-linecap="round"
        style="--ring-c:${c};--ring-off:${offset}" transform="${arc}"/>`;
  return `
    <div class="life-ring-graphic">
      <svg class="life-ring-svg${interactive}" viewBox="${RING_VIEW_BOX}" aria-hidden="true">
        <circle class="life-ring-track" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"/>
        ${progress}
      </svg>
      <div class="life-ring-center">
        <span class="life-ring-val">${opts.value}</span>
        <span class="life-ring-label">${opts.label}</span>
      </div>
    </div>`;
}

export function sleepStageRingHtml(opts: {
  stages: SleepStages;
  goalHours: number;
  totalSeconds: number;
}): string {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const cx = RING_SIZE / 2;
  const total = sleepStageTotalSeconds(opts.stages);
  const goalSec = opts.goalHours * 3600;
  const fillLen = total > 0 ? c * Math.min(1, total / goalSec) : 0;

  let acc = 0;
  const segments = STAGE_KEYS.map((key) => {
    const sec = opts.stages[key] || 0;
    const len = total > 0 ? (sec / total) * fillLen : 0;
    const off = -acc;
    acc += len;
    return { key, sec, len, off, color: STAGE_COLORS[key] };
  }).filter((s) => s.sec > 0);

  const segMap = new Map(segments.map((s) => [s.key, s]));
  const arcs = STAGE_PAINT_ORDER.filter((key) => segMap.has(key))
    .map((key) => segMap.get(key)!)
    .map((s) => {
      const delay = STAGE_KEYS.indexOf(s.key) * STAGE_ANIM_STEP;
      const tip = `${STAGE_LABELS[s.key]}：${formatSleepStageDuration(s.sec)}`;
      const arc = `rotate(-90 ${cx} ${cx})`;
      return `<g class="life-ring-segment" data-tip="${tip}" data-tip-follow>
        <circle class="life-ring-stage-hit" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="transparent" stroke-width="${STAGE_HIT_STROKE}"
          stroke-dasharray="${s.len} 999" stroke-dashoffset="${s.off}" stroke-linecap="round" transform="${arc}"/>
        <circle class="life-ring-stage life-ring-stage--animate" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"
          stroke="${s.color}" stroke-dasharray="0 999" stroke-dashoffset="${s.off}" stroke-linecap="round"
          style="--seg-len:${s.len};--seg-off:${s.off};--seg-delay:${delay}s" transform="${arc}"/>
      </g>`;
    })
    .join("");

  return `
    <div class="life-ring-graphic life-ring-graphic--sleep">
      <svg class="life-ring-svg life-ring-svg--interactive" viewBox="${RING_VIEW_BOX}">
        <circle class="life-ring-track" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"/>
        ${arcs}
      </svg>
      <div class="life-ring-center">
        <span class="life-ring-val">${formatSleepCenter(opts.totalSeconds)}</span>
        <span class="life-ring-label">睡眠</span>
      </div>
    </div>`;
}

const INTAKE_COLORS = ["#d4a054", "#c99248", "#b87e3c", "#a86c38"];
const EXP_COLORS = ["#4aaa6a", "#3d9260"];
const HYDRATION_COLOR = "#5ba8d4";

function halfArcSegments(
  cx: number,
  r: number,
  halfC: number,
  segments: { value: number; color: string; tip: string }[],
  goal: number,
  flip: boolean,
): string {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const fillLen = goal > 0 && total > 0 ? halfC * Math.min(1, total / goal) : 0;
  let acc = 0;
  const arc = `rotate(-90 ${cx} ${cx})`;
  const flipT = flip ? `rotate(180 ${cx} ${cx})` : "";
  const parts = segments
    .filter((s) => s.value > 0)
    .map((seg, i) => {
      const len = total > 0 ? (seg.value / total) * fillLen : 0;
      if (len <= 0) return "";
      const off = -acc;
      acc += len;
      const delay = i * STAGE_ANIM_STEP;
      return `<g class="life-ring-segment" data-tip="${seg.tip}" data-tip-follow transform="${flipT}">
        <circle class="life-ring-stage-hit" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="transparent" stroke-width="${STAGE_HIT_STROKE}"
          stroke-dasharray="${len} 999" stroke-dashoffset="${off}" stroke-linecap="round" transform="${arc}"/>
        <circle class="life-ring-stage life-ring-stage--animate" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"
          stroke="${seg.color}" stroke-dasharray="0 999" stroke-dashoffset="${off}" stroke-linecap="round"
          style="--seg-len:${len};--seg-off:${off};--seg-delay:${delay}s" transform="${arc}"/>
      </g>`;
    })
    .join("");
  return parts;
}

export function calorieRingHtml(opts: {
  intakeKcal: number;
  totalCalories: number;
  activeCalories: number;
  slotKcal: { breakfast: number; lunch: number; dinner: number; snack: number };
  goalIntake: number;
  goalExp: number;
}): string {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const halfC = c / 2;
  const cx = RING_SIZE / 2;
  const resting = Math.max(0, opts.totalCalories - opts.activeCalories);
  const intakeSegs = [
    { value: opts.slotKcal.breakfast, color: INTAKE_COLORS[0], tip: `早餐：${opts.slotKcal.breakfast}kcal` },
    { value: opts.slotKcal.lunch, color: INTAKE_COLORS[1], tip: `午餐：${opts.slotKcal.lunch}kcal` },
    { value: opts.slotKcal.dinner, color: INTAKE_COLORS[2], tip: `晚餐：${opts.slotKcal.dinner}kcal` },
    { value: opts.slotKcal.snack, color: INTAKE_COLORS[3], tip: `其他：${opts.slotKcal.snack}kcal` },
  ];
  const expSegs = [
    { value: resting, color: EXP_COLORS[0], tip: `基础：${resting}kcal` },
    { value: opts.activeCalories, color: EXP_COLORS[1], tip: `活动：${opts.activeCalories}kcal` },
  ];
  const intakeArcs = halfArcSegments(cx, r, halfC, intakeSegs, opts.goalIntake, true);
  const expArcs = halfArcSegments(cx, r, halfC, expSegs, opts.goalExp, false);
  const intakeVal = String(Math.round(opts.intakeKcal));
  const expVal = String(Math.round(opts.totalCalories));
  const interactive = intakeArcs || expArcs ? " life-ring-svg--interactive" : "";
  return `
    <div class="life-ring-graphic life-ring-graphic--calorie">
      <svg class="life-ring-svg${interactive}" viewBox="${RING_VIEW_BOX}">
        <circle class="life-ring-track" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"/>
        ${expArcs}
        ${intakeArcs}
      </svg>
      <div class="life-ring-center life-ring-center--calorie">
        <span class="life-ring-val">${intakeVal}/${expVal}</span>
        <span class="life-ring-label">摄入 / 消耗</span>
      </div>
    </div>`;
}

export function hydrationRingHtml(opts: {
  hydrationMl: number;
  goalHydration: number;
}): string {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const cx = RING_SIZE / 2;
  const ratio = opts.goalHydration > 0 ? opts.hydrationMl / opts.goalHydration : 0;
  const fillLen = c * Math.min(1, Math.max(0, ratio));
  const offset = c * (1 - Math.min(1, Math.max(0, ratio)));
  const arc = `rotate(-90 ${cx} ${cx})`;
  const tip = `喝水：${Math.round(opts.hydrationMl)}ml`;
  const value = String(Math.round(opts.hydrationMl));
  const interactive = ratio > 0 ? " life-ring-svg--interactive" : "";
  const progress =
    ratio > 0
      ? `<g class="life-ring-segment" data-tip="${tip}" data-tip-follow>
        <circle class="life-ring-stage-hit" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="transparent" stroke-width="${STAGE_HIT_STROKE}"
          stroke-dasharray="${fillLen} 999" stroke-dashoffset="0" stroke-linecap="round" transform="${arc}"/>
        <circle class="life-ring-progress life-ring-progress--animate" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"
          stroke="${HYDRATION_COLOR}" stroke-dasharray="${c}" stroke-dashoffset="${c}" stroke-linecap="round"
          style="--ring-c:${c};--ring-off:${offset}" transform="${arc}"/>
      </g>`
      : "";
  return `
    <div class="life-ring-graphic life-ring-graphic--water">
      <svg class="life-ring-svg${interactive}" viewBox="${RING_VIEW_BOX}">
        <circle class="life-ring-track" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${RING_STROKE}"/>
        ${progress}
      </svg>
      <div class="life-ring-center">
        <span class="life-ring-val">${value}</span>
        <span class="life-ring-label">喝水</span>
      </div>
    </div>`;
}

export const sleepRingHtml = sleepStageRingHtml;

export const SLEEP_GOAL_H = 8;

