import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckbox, setCheckbox, setCheckboxWithCompletionFeedback } from "./checkbox";

afterEach(() => vi.restoreAllMocks());

describe("shared checkbox completion feedback", () => {
  it("keeps initialization and ordinary state synchronization silent", () => {
    const checkedAtMount = createCheckbox(true);
    const synchronized = createCheckbox(false);

    setCheckbox(synchronized, true);

    expect(checkedAtMount.classList.contains("is-checking")).toBe(false);
    expect(synchronized.classList.contains("is-checking")).toBe(false);
  });

  it("plays only on a new completion and not on rollback or repeats", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ animationName: "orbita-checkbox-burst" } as CSSStyleDeclaration);
    const checkbox = createCheckbox(false);
    const remove = vi.spyOn(checkbox.classList, "remove");

    setCheckboxWithCompletionFeedback(checkbox, true);
    setCheckboxWithCompletionFeedback(checkbox, true);
    expect(checkbox.classList.contains("is-checking")).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1); // replay reset only on the first state transition

    setCheckbox(checkbox, false);
    expect(checkbox.classList.contains("is-checking")).toBe(false);
    setCheckboxWithCompletionFeedback(checkbox, false);
    expect(checkbox.classList.contains("is-checking")).toBe(false);
  });

  it("honors reduced motion when committed feedback is requested", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ animationName: "none" } as CSSStyleDeclaration);
    const checkbox = createCheckbox(false);

    setCheckboxWithCompletionFeedback(checkbox, true);

    expect(checkbox.classList.contains("is-checked")).toBe(true);
    expect(checkbox.classList.contains("is-checking")).toBe(false);
  });
});
