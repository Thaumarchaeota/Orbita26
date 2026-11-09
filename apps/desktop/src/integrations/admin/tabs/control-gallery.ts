import {
  createChoiceCheckbox,
  createChoiceRadio,
  mountToggleSwitch,
  readTriStateMarker,
  setChoiceRadio,
  setTriStateMarker,
  type TriState,
} from "../../../ui/choice-control";
import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { mountDecoupledDateRangePicker, type DateRangeValue } from "../../../ui/decoupled-date-range-picker";
import { mountDecoupledDateTimePicker } from "../../../ui/decoupled-datetime-picker";
import { mountInlineTextField } from "../../../ui/inline-text-field";
import {
  timelineGlowCssVars,
  timelinePlannedDashSvg,
  timelineSegmentClassNames,
  timelineSegmentFadePx,
} from "../../../ui/timeline-line-decoration";
import {
  TRANSPORTATION_TYPE_KEYS,
  transportationTypeIconSvg,
  transportationTypeLabelZh,
} from "../../../ui/transportation-type";
import { mountDecoupledDateTimeRangePicker } from "../../../ui/decoupled-datetime-range-picker";
import { shanghaiYmd } from "../../../ui/datetime-range-display";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { createInsightDialog } from "../../../ui/insight-dialog";
import { mountFloatingPanel, type FloatingPanelHandle } from "../../../ui/floating-panel";
import { runButtonAction } from "../../../ui/action-motion";
import { createButton } from "../../../ui/button";
import "../../../ui/theme-action-motion.css";
import { mountLoadingIndicator } from "../../../ui/loading-indicator";
import { createCheckbox, readCheckbox, setCheckboxWithCompletionFeedback } from "../../../ui/checkbox";
import { mountFlatSelectPopover } from "../../../ui/flat-select-popover";
import { mountSearchableCascadingMenu } from "../../../ui/searchable-cascading-menu";
import { mountSelectField } from "../../../ui/select-field";
import { mountOptionHint } from "../../../ui/option-hint";
import { mountSectionTitle } from "../../../ui/section-title";
import { mountSliderField } from "../../../ui/slider-field";
import { mountSwatchToggleGrid } from "../../../ui/swatch-toggle-grid";
import type { InsightDestination, InsightDestinationHandle, InsightHostContext } from "../types";
import { debugRail } from "../debug-rail";
import "./control-gallery.css";

function nextTriState(state: TriState): TriState {
  if (state === "unchecked") return "checked";
  if (state === "checked") return "indeterminate";
  return "unchecked";
}

