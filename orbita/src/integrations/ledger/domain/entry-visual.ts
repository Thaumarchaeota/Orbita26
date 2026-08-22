import { normEntry } from "./entry";
import type { Entry } from "../types";

export function applyEntryDeleteButton(btn: HTMLButtonElement, deleted: boolean): void {
  btn.classList.toggle("is-undo", deleted);
  btn.setAttribute("aria-label", deleted ? "撤销" : "删除");
  btn.textContent = deleted ? "↩" : "✕";
}

export function entryVisualState(
  entry: Entry,
  baseline: Entry[],
): "deleted" | "new" | "modified" | "unchanged" {
  if (entry._deleted) return "deleted";
  if (entry._is_new) return "new";
  if (!baseline.length) return "unchanged";
  const b = baseline.find((x) => x.id === entry.id);
  if (!b) return "unchanged";
  if (JSON.stringify(normEntry(entry)) !== JSON.stringify(normEntry(b))) return "modified";
  return "unchanged";
}
