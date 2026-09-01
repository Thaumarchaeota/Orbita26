import { SETTINGS_GEAR_SVG } from "../../ai/icons";
import { openInsightSettings } from "./nav";

export function isBillDirectory(path: string): boolean {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1)?.toLowerCase() === "bill";
}

export function mountAdminSettingsButton(titlebar: HTMLElement): () => void {
  const spacer = titlebar.querySelector(".admin-titlebar-spacer");
  if (!spacer) return () => {};

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-settings-btn";
  btn.setAttribute("aria-label", "设置");
  btn.innerHTML = SETTINGS_GEAR_SVG;
  titlebar.insertBefore(btn, spacer);

  const ac = new AbortController();
  btn.addEventListener("click", () => openInsightSettings(), { signal: ac.signal });

  return () => ac.abort();
}

export { openInsightSettings } from "./nav";
