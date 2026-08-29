import type { AppSettings } from "../../../core/settings";
import { getSettings } from "../../../core/settings";
import { closeAllPickers, createPickerGroup, mountListPicker } from "../../ticktick/form-pickers";
import type { DidaProject } from "../../ticktick/types";

export const workTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="work">
    <div class="settings-section">
      <div class="settings-section-title">项目笔记</div>
      <div class="dialog-field">
        <label for="settingsWorkNotesDir">Obsidian 子目录</label>
        <input id="settingsWorkNotesDir" type="text" placeholder="12_project-tracking" autocomplete="off">
        <p class="settings-hint">相对于 Obsidian 库根目录；默认 <code>12_project-tracking</code></p>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">工作清单</div>
      <div id="settingsWorkPickers" class="settings-picker-host"></div>
      <p class="settings-hint">工作区展示的滴答清单；留空则使用任务 tab 的默认清单</p>
    </div>
  </div>`;

export type WorkDraft = {
  projectNotesDir: string;
  ticktickProjectId: string;
};

export function bindWorkTab(root: HTMLElement, getProjects: () => DidaProject[]) {
  const notesDirInput = root.querySelector<HTMLInputElement>("#settingsWorkNotesDir")!;
  const pickersEl = root.querySelector<HTMLElement>("#settingsWorkPickers")!;
  const pickerGroup = createPickerGroup();
  const projectPicker = mountListPicker(
    pickersEl,
    "滴答清单",
    "workProject",
    [],
    "",
    pickerGroup,
  );

  const refreshProjects = () => {
    const projects = getProjects();
    const items = projects.map((p) => ({ value: p.id, label: p.name }));
    projectPicker.setItems(items.length ? items : [{ value: "", label: "（使用默认清单）" }]);
    const saved = getSettings().integrations.work.ticktickProjectId.trim();
    const current = projectPicker.getValue();
    if (!current || (current && !projects.some((p) => p.id === current))) {
      projectPicker.setValue(saved && projects.some((p) => p.id === saved) ? saved : "");
    }
  };

  return {
    fill(settings: AppSettings) {
      notesDirInput.value = settings.integrations.work.projectNotesDir;
      refreshProjects();
      projectPicker.setValue(settings.integrations.work.ticktickProjectId);
    },
    read(): WorkDraft {
      return {
        projectNotesDir: notesDirInput.value.trim() || "12_project-tracking",
        ticktickProjectId: projectPicker.getValue(),
      };
    },
    refreshProjects,
    async closePickers() {
      await closeAllPickers([projectPicker]);
    },
  };
}
