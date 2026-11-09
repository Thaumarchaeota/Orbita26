import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountPopoverPortal } from "./popover-portal";

const motionState = vi.hoisted(() => ({
  holdOpen: false,
  releaseOpen: null as (() => void) | null,
}));

const modalRoot = document.createElement("div");
modalRoot.style.setProperty("--orbita-popover-z", "205");

vi.mock("./modal-root", () => ({ getModalRoot: () => modalRoot }));
vi.mock("./motion", () => ({
  closePopover: vi.fn(async (popover: HTMLElement) => {
    popover.classList.remove("is-open");
  }),
  openPopover: vi.fn(async (popover: HTMLElement) => {
    popover.classList.add("is-open");
    if (motionState.holdOpen) {
      await new Promise<void>((resolve) => { motionState.releaseOpen = resolve; });
    }
  }),
  isPopoverOpen: vi.fn(() => false),
}));

function rect(left: number, right: number, top = 100, bottom = 132): DOMRect {
  return { left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function setup(anchorRect: DOMRect, popoverWidth: number) {
  const anchor = document.createElement("button");
  const popover = document.createElement("div");
  anchor.getBoundingClientRect = () => anchorRect;
  popover.getBoundingClientRect = () => rect(0, popoverWidth, 0, 100);
  Object.defineProperty(popover, "offsetWidth", { configurable: true, value: popoverWidth });
  Object.defineProperty(popover, "offsetHeight", { configurable: true, value: 100 });
  document.body.append(anchor);
  return { anchor, popover };
}

describe("popover placement stability", () => {
  beforeEach(() => {
    document.body.replaceChildren(modalRoot);
    motionState.holdOpen = false;
    motionState.releaseOpen = null;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  it("prefers the right side when the full measured width fits", async () => {
    const { anchor, popover } = setup(rect(100, 150), 200);
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    await handle.open();
    expect(popover.style.left).toBe("154px");
    handle.dispose();
  });

  it("uses the left side when right does not fit and left does", async () => {
    const { anchor, popover } = setup(rect(850, 900), 200);
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    await handle.open();
    expect(popover.style.left).toBe("646px");
    handle.dispose();
  });

  it("clamps to the viewport margin when neither side fits", async () => {
    const { anchor, popover } = setup(rect(20, 70), 980);
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    await handle.open();
    expect(popover.style.left).toBe("8px");
    handle.dispose();
  });

  it("sets the first visible left position before an animation resolves", async () => {
    const { anchor, popover } = setup(rect(850, 900), 200);
    popover.style.transform = "scale(.5)";
    popover.style.transition = "transform 180ms ease";
    motionState.holdOpen = true;
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    const opening = handle.open();
    expect(popover.style.left).toBe("646px");
    window.dispatchEvent(new Event("resize"));
    expect(popover.style.left).toBe("646px");
    expect(popover.style.transform).toBe("scale(.5)");
    expect(popover.style.transition).toBe("transform 180ms ease");
    motionState.releaseOpen?.();
    await opening;
    handle.dispose();
  });

  it("does not add is-open while measuring a closed popover", async () => {
    const { anchor, popover } = setup(rect(100, 150), 200);
    let sawOpenOnFirstMeasure = false;
    let measures = 0;
    Object.defineProperty(popover, "offsetWidth", {
      configurable: true,
      get() {
        measures += 1;
        if (measures === 1) sawOpenOnFirstMeasure = popover.classList.contains("is-open");
        return 200;
      },
    });
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    await handle.open();
    expect(measures).toBeGreaterThan(0);
    expect(sawOpenOnFirstMeasure).toBe(false);
    handle.dispose();
  });

  it("keeps the chosen side stable after resize repositioning", async () => {
    const { anchor, popover } = setup(rect(850, 900), 200);
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    await handle.open();
    const firstLeft = popover.style.left;
    window.dispatchEvent(new Event("resize"));
    expect(popover.style.left).toBe(firstLeft);
    handle.dispose();
  });

  it("uses stable layout dimensions while already open and leaves animation styles untouched", async () => {
    const { anchor, popover } = setup(rect(850, 900), 200);
    const handle = mountPopoverPortal({ anchor, popover, placement: "right" });
    await handle.open();
    const firstLeft = popover.style.left;
    popover.style.transform = "scale(.92)";
    popover.style.transition = "transform 180ms ease";
    Object.defineProperty(popover, "offsetWidth", { configurable: true, value: 200 });
    Object.defineProperty(popover, "offsetHeight", { configurable: true, value: 100 });
    popover.getBoundingClientRect = () => {
      throw new Error("open reposition must use offset dimensions");
    };

    window.dispatchEvent(new Event("resize"));
    expect(popover.style.transform).toBe("scale(.92)");
    expect(popover.style.transition).toBe("transform 180ms ease");
    expect(popover.style.left).toBe(firstLeft);
    handle.dispose();
  });
});
