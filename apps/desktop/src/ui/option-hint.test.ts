import { beforeEach, describe, expect, it } from "vitest";
import { mountOptionHint } from "./option-hint";

describe("mountOptionHint", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders one line of caller text in the hint role", () => {
    const hint = mountOptionHint("复制到剪贴板");
    document.body.appendChild(hint.element);

    expect(hint.element.className).toBe("orbita-option-hint");
    expect(hint.element.textContent).toBe("复制到剪贴板");
    expect(hint.element.style.fontSize).toBe("");
    expect(hint.element.style.color).toBe("");

    hint.setText("另一行说明");
    expect(hint.element.textContent).toBe("另一行说明");

    hint.dispose();
    expect(hint.element.isConnected).toBe(false);
  });
});