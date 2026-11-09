import type { AppSettings } from "../../../core/settings";
import { getSettings, patchSettings } from "../../../core/settings";
import type { LifeRingGoals } from "../../../core/data/life-ring-goals";
import { normalizeLifeRingGoals } from "../../../core/data/life-ring-goals";
import {
  HEALTH_TRACK_AXIS_METRICS,
  normalizeHealthTrackAxisPrefs,
  type HealthTrackAxisMetricKey,
  type HealthTrackAxisPrefs,
} from "../../../core/data/health-track-axis";
import { normalizeGarminSyncDays } from "../../../core/data/garmin-sync-days";
import { enhancePasswordField } from "../../settings/form-controls";
import { pickLocalFolder } from "../../shell/adapter";
import { getConfirmDialog } from "../../shell/dialog";
import { bindGarminSyncButton, garminSyncButtonMarkup } from "../../journal/garmin-sync-button";
import {
  formatGarminLoginError,
  garminLogin,
  garminStatus,
  isGarminSyncing,
  subscribeGarminSyncing,
} from "../../journal/client";

export const healthTabHtml = `
  <div class="insight-settings-panel" data-tab-panel="health">
    <div class="insight-settings-section">
      <h3 class="insight-settings-section-title">三环目标</h3>
      <div class="insight-settings-inline">
        <div class="insight-settings-field">
          <label for="insight-goal-intake">摄入 kcal</label>
          <input id="insight-goal-intake" type="number" min="1" step="1">
        </div>
        <div class="insight-settings-field">
          <label for="insight-goal-exp">消耗 kcal</label>
          <input id="insight-goal-exp" type="number" min="1" step="1">
        </div>
        <div class="insight-settings-field">
          <label for="insight-goal-hydration">喝水 ml</label>
          <input id="insight-goal-hydration" type="number" min="1" step="1">
        </div>
      </div>
    </div>
    <div class="insight-settings-section">
      <h3 class="insight-settings-section-title">佳明</h3>
      <div class="insight-settings-field">
        <label for="insight-garmin-email">邮箱</label>
        <input id="insight-garmin-email" type="email" autocomplete="off">
      </div>
      <div class="insight-settings-field">
        <label for="insight-garmin-password">密码</label>
        <input id="insight-garmin-password" type="password" autocomplete="off">
      </div>
      <div class="insight-settings-field">
        <label for="insight-garmin-token-dir">Token 目录</label>
        <div class="insight-settings-path-row">
          <input id="insight-garmin-token-dir" type="text" placeholder="默认：数据目录/garmin" readonly>
          <button type="button" class="insight-settings-btn" data-action="browse-garmin-token">浏览</button>
        </div>
      </div>
      <p class="insight-settings-hint" id="insight-garmin-login-status">佳明状态：--</p>
      <div class="insight-settings-field">
        <label>手动同步</label>
        <div class="insight-settings-sync-row">
          <span>同步最近</span>
          <input id="insight-garmin-sync-days" type="number" min="1" max="365" step="1" inputmode="numeric">
          <span>天佳明数据</span>
          ${garminSyncButtonMarkup({ id: "insight-garmin-sync-btn" })}
        </div>
      </div>
      <div class="insight-settings-row">
        <button type="button" class="insight-settings-btn" id="insight-garmin-login-btn">重新登录</button>
      </div>
      <p class="insight-settings-hint" id="insight-garmin-sync-status"></p>
    </div>
    <div class="insight-settings-section">
      <h3 class="insight-settings-section-title">飞常准</h3>
      <div class="insight-settings-field">
        <label for="insight-variflight-api-key">API Key</label>
        <input id="insight-variflight-api-key" class="insight-settings-api-key" type="password" autocomplete="off">
      </div>
    </div>
    <div class="insight-settings-section">
      <h3 class="insight-settings-section-title">健康轨道</h3>
      <div class="insight-settings-field">
        <label for="insight-health-axis-mode">Y 轴刻度</label>
        <select id="insight-health-axis-mode">
          <option value="fixed">固定范围</option>
          <option value="dynamic">动态范围（按当前窗口）</option>
        </select>
      </div>
      <p class="insight-settings-hint">固定模式下超出范围的数值会贴在边界；动态模式按当前可见数据缩放。</p>
      <div class="health-axis-range-grid" id="insight-health-axis-ranges">
        ${HEALTH_TRACK_AXIS_METRICS.map(
          ({ key, label }) => `
        <div class="health-axis-range-row" data-metric="${key}">
          <span class="health-axis-range-label">${label}</span>
          <input type="number" step="any" data-field="min" aria-label="${label}下限">
          <span class="health-axis-range-sep">–</span>
          <input type="number" step="any" data-field="max" aria-label="${label}上限">
        </div>`,
        ).join("")}
      </div>
    </div>
  </div>`;

