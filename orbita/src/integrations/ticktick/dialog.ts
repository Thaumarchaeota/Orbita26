import { escHtml } from "../../core/html";
import { bindDialog, type MotionTrigger } from "../../ui/motion";
import type { DidaProject, DidaTask } from "./types";
import { formatTaskDue, fromDidaDateParts, invokeError, priorityLabel, toDidaDateTime } from "./client";
import { formatDateValue } from "./calendar";
import { closeAllPickers, createPickerGroup, mountDatePicker, mountListPicker, mountTimePicker, mountToggle } from "./form-pickers";

export type TaskDialogResult = {
  title: string;
  content: string;
  projectId: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  priority: number;
} | null;

export type TaskDialogOptions = {
  mode: "create" | "edit";
  task?: DidaTask;
  projects: DidaProject[];
  defaultProjectId: string;
  onSave: (result: NonNullable<TaskDialogResult>) => Promise<void>;
};

const PRIORITY_ITEMS = [
  { value: "0", label: "无" },
  { value: "1", label: "低" },
  { value: "3", label: "中" },
  { value: "5", label: "高" },
];

export function mountTaskDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-wide ticktick-task-dialog" id="taskDialogForm">
      <div class="dialog-title" id="taskDialogTitleLabel">新建任务</div>
      <div class="dialog-field">
        <label for="taskDialogTitle">名称</label>
        <input id="taskDialogTitle" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-field">
        <label for="taskDialogContent">描述</label>
        <textarea id="taskDialogContent" rows="3"></textarea>
      </div>
      <div class="ticktick-dialog-pickers" id="taskDialogPickers"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary" id="taskDialogSubmit">创建</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#taskDialogForm")!;
  const pickersEl = backdrop.querySelector<HTMLElement>("#taskDialogPickers")!;
  const titleLabel = backdrop.querySelector<HTMLElement>("#taskDialogTitleLabel")!;
  const submitBtn = backdrop.querySelector<HTMLButtonElement>("#taskDialogSubmit")!;
  const titleInput = backdrop.querySelector<HTMLInputElement>("#taskDialogTitle")!;
  const contentInput = backdrop.querySelector<HTMLTextAreaElement>("#taskDialogContent")!;

  const pickerGroup = createPickerGroup();
  const projectPicker = mountListPicker(pickersEl, "清单", "project", [], "inbox", pickerGroup);
  const datePicker = mountDatePicker(pickersEl, "日期", "date", formatDateValue(new Date()), pickerGroup);
  const allDayToggle = mountToggle(pickersEl, "全天", "allday", false);
  const startPicker = mountTimePicker(pickersEl, "开始", "start", "09:00", pickerGroup);
  const endPicker = mountTimePicker(pickersEl, "结束", "end", "10:00", pickerGroup);
  const priorityPicker = mountListPicker(pickersEl, "优先级", "priority", PRIORITY_ITEMS, "0", pickerGroup);
  const pickers = [projectPicker, datePicker, startPicker, endPicker, priorityPicker];

  const timeRow = document.createElement("div");
  timeRow.className = "ticktick-time-row";
  startPicker.root.classList.add("ticktick-time-half");
  endPicker.root.classList.add("ticktick-time-half");
  datePicker.root.after(allDayToggle.root);
  allDayToggle.root.after(timeRow);
  timeRow.append(startPicker.root, endPicker.root);

  const syncAllDay = () => {
    const on = allDayToggle.getValue();
    timeRow.hidden = on;
  };
  allDayToggle.root.querySelector(".ticktick-switch")!.addEventListener("click", () => {
    requestAnimationFrame(syncAllDay);
  });

  let resolvePending: ((value: TaskDialogResult) => void) | null = null;
  let saving = false;
  let submitLabel = "创建";

  const setSaving = (on: boolean) => {
    saving = on;
    submitBtn.disabled = on;
    backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.disabled = on;
    submitBtn.textContent = on ? "保存中…" : submitLabel;
  };

  const close = async (value: TaskDialogResult) => {
    if (saving && value === null) return;
    await closeAllPickers(pickers);
    await motion.close();
    saving = false;
    resolvePending?.(value);
    resolvePending = null;
  };

  const readForm = (): NonNullable<TaskDialogResult> | null => {
    const title = titleInput.value.trim();
    if (!title) return null;
    return {
      title,
      content: contentInput.value.trim(),
      projectId: projectPicker.getValue(),
      date: datePicker.getValue(),
      startTime: startPicker.getValue(),
      endTime: endPicker.getValue(),
      allDay: allDayToggle.getValue(),
      priority: Number(priorityPicker.getValue()),
    };
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (saving) return;
    const result = readForm();
    if (!result) return;
    void (async () => {
      setSaving(true);
      try {
        await currentOnSave(result);
        await close(result);
      } catch (err) {
        alert(invokeError(err));
        setSaving(false);
      }
    })();
  });
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && !saving) void close(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen() && !saving) void close(null);
  });
  form.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".ticktick-picker")) {
      void closeAllPickers(pickers);
    }
  });

  const fillFromTask = (task: DidaTask, projectItems: { value: string; label: string }[]) => {
    titleInput.value = task.title;
    contentInput.value = task.content ?? "";
    projectPicker.setItems(projectItems);
    projectPicker.setValue(task.projectId);
    const start = fromDidaDateParts(task.startDate);
    const due = fromDidaDateParts(task.dueDate);
    const date = start?.date ?? due?.date ?? formatDateValue(new Date());
    datePicker.setValue(date);
    const allDay =
      task.isAllDay ??
      (!start?.time || (start.time === "00:00" && (!due?.time || due.time === "23:59")));
    allDayToggle.setValue(allDay);
    startPicker.setValue(start?.time ?? "09:00");
    endPicker.setValue(due?.time ?? "10:00");
    priorityPicker.setValue(String(task.priority ?? 0));
    syncAllDay();
  };

  let currentOnSave: (result: NonNullable<TaskDialogResult>) => Promise<void> = async () => {};

  return (opts: TaskDialogOptions, trigger?: MotionTrigger) =>
    new Promise<TaskDialogResult>((resolve) => {
      resolvePending = resolve;
      currentOnSave = opts.onSave;
      const projectItems = opts.projects.map((p) => ({ value: p.id, label: p.name }));
      projectPicker.setItems(projectItems);
      const isEdit = opts.mode === "edit";
      titleLabel.textContent = isEdit ? "编辑任务" : "新建任务";
      submitLabel = isEdit ? "保存" : "创建";
      submitBtn.textContent = submitLabel;
      submitBtn.disabled = false;
      backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.disabled = false;
      saving = false;
      if (isEdit && opts.task) {
        fillFromTask(opts.task, projectItems);
      } else {
        titleInput.value = "";
        contentInput.value = "";
        const inbox = opts.projects.find((p) => p.id === "inbox");
        projectPicker.setValue(opts.defaultProjectId || inbox?.id || opts.projects[0]?.id || "inbox");
        datePicker.setValue(formatDateValue(new Date()));
        allDayToggle.setValue(false);
        startPicker.setValue("09:00");
        endPicker.setValue("10:00");
        priorityPicker.setValue("0");
        syncAllDay();
      }
      void motion.open(trigger).then(() => requestAnimationFrame(() => titleInput.focus()));
    });
}

