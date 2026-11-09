import { afterEach, describe, expect, it, vi } from "vitest";
import { bindMouseHistoryInput } from "./mouse-history-input";

const controllers: AbortController[] = [];
afterEach(() => controllers.splice(0).forEach((controller) => controller.abort()));

function setup(isFocused = () => true) {
  const controller = new AbortController();
  controllers.push(controller);
  const navigate = vi.fn();
  bindMouseHistoryInput(navigate, { signal: controller.signal, isFocused });
  return { controller, navigate };
}
function mouse(type: string, button: number) {
  const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("Insight physical mouse-button binding", () => {
  it.each([[3, -1], [4, 1]])("routes button %s once for mouseup plus auxclick", (button, step) => {
    const { navigate } = setup();
    expect(mouse("mousedown", button).defaultPrevented).toBe(true);
    expect(mouse("mouseup", button).defaultPrevented).toBe(true);
    expect(mouse("auxclick", button).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(step);
  });
  it("consumes an isolated side-button release without navigating", () => {
    const { navigate } = setup();
    expect(mouse("mouseup", 3).defaultPrevented).toBe(true);
    mouse("auxclick", 3);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("leaves primary, middle and right clicks alone", () => {
    const { navigate } = setup();
    for (const button of [0, 1, 2]) {
      expect(mouse("mousedown", button).defaultPrevented).toBe(false);
      expect(mouse("mouseup", button).defaultPrevented).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
  });
  it("does not handle input outside the focused Insight document", () => {
    const { navigate } = setup(() => false);
    expect(mouse("mousedown", 3).defaultPrevented).toBe(false);
    expect(mouse("mouseup", 3).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("clears a press on blur and removes old bindings on abort", () => {
    const old = setup();
    mouse("mousedown", 3);
    window.dispatchEvent(new Event("blur"));
    mouse("mouseup", 3);
    expect(old.navigate).not.toHaveBeenCalled();
    old.controller.abort();
    const next = setup();
    mouse("mousedown", 3);
    mouse("mouseup", 3);
    expect(old.navigate).not.toHaveBeenCalled();
    expect(next.navigate).toHaveBeenCalledTimes(1);
  });
});
