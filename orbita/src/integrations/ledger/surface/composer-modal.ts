import { shanghaiIsoDate } from "../../../core/shanghai-date";
import { getConfirmDialog } from "../../shell/dialog";
import { bindDialog, type MotionTrigger } from "../../../ui/motion";
import { mountModalBackdrop } from "../../../ui/modal-root";
import { mountCdsComposerForm } from "./cds-composer";
import type { CardDetailStore } from "./types";
import "./composer-modal.css";

export type ComposerModalHandle = {
  open: (trigger?: MotionTrigger, prefillDate?: string) => Promise<void>;
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

function resolvePrefillDate(store: CardDetailStore, overrideDate?: string): string {
  if (overrideDate) return overrideDate;
  const { dateFrom, dateTo } = store.getFilterSnapshot();
  if (dateFrom && dateTo && dateFrom === dateTo) return dateFrom;
  return shanghaiIsoDate();
}

export function mountComposerModal(
  ac: AbortController,
  store: CardDetailStore,
): ComposerModalHandle {
  let disposed = false;
  const confirmDialog = getConfirmDialog();

  const backdrop = el("div", "dialog-backdrop");
  const panel = el("div", "dialog-panel composer-modal-panel");

  const head = el("div", "composer-modal-head");
  const title = el("div", "dialog-title");
  title.textContent = "添加";
  const closeBtn = el("button", "composer-modal-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "关闭");
  closeBtn.textContent = "×";
  head.append(title, closeBtn);

  const bodyMount = el("div", "composer-modal-body");
  bodyMount.setAttribute("data-role", "composer-modal-body");

  const actions = el("div", "dialog-actions composer-modal-actions");
  const cancelBtn = el("button", "dialog-btn");
  cancelBtn.type = "button";
  cancelBtn.dataset.action = "cancel";
  cancelBtn.textContent = "取消";
  const saveBtn = el("button", "dialog-btn dialog-btn-primary");
  saveBtn.type = "button";
  saveBtn.dataset.action = "save";
  saveBtn.textContent = "保存";
  const saveContinueBtn = el("button", "dialog-btn");
  saveContinueBtn.type = "button";
  saveContinueBtn.dataset.action = "save-continue";
  saveContinueBtn.textContent = "保存并继续记一笔";
  actions.append(cancelBtn, saveBtn, saveContinueBtn);

  panel.append(head, bodyMount, actions);
  backdrop.appendChild(panel);
  mountModalBackdrop(backdrop);

  const motion = bindDialog(backdrop);
  const { signal } = ac;
  const form = mountCdsComposerForm(bodyMount, store, signal);

  async function tryClose(trigger?: MotionTrigger): Promise<boolean> {
    if (form.isDirty()) {
      const ok = await confirmDialog(
        "放弃编辑？",
        "有未保存的内容，确定要放弃吗？",
        trigger,
        { confirmLabel: "放弃", danger: true },
      );
      if (!ok) return false;
    }
    await motion.close(trigger);
    return true;
  }

  async function handleSave(continueAfter: boolean, trigger?: MotionTrigger): Promise<void> {
    const result = await form.submit();
    if (result !== "ok") return;
    if (continueAfter) {
      form.resetForContinue();
      form.focus();
      return;
    }
    form.resetAll();
    await motion.close(trigger);
  }

  closeBtn.addEventListener("click", () => void tryClose(closeBtn), { signal });
  cancelBtn.addEventListener("click", () => void tryClose(cancelBtn), { signal });
  saveBtn.addEventListener("click", () => void handleSave(false, saveBtn), { signal });
  saveContinueBtn.addEventListener(
    "click",
    () => void handleSave(true, saveContinueBtn),
    { signal },
  );

  backdrop.addEventListener(
    "click",
    (e) => {
      if (e.target === backdrop) void tryClose();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && motion.isOpen()) void tryClose();
    },
    { signal },
  );

  const open = async (trigger?: MotionTrigger, prefillDate?: string) => {
    if (disposed) return;
    form.resetAll();
    form.setPrefillDate(resolvePrefillDate(store, prefillDate));
    await motion.open(trigger);
    requestAnimationFrame(() => form.focus());
  };

  return {
    open,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      form.dispose();
      backdrop.remove();
    },
  };
}
