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
      {
        value: "clients",
        label: "客户",
        children: [{ value: "north", label: "北区客户" }],
      },
    ],
  },
];

function mountItemActionMenu() {
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

function rootPopover(): HTMLElement {
  return document.querySelector<HTMLElement>(".orbita-flat-select")!;
}

function flyouts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".orbita-flat-select")].slice(1);
}

describe("FlatSelect nested gallery review regressions", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps L1 without a root search field while flyouts have submenu search", async () => {
    const { handle } = mountItemActionMenu();
    await handle.open();
    expect(rootPopover().querySelector(".orbita-flat-select-input")).toBeNull();

    option("move")!.click();
    expect(flyouts()[0]!.querySelector(".orbita-flat-select-input")).not.toBeNull();
    option("work")!.click();
    expect(flyouts()[1]!.querySelector(".orbita-flat-select-input")).toBeNull();
  });

  it("closes deeper flyouts when pointerenter moves to a sibling row", async () => {
    const { handle } = mountItemActionMenu();
    await handle.open();
    option("move")!.click();
    option("work")!.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(flyouts()).toHaveLength(2);

    option("inbox")!.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(flyouts()).toHaveLength(1);
  });

  it("treats a matching folder label as a flat leaf and fires menu onChange", async () => {
    const { handle, onChange } = mountItemActionMenu();
    await handle.open();
    option("move")!.click();

    const search = flyouts()[0]!.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    search.value = "工作";
    search.dispatchEvent(new Event("input"));

    const work = option("work")!;
    expect(work.classList.contains("has-children")).toBe(false);
    work.click();
    expect(onChange).toHaveBeenCalledWith(new Set(["work"]));
  });

  it("restores branch arrows after clearing flyout search", async () => {
    const { handle } = mountItemActionMenu();
    await handle.open();
    option("move")!.click();

    const search = flyouts()[0]!.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    search.value = "客户";
    search.dispatchEvent(new Event("input"));
    expect(option("clients")?.classList.contains("has-children")).toBe(false);

    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(option("work")?.classList.contains("has-children")).toBe(true);
  });

  it("marks delete as danger at L1", async () => {
    const { handle } = mountItemActionMenu();
    await handle.open();
    expect(option("delete")?.classList.contains("is-danger")).toBe(true);
  });

  it("closes deeper flyouts when keyboard focus moves to a sibling row", async () => {
    const { handle } = mountItemActionMenu();
    await handle.open();
    option("move")!.click();
    option("work")!.click();
    expect(flyouts()).toHaveLength(2);

    const workRow = option("work")!;
    workRow.focus();
    flyouts()[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(document.activeElement?.dataset.value).toBe("inbox");
    expect(flyouts()).toHaveLength(1);
  });
});
