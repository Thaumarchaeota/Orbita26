import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelLayoutFlip, runLayoutFlip } from "../../../ui/layout-flip";

describe("runLayoutFlip", () => {
  let target: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    target = document.createElement("div");
    target.setAttribute("data-layout-flip", "");
    document.body.appendChild(target);
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList);
  });

  it("applies inverse translate then animates back to zero", async () => {
    let pass = 0;
    vi.spyOn(target, "getBoundingClientRect").mockImplementation(() => {
      pass += 1;
      return {
        left: pass === 1 ? 100 : 140,
        top: 0,
        width: 200,
        height: 40,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const mutate = vi.fn();
    const promise = runLayoutFlip(target, mutate);
    expect(mutate).toHaveBeenCalledOnce();
    expect(target.style.transform).toContain("translateX(-40px)");

    await promise;
    expect(target.style.transform).toBe("");
    expect(target.style.transition).toBe("");
  });

  it("skips animation when prefers-reduced-motion", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList);

    const mutate = vi.fn();
    await runLayoutFlip(target, mutate);
    expect(mutate).toHaveBeenCalledOnce();
    expect(target.style.transform).toBe("");
  });

  it("cancels in-flight flip and clears transform on rapid re-toggle", async () => {
    let pass = 0;
    vi.spyOn(target, "getBoundingClientRect").mockImplementation(() => {
      pass += 1;
      return {
        left: pass % 2 === 1 ? 80 : 120,
        top: 0,
        width: 200,
        height: 40,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    void runLayoutFlip(target, () => {});
    cancelLayoutFlip(target);
    await runLayoutFlip(target, () => {});
    expect(target.style.transform).toBe("");
  });
});
