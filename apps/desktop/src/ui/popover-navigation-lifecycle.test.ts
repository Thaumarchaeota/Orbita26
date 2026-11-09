import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPopoverPortal, type PopoverPortalHandle } from "./popover-portal";
import { hasBlockingOverlayNavigation, setOverlayNavigationRegistrar } from "./overlay-navigation";

vi.mock("./modal-root", () => ({ getModalRoot: () => document.body, topModalRootZ: () => 0 }));
vi.mock("./motion", () => ({
  openPopover: async (node: HTMLElement) => { node.classList.add("is-open"); },
  closePopover: async (node: HTMLElement) => { node.classList.remove("is-open"); },
  isPopoverOpen: (node: HTMLElement) => node.classList.contains("is-open"),
}));
const handles: PopoverPortalHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) { await handle.close(); handle.dispose(); }
  setOverlayNavigationRegistrar(null);
  document.body.innerHTML = "";
});
function nodes() {
  const anchor = document.createElement("button");
  const popover = document.createElement("div");
  document.body.append(anchor);
  return { anchor, popover };
}

describe("popover navigation lifecycle", () => {
  it("does not revive when its opening callback requests immediate close", async () => {
    const { anchor, popover } = nodes();
    let closed: Promise<void> | undefined;
    const handle = mountPopoverPortal({ anchor, popover, onOpenChange: (open) => {
      if (open) closed = handle.close();
    } });
    handles.push(handle);
    await handle.open();
    await closed;
    expect(popover.hidden).toBe(true);
    expect(popover.classList.contains("is-open")).toBe(false);
    expect(hasBlockingOverlayNavigation()).toBe(false);
  });

  it("serializes a reopen requested synchronously by the closing callback", async () => {
    const { anchor, popover } = nodes();
    let reopen = false;
    let reopened: Promise<void> | undefined;
    const handle = mountPopoverPortal({ anchor, popover, onOpenChange: (open) => {
      if (!open && reopen) { reopen = false; reopened = handle.open(); }
    } });
    handles.push(handle);
    await handle.open();
    reopen = true;
    await handle.close();
    await reopened;
    expect(handle.isOpen()).toBe(true);
    expect(popover.hidden).toBe(false);
    expect(popover.classList.contains("is-open")).toBe(true);
    expect(hasBlockingOverlayNavigation()).toBe(true);
  });
});
