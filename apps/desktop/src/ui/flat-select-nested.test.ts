import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountFlatSelectPopover, type FlatSelectOption } from "./flat-select-popover";

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

const moveTree: FlatSelectOption[] = [
  { value: "inbox", label: "收件箱" },
  {
    value: "work",
    label: "工作",
    children: [
      { value: "week", label: "本周重点" },
      {
        value: "clients",
        label: "客户",
        children: [
          { value: "north", label: "北区客户" },
          { value: "south", label: "南区客户" },
        ],
      },
    ],
  },
];

function mount() {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onChange = vi.fn();
  const handle = mountFlatSelectPopover({
    anchor,
    options: [
      { value: "detail", label: "详情" },
      { value: "move", label: "移动到", children: moveTree },
      { value: "delete", label: "删除", danger: true },
    ],
    selected: new Set(),
    multiple: false,
    search: false,
    menu: true,
    submenuSearch: true,
    onChange,
  });
  return { handle, onChange };
}

function option(value: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")].find(
    (button) => button.dataset.value === value,
  );
}

function flyouts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".orbita-flat-select")].slice(1);
}

describe("FlatSelect nested flyout assembly", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps nested rows as a tree until search flattens every matching depth", async () => {
    const { handle } = mount();
    await handle.open();
    option("move")!.click();

    const first = flyouts()[0]!;
    expect(first.querySelector(".orbita-flat-select-input")).not.toBeNull();
    expect(option("work")?.classList.contains("has-children")).toBe(true);
    expect(option("north")).toBeUndefined();

    option("work")!.click();
    expect(option("clients")?.classList.contains("has-children")).toBe(true);
    expect(flyouts()).toHaveLength(2);
    expect(flyouts()[1]!.querySelector(".orbita-flat-select-input")).toBeNull();

    const search = flyouts()[0]!.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    search.value = "客户";
    search.dispatchEvent(new Event("input"));

    expect(option("clients")).toBeTruthy();
    expect(option("north")).toBeTruthy();
    expect(option("south")).toBeTruthy();
    expect(option("clients")?.classList.contains("has-children")).toBe(false);
    expect(option("clients")?.querySelector(".orbita-option-hint")?.textContent).toBe("工作");
    expect(option("north")?.querySelector(".orbita-option-hint")?.textContent).toBe("工作 \u203A\u203A 客户");
    expect(option("work")).toBeUndefined();
    expect(flyouts()).toHaveLength(1);
  });
});