export function mountTaskDetailDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <div class="dialog-panel dialog-panel-wide ticktick-detail-dialog">
      <div class="dialog-title" id="taskDetailTitle"></div>
      <div class="ticktick-detail-meta" id="taskDetailMeta"></div>
      <div class="ticktick-detail-content scroll-slim" id="taskDetailContent"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn dialog-btn-primary" data-action="close">关闭</button>
      </div>
    </div>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const titleEl = backdrop.querySelector<HTMLElement>("#taskDetailTitle")!;
  const metaEl = backdrop.querySelector<HTMLElement>("#taskDetailMeta")!;
  const contentEl = backdrop.querySelector<HTMLElement>("#taskDetailContent")!;

  const close = () => void motion.close();
  backdrop.querySelector('[data-action="close"]')!.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) close();
  });

  return (task: DidaTask, projectName: string, trigger?: MotionTrigger) => {
    titleEl.textContent = task.title;
    const due = formatTaskDue(task.dueDate);
    metaEl.innerHTML = [
      projectName ? `<span>${escHtml(projectName)}</span>` : "",
      due ? `<span>${escHtml(due)}</span>` : "",
      `<span>${escHtml(priorityLabel(task.priority))}</span>`,
    ]
      .filter(Boolean)
      .join("");
    const body = task.content?.trim();
    contentEl.innerHTML = body
      ? escHtml(body).replace(/\n/g, "<br>")
      : `<span class="ticktick-detail-empty">无描述</span>`;
    void motion.open(trigger);
  };
}

function dialogToPayload(result: NonNullable<TaskDialogResult>) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  if (!result.date) {
    return {
      title: result.title,
      projectId: result.projectId,
      content: result.content || undefined,
      priority: result.priority,
      timeZone: tz,
    };
  }
  if (result.allDay) {
    const start = toDidaDateTime(result.date, "00:00");
    const end = toDidaDateTime(result.date, "23:59");
    return {
      title: result.title,
      projectId: result.projectId,
      content: result.content || undefined,
      startDate: start,
      dueDate: end,
      isAllDay: true,
      priority: result.priority,
      timeZone: tz,
    };
  }
  return {
    title: result.title,
    projectId: result.projectId,
    content: result.content || undefined,
    startDate: toDidaDateTime(result.date, result.startTime),
    dueDate: toDidaDateTime(result.date, result.endTime),
    isAllDay: false,
    priority: result.priority,
    timeZone: tz,
  };
}

export function dialogToCreatePayload(result: NonNullable<TaskDialogResult>) {
  return dialogToPayload(result);
}

export function dialogToUpdatePayload(result: NonNullable<TaskDialogResult>) {
  return dialogToPayload(result);
}
