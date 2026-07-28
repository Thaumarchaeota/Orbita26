import { getSettings, patchSettings } from "../../core/settings";
import { SETTINGS_GEAR_SVG } from "../ai/icons";
import { bindDialog, type MotionTrigger } from "../../ui/motion";
import { closeAllPickers, createPickerGroup, mountListPicker } from "./form-pickers";
import type { DidaProject } from "./types";

export function mountTicktickSettingsButton(
  container: HTMLElement,
  dialogRoot: HTMLElement,
  getProjects: () => DidaProject[],
) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ticktick-head-btn";
  btn.title = "任务设置";
  btn.innerHTML = SETTINGS_GEAR_SVG;
  container.appendChild(btn);

  const open = mountTicktickSettingsDialog(dialogRoot, getProjects);
  btn.addEventListener("click", (e) => void open(e));
}

function mountTicktickSettingsDialog(
  root: HTMLElement,
  getProjects: () => DidaProject[],
) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-wide ticktick-settings-dialog" id="ticktickSettingsForm">
      <div class="dialog-title">任务设置</div>
      <div id="ticktickSettingsPickers"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const pickersEl = backdrop.querySelector<HTMLElement>("#ticktickSettingsPickers")!;
  const pickerGroup = createPickerGroup();
  const projectPicker = mountListPicker(
    pickersEl,
    "新建任务默认清单",
    "defaultProject",
    [],
    "inbox",
    pickerGroup,
  );
  let resolvePending: ((saved: boolean) => void) | null = null;

  const close = async (saved: boolean) => {
    await closeAllPickers([projectPicker]);
    await motion.close();
    resolvePending?.(saved);
    resolvePending = null;
  };

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(false);
  });

  backdrop.querySelector<HTMLFormElement>("#ticktickSettingsForm")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const current = getSettings();
    void patchSettings({
      integrations: {
        ...current.integrations,
        ticktick: {
          ...current.integrations.ticktick,
          defaultProjectId: projectPicker.getValue(),
        },
      },
    }).then(() => void close(true));
  });

  return (trigger?: MotionTrigger) =>
    new Promise<void>((resolve) => {
      resolvePending = () => resolve();
      const projects = getProjects();
      const items = projects.map((p) => ({ value: p.id, label: p.name }));
      projectPicker.setItems(items.length ? items : [{ value: "inbox", label: "收集箱" }]);
      const saved = getSettings().integrations.ticktick.defaultProjectId.trim();
      const fallback = projects.find((p) => p.id === "inbox")?.id ?? projects[0]?.id ?? "inbox";
      projectPicker.setValue(
        saved && projects.some((p) => p.id === saved) ? saved : fallback,
      );
      void motion.open(trigger);
    });
}
