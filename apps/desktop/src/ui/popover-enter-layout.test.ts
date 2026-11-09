import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPopoverOrigin } from "./motion";

describe("popover enter layout (transform-origin)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });

  it("derives transform-origin from style left/top and trigger center, not popover GBR", () => {
    const el = document.createElement("div");
    el.style.left = "100px";
    el.style.top = "200px";
    el.getBoundingClientRect = () => {
      throw new Error("popover getBoundingClientRect must not drive origin");
    };

    const trigger = document.createElement("button");
    trigger.getBoundingClientRect = () =>
      ({
        left: 150,
        top: 250,
        width: 40,
        height: 32,
        right: 190,
        bottom: 282,
        x: 150,
        y: 250,
        toJSON: () => ({}),
      }) as DOMRect;

    setPopoverOrigin(el, trigger);
    expect(el.style.transformOrigin).toBe("70px 66px");
  });

  it("uses pointer coordinates when the trigger is a MouseEvent", () => {
    const el = document.createElement("div");
    el.style.left = "50px";
    el.style.top = "80px";

    setPopoverOrigin(el, { clientX: 120, clientY: 100 } as MouseEvent);
    expect(el.style.transformOrigin).toBe("70px 20px");
  });
});