export type HealthSettingsDraft = {
  lifeRingGoals: LifeRingGoals;
  garminEmail: string;
  garminPassword: string;
  garminTokenDir: string;
  garminSyncDays: number;
  variflightApiKey: string;
  healthTrackAxis: HealthTrackAxisPrefs;
};

async function refreshGarminStatus(
  loginStatusEl: HTMLElement,
  loginBtn: HTMLButtonElement,
  isActive: () => boolean = () => true,
) {
  try {
    const st = await garminStatus();
    if (!isActive()) return;
    if (st.rateLimited) {
      loginStatusEl.textContent = "佳明状态：登录冷却中（429），请稍后再试";
      loginBtn.disabled = true;
    } else if (st.loggedIn) {
      loginStatusEl.textContent = "佳明状态：已登录";
      loginBtn.disabled = false;
    } else {
      loginStatusEl.textContent = "佳明状态：未登录";
      loginBtn.disabled = false;
    }
  } catch {
    if (!isActive()) return;
    loginStatusEl.textContent = "佳明状态：--";
    loginBtn.disabled = false;
  }
}

export function bindHealthTab(root: HTMLElement) {
  let disposed = false;
  const goalIntakeEl = root.querySelector<HTMLInputElement>("#insight-goal-intake")!;
  const goalExpEl = root.querySelector<HTMLInputElement>("#insight-goal-exp")!;
  const goalHydrationEl = root.querySelector<HTMLInputElement>("#insight-goal-hydration")!;
  const emailEl = root.querySelector<HTMLInputElement>("#insight-garmin-email")!;
  const passEl = root.querySelector<HTMLInputElement>("#insight-garmin-password")!;
  const tokenEl = root.querySelector<HTMLInputElement>("#insight-garmin-token-dir")!;
  const variflightApiKeyEl = root.querySelector<HTMLInputElement>("#insight-variflight-api-key")!;
  enhancePasswordField(variflightApiKeyEl);
  const loginBtn = root.querySelector<HTMLButtonElement>("#insight-garmin-login-btn")!;
  const loginStatusEl = root.querySelector<HTMLElement>("#insight-garmin-login-status")!;
  const syncBtn = root.querySelector<HTMLButtonElement>("#insight-garmin-sync-btn")!;
  const syncDaysEl = root.querySelector<HTMLInputElement>("#insight-garmin-sync-days")!;
  const syncStatus = root.querySelector<HTMLElement>("#insight-garmin-sync-status")!;
  const confirmDialog = getConfirmDialog();
  const unsubscribeGarminSyncing = subscribeGarminSyncing((busy) => {
    syncDaysEl.disabled = busy;
  });
  const disposeGarminSyncButton = bindGarminSyncButton(syncBtn, {
    beforeSync: async () => {
      const days = normalizeGarminSyncDays(Number(syncDaysEl.value));
      syncDaysEl.value = String(days);
      const current = getSettings();
      if (normalizeGarminSyncDays(current.integrations.garmin.syncDays) !== days) {
        await patchSettings({
          integrations: {
            ...current.integrations,
            garmin: { ...current.integrations.garmin, syncDays: days },
          },
        });
      }
    },
    onSuccess: (result) => {
      syncStatus.textContent = `完成：daily ${result.dailyCount ?? 0}，睡眠 ${result.routineCount ?? 0}，活动 ${result.exerciseCount ?? 0}`;
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
    },
    onError: async (message) => {
      syncStatus.textContent = message;
      await confirmDialog("佳明同步失败", message, syncBtn, {
        confirmLabel: "确定",
        danger: false,
        info: true,
      });
    },
  });
  const axisModeEl = root.querySelector<HTMLSelectElement>("#insight-health-axis-mode")!;
  const axisRangesEl = root.querySelector<HTMLElement>("#insight-health-axis-ranges")!;

  const syncAxisRangeEnabled = () => {
    const fixed = axisModeEl.value === "fixed";
    axisRangesEl.querySelectorAll<HTMLInputElement>("input").forEach((el) => {
      el.disabled = !fixed;
    });
    axisRangesEl.classList.toggle("is-disabled", !fixed);
  };
  axisModeEl.addEventListener("change", syncAxisRangeEnabled);

  root.querySelector('[data-action="browse-garmin-token"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) tokenEl.value = path;
  });

  loginBtn.addEventListener("click", async () => {
    if (!emailEl.value.trim() || !passEl.value) {
      await confirmDialog("佳明登录", "请先填写佳明邮箱和密码", loginBtn, {
        confirmLabel: "确定",
        danger: false,
      });
      return;
    }
    const ok = await confirmDialog(
      "佳明登录",
      "将向佳明 SSO 发起登录；429 冷却期内请勿重复；国内建议先开 v2ray HTTP 10808。",
      loginBtn,
      { confirmLabel: "继续登录", danger: false },
    );
    if (disposed) return;
    if (!ok) return;
    loginBtn.disabled = true;
    loginStatusEl.textContent = "佳明状态：登录中…";
    try {
      const res = await garminLogin({
        email: emailEl.value.trim(),
        password: passEl.value,
      });
      if (disposed) return;
      if (res.ok) {
        loginStatusEl.textContent = "佳明状态：已登录";
        syncStatus.textContent = "登录成功";
      } else {
        await confirmDialog("佳明登录失败", formatGarminLoginError(res.reason, res.message), loginBtn, {
          confirmLabel: "确定",
          danger: false,
        });
        loginStatusEl.textContent = "佳明状态：登录失败";
        syncStatus.textContent = res.message ?? "登录失败";
      }
    } catch (e) {
      if (disposed) return;
      const msg = String(e);
      await confirmDialog("佳明登录失败", msg, loginBtn, {
        confirmLabel: "确定",
        danger: false,
      });
      syncStatus.textContent = msg;
    } finally {
      void refreshGarminStatus(loginStatusEl, loginBtn, () => !disposed);
    }
  });

  return {
    fill(settings: AppSettings) {
      const goals = normalizeLifeRingGoals(settings.ui.lifeRingGoals);
      goalIntakeEl.value = String(goals.goalIntake);
      goalExpEl.value = String(goals.goalExp);
      goalHydrationEl.value = String(goals.goalHydration);
      emailEl.value = settings.integrations.credentials.garmin.email;
      passEl.value = settings.integrations.credentials.garmin.password;
      tokenEl.value = settings.integrations.garmin.tokenDir;
      variflightApiKeyEl.value = settings.integrations.credentials.variflight.apiKey;
      syncDaysEl.value = String(normalizeGarminSyncDays(settings.integrations.garmin.syncDays));
      const axis = settings.ui.healthTrackAxis;
      axisModeEl.value = axis.mode;
      for (const { key } of HEALTH_TRACK_AXIS_METRICS) {
        const row = axisRangesEl.querySelector<HTMLElement>(`[data-metric="${key}"]`);
        if (!row) continue;
        const range = axis.ranges[key as HealthTrackAxisMetricKey];
        const minEl = row.querySelector<HTMLInputElement>('[data-field="min"]')!;
        const maxEl = row.querySelector<HTMLInputElement>('[data-field="max"]')!;
        minEl.value = String(range.min);
        maxEl.value = String(range.max);
      }
      syncAxisRangeEnabled();
      if (!isGarminSyncing()) syncStatus.textContent = "";
      void refreshGarminStatus(loginStatusEl, loginBtn, () => !disposed);
    },
    read(): HealthSettingsDraft {
      const ranges = {} as HealthTrackAxisPrefs["ranges"];
      for (const { key } of HEALTH_TRACK_AXIS_METRICS) {
        const row = axisRangesEl.querySelector<HTMLElement>(`[data-metric="${key}"]`)!;
        const minEl = row.querySelector<HTMLInputElement>('[data-field="min"]')!;
        const maxEl = row.querySelector<HTMLInputElement>('[data-field="max"]')!;
        ranges[key] = {
          min: Number(minEl.value),
          max: Number(maxEl.value),
        };
      }
      return {
        lifeRingGoals: normalizeLifeRingGoals({
          goalIntake: Number(goalIntakeEl.value),
          goalExp: Number(goalExpEl.value),
          goalHydration: Number(goalHydrationEl.value),
        }),
        garminEmail: emailEl.value.trim(),
        garminPassword: passEl.value,
        garminTokenDir: tokenEl.value.trim(),
        garminSyncDays: normalizeGarminSyncDays(Number(syncDaysEl.value)),
        variflightApiKey: variflightApiKeyEl.value.trim(),
        healthTrackAxis: normalizeHealthTrackAxisPrefs({
          mode: axisModeEl.value === "dynamic" ? "dynamic" : "fixed",
          ranges,
        }),
      };
    },
    dispose() {
      disposed = true;
      disposeGarminSyncButton();
      unsubscribeGarminSyncing();
    },
  };
}
