import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cssText from "./insight-dialog.css?raw";
import { createInsightDialog } from "./insight-dialog";

vi.mock("./modal-root", () => ({
  mountModalBackdrop: (backdrop: HTMLElement) => document.body.appendChild(backdrop),
}));

vi.mock("./motion", () => ({
  bindDialog: (backdrop: HTMLElement) => ({
    open: async () => backdrop.classList.add("is-open"),
    close: async () => backdrop.classList.remove("is-open"),
    isOpen: () => backdrop.classList.contains("is-open"),
  }),
}));

function injectInsightDialogCss(): void {
  const style = document.createElement("style");
  style.textContent = cssText;
  document.head.appendChild(style);
}

describe("createInsightDialog failure boundaries", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    injectInsightDialogCss();
  });

  afterEach(() => {
    document.head.querySelectorAll("style").forEach((el) => el.remove());
  });

  it("keeps the primary submit button visible with primary classes when enabled and busy", () => {
    const dlg = createInsightDialog({
      title: "测试",
      bodyHtml: "<p>内容</p>",
      submitLabel: "确认",
    });

    expect(dlg.submitBtn.hidden).toBe(false);
    expect(dlg.submitBtn.classList.contains("insight-dialog-btn-primary")).toBe(true);
    expect(dlg.submitBtn.classList.contains("dialog-btn-primary")).toBe(true);
    expect(dlg.submitBtn.disabled).toBe(false);

    dlg.setBusy(true);

    expect(dlg.submitBtn.hidden).toBe(false);
    expect(dlg.submitBtn.disabled).toBe(true);
    expect(dlg.submitBtn.classList.contains("insight-dialog-btn-primary")).toBe(true);
    expect(cssText).toMatch(/\.insight-dialog-btn-primary:disabled\s*\{[^}]*opacity:\s*1/);
  });

  it("applies max-height min(85vh, calc(100vh - 32px)) on the panel", () => {
    const dlg = createInsightDialog({
      title: "测试",
      bodyHtml: "<p>内容</p>",
      submitLabel: "确认",
    });

    expect(cssText).toMatch(
      /\.insight-dialog-panel\s*\{[^}]*max-height:\s*min\(85vh,\s*calc\(100vh - 32px\)\)/,
    );
    const maxHeight = getComputedStyle(dlg.panel).maxHeight;
    expect(maxHeight === "min(85vh, calc(-32px + 100vh))" || maxHeight.includes("85vh")).toBe(true);
  });

  it("keeps the dialog open when submit handling fails", async () => {
    const dlg = createInsightDialog({
      title: "测试",
      bodyHtml: "<p>内容</p>",
      submitLabel: "确认",
    });
    dlg.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      dlg.setBusy(true);
      dlg.setBusy(false);
      dlg.setError("保存失败");
    });

    await dlg.open();
    dlg.panel.requestSubmit();

    expect(document.body.contains(dlg.backdrop)).toBe(true);
    expect(dlg.errorEl.hidden).toBe(false);
    expect(dlg.errorEl.textContent).toBe("保存失败");
  });

  it("keeps the dialog when a press starts inside and releases on the backdrop", async () => {
    const onCancel = vi.fn();
    const dlg = createInsightDialog({
      title: "测试",
      bodyHtml: "<p>内容</p>",
      submitLabel: "确认",
    });
    dlg.bindChrome(onCancel);
    await dlg.open();

    dlg.panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    dlg.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.contains(dlg.backdrop)).toBe(true);
  });

  it("dismisses when the press and the click both land on the backdrop", async () => {
    const onCancel = vi.fn();
    const dlg = createInsightDialog({
      title: "测试",
      bodyHtml: "<p>内容</p>",
      submitLabel: "确认",
    });
    dlg.bindChrome(onCancel);
    await dlg.open();

    dlg.backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    dlg.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("closes the dialog after submit handling succeeds", async () => {
    const dlg = createInsightDialog({
      title: "测试",
      bodyHtml: "<p>内容</p>",
      submitLabel: "确认",
    });
    dlg.panel.addEventListener("submit", async (e) => {
      e.preventDefault();
      await dlg.close();
    });

    await dlg.open();
    dlg.panel.requestSubmit();

    expect(document.body.contains(dlg.backdrop)).toBe(false);
  });
});
