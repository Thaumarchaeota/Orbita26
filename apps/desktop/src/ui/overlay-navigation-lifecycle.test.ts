import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfirmDialog } from "../integrations/shell/dialog";
import { createInsightDialog } from "./insight-dialog";
import { hasBlockingOverlayNavigation, setOverlayNavigationRegistrar } from "./overlay-navigation";

const motionState = vi.hoisted(() => ({ failOpen: false, closeGate: null as Promise<void> | null }));
vi.mock("./modal-root", () => ({
  mountModalBackdrop: (node: HTMLElement) => document.body.appendChild(node),
}));
vi.mock("./motion", () => ({
  bindDialog: (backdrop: HTMLElement) => ({
    open: async () => { if (!motionState.failOpen) backdrop.classList.add("is-open"); },
    close: async () => { await motionState.closeGate; backdrop.classList.remove("is-open"); },
    isOpen: () => backdrop.classList.contains("is-open"),
  }),
}));
const dialogs: ReturnType<typeof createInsightDialog>[] = [];
function dialog(navigationKind?: "temporary" | "navigation-detail") {
  const handle = createInsightDialog({ title: "Test", bodyHtml: "", submitLabel: "Save", navigationKind });
  dialogs.push(handle);
  return handle;
}
beforeEach(() => { motionState.failOpen = false; motionState.closeGate = null; });
afterEach(() => {
  dialogs.splice(0).forEach((handle) => handle.dispose());
  setOverlayNavigationRegistrar(null);
  document.body.innerHTML = "";
});

describe("dialog navigation lifecycle", () => {
  it("keeps a protected lease through exit and releases a failed open", async () => {
    const handle = dialog();
    await handle.open();
    let finish!: () => void;
    motionState.closeGate = new Promise<void>((resolve) => { finish = resolve; });
    const closed = handle.close();
    expect(hasBlockingOverlayNavigation()).toBe(true);
    finish(); await closed;
    expect(hasBlockingOverlayNavigation()).toBe(false);
    motionState.failOpen = true;
    await handle.open();
    expect(hasBlockingOverlayNavigation()).toBe(false);
  });

  it("protects an explicitly registered detail while busy", async () => {
    const handle = dialog("navigation-detail");
    await handle.open();
    expect(hasBlockingOverlayNavigation()).toBe(false);
    handle.setBusy(true);
    expect(hasBlockingOverlayNavigation()).toBe(true);
    handle.setBusy(false);
    expect(hasBlockingOverlayNavigation()).toBe(false);
  });

  it("cleans old chrome listeners and uses the current cancel callback", async () => {
    const handle = dialog("temporary");
    const old = vi.fn();
    const current = vi.fn();
    handle.bindChrome(old);
    handle.bindChrome(current);
    await handle.open();
    handle.panel.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale exit remove a reopened dialog or its lease", async () => {
    const handle = dialog();
    await handle.open();
    let finish!: () => void;
    motionState.closeGate = new Promise<void>((resolve) => { finish = resolve; });
    const closed = handle.close();
    const reopened = handle.open();
    finish();
    await closed; await reopened;
    expect(handle.backdrop.isConnected).toBe(true);
    expect(handle.motion.isOpen()).toBe(true);
    expect(hasBlockingOverlayNavigation()).toBe(true);
  });
});

describe("Insight singleton confirmation ownership", () => {
  it("completes a replaced request and leaves its successor pending until that request closes", async () => {
    const admin = document.createElement("main");
    admin.className = "admin-app";
    document.body.appendChild(admin);
    const confirm = getConfirmDialog();
    const first = confirm("First", "Message");
    let secondFinished = false;
    const second = confirm("Second", "Message").then((value) => { secondFinished = true; return value; });
    expect(await first).toBe(false);
    await vi.waitFor(() => expect(document.querySelector(".insight-confirm-dialog")?.parentElement?.classList.contains("is-open")).toBe(true));
    expect(secondFinished).toBe(false);
    expect(hasBlockingOverlayNavigation()).toBe(true);
    document.querySelector<HTMLButtonElement>('.insight-confirm-dialog [data-action="confirm"]')!.click();
    expect(await second).toBe(true);
    expect(hasBlockingOverlayNavigation()).toBe(false);
  });
});
