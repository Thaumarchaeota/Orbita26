import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

export async function openUrl(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await tauriOpenUrl(url);
    return;
  }
  window.open(url, "_blank");
}

export async function launchV2ray(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("launch_v2ray");
    return;
  }
  window.location.href = "v2rayn://open";
}

export async function pickAppFile(): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    return await invoke<string | null>("pick_app_file");
  }
  const path = prompt("程序路径");
  return path?.trim() || null;
}

export async function pickLocalFile(): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    return await invoke<string | null>("pick_local_file");
  }
  const path = prompt("文件路径");
  return path?.trim() || null;
}

export async function pickLocalFolder(): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    return await invoke<string | null>("pick_local_folder");
  }
  const path = prompt("文件夹路径");
  return path?.trim() || null;
}

export async function openLocalPath(path: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("open_local_path", { path });
    return;
  }
  alert("需完整 App 打开本地路径");
}

export async function launchApp(path: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("launch_app", { path });
    return;
  }
  alert("需完整 App 启动本地应用");
}

export async function cacheAppIcon(appId: string, path: string): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    return await invoke<string | null>("cache_app_icon", { appId, path });
  }
  return null;
}

export async function deleteAppIcon(path: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("delete_app_icon", { path });
  }
}

export async function readAppIconData(path: string): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    return await invoke<string | null>("read_app_icon_data", { path });
  }
  return null;
}

export async function cacheFavicon(bookmarkId: string, url: string): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    return await invoke<string | null>("cache_favicon", { bookmarkId, url });
  }
  return null;
}

export async function deleteFavicon(path: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("delete_favicon", { path });
  }
}

export function webFaviconSrc(url: string): string {
  const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
}
