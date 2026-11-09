import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ui/modal-root", () => ({
  mountModalBackdrop: (backdrop: HTMLElement) => document.body.appendChild(backdrop),
}));

vi.mock("../../ui/motion", () => ({
  bindDialog: (backdrop: HTMLElement) => ({
    open: async () => backdrop.classList.add("is-open"),
    close: async () => backdrop.classList.remove("is-open"),
    isOpen: () => backdrop.classList.contains("is-open"),
  }),
}));

describe("shared confirm dialog information and confirmation modes", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("hides cancellation for info notices and restores focus after acknowledgement", async () => {
    const { getConfirmDialog } = await import("../shell/dialog");
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const result = getConfirmDialog()("同步失败", "网络不可用", trigger, {
      confirmLabel: "确定",
      danger: false,
      info: true,
    });
    await Promise.resolve();

    const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop")!;
    expect(backdrop.querySelector('[data-action="cancel"]')?.hasAttribute("hidden")).toBe(true);
    expect(backdrop.querySelector('[data-action="confirm"]')?.textContent).toBe("确定");
    (backdrop.querySelector('[data-action="confirm"]') as HTMLButtonElement).click();

    await expect(result).resolves.toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps cancellation for login confirmation and returns false on cancel", async () => {
    const { getConfirmDialog } = await import("../shell/dialog");
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const result = getConfirmDialog()("佳明登录", "继续登录？", trigger, {
      confirmLabel: "继续登录",
      danger: false,
    });
    await Promise.resolve();

    const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop")!;
    expect(backdrop.querySelector('[data-action="cancel"]')?.hasAttribute("hidden")).toBe(false);
    (backdrop.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();

    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses an info notice with Escape or backdrop click without a cancel action", async () => {
    const { getConfirmDialog } = await import("../shell/dialog");
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const first = getConfirmDialog()("同步失败", "网络不可用", trigger, { info: true, danger: false });
    await Promise.resolve();
    const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop")!;
    backdrop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(first).resolves.toBe(true);

    const second = getConfirmDialog()("同步失败", "网络不可用", trigger, { info: true, danger: false });
    await Promise.resolve();
    const reopened = document.querySelector<HTMLElement>(".dialog-backdrop")!;
    reopened.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(second).resolves.toBe(true);
  });

  it("keeps Tab focus inside the dialog and ignores Enter from an external control", async () => {
    const { getConfirmDialog } = await import("../shell/dialog");
    const trigger = document.createElement("button");
    const external = document.createElement("button");
    document.body.append(trigger, external);
    const result = getConfirmDialog()("佳明登录", "继续登录？", trigger, {
      confirmLabel: "继续登录",
      danger: false,
    });
    await Promise.resolve();
    const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop")!;
    const cancel = backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const confirm = backdrop.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;

    confirm.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(cancel);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(confirm);

    external.focus();
    expect(document.activeElement).toBe(confirm);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(confirm);
    expect(await Promise.race([result, Promise.resolve("pending")])).toBe("pending");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(result).resolves.toBe(false);
  });
});
