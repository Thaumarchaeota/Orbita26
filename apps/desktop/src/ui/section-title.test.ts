import { beforeEach, describe, expect, it } from "vitest";
import { mountSectionTitle } from "./section-title";

describe("mountSectionTitle", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders the caller text and can replace it", () => {
    const title = mountSectionTitle("插入");
    document.body.appendChild(title.element);

    expect(title.element.className).toBe("orbita-section-title");
    expect(title.element.textContent).toBe("插入");
    expect(title.element.style.fontSize).toBe("");

    title.setText("编辑");
    expect(title.element.textContent).toBe("编辑");

    title.dispose();
    expect(title.element.isConnected).toBe(false);
  });
});