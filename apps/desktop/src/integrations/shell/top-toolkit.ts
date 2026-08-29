import { isTauri } from "../../core/data/client";
import { isV2rayRunning, launchV2ray, stopV2ray } from "./adapter";
import { mountSettingsButton } from "../settings";
import { mountAdminButton } from "../admin";
import { mountStatsBar } from "./stats-bar";
import { openCaptureOverlay } from "./capture-overlay";
import { SETTINGS_GEAR_SVG } from "../ai/icons";

const ICON_STROKE =
  "fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"";

const SCREENSHOT_SVG = `<svg viewBox="0 0 24 24" ${ICON_STROKE}><path d="M6 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/><rect x="6" y="3" width="12" height="4" rx="1"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>`;
const V2RAY_SVG = `<svg viewBox="0 0 24 24" ${ICON_STROKE}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

const LBL_V2RAY_START = "启动 v2rayN";
const LBL_V2RAY_STOP = "关闭 v2rayN";
const LBL_V2RAY_START_FAIL = "启动 v2rayN 失败";
const LBL_V2RAY_STOP_FAIL = "关闭 v2rayN 失败";
const LBL_SCREENSHOT = "框选截屏";

function iconBtn(id: string, svg: string, tip: string, disabled = false, className = ""): string {
  const dis = disabled ? " disabled" : "";
  const cls = className ? ` ${className}` : "";
  return `<button type="button" class="top-toolkit-icon-btn${cls}" id="${id}" data-tip="${tip}"${dis}>${svg}</button>`;
}

export function topToolkitHtml(): string {
  return `
    <div class="top-toolkit" id="topToolkit">
      <div class="sys-stats" id="sysStats">
        <div class="sys-stat-item sys-stat-fps">
          <span class="sys-stat-label">FPS</span>
          <span class="sys-stat-val" id="statFps">--</span>
        </div>
        <div class="sys-stat-item">
          <span class="sys-stat-label">CPU</span>
          <span class="sys-stat-val" id="statCpu">--</span>
        </div>
        <div class="sys-stat-item">
          <span class="sys-stat-label">MEM</span>
          <span class="sys-stat-val" id="statMem">--</span>
        </div>
      </div>
      <div class="top-toolkit-divider" aria-hidden="true"></div>
      <div class="top-toolkit-actions">
        ${iconBtn("screenshotBtn", SCREENSHOT_SVG, LBL_SCREENSHOT, false)}
        ${iconBtn("v2rayBtn", V2RAY_SVG, LBL_V2RAY_START, false, "v2ray-btn")}
        <div class="top-toolkit-settings" id="settingsMount"></div>
      </div>
    </div>`;
}

async function syncV2rayBtn(btn: HTMLButtonElement) {
  if (!isTauri()) return;
  try {
    const running = await isV2rayRunning();
    btn.classList.toggle("is-running", running);
    btn.dataset.tip = running ? LBL_V2RAY_STOP : LBL_V2RAY_START;
  } catch {
    btn.classList.remove("is-running");
    btn.dataset.tip = LBL_V2RAY_START;
  }
}

export function mountTopToolkit(root: HTMLElement) {
  const v2rayBtn = root.querySelector<HTMLButtonElement>("#v2rayBtn");
  if (v2rayBtn) {
    void syncV2rayBtn(v2rayBtn);
    window.setInterval(() => void syncV2rayBtn(v2rayBtn), 2000);
    v2rayBtn.addEventListener("click", () => {
      void (async () => {
        const wasRunning = v2rayBtn.classList.contains("is-running");
        try {
          if (wasRunning) {
            await stopV2ray();
          } else {
            await launchV2ray();
          }
          await syncV2rayBtn(v2rayBtn);
        } catch {
          alert(wasRunning ? LBL_V2RAY_STOP_FAIL : LBL_V2RAY_START_FAIL);
        }
      })();
    });
  }

  mountStatsBar(root);
  mountAdminButton(root);
  mountSettingsButton(root, SETTINGS_GEAR_SVG);
  const shotBtn = root.querySelector<HTMLButtonElement>("#screenshotBtn");
  if (shotBtn) shotBtn.addEventListener("click", () => void openCaptureOverlay("screenshot"));
}
