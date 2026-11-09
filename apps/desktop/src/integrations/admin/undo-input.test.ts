import { afterEach, describe, expect, it, vi } from "vitest";
import { installInsightUndoInput, registerArrangementUndoInputOwner, registerInsightTextHistoryOwner } from "./undo-input";

vi.mock("../../ui/overlay-navigation", () => ({ hasBlockingOverlayNavigation: () => false }));

const releases: Array<() => void> = [];
afterEach(() => { releases.splice(0).reverse().forEach((release) => release()); document.body.replaceChildren(); });

function setup() {
  const request = vi.fn();
  releases.push(registerArrangementUndoInputOwner({ isActive: () => true, isBusy: () => false, request, onError: vi.fn() }));
  releases.push(installInsightUndoInput());
  return request;
}

function press(target: EventTarget, key = "z", extras: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, composed: true, cancelable: true, ...extras });
  target.dispatchEvent(event);
  return event;
}

describe("Insight undo input ownership", () => {
  it.each(["input", "textarea", "select"])("keeps empty native %s history from undoing a plan", async (tag) => {
    const request = setup();
    const control = document.createElement(tag);
    document.body.append(control);
    expect(press(control).defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it("reserves a custom closed shadow editor host", async () => {
    const request = setup();
    const host = document.createElement("div");
    document.body.append(host);
    const child = document.createElement("span");
    host.attachShadow({ mode: "closed" }).append(child);
    releases.push(registerInsightTextHistoryOwner(host));
    expect(press(child).defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it("runs only one committed-direction request while pending", async () => {
    const request = setup();
    expect(press(window).defaultPrevented).toBe(true);
    press(window, "y");
    await Promise.resolve();
    expect(request).toHaveBeenCalledExactlyOnceWith("undo");
  });

  it("does not capture IME or editor-consumed input", async () => {
    const request = setup();
    expect(press(window, "z", { isComposing: true }).defaultPrevented).toBe(false);
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not invoke an owner released before its queued callback", async () => {
    const request = vi.fn();
    const release = registerArrangementUndoInputOwner({ isActive: () => true, isBusy: () => false, request, onError: vi.fn() });
    releases.push(release, installInsightUndoInput());
    press(window);
    release();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });
});
