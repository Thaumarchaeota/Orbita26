import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountSliderField } from "./slider-field";

describe("mountSliderField", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps the slider and the number on the same clamped value", () => {
    const onChange = vi.fn();
    const field = mountSliderField({
      min: 0,
      max: 100,
      value: 150,
      label: "数值",
      onChange,
    });
    document.body.appendChild(field.element);

    const range = field.element.querySelector<HTMLInputElement>('input[type="range"]')!;
    const number = field.element.querySelector<HTMLInputElement>('input[type="number"]')!;

    expect(field.getValue()).toBe(100);
    expect(range.value).toBe("100");
    expect(number.value).toBe("100");
    expect(range.getAttribute("aria-label")).toBe("数值");
    expect(number.getAttribute("aria-label")).toBe("数值");

    range.value = "20";
    range.dispatchEvent(new Event("input"));
    expect(field.getValue()).toBe(20);
    expect(number.value).toBe("20");
    expect(onChange).toHaveBeenCalledWith(20);

    number.value = "4";
    number.dispatchEvent(new Event("input"));
    expect(range.value).toBe("4");
    expect(field.getValue()).toBe(4);

    number.value = "";
    number.dispatchEvent(new Event("input"));
    expect(field.getValue()).toBe(4);

    number.dispatchEvent(new Event("blur"));
    expect(number.value).toBe("4");

    field.setValue(-3);
    expect(field.getValue()).toBe(0);
    expect(range.value).toBe("0");
    expect(number.value).toBe("0");
    expect(range.style.getPropertyValue("--orbita-slider-pct")).toBe("0%");

    field.setValue(50);
    expect(range.style.getPropertyValue("--orbita-slider-pct")).toBe("50%");

    field.dispose();
    expect(field.element.isConnected).toBe(false);
  });
});
