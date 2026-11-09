import { escAttr } from "../../../../../core/html";
import {
  timelineGlowCssVars,
  timelinePlannedDashSvg,
  timelineSegmentClassNames,
  timelineSegmentFadePx,
} from "../../../../../ui/timeline-line-decoration";
import { transportationTypeIconSvg } from "../../../../../ui/transportation-type";
import { resolveCategoryRoles } from "../../../../../ui/color-system";
import { dateAt, minuteAt, type BusinessZone } from "../arrangement-model";
import { renderWeekTimeBubble } from "../week-time-bubble";
import { TRAVEL_LANE_WIDTH, type TravelPointView, type TravelSegmentView, type TravelTripLine } from "./week-model";

const POINT_RADIUS_PX = 8;
const CIRCLE_OUTER_RADIUS_PX = 5;
// Outer radius is 5px. Stop inside the 2.5px stroke so the line meets the ring
// instead of leaving a gap, and still stays out of the filled center.
const CIRCLE_RADIUS_PX = 3.5;
const MIN_CONNECTOR_PX = 8;
const CIRCLE_MIN_CONNECTOR_PX = 4;
const MARKER_GAP_PX = 4;
const EMPTY_CIRCLE = `<span class="travel-week-empty-circle" aria-hidden="true"></span>`;

function yAt(t: number, dayDate: string, zone: BusinessZone, hourPx: number): number {
  const minute = minuteAt(t, zone) + (Date.parse(`${dateAt(t, zone)}T00:00:00Z`) - Date.parse(`${dayDate}T00:00:00Z`)) / 86_400_000 * 1440;
  return minute / 60 * hourPx;
}

function pointMarker(point: TravelPointView, segment: TravelSegmentView | undefined, rearSegment: TravelSegmentView | undefined): { html: string; icon: boolean } {
  const circle = { html: EMPTY_CIRCLE, icon: false };
  const icon = (type: string, flightGlyph?: "departure" | "arrival") => ({
    html: transportationTypeIconSvg(type, { size: 16, flightGlyph }),
    icon: true,
  });
  if (point.attachmentKind === "checkpoint") return circle;
  if (point.isShared && rearSegment) {
    if (rearSegment.transportationType === "flight") return icon("flight", "departure");
    return rearSegment.transportationType ? icon(rearSegment.transportationType) : circle;
  }
  if (point.role === "end" && segment?.transportationType === "flight") return icon("flight", "arrival");
  if (point.role === "end") return circle;
  if (point.role === "start" && (rearSegment ?? segment)) {
    const type = (rearSegment ?? segment)!.transportationType;
    if (type === "flight") return icon("flight", "departure");
    return type ? icon(type) : circle;
  }
  return circle;
}

function markerOuterRadius(icon: boolean): number {
  return icon ? POINT_RADIUS_PX : CIRCLE_OUTER_RADIUS_PX;
}

function isDroppableEnd(point: TravelPointView): boolean {
  return point.role === "end" && !point.isShared && point.attachmentKind !== "checkpoint";
}

function keepVisibleMarkers<T extends { point: TravelPointView; icon: boolean }>(markers: T[], hourPx: number): T[] {
  const pxPerMs = hourPx / 3_600_000;
  const collides = (a: T, b: T) => {
    const distance = Math.abs(a.point.atMs - b.point.atMs) * pxPerMs;
    return distance < markerOuterRadius(a.icon) + markerOuterRadius(b.icon) + MARKER_GAP_PX;
  };
  const kept: T[] = [];
  for (const marker of [...markers].sort((a, b) => a.point.atMs - b.point.atMs || a.point.pointId.localeCompare(b.point.pointId))) {
    if (isDroppableEnd(marker.point)) {
      if (kept.some((other) => collides(other, marker))) continue;
      kept.push(marker);
      continue;
    }
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (isDroppableEnd(kept[i].point) && collides(kept[i], marker)) kept.splice(i, 1);
    }
    kept.push(marker);
  }
  return kept;
}

