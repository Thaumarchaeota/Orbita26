import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";

const ICON_STROKE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ADMIN_SVG = `<svg viewBox="0 0 24 24" ${ICON_STROKE}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;

export function openAdminWindow(): void {
  if (!isTauri()) return;
  void invoke("open_admin_window").catch((err: unknown) => {
    alert(typeof err === "string" ? err : String(err));
  });
}

if (import.meta.env.DEV && isTauri()) {
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "f") {
      void invoke("dev_open_finance_detail").catch((err: unknown) => {
        console.error("dev_open_finance_detail failed", err);
      });
    }
  });
}

export function mountAdminButton(root: HTMLElement): void {
  const settingsMount = root.querySelector<HTMLElement>("#settingsMount");
  if (!settingsMount) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "adminBtn";
  btn.className = "top-toolkit-icon-btn";
  btn.dataset.tip = "台后";
  btn.innerHTML = ADMIN_SVG;
  settingsMount.insertAdjacentElement("beforebegin", btn);
  btn.addEventListener("click", () => openAdminWindow());
}
