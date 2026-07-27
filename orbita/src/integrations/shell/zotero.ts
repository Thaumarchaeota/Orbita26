import { invoke } from "@tauri-apps/api/core";
import { openObsidianNote } from "./obsidian";

export type ZoteroItem = {
  id: number;
  key: string;
  item_type: string;
  title: string;
  date_modified: string;
  note_path: string | null;
};

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function listZoteroItems(limit = 20): Promise<ZoteroItem[]> {
  if (isTauri()) {
    return await invoke<ZoteroItem[]>("list_zotero_items", { limit });
  }
  return [];
}

export async function openZoteroItem(key: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_external_url", {
    url: `zotero://select/library/items/${key}`,
  });
}

export { openObsidianNote };