function mountControlGalleryPage(root: HTMLElement, _ctx: InsightHostContext): InsightDestinationHandle {
  const ac = new AbortController();
  const { signal } = ac;
  const disposers: Array<() => void> = [];

  root.innerHTML = `
    <div class="control-gallery-page">
      <div class="control-gallery-main">
        <div class="control-gallery-parts"></div>
      </div>
      <aside class="control-gallery-detail-rail" aria-label="详情"></aside>
    </div>`;

  const parts = root.querySelector<HTMLElement>(".control-gallery-parts")!;
  let sampleFloatingPanel: FloatingPanelHandle | null = null;

  const addPart = (key: string, title: string): HTMLElement => {
    const part = document.createElement("section");
    part.className = "control-gallery-part";
    part.dataset.galleryPart = key;
    part.innerHTML = `
      <h2 class="control-gallery-part-title"></h2>
      <div class="control-gallery-part-body"></div>`;
    part.querySelector(".control-gallery-part-title")!.textContent = title;
    parts.appendChild(part);
    return part.querySelector<HTMLElement>(".control-gallery-part-body")!;
  };

  const addItem = (body: HTMLElement, title: string): HTMLElement => {
    const item = document.createElement("div");
    item.className = "control-gallery-item";
    item.innerHTML = `
      <h3 class="control-gallery-item-title"></h3>
      <div class="control-gallery-item-body"></div>`;
    item.querySelector(".control-gallery-item-title")!.textContent = title;
    body.appendChild(item);
    return item.querySelector<HTMLElement>(".control-gallery-item-body")!;
  };

  const genericTrigger = (label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-gallery-trigger";
    button.textContent = label;
    return button;
  };

  const part1 = addPart("choice", "开关、单选、复选、加载、色块");

  const toggleMount = document.createElement("div");
  const toggleSwitch = mountToggleSwitch(toggleMount, { checked: true, onChange: () => {} });
  addItem(part1, "开关").appendChild(toggleMount);
  disposers.push(() => toggleSwitch.dispose());

  const radioGroup = document.createElement("div");
  radioGroup.className = "control-gallery-native-group";
  radioGroup.setAttribute("role", "radiogroup");
  let radioValue = "range";
  const radioButtons: HTMLButtonElement[] = [];
  for (const [value, label] of [
    ["range", "起止"],
    ["duration", "预计时长"],
    ["none", "无时间"],
  ] as const) {
    const row = document.createElement("label");
    row.className = "control-gallery-native-label";
    const input = createChoiceRadio(value === radioValue);
    radioButtons.push(input);
    input.addEventListener("click", () => {
      radioValue = value;
      for (const button of radioButtons) setChoiceRadio(button, button === input);
    });
    const text = document.createElement("span");
    text.textContent = label;
    row.append(input, text);
    radioGroup.appendChild(row);
  }
  addItem(part1, "单选").appendChild(radioGroup);

  const checks = document.createElement("div");
  checks.className = "control-gallery-checks";
  const triStates: TriState[] = ["unchecked", "checked", "indeterminate"];
  const triLabels = ["未选", "已选", "半选"];
  for (let i = 0; i < triStates.length; i++) {
    const row = document.createElement("label");
    row.className = "control-gallery-native-label";
    const marker = createChoiceCheckbox(triStates[i]);
    marker.addEventListener("click", () => {
      setTriStateMarker(marker, nextTriState(readTriStateMarker(marker)));
    });
    const text = document.createElement("span");
    text.textContent = triLabels[i]!;
    row.append(marker, text);
    checks.appendChild(row);
  }
  const showDoneLabel = document.createElement("label");
  showDoneLabel.className = "control-gallery-native-label";
  const showDoneInput = createChoiceCheckbox("unchecked");
  showDoneInput.addEventListener("click", () => {
    const next = readTriStateMarker(showDoneInput) === "checked" ? "unchecked" : "checked";
    setTriStateMarker(showDoneInput, next);
  });
  const showDoneText = document.createElement("span");
  showDoneText.textContent = "显示完成";
  showDoneLabel.append(showDoneInput, showDoneText);
  checks.appendChild(showDoneLabel);
  addItem(part1, "复选").appendChild(checks);

  const checkboxRow = document.createElement("div");
  checkboxRow.className = "control-gallery-native-group";
  const checkbox = createCheckbox(false);
  checkbox.addEventListener("click", () => {
    const next = !readCheckbox(checkbox);
    setCheckboxWithCompletionFeedback(checkbox, next);
  });
  checkboxRow.appendChild(checkbox);
  addItem(part1, "Checkbox").appendChild(checkboxRow);

  const loadingMount = document.createElement("div");
  const loading = mountLoadingIndicator(loadingMount, { label: "加载中…" });
  loading.setLoading(true);
  addItem(part1, "加载").appendChild(loadingMount);
  disposers.push(() => loading.dispose());

  const swatchMount = document.createElement("div");
  let swatchValues: Record<string, boolean> = { red: true, green: false, blue: true };
  const swatchGrid = mountSwatchToggleGrid(swatchMount, {
    columns: 3,
    ariaLabel: "色块开关",
    values: swatchValues,
    options: [
      { value: "red", label: "红色", color: "#e74c3c" },
      { value: "green", label: "绿色", color: "#2ecc71" },
      { value: "blue", label: "蓝色", color: "#3498db" },
    ],
    onChange: (value, on) => {
      swatchValues = { ...swatchValues, [value]: on };
    },
  });
  addItem(part1, "色块").appendChild(swatchMount);
  disposers.push(() => swatchGrid.dispose());

  const partButton = addPart("button", "按钮");
  addItem(partButton, "按钮").appendChild(createButton("继续"));

  const waitMotion = (ms: number): Promise<boolean> => new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => resolve(!signal.aborted), ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
  const mountConfirmDemo = (label: string, outcome: "ok" | "bad"): HTMLButtonElement => {
    const button = createButton(label);
    button.addEventListener("click", () => {
      void runButtonAction(button, {
        task: async () => {
          const pendingShown = await waitMotion(700);
          if (!pendingShown) return;
          if (outcome === "bad") throw new Error("confirm demo failed");
        },
        pending: { label: "确认中" },
        success: outcome === "ok",
        error: outcome === "bad",
      }).catch(() => {});
    }, { signal });
    return button;
  };
  const confirmRow = addItem(partButton, "确认");
  confirmRow.append(mountConfirmDemo("确认成功", "ok"), mountConfirmDemo("确认失败", "bad"));

  const part2 = addPart("dialog", "消息框");

  const dialogBtn = genericTrigger("消息框");
  const dialog = createInsightDialog({
    title: "示例",
    bodyHtml: "<p>这是一句示例文案，仅用于控件对照。</p>",
    submitLabel: "确认",
  });
  dialog.bindChrome(() => void dialog.close());
  dialog.panel.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      void dialog.close();
    },
    { signal },
  );
  dialogBtn.addEventListener("click", () => void dialog.open(), { signal });
  const messageRow = addItem(part2, "消息框");
  messageRow.appendChild(dialogBtn);

  const deleteBtn = genericTrigger("确认删除");
  const deleteDialog = createInsightDialog({
    title: "确认删除",
    bodyHtml: "<p>删除后无法恢复。</p>",
    submitLabel: "删除",
    dangerSubmit: true,
  });
  deleteDialog.bindChrome(() => void deleteDialog.close());
  deleteDialog.panel.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      void deleteDialog.close();
    },
    { signal },
  );
  deleteBtn.addEventListener("click", () => void deleteDialog.open(), { signal });
  messageRow.appendChild(deleteBtn);
  disposers.push(() => {
    void dialog.close();
    void deleteDialog.close();
    if (dialog.backdrop.isConnected) dialog.backdrop.remove();
    if (deleteDialog.backdrop.isConnected) deleteDialog.backdrop.remove();
  });

  const part3 = addPart("datetime", "日期、日期范围、时间");

  let dateValue = "";
  const dateMount = addItem(part3, "日期");
  const datePicker = mountDecoupledDatePicker({
    defaultTrigger: { container: dateMount },
    value: dateValue,
    onChange: (value) => {
      dateValue = value;
    },
  });
  disposers.push(() => datePicker.dispose());

  let rangeValue: DateRangeValue = { from: "", to: "" };
  const rangeMount = addItem(part3, "日期范围");
  const rangePicker = mountDecoupledDateRangePicker({
    defaultTrigger: { container: rangeMount },
    value: rangeValue,
    onChange: (value) => {
      rangeValue = value;
    },
  });
  disposers.push(() => rangePicker.dispose());

  let timeValue = "09:30";
  const timeMount = addItem(part3, "时间");
  const timePicker = mountDecoupledTimePicker({
    defaultTrigger: { container: timeMount },
    value: timeValue,
    onChange: (value) => {
      timeValue = value;
    },
  });
  disposers.push(() => timePicker.dispose());

  const today = shanghaiYmd();
  let dateTimeValue = { date: today, time: "09:00" };
  const dateTimeMount = addItem(part3, "日期时间");
  const dateTimePicker = mountDecoupledDateTimePicker({
    defaultTrigger: { container: dateTimeMount },
    value: dateTimeValue,
    onChange: (value) => {
      dateTimeValue = value;
    },
  });
  disposers.push(() => dateTimePicker.dispose());

  let dateTimeRangeValue = {
    startDate: today,
    startTime: "09:00",
    endDate: today,
    endTime: "18:00",
  };
  const dateTimeRangeMount = addItem(part3, "起止时间");
  const dateTimeRangePicker = mountDecoupledDateTimeRangePicker({
    defaultTrigger: { container: dateTimeRangeMount },
    value: dateTimeRangeValue,
    onChange: (value) => {
      dateTimeRangeValue = value;
    },
  });
  disposers.push(() => dateTimeRangePicker.dispose());

  let dateTimeChangeValue = { date: today, time: "14:30" };
  const dateTimeChangeMount = addItem(part3, "日期时间（commitMode: change）");
  const dateTimeChangePicker = mountDecoupledDateTimePicker({
    defaultTrigger: { container: dateTimeChangeMount },
    value: dateTimeChangeValue,
    commitMode: "change",
    onChange: (value) => {
      dateTimeChangeValue = value;
    },
  });
  disposers.push(() => dateTimeChangePicker.dispose());

  const partD1Shared = addPart("d1-shared", "D1 共享场景零件");
  const inlineFieldMount = addItem(partD1Shared, "无框文字字段");
  let inlineFieldValue = "";
  const inlineField = mountInlineTextField({
    container: inlineFieldMount,
    value: inlineFieldValue,
    placeholder: "未命名",
    inputPlaceholder: "输入标题",
    onCommit: (value) => {
      inlineFieldValue = value;
    },
  });
  disposers.push(() => inlineField.dispose());

  const inlineSelectionMount = addItem(partD1Shared, "无框文字字段（直接拖选）");
  const inlineSelectionField = mountInlineTextField({
    container: inlineSelectionMount,
    value: "无需先点击，直接按住拖选这段文字",
    onCommit: () => {},
  });
  disposers.push(() => inlineSelectionField.dispose());

  const inlineSubtleMount = addItem(partD1Shared, "无框文字字段（较浅占位）");
  inlineSubtleMount.style.setProperty("--orbita-inline-placeholder-color", "var(--insight-text-disabled)");
  const inlineSubtleField = mountInlineTextField({
    container: inlineSubtleMount,
    value: "",
    placeholder: "食物",
    ariaLabel: "食物",
    onCommit: () => {},
  });
  disposers.push(() => inlineSubtleField.dispose());

  const lineDecorationMount = addItem(partD1Shared, "时间轴连线装饰");
  const lineSample = document.createElement("div");
  lineSample.className = "control-gallery-timeline-line-sample orbita-timeline-line-group";
  const glow = timelineGlowCssVars("#5a9de8", 0.55);
  lineSample.style.setProperty("--orbita-timeline-glow-primary", glow["--orbita-timeline-glow-primary"]);
  lineSample.style.setProperty("--orbita-timeline-glow-opacity", glow["--orbita-timeline-glow-opacity"]);
  const fadePx = timelineSegmentFadePx(80);
  const plannedClass = timelineSegmentClassNames({ actual: false, fadeStart: true, fadeEnd: true });
  const actualClass = timelineSegmentClassNames({ actual: true });
  lineSample.innerHTML = `
    <span class="control-gallery-timeline-segment ${plannedClass}" style="top:8px;height:80px;--orbita-timeline-fade:${fadePx}px;color:#87909a">${timelinePlannedDashSvg()}</span>
    <span class="control-gallery-timeline-segment ${actualClass}" style="top:96px;height:48px;color:#5a9de8"></span>
    <button type="button" class="control-gallery-timeline-point orbita-timeline-point has-icon" style="top:40px;color:#5a9de8">${transportationTypeIconSvg("walk")}</button>`;
  lineDecorationMount.appendChild(lineSample);

  const transportMount = addItem(partD1Shared, "出行类型图标");
  const transportGrid = document.createElement("div");
  transportGrid.className = "control-gallery-transport-grid";
  const transportCells: Array<{ key: string | null; label: string; icon: string }> = [
    { key: null, label: "空", icon: transportationTypeIconSvg(null) },
    ...TRANSPORTATION_TYPE_KEYS.flatMap((key) => {
      if (key === "flight") {
        return [
          { key, label: `${transportationTypeLabelZh(key)}（起飞）`, icon: transportationTypeIconSvg(key, { flightGlyph: "departure" }) },
          { key, label: `${transportationTypeLabelZh(key)}（降落）`, icon: transportationTypeIconSvg(key, { flightGlyph: "arrival" }) },
        ];
      }
      return [{ key, label: transportationTypeLabelZh(key) ?? key, icon: transportationTypeIconSvg(key) }];
    }),
  ];
  for (const cell of transportCells) {
    const item = document.createElement("div");
    item.className = "control-gallery-transport-cell";
    item.innerHTML = `<span class="control-gallery-transport-icon">${cell.icon}</span><span class="control-gallery-transport-label">${cell.label}</span>`;
    transportGrid.appendChild(item);
  }
  transportMount.appendChild(transportGrid);

  const partStandardSelect = addPart("standard-select", "标准选择控件");

  const standardFlatOptions = [
    { value: "a", label: "选项甲" },
    { value: "b", label: "选项乙" },
    { value: "c", label: "选项丙" },
    { value: "d", label: "选项丁" },
  ];
  let flatSingleValue: string | null = "a";
  const flatSingle = mountSelectField(addItem(partStandardSelect, "平铺单选"), {
    label: "平铺单选",
    options: standardFlatOptions,
    multiple: false,
    search: false,
    value: flatSingleValue,
    onChange: (value) => {
      flatSingleValue = value;
    },
  });
  disposers.push(() => flatSingle.dispose());

  const cascadingMenuItems = [
    { value: "move-inbox", label: "收件箱" },
    {
      value: "move-work",
      label: "工作",
      children: [
        { value: "move-week", label: "本周重点" },
        {
          value: "move-clients",
          label: "客户",
          children: [
            { value: "move-clients-north", label: "北区客户" },
            { value: "move-clients-south", label: "南区客户" },
          ],
        },
        {
          value: "move-internal",
          label: "内部项目",
          children: [
            { value: "move-desktop", label: "桌面客户端" },
            { value: "move-docs", label: "文档站点" },
          ],
        },
      ],
    },
    {
      value: "move-personal",
      label: "个人",
      children: [
        { value: "move-reading", label: "阅读清单" },
        { value: "move-home", label: "家务" },
      ],
    },
    {
      value: "move-archive",
      label: "归档",
      children: [
        { value: "move-archive-2025", label: "2025" },
        { value: "move-archive-2026", label: "2026" },
      ],
    },
  ];
  const cascadingMenuBtn = genericTrigger("可搜索级联菜单");
  const cascadingMenu = mountSearchableCascadingMenu({
    anchor: cascadingMenuBtn,
    items: cascadingMenuItems,
    onSelect: () => {},
  });
  addItem(partStandardSelect, "可搜索级联菜单").appendChild(cascadingMenuBtn);
  disposers.push(() => cascadingMenu.dispose());

  const partTextRoles = addPart("text-role", "文字角色");
  const pageTitleSample = addItem(partTextRoles, "页面主标题");
  const pageTitle = document.createElement("h1");
  pageTitle.textContent = "页面主标题示例";
  pageTitle.style.fontSize = "var(--insight-font-role-page-title)";
  pageTitleSample.appendChild(pageTitle);

  const part4 = addPart("command", "命令菜单");

  const menuBtn = genericTrigger("右键菜单");
  const insertSlider = mountSliderField({
    min: 0,
    max: 100,
    value: 50,
    label: "数值",
  });
  disposers.push(() => insertSlider.dispose());
  const insertTitle = mountSectionTitle("插入");
  disposers.push(() => insertTitle.dispose());
  const copyHint = mountOptionHint("复制到剪贴板");
  const pasteHint = mountOptionHint("粘贴剪贴板内容");
  disposers.push(() => copyHint.dispose(), () => pasteHint.dispose());
  const actionMenu = mountFlatSelectPopover({
    anchor: menuBtn,
    options: [],
    sections: [
      {
        options: [
          { value: "undo", label: "撤销", disabled: true },
          { value: "redo", label: "重做", disabled: true },
          { value: "cut", label: "剪切" },
          { value: "copy", label: "复制", hint: copyHint.element },
          { value: "paste", label: "粘贴", hint: pasteHint.element },
          {
            value: "paste-as",
            label: "粘贴为",
            children: [
              { value: "paste-plain", label: "纯文本" },
              { value: "paste-format", label: "保留格式" },
            ],
          },
        ],
      },
      {
        title: insertTitle.element,
        options: [
          {
            value: "insert",
            label: "插入",
            submenu: insertSlider.element,
            children: [
              { value: "insert-link", label: "链接" },
              { value: "insert-image", label: "图片" },
              { value: "insert-rule", label: "分隔线" },
            ],
          },
          { value: "copy-link", label: "复制链接" },
        ],
      },
      {
        options: [{ value: "delete", label: "删除", danger: true }],
      },
    ],
    selected: new Set(),
    multiple: false,
    search: false,
    menu: true,
    onChange: () => {},
  });
  menuBtn.addEventListener("click", () => void actionMenu.open(), { signal });
  addItem(part4, "右键菜单").appendChild(menuBtn);
  disposers.push(() => actionMenu.dispose());

  const part5 = addPart("select", "选择器");

  const flatOptions = [
    { value: "a", label: "选项甲" },
    { value: "b", label: "选项乙" },
    { value: "c", label: "选项丙（禁用）", disabled: true },
    { value: "d", label: "选项丁" },
  ];

  let singlePlainValue: string | null = "a";
  const singlePlain = mountSelectField(addItem(part5, "单选，无搜索"), {
    label: "单选，无搜索",
    options: flatOptions,
    multiple: false,
    search: false,
    value: singlePlainValue,
    onChange: (value) => { singlePlainValue = value; },
  });
  disposers.push(() => singlePlain.dispose());

  let singleSearchValue: string | null = "a";
  const singleSearch = mountSelectField(addItem(part5, "单选，有搜索"), {
    label: "单选，有搜索",
    options: flatOptions,
    multiple: false,
    search: true,
    value: singleSearchValue,
    onChange: (value) => { singleSearchValue = value; },
  });
  disposers.push(() => singleSearch.dispose());

  let multiPlainValues = new Set<string>(["a", "b"]);
  const multiPlain = mountSelectField(addItem(part5, "多选，无搜索"), {
    label: "多选，无搜索",
    options: flatOptions,
    multiple: true,
    search: false,
    values: multiPlainValues,
    onChange: (values) => { multiPlainValues = values; },
  });
  disposers.push(() => multiPlain.dispose());

  let multiSearchValues = new Set<string>(["a", "b"]);
  const multiSearch = mountSelectField(addItem(part5, "多选，有搜索"), {
    label: "多选，有搜索",
    options: flatOptions,
    multiple: true,
    search: true,
    values: multiSearchValues,
    onChange: (values) => { multiSearchValues = values; },
  });
  disposers.push(() => multiSearch.dispose());

  const part6 = addPart("radius", "圆角类型");
  const rows = document.createElement("div");
  rows.className = "control-gallery-radius-rows";

  const line1 = document.createElement("div");
  line1.className = "control-gallery-radius-line";
  const circle = document.createElement("div");
  circle.className = "control-gallery-radius-circle";
  const pill = document.createElement("div");
  pill.className = "control-gallery-radius-pill";
  pill.textContent = "胶囊";
  const btnShort = document.createElement("div");
  btnShort.className = "control-gallery-radius-button control-gallery-radius-button--short";
  btnShort.textContent = "短";
  const btnLong = document.createElement("div");
  btnLong.className = "control-gallery-radius-button control-gallery-radius-button--long";
  btnLong.textContent = "长一点";
  const input = document.createElement("div");
  input.className = "control-gallery-radius-input";
  input.textContent = "输入框";
  line1.append(circle, pill, btnShort, btnLong, input);

  const line2 = document.createElement("div");
  line2.className = "control-gallery-radius-line";
  const composer = document.createElement("div");
  composer.className = "control-gallery-radius-composer";
  const composerInput = document.createElement("div");
  composerInput.className = "control-gallery-radius-composer-input";
  composerInput.textContent = "输入消息…";
  const composerTools = document.createElement("div");
  composerTools.className = "control-gallery-radius-composer-tools";
  const composerPlus = document.createElement("div");
  composerPlus.className = "control-gallery-radius-composer-plus";
  composerPlus.textContent = "+";
  const composerToken = document.createElement("div");
  composerToken.className = "control-gallery-radius-composer-token";
  const composerModel = document.createElement("div");
  composerModel.className = "control-gallery-radius-composer-model";
  composerModel.textContent = "模型";
  const composerSend = document.createElement("div");
  composerSend.className = "control-gallery-radius-composer-send";
  composerTools.append(composerPlus, composerToken, composerModel, composerSend);
  composer.append(composerInput, composerTools);
  line2.appendChild(composer);

  const line3 = document.createElement("div");
  line3.className = "control-gallery-radius-line";
  const dialogFrame = document.createElement("div");
  dialogFrame.className = "control-gallery-radius-dialog";
  const dialogTitle = document.createElement("div");
  dialogTitle.className = "control-gallery-radius-dialog-title";
  dialogTitle.textContent = "标题";
  const dialogBody = document.createElement("div");
  dialogBody.className = "control-gallery-radius-dialog-body";
  dialogBody.textContent = "正文";
  const dialogFooter = document.createElement("div");
  dialogFooter.className = "control-gallery-radius-dialog-footer";
  const dialogCancel = document.createElement("div");
  dialogCancel.className = "control-gallery-radius-dialog-btn";
  dialogCancel.textContent = "取消";
  const dialogConfirm = document.createElement("div");
  dialogConfirm.className = "control-gallery-radius-dialog-btn control-gallery-radius-dialog-btn--primary";
  dialogConfirm.textContent = "确认";
  dialogFooter.append(dialogCancel, dialogConfirm);
  dialogFrame.append(dialogTitle, dialogBody, dialogFooter);
  line3.appendChild(dialogFrame);

  const line4 = document.createElement("div");
  line4.className = "control-gallery-radius-line";
  const activity = document.createElement("div");
  activity.className = "control-gallery-radius-activity";
  const activityBadge = document.createElement("div");
  activityBadge.className = "control-gallery-radius-activity-badge";
  const activityCopy = document.createElement("div");
  activityCopy.className = "control-gallery-radius-activity-copy";
  const activityWhen = document.createElement("div");
  activityWhen.className = "control-gallery-radius-activity-when";
  activityWhen.textContent = "今天 07:12";
  const activityName = document.createElement("div");
  activityName.className = "control-gallery-radius-activity-name";
  activityName.textContent = "步行";
  const activityPlace = document.createElement("div");
  activityPlace.className = "control-gallery-radius-activity-place";
  activityPlace.textContent = "地点";
  activityCopy.append(activityWhen, activityName, activityPlace);
  const activityStat = document.createElement("div");
  activityStat.className = "control-gallery-radius-activity-stat";
  activityStat.textContent = "3.2 km";
  const activityMap = document.createElement("div");
  activityMap.className = "control-gallery-radius-activity-map";
  activityMap.textContent = "路线";
  activity.append(activityBadge, activityCopy, activityStat, activityMap);
  const trade = document.createElement("div");
  trade.className = "control-gallery-radius-activity control-gallery-radius-activity--pending";
  trade.textContent = "交易（待定）";
  line4.append(activity, trade);

  rows.append(line1, line3, line4, line2);
  part6.appendChild(rows);

  const floatingPart = addPart("floating-panel", "非模态浮动编辑器");
  const floatingDescription = document.createElement("p");
  floatingDescription.textContent = "拖动标题栏移动；可收起、展开或关闭。浮窗没有遮罩，底层页面仍可操作。";
  const openFloatingSample = document.createElement("button");
  openFloatingSample.type = "button";
  openFloatingSample.className = "control-gallery-trigger";
  openFloatingSample.textContent = "打开浮窗样品";
  const sampleBody = document.createElement("div");
  sampleBody.className = "control-gallery-floating-sample";
  sampleBody.innerHTML = `<strong>编辑区域示例</strong><p>这里是可滚动的浮窗内容。</p><label>预览文字 <input value="可继续操作底层页面"></label>`;
  const mountFloatingSample = () => {
    if (sampleFloatingPanel) return;
    const content = document.createElement("div");
    content.append(sampleBody);
    sampleFloatingPanel = mountFloatingPanel({
      title: "色彩管理编辑器样品",
      content,
      onCloseRequest: () => { sampleFloatingPanel?.dispose(); sampleFloatingPanel = null; },
    });
  };
  openFloatingSample.addEventListener("click", mountFloatingSample, { signal });
  floatingPart.append(floatingDescription, openFloatingSample);

  return {
    activate() {},
    deactivate() {},
    dispose() {
      ac.abort();
      sampleFloatingPanel?.dispose();
      sampleFloatingPanel = null;
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      root.innerHTML = "";
    },
    getSecondaryRailDescriptor: () => debugRail("control-gallery"),
  };
}

export const controlGalleryDestination: InsightDestination = {
  id: "control-gallery",
  kind: "workspace",
  label: "控件",
  icon: "work",
  showInNav: false,
  mount(root, ctx) {
    return mountControlGalleryPage(root, ctx);
  },
};
