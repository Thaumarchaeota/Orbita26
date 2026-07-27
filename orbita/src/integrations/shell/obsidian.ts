import { invoke } from "@tauri-apps/api/core";

export type ObsidianNote = {
  path: string;
  name: string;
  modified: number;
};

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function listObsidianNotes(limit = 50): Promise<ObsidianNote[]> {
  if (isTauri()) {
    return await invoke<ObsidianNote[]>("list_obsidian_notes", { limit });
  }
  return [];
}

export async function openObsidianNote(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_external_url", {
    url: `obsidian://open?path=${encodeURIComponent(path)}`,
  });
}

export function formatNoteTime(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString("zh-CN", { hour12: false });
}
