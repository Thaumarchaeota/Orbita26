import { getSettings } from "../../core/settings";
import { beijingToday, garminStatus, garminSync, journalConfigured, syncFromDate } from "./client";

let syncing = false;
let timer: number | null = null;
let lastSlotKey = "";

function beijingParts() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    y: parts.year,
    mo: parts.month,
    d: parts.day,
    h: Number(parts.hour),
    min: Number(parts.minute),
    sec: Number(parts.second),
  };
}

function currentSlotKey(): string {
  const { y, mo, d, h, min } = beijingParts();
  const slot = min < 30 ? 0 : 30;
  return `${y}-${mo}-${d}T${h}:${String(slot).padStart(2, "0")}`;
}

function msUntilNextHalfHour(): number {
  const { min, sec } = beijingParts();
  const ms = new Date().getMilliseconds();
  const nextSlotMin = min < 30 ? 30 : 60;
  const deltaMin = nextSlotMin - min;
  return Math.max(500, (deltaMin * 60 - sec) * 1000 - ms);
}

export async function runGarminSyncSilent(): Promise<boolean> {
  if (syncing) return false;
  if (!journalConfigured(getSettings())) return false;
  try {
    const status = await garminStatus();
    if (!status.loggedIn) return false;
  } catch {
    return false;
  }
  syncing = true;
  try {
    const res = await garminSync({ from: syncFromDate(7), to: beijingToday() });
    if (res.ok) {
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
      return true;
    }
  } catch {
    /* silent */
  } finally {
    syncing = false;
  }
  return false;
}

function scheduleNext() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => void tick(), msUntilNextHalfHour());
}

async function tick() {
  const key = currentSlotKey();
  if (key !== lastSlotKey) {
    lastSlotKey = key;
    await runGarminSyncSilent();
  }
  scheduleNext();
}

export function initGarminAutoSync() {
  lastSlotKey = "";
  scheduleNext();
}
