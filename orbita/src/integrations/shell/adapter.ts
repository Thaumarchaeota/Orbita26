import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../../core/data/client";

export async function openUrl(url: string): Promise<void> {
  if (isTauri()) {
    await tauriOpenUrl(url);
    return;
  }
  window.open(url, "_blank");
}

export async function launchV2ray(): Promise<void> {
  if (isTauri()) {
    await invoke("launch_v2ray");
    return;
  }
  window.location.href = "v2rayn://open";
}

export async function pickAppFile(): Promise<string | null> {
  if (isTauri()) {
    return await invoke<string | null>("pick_app_file");
  }
  const path = prompt("程序路径");
  return path?.trim() || null;
}

export async function pickLocalFile(): Promise<string | null> {
  if (isTauri()) {
    return await invoke<string | null>("pick_local_file");
  }
  const path = prompt("文件路径");
  return path?.trim() || null;
}

export async function pickLocalFolder(): Promise<string | null> {
  if (isTauri()) {
    return await invoke<string | null>("pick_local_folder");
  }
  const path = prompt("文件夹路径");
  return path?.trim() || null;
}

export async function openLocalPath(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_local_path", { path });
    return;
  }
  alert("需完整 App 打开本地路径");
}

export async function openWithCursor(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_with_cursor", { path });
    return;
  }
  alert("需完整 App 用 Cursor 打开");
}

export async function openWithSystemDialog(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_with_dialog", { path });
    return;
  }
  alert("需完整 App 选择打开方式");
}

export async function openRecycleBin(): Promise<void> {
  if (isTauri()) {
    await invoke("open_recycle_bin");
    return;
  }
  alert("需完整 App 打开回收站");
}

export async function revealPathInExplorer(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("reveal_path_in_explorer", { path });
    return;
  }
  alert("需完整 App 打开文件路径");
}

export type EverythingHit = { path: string; name: string; isDir: boolean };

export async function searchEverything(query: string, limit = 50): Promise<EverythingHit[]> {
  if (isTauri()) {
    return await invoke<EverythingHit[]>("search_everything", { query, limit });
  }
  return [];
}

export async function getFileTypeIcons(
  items: Pick<EverythingHit, "path" | "isDir">[],
): Promise<Map<string, string>> {
  if (!isTauri() || !items.length) return new Map();
  const rows = await invoke<{ path: string; data_url: string | null }[]>("get_file_type_icons", {
    items: items.map((i) => ({ path: i.path, is_dir: i.isDir })),
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.data_url) map.set(row.path, row.data_url);
  }
  return map;
}

export async function launchApp(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("launch_app", { path });
    return;
  }
  alert("需完整 App 启动本地应用");
}

export async function cacheAppIcon(appId: string, path: string): Promise<string | null> {
  if (isTauri()) {
    return await invoke<string | null>("cache_app_icon", { appId, path });
  }
  return null;
}

export async function deleteAppIcon(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_app_icon", { path });
  }
}

export async function readAppIconData(path: string): Promise<string | null> {
  if (isTauri()) {
    return await invoke<string | null>("read_app_icon_data", { path });
  }
  return null;
}

export async function cacheFavicon(bookmarkId: string, url: string): Promise<string | null> {
  if (isTauri()) {
    return await invoke<string | null>("cache_favicon", { bookmarkId, url });
  }
  return null;
}

export async function deleteFavicon(path: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_favicon", { path });
  }
}

export function webFaviconSrc(url: string): string {
  const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
}