export function renderTravelLinesForDay(
  lines: TravelTripLine[],
  day: { date: string; start: number; end: number },
  zone: BusinessZone,
  hourPx: number,
  selectedItemId: string | null,
  editingItemId: string | null,
  dragEndpoint?: { itemId: string; instant: number } | null,
): string {
  const dayEnd = day.end;
  return lines
    .filter((line) => line.start < dayEnd && line.end >= day.start)
    .map((line) => {
      // Travel stores canonical category HEX; only the display layer follows the active palette.
      const sourceColor = /^#[\da-f]{6}$/i.test(line.color ?? "") ? line.color! : "#87909a";
      const roles = resolveCategoryRoles(sourceColor);
      const color = roles.main;
      const glow = timelineGlowCssVars(roles.glowPrimary, roles.glowPrimaryOpacity);
      const glowStyle = `--orbita-timeline-glow-primary:${escAttr(glow["--orbita-timeline-glow-primary"])};--orbita-timeline-glow-opacity:${escAttr(glow["--orbita-timeline-glow-opacity"])}`;
      const selected = selectedItemId === line.itemId;
      const editing = editingItemId === line.itemId;
      const tripComplete = line.completed;
      const lineStyle = tripComplete ? "solid" : "planned-dash";
      const classes = `travel-week-trip orbita-timeline-line-group${selected ? " is-selected" : ""}${editing ? " is-editing travel-week-foreground" : ""}`;
      const attrs = `data-travel-item="${escAttr(line.itemId)}"`;
      let html = "";
      const pointTimes = line.points.filter((p) => p.atMs >= day.start && p.atMs < dayEnd);
      const markers = pointTimes.map((point) => {
        const seg = line.segments.find((s) => s.actionId === point.ownerActionId && point.role === "end")
          ?? line.segments.find((s) => s.actionId === point.rearActionId && point.role === "start")
          ?? line.segments.find((s) => s.actionId === point.ownerActionId);
        const rear = point.rearActionId ? line.segments.find((s) => s.actionId === point.rearActionId) : undefined;
        return { point, ...pointMarker(point, seg, rear) };
      });
      const visibleMarkers = keepVisibleMarkers(markers, hourPx);

      const drawnRanges = tripComplete ? line.segments.map(s => ({ start: s.startMs, end: s.endMs })) : [{ start: line.start, end: line.end }];
      for (const range of drawnRanges) {
        const tripFrom = Math.max(range.start, day.start);
        const tripTo = Math.min(range.end, dayEnd);
        if (tripTo <= tripFrom) continue;
        const msPerPx = 3_600_000 / hourPx;
        const iconRadiusMs = POINT_RADIUS_PX * msPerPx;
        const circleRadiusMs = CIRCLE_RADIUS_PX * msPerPx;
        const atIcon = (at: number) => visibleMarkers.some((marker) => marker.icon && Math.abs(marker.point.atMs - at) < 1);
        const atCircle = (at: number) => visibleMarkers.some((marker) => !marker.icon && Math.abs(marker.point.atMs - at) < 1);
        const omittedEnd = (at: number) => markers.some((marker) => isDroppableEnd(marker.point) && Math.abs(marker.point.atMs - at) < 1)
          && !visibleMarkers.some((marker) => Math.abs(marker.point.atMs - at) < 1);
        const markerTimes = [...new Set(visibleMarkers.map((marker) => marker.point.atMs).filter((at) => at >= tripFrom && at <= tripTo))].sort((a, b) => a - b);
        const reservedMs = markerTimes.reduce((sum, at) => sum + (atIcon(at) ? iconRadiusMs : circleRadiusMs), 0);
        const spanHasIcon = markerTimes.some((at) => atIcon(at));
        const minMs = (spanHasIcon ? MIN_CONNECTOR_PX : CIRCLE_MIN_CONNECTOR_PX) * msPerPx;
        const connectorShort = !omittedEnd(tripTo) && markerTimes.length > 0 && tripTo - tripFrom - reservedMs < minMs;
        const cuts = [
          tripFrom,
          ...markerTimes.filter((at) => at > tripFrom && at < tripTo),
          tripTo,
        ];
        if (!connectorShort) {
          for (let i = 1; i < cuts.length; i++) {
            let from = cuts[i - 1]!;
            let to = cuts[i]!;
            const rawFrom = from;
            const rawTo = to;
            if (to <= from) continue;
            let fadeStart = i === 1 && range.start < day.start;
            let fadeEnd = i === cuts.length - 1 && range.end > dayEnd;
            if (atIcon(from)) {
              from += iconRadiusMs;
              fadeStart = true;
            } else if (atCircle(from)) {
              from += circleRadiusMs;
            }
            if (atIcon(rawTo)) {
              to -= iconRadiusMs;
              fadeEnd = true;
            } else if (atCircle(rawTo)) {
              to -= circleRadiusMs;
            }
            if (omittedEnd(rawTo) && to <= from) {
              const minStubMs = 2 * msPerPx;
              from = Math.min(from, rawTo - minStubMs);
              to = rawTo;
            }
            if (to <= from) continue;
            const top = yAt(from, day.date, zone, hourPx);
            const bottom = yAt(to, day.date, zone, hourPx);
            const height = bottom - top;
            const pieceMinPx = omittedEnd(rawTo) ? 0 : (atIcon(rawFrom) || atIcon(rawTo) ? MIN_CONNECTOR_PX : CIRCLE_MIN_CONNECTOR_PX);
            if (height <= pieceMinPx) continue;
            const fade = timelineSegmentFadePx(height);
            const connectorClass = `travel-week-segment travel-week-connector ${timelineSegmentClassNames({
              actual: tripComplete,
              fadeStart,
              fadeEnd,
            })}`;
            const dash = tripComplete ? "" : timelinePlannedDashSvg("orbita-timeline-dash travel-week-dash");
            html += `<span class="${connectorClass}" ${attrs} data-travel-connector="1" aria-hidden="true" style="top:${top}px;height:${height}px;--travel-stroke:2.5px;--orbita-timeline-fade:${fade}px;color:${escAttr(color)}">${dash}</span>`;
          }
        }
      }

      for (const segment of line.segments) {
        if (segment.endMs <= day.start || segment.startMs >= dayEnd) continue;
        const from = Math.max(segment.startMs, day.start);
        const to = Math.min(segment.endMs, dayEnd);
        if (to <= from) continue;
        const top = yAt(from, day.date, zone, hourPx);
        const height = Math.max(1, yAt(to, day.date, zone, hourPx) - top);
        html += `<span class="travel-week-segment travel-week-action-hit" ${attrs} data-travel-segment="${escAttr(segment.actionId)}" style="top:${top}px;height:${height}px" title="出行段"></span>`;
      }

      for (const marker of visibleMarkers) {
        const point = marker.point;
        const top = yAt(point.atMs, day.date, zone, hourPx);
        const pointClass = `travel-week-point${marker.icon ? " orbita-timeline-point has-icon" : " is-circle"}`;
        html += `<button type="button" class="${pointClass}" ${attrs} data-travel-point="${escAttr(point.pointId)}" data-travel-checkpoint="${escAttr(point.ownerCheckpointId ?? "")}" data-travel-shared="${point.isShared ? "1" : "0"}" data-travel-role="${escAttr(point.role)}" data-travel-owner-action="${escAttr(point.ownerActionId ?? "")}" data-travel-front-action="${escAttr(point.frontActionId ?? "")}" data-travel-rear-action="${escAttr(point.rearActionId ?? "")}" style="top:${top}px;color:${escAttr(color)}" title="出行点">${marker.html}</button>`;
      }

      if (dragEndpoint?.itemId === line.itemId && dragEndpoint.instant >= day.start && dragEndpoint.instant < dayEnd) {
        html += renderWeekTimeBubble(dragEndpoint.instant, zone, yAt(dragEndpoint.instant, day.date, zone, hourPx), "var(--travel-color)");
      }

      return `<div class="${classes}" style="left:${line.lane * TRAVEL_LANE_WIDTH}px;--travel-color:${escAttr(color)};color:var(--travel-color);${glowStyle}">${html}</div>`;
    })
    .join("");
}
