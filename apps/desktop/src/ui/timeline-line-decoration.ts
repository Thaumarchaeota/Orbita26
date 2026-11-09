import "./timeline-line-decoration.css";

export const TIMELINE_CONNECTOR_WIDTH_PX = 2.5;
export const TIMELINE_DASH_STROKE_WIDTH = 2.5;
export const TIMELINE_DASH_PATTERN = "4 12";

export type TimelineSegmentLineStyle = "solid" | "planned-dash";

export type TimelineSegmentDecoration = {
  lineStyle: TimelineSegmentLineStyle;
  fadeStart: boolean;
  fadeEnd: boolean;
  fadePx: number;
};

export function timelineSegmentFadePx(segmentHeightPx: number): number {
  return Math.min(8, Math.max(2, segmentHeightPx * 0.35));
}

export function timelinePlannedDashSvg(className = "orbita-timeline-dash"): string {
  return `<svg class="${className}" aria-hidden="true"><line x1="1.5" y1="0" x2="1.5" y2="100%" stroke="currentColor" stroke-width="${TIMELINE_DASH_STROKE_WIDTH}" stroke-dasharray="${TIMELINE_DASH_PATTERN}" stroke-linecap="round"/></svg>`;
}

export function timelineSegmentClassNames(options: {
  actual: boolean;
  fadeStart?: boolean;
  fadeEnd?: boolean;
  awake?: boolean;
}): string {
  const parts = [
    "orbita-timeline-line-segment",
    options.actual ? "is-actual" : "is-planned",
  ];
  if (options.awake) parts.push("is-awake");
  if (options.fadeStart) parts.push("is-fade-start");
  if (options.fadeEnd) parts.push("is-fade-end");
  return parts.join(" ");
}

export function timelineSegmentInnerHtml(lineStyle: TimelineSegmentLineStyle): string {
  return lineStyle === "planned-dash" ? timelinePlannedDashSvg() : "";
}

export function timelineGlowCssVars(glowPrimary: string, glowOpacity: number | string): Record<string, string> {
  return {
    "--orbita-timeline-glow-primary": glowPrimary,
    "--orbita-timeline-glow-opacity": String(glowOpacity),
  };
}
