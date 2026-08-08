import type { Entry } from "./types";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatTags(tags: string[]): string {
  if (!tags.length) return "";
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function cloneEntries(entries: Entry[]): Entry[] {
  return JSON.parse(JSON.stringify(entries));
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseTagsString(s: string): string[] {
  if (!s || !String(s).trim()) return [];
  return String(s)
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ""))
    .filter(Boolean);
}
