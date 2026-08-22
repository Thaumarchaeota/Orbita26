import type { LedgerRouter, LedgerViewHandle } from "../../shell";
import { mergeCsvBatch } from "../../state/ledger";
import { mountFinancePage } from "../../ui/page-shell";
import type { CsvImportOrder, CsvRowError } from "./csv";
import { handleImportFile } from "./csv";
import type { Transaction } from "../../domain/ledger-item";

/** CSV 导入子页：顶栏由 page-shell 提供，内容区仅保留拖放与校验 */
export function mountImportView(panel: HTMLElement, router: LedgerRouter): LedgerViewHandle {
  let pendingDrafts: Transaction[] | null = null;

  const page = mountFinancePage(panel, {
    title: "财务·导入",
    showBack: true,
    onBack: () => router.back(),
    renderBody(bodyEl) {
      const ac = new AbortController();
      const { signal } = ac;

      bodyEl.innerHTML = `
        <div class="import-view">
          <div class="import-body">
            <a class="import-template-link" href="/ledger-csv-template.csv" download="ledger-csv-template.csv">下载模板</a>
            <div class="import-dropzone" id="import-dropzone" role="button" tabindex="0" aria-label="拖拽 CSV 或点击选择">
              <span class="import-dropzone-icon" aria-hidden="true">+</span>
              <span class="import-dropzone-text">拖拽 CSV 或点击选择</span>
            </div>
            <input type="file" id="import-file-input" class="import-file-input" accept=".csv,text/csv" hidden>
            <div class="import-status" id="import-status" hidden>
              <span class="import-status-icon" id="import-status-icon" aria-hidden="true"></span>
              <span class="import-status-text" id="import-status-text"></span>
            </div>
            <ul class="import-error-list" id="import-error-list" hidden></ul>
            <div class="import-actions" id="import-actions" hidden>
              <fieldset class="import-order-fieldset">
                <legend class="import-order-legend">行序</legend>
                <label class="import-order-label">
                  <input type="radio" name="import-order" value="forward" checked>
                  正序
                </label>
                <label class="import-order-label">
                  <input type="radio" name="import-order" value="reverse">
                  倒序
                </label>
              </fieldset>
              <button type="button" class="import-confirm-btn" id="import-confirm-btn">确定添加</button>
            </div>
          </div>
        </div>`;

      const dropzone = bodyEl.querySelector<HTMLElement>("#import-dropzone")!;
      const fileInput = bodyEl.querySelector<HTMLInputElement>("#import-file-input")!;
      const statusEl = bodyEl.querySelector<HTMLElement>("#import-status")!;
      const statusIcon = bodyEl.querySelector<HTMLElement>("#import-status-icon")!;
      const statusText = bodyEl.querySelector<HTMLElement>("#import-status-text")!;
      const errList = bodyEl.querySelector<HTMLElement>("#import-error-list")!;
      const actionsEl = bodyEl.querySelector<HTMLElement>("#import-actions")!;
      const confirmBtn = bodyEl.querySelector<HTMLButtonElement>("#import-confirm-btn")!;

      function resetImportUI(): void {
        statusEl.hidden = true;
        actionsEl.hidden = true;
        errList.hidden = true;
        errList.innerHTML = "";
        pendingDrafts = null;
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
        statusIcon.className = "import-status-icon is-ok";
        statusText.textContent = `校验通过，共 ${drafts.length} 条`;
        errList.hidden = true;
        errList.innerHTML = "";
        pendingDrafts = drafts;
      }

      async function onFileSelected(file: File | null | undefined): Promise<void> {
        showImportLoading();
        const result = await handleImportFile(file);
        if (result.status === "error") {
          showImportError(result.errors);
          return;
        }
        showImportSuccess(result.drafts);
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
      confirmBtn.addEventListener(
        "click",
        () => {
          if (!pendingDrafts?.length) return;
          const orderMode =
            (bodyEl.querySelector<HTMLInputElement>('input[name="import-order"]:checked')?.value as
              | CsvImportOrder) || "forward";
          mergeCsvBatch(pendingDrafts, orderMode);
          pendingDrafts = null;
          actionsEl.hidden = true;
          resetImportUI();
          router.navigate("detail");
        },
        { signal },
      );

      return () => ac.abort();
    },
  });

  return {
    getScrollEl: () => page.getScrollEl(),
    dispose() {
      page.unmount();
    },
  };
}
