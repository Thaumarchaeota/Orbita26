import { bindDialog, type MotionTrigger } from "../../../ui/motion";
import { mountModalBackdrop } from "../../../ui/modal-root";
import type { Transaction } from "../domain/ledger-item";
import type { CsvImportOrder, CsvRowError } from "../domain/csv-import";
import { handleImportFile } from "../views/import/csv";

export type CdsCsvModalHandle = {
  open: (trigger?: MotionTrigger) => Promise<void>;
  dispose: () => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Phase C CSV staging modal — programmatic DOM only; no legacy IDs/innerHTML. */
export function mountCdsCsvModal(
  ac: AbortController,
  detailActions: {
    resetFilters: () => void;
    scrollToEntry: (id: string) => void;
    onMerge: (drafts: Transaction[], orderMode: CsvImportOrder) => string;
  },
): CdsCsvModalHandle {
  let pendingDrafts: Transaction[] | null = null;
  let disposed = false;

  const backdrop = el("div", "dialog-backdrop");
  const panel = el("div", "dialog-panel import-modal-panel");
  const title = el("div", "dialog-title");
  title.textContent = "CSV 导入";

  const body = el("div", "import-view import-modal-body");
  const templateLink = el("a", "import-template-link");
  templateLink.href = "/ledger-csv-template.csv";
  templateLink.download = "ledger-csv-template.csv";
  templateLink.textContent = "下载模板";

  const dropzone = el("div", "import-dropzone");
  dropzone.setAttribute("role", "button");
  dropzone.tabIndex = 0;
  dropzone.setAttribute("aria-label", "拖拽 CSV 或点击选择");
  const dropIcon = el("span", "import-dropzone-icon");
  dropIcon.setAttribute("aria-hidden", "true");
  dropIcon.textContent = "+";
  const dropText = el("span", "import-dropzone-text");
  dropText.textContent = "拖拽 CSV 或点击选择";
  dropzone.append(dropIcon, dropText);

  const fileInput = el("input", "import-file-input") as HTMLInputElement;
  fileInput.type = "file";
  fileInput.accept = ".csv,text/csv";
  fileInput.hidden = true;

  const statusEl = el("div", "import-status");
  statusEl.hidden = true;
  const statusIcon = el("span", "import-status-icon");
  statusIcon.setAttribute("aria-hidden", "true");
  const statusText = el("span", "import-status-text");
  statusEl.append(statusIcon, statusText);

  const errList = el("ul", "import-error-list");
  errList.hidden = true;

  const actionsEl = el("div", "import-actions");
  actionsEl.hidden = true;
  const fieldset = el("fieldset", "import-order-fieldset");
  const legend = el("legend", "import-order-legend");
  legend.textContent = "行序";
  fieldset.appendChild(legend);
  const forwardLabel = el("label", "import-order-label");
  const forwardInput = el("input") as HTMLInputElement;
  forwardInput.type = "radio";
  forwardInput.name = "cds-csv-order";
  forwardInput.value = "forward";
  forwardInput.checked = true;
  forwardLabel.append(forwardInput, document.createTextNode(" 正序"));
  const reverseLabel = el("label", "import-order-label");
  const reverseInput = el("input") as HTMLInputElement;
  reverseInput.type = "radio";
  reverseInput.name = "cds-csv-order";
  reverseInput.value = "reverse";
  reverseLabel.append(reverseInput, document.createTextNode(" 倒序"));
  fieldset.append(forwardLabel, reverseLabel);
  actionsEl.appendChild(fieldset);

  body.append(templateLink, dropzone, fileInput, statusEl, errList, actionsEl);

  const dialogActions = el("div", "dialog-actions");
  const cancelBtn = el("button", "dialog-btn");
  cancelBtn.type = "button";
  cancelBtn.dataset.action = "cancel";
  cancelBtn.textContent = "取消";
  const confirmBtn = el("button", "dialog-btn dialog-btn-primary import-confirm-btn");
  confirmBtn.type = "button";
  confirmBtn.disabled = true;
  confirmBtn.textContent = "确定添加";
  dialogActions.append(cancelBtn, confirmBtn);

  panel.append(title, body, dialogActions);
  backdrop.appendChild(panel);
  mountModalBackdrop(backdrop);
  const motion = bindDialog(backdrop);
  const { signal } = ac;

  function resetImportUI(): void {
    statusEl.hidden = true;
    actionsEl.hidden = true;
    errList.hidden = true;
    errList.replaceChildren();
    pendingDrafts = null;
    confirmBtn.disabled = true;
  }

  function showImportLoading(): void {
    resetImportUI();
    statusEl.hidden = false;
    statusIcon.className = "import-status-icon is-loading";
    statusText.textContent = "解析中…";
  }

  function showImportError(errors: CsvRowError[]): void {
    statusEl.hidden = false;
    actionsEl.hidden = true;
    confirmBtn.disabled = true;
    statusIcon.className = "import-status-icon is-err";
    statusText.textContent = "校验失败";
    errList.hidden = false;
    errList.replaceChildren();
    for (const e of errors) {
      const li = el("li");
      li.textContent = `第 ${e.row} 行${e.field ? ` · ${e.field}` : ""}：${e.message}`;
      errList.appendChild(li);
    }
    pendingDrafts = null;
  }

  function showImportSuccess(drafts: Transaction[]): void {
    statusEl.hidden = false;
    actionsEl.hidden = false;
    confirmBtn.disabled = false;
    statusIcon.className = "import-status-icon is-ok";
    statusText.textContent = `校验通过，共 ${drafts.length} 条`;
    errList.hidden = true;
    errList.replaceChildren();
    pendingDrafts = drafts;
  }

  async function onFileSelected(file: File | null | undefined): Promise<void> {
    if (disposed) return;
    showImportLoading();
    const result = await handleImportFile(file);
    if (disposed) return;
    if (result.status === "error") {
      showImportError(result.errors);
      return;
    }
    showImportSuccess(result.drafts);
  }

  async function closeModal(trigger?: MotionTrigger): Promise<void> {
    resetImportUI();
    fileInput.value = "";
    await motion.close(trigger);
  }

  dropzone.addEventListener("click", () => fileInput.click(), { signal });
  dropzone.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    },
    { signal },
  );
  fileInput.addEventListener(
    "change",
    () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void onFileSelected(file);
    },
    { signal },
  );
  dropzone.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    },
    { signal },
  );
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"), {
    signal,
  });
  dropzone.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) void onFileSelected(file);
    },
    { signal },
  );

  cancelBtn.addEventListener("click", () => void closeModal(), { signal });
  backdrop.addEventListener(
    "click",
    (e) => {
      if (e.target === backdrop) void closeModal();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && motion.isOpen()) void closeModal();
    },
    { signal },
  );

  confirmBtn.addEventListener(
    "click",
    () => {
      if (!pendingDrafts?.length) return;
      const orderMode =
        (backdrop.querySelector<HTMLInputElement>('input[name="cds-csv-order"]:checked')?.value as
          | CsvImportOrder) || "forward";
      const drafts = pendingDrafts;
      const focusId = detailActions.onMerge(drafts, orderMode);
      detailActions.resetFilters();
      void closeModal().then(() => {
        if (!disposed && focusId) detailActions.scrollToEntry(focusId);
      });
    },
    { signal },
  );

  const open = async (trigger?: MotionTrigger) => {
    if (disposed) return;
    resetImportUI();
    await motion.open(trigger);
  };

  return {
    open,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      resetImportUI();
      backdrop.remove();
    },
  };
}
