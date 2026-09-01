import type { AppSettings } from "../../../core/settings";
import type { LifeRingGoals } from "../../../core/data/life-ring-goals";
import { normalizeLifeRingGoals } from "../../../core/data/life-ring-goals";
import {
  HEALTH_TRACK_AXIS_METRICS,
  normalizeHealthTrackAxisPrefs,
  type HealthTrackAxisMetricKey,
  type HealthTrackAxisPrefs,
} from "../../../core/data/health-track-axis";
import { pickLocalFolder } from "../../shell/adapter";
import {
  formatGarminError,
  formatGarminLoginError,
  garminLogin,
  garminStatus,
  garminSync,
  syncFromDate,
} from "../../journal/client";

export const lifeTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="life">
    <div class="settings-section">
      <div class="settings-section-title">三环目标</div>
      <div class="settings-field-inline">
        <div class="dialog-field dialog-field-compact">
          <label for="goalIntake">摄入 kcal</label>
          <input id="goalIntake" type="number" min="1" step="1">
        </div>
        <div class="dialog-field dialog-field-compact">
          <label for="goalExp">消耗 kcal</label>
          <input id="goalExp" type="number" min="1" step="1">
        </div>
        <div class="dialog-field dialog-field-compact">
          <label for="goalHydration">喝水 ml</label>
          <input id="goalHydration" type="number" min="1" step="1">
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">今日数据</div>
      <div class="dialog-field">
        <label for="journalDataRoot">今日记录（JSON）目录</label>
        <div class="settings-path-row">
          <input id="journalDataRoot" type="text" placeholder="默认：数据目录" readonly>
          <button type="button" class="dialog-btn" data-action="browse-journal">浏览</button>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">佳明</div>
      <div class="dialog-field">
        <label for="garminEmail">邮箱</label>
        <input id="garminEmail" type="email" autocomplete="off">
      </div>
      <div class="dialog-field">
        <label for="garminPassword">密码</label>
        <input id="garminPassword" type="password" autocomplete="off">
      </div>
      <div class="dialog-field">
        <label for="garminTokenDir">Token 目录</label>
        <div class="settings-path-row">
          <input id="garminTokenDir" type="text" placeholder="默认：数据目录/garmin">
          <button type="button" class="dialog-btn" data-action="browse-garmin-token">浏览</button>
        </div>
      </div>
      <p class="settings-hint" id="garminLoginStatus">佳明状态：--</p>
      <div class="settings-row">
        <button type="button" class="dialog-btn" id="garminLoginBtn">重新登录</button>
        <button type="button" class="dialog-btn dialog-btn-primary" id="garminSyncBtn">同步最近 7 天</button>
      </div>
      <p class="settings-hint" id="garminSyncStatus"></p>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">健康轨道</div>
      <div class="dialog-field">
        <label for="healthTrackAxisMode">Y 轴刻度</label>
        <select id="healthTrackAxisMode">
          <option value="fixed">固定范围</option>
          <option value="dynamic">动态范围（按当前窗口）</option>
        </select>
      </div>
      <p class="settings-hint">固定模式下超出范围的数值会贴在边界；动态模式按当前可见数据缩放。</p>
      <div class="health-axis-range-grid" id="healthTrackAxisRanges">
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

export type LifeDraft = {
  lifeRingGoals: LifeRingGoals;
  journalDataRoot: string;
  garminEmail: string;
  garminPassword: string;
  garminTokenDir: string;
  healthTrackAxis: HealthTrackAxisPrefs;
};

async function refreshGarminStatus(loginStatusEl: HTMLElement, loginBtn: HTMLButtonElement) {
  try {
    const st = await garminStatus();
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
    loginStatusEl.textContent = "佳明状态：--";
    loginBtn.disabled = false;
  }
}

