import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountFlatSelectPopover, type FlatSelectOption } from "./flat-select-popover";

type PortalOptions = { popover: HTMLElement; onOpenChange?: (open: boolean) => void };

vi.mock("./popover-portal", () => ({
  mountPopoverPortal: ({ popover, onOpenChange }: PortalOptions) => {
    let open = false;
    return {
      open: async () => {
        if (open) return;
        open = true;
        document.body.appendChild(popover);
        onOpenChange?.(true);
      },
      close: async () => {
        if (!open) return;
        open = false;
        popover.remove();
        onOpenChange?.(false);
      },
      isOpen: () => open,
      dispose: () => { open = false; popover.remove(); },
    };
  },
}));

const treeOptions: FlatSelectOption[] = [
  { value: "inbox", label: "收件箱" },
  {
    value: "work", label: "工作", children: [
      { value: "week", label: "本周" },
      { value: "clients", label: "客户", children: [
        { value: "north", label: "北区客户" },
        { value: "south", label: "南区客户" },
      ] },
    ],
  },
];

function option(value: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")]
    .find((button) => button.dataset.value === value);
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("FlatSelect shared selection synchronization", () => {
  beforeEach(() => document.body.replaceChildren());

  it("preserves nested-layer focus and search state across silent external selection", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onChange = vi.fn();
    const handle = mountFlatSelectPopover({
      anchor,
      options: treeOptions,
      selected: new Set(),
      multiple: true,
      search: false,
      submenuSearch: true,
      onChange,
    });

    await handle.open();
    option("work")!.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await settle();
    const firstLayer = [...document.querySelectorAll<HTMLElement>(".orbita-flat-select")][1]!;
    const search = firstLayer.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    option("clients")!.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await settle();
    expect(document.querySelectorAll(".orbita-flat-select")).toHaveLength(3);

    const focused = option("north")!;
    focused.focus();
    handle.setSelected(new Set(["inbox", "north"]));

    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".orbita-flat-select")).toHaveLength(3);
    expect(option("north")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.dataset.value).toBe("north");
    expect(document.querySelectorAll(".orbita-flat-select-input")).toHaveLength(1);

    search.focus();
    search.value = "客户";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    handle.setSelected(new Set(["inbox", "north", "south"]));
    expect(search.value).toBe("客户");
    expect(document.activeElement).toBe(firstLayer.querySelector(".orbita-flat-select-input"));
    expect(document.querySelectorAll(".orbita-flat-select")).toHaveLength(2);
    expect(option("north")?.getAttribute("aria-selected")).toBe("true");
    expect(option("south")?.getAttribute("aria-selected")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    handle.dispose();
  });

  it.each([
    { tree: false, search: false },
    { tree: true, search: false },
  ])("notifies open/close for $tree branch while callback remains optional", async ({ tree }) => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onOpenChange = vi.fn();
    const handle = mountFlatSelectPopover({
      anchor,
      options: tree ? treeOptions : [{ value: "inbox", label: "收件箱" }],
      selected: new Set(),
      multiple: false,
      search: false,
      onChange: vi.fn(),
      onOpenChange,
    });
    await handle.open();
    expect(handle.isOpen()).toBe(true);
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true]);
    await handle.close();
    expect(handle.isOpen()).toBe(false);
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
    handle.dispose();

    const defaultAnchor = document.createElement("button");
    document.body.appendChild(defaultAnchor);
    const defaultHandle = mountFlatSelectPopover({
      anchor: defaultAnchor,
      options: [{ value: "inbox", label: "收件箱" }],
      selected: new Set(),
      multiple: false,
      search: false,
      onChange: vi.fn(),
    });
    await defaultHandle.open();
    await defaultHandle.close();
    expect(defaultHandle.isOpen()).toBe(false);
    defaultHandle.dispose();
  });

  it.each([false, true])("does not focus a closed popup after an immediate Escape race (tree=%s)", async (tree) => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const handle = mountFlatSelectPopover({
      anchor,
      options: tree ? treeOptions : [{ value: "inbox", label: "收件箱" }],
      selected: new Set(),
      multiple: false,
      search: false,
      onChange: vi.fn(),
    });

    const opening = handle.open();
    const popup = document.querySelector<HTMLElement>(".orbita-flat-select")!;
    const list = popup.querySelector<HTMLElement>(".orbita-flat-select-list")!;
    const focus = vi.spyOn(list, "focus");
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await opening;

    expect(handle.isOpen()).toBe(false);
    expect(document.activeElement).not.toBe(list);
    expect(popup.isConnected).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    handle.dispose();
  });
});
