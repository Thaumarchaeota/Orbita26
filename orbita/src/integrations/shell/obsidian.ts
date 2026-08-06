import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";

export type ObsidianNote = {
  path: string;
  name: string;
  modified: number;
};

export async function listObsidianNotes(limit = 50, subdir?: string): Promise<ObsidianNote[]> {
  if (isTauri()) {
    return await invoke<ObsidianNote[]>("list_obsidian_notes", {
      limit,
      subdir: subdir?.trim() || null,
    });
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
