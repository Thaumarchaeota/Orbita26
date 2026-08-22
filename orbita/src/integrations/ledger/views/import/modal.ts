import { bindDialog, type MotionTrigger } from "../../../../ui/motion";
import { mountModalBackdrop } from "../../../../ui/modal-root";
import type { Transaction } from "../../domain/ledger-item";
import type { CsvImportOrder, CsvRowError } from "./csv";
import { handleImportFile } from "./csv";

export type ImportModalHandle = {
  open: (trigger?: MotionTrigger) => void;
  dispose: () => void;
};

export function mountImportModal(
  ac: AbortController,
  detailActions: {
    resetFilters: () => void;
    scrollToEntry: (id: string) => void;
    onMerge: (drafts: Transaction[], orderMode: CsvImportOrder) => string;
  },
): ImportModalHandle {
  let pendingDrafts: Transaction[] | null = null;
  let disposed = false;

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <div class="dialog-panel import-modal-panel">
      <div class="dialog-title">CSV 导入</div>
      <div class="import-view import-modal-body">
        <a class="import-template-link" href="/ledger-csv-template.csv" download="ledger-csv-template.csv">下载模板</a>
        <div class="import-dropzone" id="import-modal-dropzone" role="button" tabindex="0" aria-label="拖拽 CSV 或点击选择">
          <span class="import-dropzone-icon" aria-hidden="true">+</span>
          <span class="import-dropzone-text">拖拽 CSV 或点击选择</span>
        </div>
        <input type="file" id="import-modal-file-input" class="import-file-input" accept=".csv,text/csv" hidden>
        <div class="import-status" id="import-modal-status" hidden>
          <span class="import-status-icon" id="import-modal-status-icon" aria-hidden="true"></span>
          <span class="import-status-text" id="import-modal-status-text"></span>
        </div>
        <ul class="import-error-list" id="import-modal-error-list" hidden></ul>
        <div class="import-actions" id="import-modal-actions" hidden>
          <fieldset class="import-order-fieldset">
            <legend class="import-order-legend">行序</legend>
            <label class="import-order-label">
              <input type="radio" name="import-modal-order" value="forward" checked>
              正序
            </label>
            <label class="import-order-label">
              <input type="radio" name="import-modal-order" value="reverse">
              倒序
            </label>
          </fieldset>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="button" class="dialog-btn dialog-btn-primary import-confirm-btn" id="import-modal-confirm" disabled>确定添加</button>
      </div>
    </div>`;
  mountModalBackdrop(backdrop);
  const motion = bindDialog(backdrop);
  const { signal } = ac;

  const dropzone = backdrop.querySelector<HTMLElement>("#import-modal-dropzone")!;
  const fileInput = backdrop.querySelector<HTMLInputElement>("#import-modal-file-input")!;
  const statusEl = backdrop.querySelector<HTMLElement>("#import-modal-status")!;
  const statusIcon = backdrop.querySelector<HTMLElement>("#import-modal-status-icon")!;
  const statusText = backdrop.querySelector<HTMLElement>("#import-modal-status-text")!;
  const errList = backdrop.querySelector<HTMLElement>("#import-modal-error-list")!;
  const actionsEl = backdrop.querySelector<HTMLElement>("#import-modal-actions")!;
  const confirmBtn = backdrop.querySelector<HTMLButtonElement>("#import-modal-confirm")!;

  function resetImportUI(): void {
    statusEl.hidden = true;
    actionsEl.hidden = true;
    errList.hidden = true;
    errList.innerHTML = "";
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
    errList.innerHTML = errors
      .map((e) => `<li>第 ${e.row} 行${e.field ? ` · ${e.field}` : ""}：${e.message}</li>`)
      .join("");
    pendingDrafts = null;
  }

  function showImportSuccess(drafts: Transaction[]): void {
    statusEl.hidden = false;
    actionsEl.hidden = false;
    confirmBtn.disabled = false;
    statusIcon.className = "import-status-icon is-ok";
    statusText.textContent = `校验通过，共 ${drafts.length} 条`;
    errList.hidden = true;
    errList.innerHTML = "";
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
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"), { signal });
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

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener(
    "click",
    () => void closeModal(),
    { signal },
  );
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
        (backdrop.querySelector<HTMLInputElement>('input[name="import-modal-order"]:checked')?.value as
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

  const open = (trigger?: MotionTrigger) => {
    if (disposed) return;
    resetImportUI();
    void motion.open(trigger);
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
