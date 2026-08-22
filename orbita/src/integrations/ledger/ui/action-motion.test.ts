import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyActionSuccessVisual,
  holdActionVisual,
  isActionVisualHeld,
  playActionShake,
} from "../../../ui/action-motion";

describe("action-motion", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("applies success icon and holds recompute", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const hold = holdActionVisual(btn);
    expect(isActionVisualHeld(btn)).toBe(true);
    applyActionSuccessVisual(btn);
    expect(btn.classList.contains("is-action-success")).toBe(true);
    expect(btn.querySelector(".orbita-action-icon")).not.toBeNull();
    hold.release();
    expect(isActionVisualHeld(btn)).toBe(false);
  });

  it("shakes then removes shake class", async () => {
    vi.useFakeTimers();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const done = playActionShake(btn, 350);
    expect(btn.classList.contains("is-action-shake")).toBe(true);
    await vi.advanceTimersByTimeAsync(350);
    await done;
    expect(btn.classList.contains("is-action-shake")).toBe(false);
    vi.useRealTimers();
  });
});
