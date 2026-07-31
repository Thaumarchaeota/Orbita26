import type { AppSettings } from "../../../core/settings";
import { getSettings, patchSettings } from "../../../core/settings";
import { didaAuthStatus, didaConnect, didaDisconnect, invokeError } from "../../ticktick/client";
import { closeAllPickers, createPickerGroup, mountListPicker } from "../../ticktick/form-pickers";
import type { DidaProject } from "../../ticktick/types";

export const tasksTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="tasks" hidden>
    <div class="dialog-field">
      <label for="settingsTicktickClientId">Client ID</label>
      <input id="settingsTicktickClientId" type="text" autocomplete="off">
    </div>
    <div class="dialog-field">
      <label for="settingsTicktickClientSecret">Client Secret</label>
      <input id="settingsTicktickClientSecret" type="password" autocomplete="off">
    </div>
    <div class="dialog-field">
      <label for="settingsTicktickRedirect">Redirect URI</label>
      <input id="settingsTicktickRedirect" type="text" autocomplete="off">
    </div>
    <div class="settings-path-row">
      <button type="button" class="dialog-btn" data-action="ticktick-connect">连接</button>
      <button type="button" class="dialog-btn" data-action="ticktick-disconnect">断开</button>
      <span id="settingsTicktickStatus" class="settings-ticktick-status"></span>
    </div>
    <div id="settingsTasksPickers"></div>
  </div>`;

export type TasksDraft = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  defaultProjectId: string;
};

export function bindTasksTab(
  root: HTMLElement,
  getProjects: () => DidaProject[],
) {
  const clientIdInput = root.querySelector<HTMLInputElement>("#settingsTicktickClientId")!;
  const clientSecretInput = root.querySelector<HTMLInputElement>("#settingsTicktickClientSecret")!;
  const redirectInput = root.querySelector<HTMLInputElement>("#settingsTicktickRedirect")!;
  const statusEl = root.querySelector<HTMLElement>("#settingsTicktickStatus")!;
  const pickersEl = root.querySelector<HTMLElement>("#settingsTasksPickers")!;
  const pickerGroup = createPickerGroup();
  const projectPicker = mountListPicker(
    pickersEl,
    "新建任务默认清单",
    "defaultProject",
    [],
    "inbox",
    pickerGroup,
  );

  const refreshProjects = () => {
    const projects = getProjects();
    const items = projects.map((p) => ({ value: p.id, label: p.name }));
    projectPicker.setItems(items.length ? items : [{ value: "inbox", label: "收集箱" }]);
    const saved = getSettings().integrations.ticktick.defaultProjectId.trim();
    const fallback = projects.find((p) => p.id === "inbox")?.id ?? projects[0]?.id ?? "inbox";
    const current = projectPicker.getValue();
    if (!current || !projects.some((p) => p.id === current)) {
      projectPicker.setValue(saved && projects.some((p) => p.id === saved) ? saved : fallback);
    }
  };

  root.querySelector('[data-action="ticktick-connect"]')!.addEventListener("click", async () => {
    const current = getSettings();
    await patchSettings({
      integrations: {
        ...current.integrations,
        ticktick: {
          clientId: clientIdInput.value.trim(),
          clientSecret: clientSecretInput.value.trim(),
          redirectUri: redirectInput.value.trim(),
          accessToken: current.integrations.ticktick.accessToken,
          defaultProjectId: projectPicker.getValue(),
        },
      },
    });
    try {
      await didaConnect();
      statusEl.textContent = "已连接";
      window.dispatchEvent(new CustomEvent("orbita:ticktick-auth"));
    } catch (e) {
      alert(invokeError(e));
    }
  });

  root.querySelector('[data-action="ticktick-disconnect"]')!.addEventListener("click", async () => {
    await didaDisconnect();
    statusEl.textContent = "未连接";
    window.dispatchEvent(new CustomEvent("orbita:ticktick-auth"));
  });

  return {
    fill(settings: AppSettings) {
      clientIdInput.value = settings.integrations.ticktick.clientId;
      clientSecretInput.value = settings.integrations.ticktick.clientSecret;
      redirectInput.value = settings.integrations.ticktick.redirectUri;
      void didaAuthStatus().then(({ connected }) => {
        statusEl.textContent = connected ? "已连接" : "未连接";
      });
      refreshProjects();
      const saved = settings.integrations.ticktick.defaultProjectId.trim();
      const projects = getProjects();
      const fallback = projects.find((p) => p.id === "inbox")?.id ?? projects[0]?.id ?? "inbox";
      projectPicker.setValue(
        saved && projects.some((p) => p.id === saved) ? saved : fallback,
      );
    },
    read(_saved: AppSettings): TasksDraft {
      return {
        clientId: clientIdInput.value.trim(),
        clientSecret: clientSecretInput.value.trim(),
        redirectUri: redirectInput.value.trim(),
        defaultProjectId: projectPicker.getValue(),
      };
    },
    refreshProjects,
    async closePickers() {
      await closeAllPickers([projectPicker]);
    },
  };
}
