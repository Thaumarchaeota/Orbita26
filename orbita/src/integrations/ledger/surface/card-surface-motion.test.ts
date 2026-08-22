import { beforeEach, describe, expect, it, vi } from "vitest";
import { transitionPaint } from "./card-surface-motion";

describe("card surface motion", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("seeds inline paint before clearing on the next frame", () => {
    let raf: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      raf = cb;
      return 1;
    });

    const el = document.createElement("div");
    el.style.backgroundColor = "rgb(255, 0, 0)";
    document.body.appendChild(el);

    transitionPaint(
      el,
      () => {
        el.style.backgroundColor = "rgb(0, 128, 0)";
      },
      ["backgroundColor"],
    );

    expect(el.style.backgroundColor).toBe("rgb(255, 0, 0)");
    raf?.(0);
    expect(el.style.backgroundColor).toBe("");
  });
});
