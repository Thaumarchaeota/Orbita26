import { minuteAt, type BusinessZone } from "./arrangement-model";

export function renderWeekTimeBubble(instant: number, zone: BusinessZone, top: number, color: string): string {
  const minute = minuteAt(instant, zone);
  const label = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `<span class="arrangement-preview" aria-hidden="true" style="left:24px;top:${top}px;bottom:auto;transform:translateY(-50%);white-space:nowrap;color:${color}">${label}</span>`;
}
