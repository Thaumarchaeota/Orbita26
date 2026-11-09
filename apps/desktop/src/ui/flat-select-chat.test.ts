import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountFlatSelectPopover, type FlatSelectOption } from "./flat-select-popover";
import { mountSliderField } from "./slider-field";

type PortalOptions = {
  popover: HTMLElement;
  onOpenChange?: (open: boolean) => void;
};

vi.mock("./popover-portal", () => ({
  mountPopoverPortal: ({ popover, onOpenChange }: PortalOptions) => {
    let open = false;
    return {
      open: async () => {
        open = true;
        document.body.appendChild(popover);
        onOpenChange?.(true);
      },
      close: async () => {
        open = false;
        popover.remove();
        onOpenChange?.(false);
      },
      isOpen: () => open,
      dispose: () => {
        open = false;
        popover.remove();
      },
    };
  },
}));

function mount(options: Partial<Parameters<typeof mountFlatSelectPopover>[0]> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onChange = vi.fn();
  const handle = mountFlatSelectPopover({
    anchor,
    options: [],
    selected: new Set(),
    multiple: false,
    search: false,
    menu: true,
    onChange,
    ...options,
  });
  return { anchor, handle, onChange };
}

function rootButton(value: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    `.orbita-flat-select:not(.orbita-popover-portal-item) .orbita-flat-select-option[data-value="${value}"]`,
  )!;
}

function optionButton(value: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")].find(
    (button) => button.dataset.value === value,
  );
}

describe("FlatSelect chat menu composition", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("opens a single-select parent from click and selects a leaf", async () => {
    const model: FlatSelectOption = {
      value: "model",
      label: "模型",
      children: [{ value: "entry\u001fmodel-a", label: "model-a" }],
    };
    const { handle, onChange } = mount({ options: [model] });
    await handle.open();

    rootButton("model").click();
    const leaf = optionButton("entry\u001fmodel-a");
    expect(leaf).not.toBeNull();
    leaf!.click();
    expect(onChange).toHaveBeenCalledWith(new Set(["entry\u001fmodel-a"]));
  });

  it("supports keyboard parent expansion and Esc returns focus to the parent", async () => {
    const effort: FlatSelectOption = {
      value: "effort",
      label: "思考强度",
      children: [{ value: "low", label: "低" }, { value: "high", label: "高" }],
    };
    const { handle } = mount({ options: [effort] });
    await handle.open();
    const parent = rootButton("effort");
    parent.focus();
    parent.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    const submenu = [...document.querySelectorAll<HTMLElement>(".orbita-flat-select")].find(
      (el) => el !== parent.closest(".orbita-flat-select"),
    );
    expect(submenu).toBeDefined();
    submenu!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.contains(parent.closest(".orbita-flat-select"))).toBe(true);
    expect(document.activeElement).toBe(parent);
  });

  it("does not expand or select disabled parents", async () => {
    const { handle, onChange } = mount({
      options: [
        {
          value: "disabled-model",
          label: "不可用模型",
          disabled: true,
          children: [{ value: "disabled-leaf", label: "不可用" }],
        },
      ],
    });
    await handle.open();
    const parent = rootButton("disabled-model");
    parent.click();
    parent.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.querySelectorAll(".orbita-flat-select")).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mounts a slot-only temperature panel without an empty option list", async () => {
    const temperature = mountSliderField({ min: 0, max: 2, step: 0.01, value: 1, label: "温度" });
    const { handle, onChange } = mount({
      options: [{ value: "temperature", label: "温度", submenu: temperature.element }],
    });
    await handle.open();
    rootButton("temperature").click();

    const slot = document.querySelector<HTMLElement>(".orbita-flat-select-slot")!;
    const range = slot.querySelector<HTMLInputElement>('input[type="range"]')!;
    const number = slot.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(range).toBeDefined();
    expect(slot.closest(".orbita-flat-select")?.querySelector(".orbita-flat-select-list")).toBeNull();
    range.value = "1.25";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(number.value).toBe("1.25");
    expect(onChange).not.toHaveBeenCalled();
    temperature.dispose();
  });

  it("disposes both root and submenu portals", async () => {
    const { handle } = mount({
      options: [{ value: "model", label: "模型", children: [{ value: "a", label: "A" }] }],
    });
    await handle.open();
    rootButton("model").click();
    expect(document.querySelectorAll(".orbita-flat-select").length).toBeGreaterThan(0);
    handle.dispose();
    expect(document.querySelectorAll(".orbita-flat-select")).toHaveLength(0);
  });
});
