import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountSimpleSelect } from "./simple-select";

describe("SimpleSelect", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("shows placeholder and opens option list", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onChange = vi.fn();

    const select = mountSimpleSelect(host, {
      placeholder: "预设…",
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      onChange,
    });

    expect(select.button.querySelector(".orbita-simple-select-label")?.textContent).toBe("预设…");
    select.button.click();
    const options = [...document.querySelectorAll<HTMLButtonElement>(".orbita-simple-select-option")];
    expect(options).toHaveLength(2);
    options[0]?.click();
    expect(onChange).toHaveBeenCalledWith("a");
    expect(select.getValue()).toBe("a");
  });

  it("updates label from setValue and setOptions", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const select = mountSimpleSelect(host, {
      placeholder: "选择…",
      options: [{ value: "x", label: "X" }],
      onChange: () => {},
    });

    select.setValue("x");
    expect(select.button.querySelector(".orbita-simple-select-label")?.textContent).toBe("X");
    select.setOptions([
      { value: "y", label: "Y" },
      { value: "__sep__", label: "──", disabled: true, separator: true },
    ]);
    select.setValue("y");
    expect(select.button.querySelector(".orbita-simple-select-label")?.textContent).toBe("Y");
  });

  it("skips disabled and separator options on click", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onChange = vi.fn();

    const select = mountSimpleSelect(host, {
      options: [
        { value: "ok", label: "OK" },
        { value: "__sep__", label: "──", disabled: true, separator: true },
        { value: "no", label: "NO", disabled: true },
      ],
      onChange,
    });

    select.button.click();
    document.querySelector<HTMLButtonElement>(".orbita-simple-select-option.is-separator");
    expect(onChange).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('.orbita-simple-select-option[data-value="ok"]')?.click();
    expect(onChange).toHaveBeenCalledWith("ok");
  });
});