export function bindLifeTab(root: HTMLElement) {
  const goalIntakeEl = root.querySelector<HTMLInputElement>("#goalIntake")!;
  const goalExpEl = root.querySelector<HTMLInputElement>("#goalExp")!;
  const goalHydrationEl = root.querySelector<HTMLInputElement>("#goalHydration")!;
  const journalEl = root.querySelector<HTMLInputElement>("#journalDataRoot")!;
  const emailEl = root.querySelector<HTMLInputElement>("#garminEmail")!;
  const passEl = root.querySelector<HTMLInputElement>("#garminPassword")!;
  const tokenEl = root.querySelector<HTMLInputElement>("#garminTokenDir")!;
  const loginBtn = root.querySelector<HTMLButtonElement>("#garminLoginBtn")!;
  const loginStatusEl = root.querySelector<HTMLElement>("#garminLoginStatus")!;
  const syncBtn = root.querySelector<HTMLButtonElement>("#garminSyncBtn")!;
  const syncStatus = root.querySelector<HTMLElement>("#garminSyncStatus")!;
  const axisModeEl = root.querySelector<HTMLSelectElement>("#healthTrackAxisMode")!;
  const axisRangesEl = root.querySelector<HTMLElement>("#healthTrackAxisRanges")!;

  const syncAxisRangeEnabled = () => {
    const fixed = axisModeEl.value === "fixed";
    axisRangesEl.querySelectorAll<HTMLInputElement>("input").forEach((el) => {
      el.disabled = !fixed;
    });
    axisRangesEl.classList.toggle("is-disabled", !fixed);
  };
  axisModeEl.addEventListener("change", syncAxisRangeEnabled);

  root.querySelector('[data-action="browse-journal"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) journalEl.value = path;
  });
  root.querySelector('[data-action="browse-garmin-token"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) tokenEl.value = path;
  });

  loginBtn.addEventListener("click", async () => {
    if (!emailEl.value.trim() || !passEl.value) {
      alert("请先填写佳明邮箱和密码");
      return;
    }
    const ok = confirm(
      "将向佳明 SSO 发起登录；429 冷却期内请勿重复；国内建议先开 v2ray HTTP 10808。",
    );
    if (!ok) return;
    loginBtn.disabled = true;
    loginStatusEl.textContent = "佳明状态：登录中…";
    try {
      const res = await garminLogin({
        email: emailEl.value.trim(),
        password: passEl.value,
      });
      if (res.ok) {
        loginStatusEl.textContent = "佳明状态：已登录";
        syncStatus.textContent = "登录成功";
      } else {
        alert(formatGarminLoginError(res.reason, res.message));
        loginStatusEl.textContent = "佳明状态：登录失败";
        syncStatus.textContent = res.message ?? "登录失败";
      }
    } catch (e) {
      const msg = String(e);
      alert(msg);
      syncStatus.textContent = msg;
    } finally {
      void refreshGarminStatus(loginStatusEl, loginBtn);
    }
  });

  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncStatus.textContent = "同步中…";
    try {
      const res = await garminSync({ from: syncFromDate(7), to: undefined });
      if (res.ok) {
        syncStatus.textContent = `完成：daily ${res.dailyCount ?? 0}，睡眠 ${res.routineCount ?? 0}，骑行 ${res.exerciseCount ?? 0}`;
        window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
      } else {
        alert(formatGarminError(res.reason, res.message));
        syncStatus.textContent = formatGarminError(res.reason, res.message);
      }
    } catch (e) {
      const msg = String(e);
      alert(msg);
      syncStatus.textContent = msg;
    } finally {
      syncBtn.disabled = false;
    }
  });

  return {
    fill(settings: AppSettings) {
      const goals = normalizeLifeRingGoals(settings.ui.lifeRingGoals);
      goalIntakeEl.value = String(goals.goalIntake);
      goalExpEl.value = String(goals.goalExp);
      goalHydrationEl.value = String(goals.goalHydration);
      journalEl.value = settings.integrations.journal.dataRoot;
      emailEl.value = settings.integrations.credentials.garmin.email;
      passEl.value = settings.integrations.credentials.garmin.password;
      tokenEl.value = settings.integrations.garmin.tokenDir;
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
      syncStatus.textContent = "";
      void refreshGarminStatus(loginStatusEl, loginBtn);
    },
    read(): LifeDraft {
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
        journalDataRoot: journalEl.value.trim(),
        garminEmail: emailEl.value.trim(),
        garminPassword: passEl.value,
        garminTokenDir: tokenEl.value.trim(),
        healthTrackAxis: normalizeHealthTrackAxisPrefs({
          mode: axisModeEl.value === "dynamic" ? "dynamic" : "fixed",
          ranges,
        }),
      };
    },
  };
}
