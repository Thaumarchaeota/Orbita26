import type { AppSettings } from "../../../core/settings";
import type { LifeRingGoals } from "../../../core/data/life-ring-goals";
import { normalizeLifeRingGoals } from "../../../core/data/life-ring-goals";
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
  <div class="settings-tab-panel" data-tab-panel="life" hidden>
    <div class="dialog-section-title">三环目标</div>
    <div class="dialog-field">
      <label for="goalIntake">摄入目标 kcal</label>
      <input id="goalIntake" type="number" min="1" step="1">
    </div>
    <div class="dialog-field">
      <label for="goalExp">消耗目标 kcal</label>
      <input id="goalExp" type="number" min="1" step="1">
    </div>
    <div class="dialog-field">
      <label for="goalHydration">喝水目标 ml</label>
      <input id="goalHydration" type="number" min="1" step="1">
    </div>
    <div class="dialog-field">
      <label for="journalDataRoot">今日记录（JSON）目录</label>
      <div class="settings-path-row">
        <input id="journalDataRoot" type="text" placeholder="默认：数据目录" readonly>
        <button type="button" class="dialog-btn" data-action="browse-journal">浏览</button>
      </div>
    </div>
    <div class="dialog-field">
      <label for="bkeasyDataRoot">账本（bean）目录</label>
      <div class="settings-path-row">
        <input id="bkeasyDataRoot" type="text" placeholder="默认：数据目录" readonly>
        <button type="button" class="dialog-btn" data-action="browse-bkeasy">浏览</button>
      </div>
    </div>
    <div class="dialog-section-title">佳明</div>
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
    <div class="dialog-field">
      <button type="button" class="dialog-btn" id="garminLoginBtn">重新登录佳明</button>
      <button type="button" class="dialog-btn dialog-btn-primary" id="garminSyncBtn">同步佳明（最近 7 天）</button>
      <p class="settings-hint" id="garminSyncStatus"></p>
    </div>
  </div>`;

export type LifeDraft = {
  lifeRingGoals: LifeRingGoals;
  journalDataRoot: string;
  bkeasyDataRoot: string;
  garminEmail: string;
  garminPassword: string;
  garminTokenDir: string;
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
  const bkeasyEl = root.querySelector<HTMLInputElement>("#bkeasyDataRoot")!;
  const emailEl = root.querySelector<HTMLInputElement>("#garminEmail")!;
  const passEl = root.querySelector<HTMLInputElement>("#garminPassword")!;
  const tokenEl = root.querySelector<HTMLInputElement>("#garminTokenDir")!;
  const loginBtn = root.querySelector<HTMLButtonElement>("#garminLoginBtn")!;
  const loginStatusEl = root.querySelector<HTMLElement>("#garminLoginStatus")!;
  const syncBtn = root.querySelector<HTMLButtonElement>("#garminSyncBtn")!;
  const syncStatus = root.querySelector<HTMLElement>("#garminSyncStatus")!;

  root.querySelector('[data-action="browse-journal"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) journalEl.value = path;
  });
  root.querySelector('[data-action="browse-bkeasy"]')!.addEventListener("click", async () => {
    const path = await pickLocalFolder();
    if (path) bkeasyEl.value = path;
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
      bkeasyEl.value = settings.integrations.bkeasy.dataRoot;
      emailEl.value = settings.integrations.credentials.garmin.email;
      passEl.value = settings.integrations.credentials.garmin.password;
      tokenEl.value = settings.integrations.garmin.tokenDir;
      syncStatus.textContent = "";
      void refreshGarminStatus(loginStatusEl, loginBtn);
    },
    read(): LifeDraft {
      return {
        lifeRingGoals: normalizeLifeRingGoals({
          goalIntake: Number(goalIntakeEl.value),
          goalExp: Number(goalExpEl.value),
          goalHydration: Number(goalHydrationEl.value),
        }),
        journalDataRoot: journalEl.value.trim(),
        bkeasyDataRoot: bkeasyEl.value.trim(),
        garminEmail: emailEl.value.trim(),
        garminPassword: passEl.value,
        garminTokenDir: tokenEl.value.trim(),
      };
    },
  };
}
