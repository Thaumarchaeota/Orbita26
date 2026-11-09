import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSelectField, type SelectFieldHandle } from "./select-field";

vi.mock("./motion", () => ({
  openPopover: async (element: HTMLElement) => { element.classList.add("is-open"); },
  closePopover: async (element: HTMLElement) => { element.classList.remove("is-open"); },
  isPopoverOpen: (element: HTMLElement) => element.classList.contains("is-open"),
}));

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

const fields: SelectFieldHandle[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

function option(value: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")]
    .find((element) => element.dataset.value === value)!;
}

function accessibleState(button: HTMLButtonElement): string {
  const referencedText = button.getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ") ?? "";
  return [button.getAttribute("aria-label"), button.getAttribute("aria-valuetext"), referencedText]
    .filter(Boolean)
    .join(" ");
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => document.body.replaceChildren());
afterEach(() => {
  fields.splice(0).forEach((field) => field.dispose());
  document.body.replaceChildren();
});

describe("SelectField", () => {
  it.each([
    { multiple: false, search: false },
    { multiple: false, search: true },
    { multiple: true, search: false },
    { multiple: true, search: true },
  ])("keeps the trigger, choice state, and search behavior for $multiple / $search", async ({ multiple, search }) => {
    const onChange = vi.fn();
    const field = multiple
      ? mountSelectField(host(), {
          label: "分类",
          options,
          search,
          multiple: true,
          values: new Set(["a"]),
          onChange,
        })
      : mountSelectField(host(), {
          label: "分类",
          options,
          search,
          multiple: false,
          value: "a",
          onChange,
        });
    fields.push(field);

    expect(field.button.textContent).toContain("Alpha");
    expect(accessibleState(field.button)).toContain("分类");
    expect(accessibleState(field.button)).toContain("Alpha");
    expect(field.button.getAttribute("aria-haspopup")).toBe("listbox");
    expect(field.button.getAttribute("aria-expanded")).toBe("false");

    field.button.click();
    expect(field.button.getAttribute("aria-expanded")).toBe("true");
    const searchBox = document.querySelector<HTMLInputElement>(".orbita-flat-select-input");
    expect(Boolean(searchBox)).toBe(search);
    if (searchBox) {
      searchBox.value = "Bet";
      searchBox.dispatchEvent(new Event("input", { bubbles: true }));
      expect(document.querySelectorAll('.orbita-flat-select-option[data-value="b"]')).toHaveLength(1);
      expect(document.querySelectorAll('.orbita-flat-select-option[data-value="a"]')).toHaveLength(0);
    }

    option("b").click();
    if (multiple) {
      expect(field.getValues()).toEqual(new Set(["a", "b"]));
      expect(field.button.textContent).toContain("Alpha、Beta");
      expect(accessibleState(field.button)).toContain("Alpha");
      expect(accessibleState(field.button)).toContain("Beta");
      expect(field.button.getAttribute("aria-expanded")).toBe("true");
      expect(onChange).toHaveBeenCalledTimes(1);
    } else {
      expect(field.getValue()).toBe("b");
      expect(field.button.textContent).toContain("Beta");
      expect(accessibleState(field.button)).toContain("Beta");
      expect(field.button.getAttribute("aria-expanded")).toBe("false");
      expect(onChange).toHaveBeenCalledTimes(1);
    }
  });

  it("applies external single and multiple values silently, including while open", async () => {
    const singleChange = vi.fn();
    const single = mountSelectField(host(), {
      label: "项目", options, search: false, multiple: false, value: "a", onChange: singleChange,
    });
    fields.push(single);
    single.button.click();
    single.setValue("c");
    expect(single.getValue()).toBe("c");
    expect(single.button.textContent).toContain("Gamma");
    expect(accessibleState(single.button)).toContain("Gamma");
    expect(option("c").getAttribute("aria-selected")).toBe("true");
    expect(option("a").getAttribute("aria-selected")).toBe("false");
    expect(singleChange).not.toHaveBeenCalled();

    const multiChange = vi.fn();
    const multi = mountSelectField(host(), {
      label: "标签", options, search: false, multiple: true, values: new Set(["a"]), onChange: multiChange,
    });
    fields.push(multi);
    multi.setValues(new Set(["b", "c"]));
    expect(multi.getValues()).toEqual(new Set(["b", "c"]));
    expect(multi.button.textContent).toContain("Beta、Gamma");
    expect(accessibleState(multi.button)).toContain("Beta");
    expect(accessibleState(multi.button)).toContain("Gamma");
    expect(multiChange).not.toHaveBeenCalled();
    await settle();
  });

  it("lets a controlled owner correct a choice synchronously without stale menu state", async () => {
    const onChange = vi.fn((next: string | null) => field.setValue(next === "b" ? "c" : next));
    const field = mountSelectField(host(), {
      label: "项目", options, search: false, multiple: false, value: "a", onChange,
    });
    fields.push(field);
    field.button.click();
    option("b").click();

    expect(onChange).toHaveBeenCalledWith("b");
    expect(field.getValue()).toBe("c");
    expect(field.button.textContent).toContain("Gamma");
    expect(option("c").getAttribute("aria-selected")).toBe("true");
  });

  it("rebuilds an open field when options change and keeps its controlled selection", async () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    const field = mountSelectField(host(), {
      label: "项目", options, search: true, multiple: false, value: "a", onChange, onOpenChange,
    });
    fields.push(field);
    field.button.click();
    const oldSearch = document.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    oldSearch.value = "Al";
    oldSearch.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll(".orbita-flat-select-option")).toHaveLength(1);

    field.setOptions([
      { value: "a", label: "Alpha renamed" },
      { value: "d", label: "Delta" },
    ]);
    await settle();

    expect(field.button.getAttribute("aria-expanded")).toBe("true");
    expect(field.button.textContent).toContain("Alpha renamed");
    expect(accessibleState(field.button)).toContain("Alpha renamed");
    expect(document.querySelectorAll(".orbita-flat-select-option")).toHaveLength(2);
    expect(option("a").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector(".orbita-flat-select-input"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true]);
  });

  it("does not open when disabled and never reports a disabled option", () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    const field = mountSelectField(host(), {
      label: "项目",
      options: [...options, { value: "locked", label: "锁定", disabled: true }],
      search: false,
      multiple: false,
      value: null,
      onChange,
      onOpenChange,
    });
    fields.push(field);

    field.setDisabled(true);
    field.button.click();
    expect(field.button.disabled).toBe(true);
    expect(field.button.getAttribute("aria-expanded")).toBe("false");
    expect(onOpenChange).not.toHaveBeenCalled();

    field.setDisabled(false);
    field.button.click();
    option("locked").click();
    expect(field.getValue()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true]);
  });

  it("synchronizes open state on outside close and Escape without inventing a selection", async () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    const field = mountSelectField(host(), {
      label: "项目", options, search: false, multiple: false, value: "a", onChange, onOpenChange,
    });
    fields.push(field);

    field.button.click();
    expect(field.button.getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await settle();
    expect(field.button.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();

    field.button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(field.button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(field.button);
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false, true, false]);
  });

  it("keeps instances independent and disposes only the selected field's portal", async () => {
    const first = mountSelectField(host(), {
      label: "第一个", options, search: false, multiple: false, value: "a", onChange: vi.fn(),
    });
    const second = mountSelectField(host(), {
      label: "第二个", options, search: false, multiple: false, value: "b", onChange: vi.fn(),
    });
    fields.push(first, second);

    first.button.click();
    second.button.click();
    await settle();
    expect(first.button.getAttribute("aria-expanded")).toBe("false");
    expect(second.button.getAttribute("aria-expanded")).toBe("true");
    expect(first.getValue()).toBe("a");
    expect(second.getValue()).toBe("b");

    first.dispose();
    expect(second.button.getAttribute("aria-expanded")).toBe("true");
    option("c").click();
    expect(second.getValue()).toBe("c");
    expect(second.button.textContent).toContain("Gamma");
  });

  it("removes listeners and prevents portal recreation or callbacks after dispose", () => {
    const onOpenChange = vi.fn();
    const onChange = vi.fn();
    const field = mountSelectField(host(), {
      label: "项目", options, search: false, multiple: false, value: "a", onChange, onOpenChange,
    });
    field.button.click();
    const staleOption = option("b");
    field.dispose();
    expect(field.root.isConnected).toBe(false);
    expect(document.querySelector(".orbita-flat-select")).toBeNull();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);

    field.setOptions([{ value: "d", label: "Delta" }]);
    field.setValue("d");
    field.setDisabled(false);
    expect(document.querySelector(".orbita-flat-select")).toBeNull();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
    field.button.click();
    staleOption.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector(".orbita-flat-select")).toBeNull();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
