import { beforeEach, describe, expect, it } from "vitest";
import { mountSearchableSelectPopover } from "./searchable-select-popover";

describe("SearchableSelectPopover", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("filters options and toggles multi-select", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    let selected = new Set<string>();

    const popover = mountSearchableSelectPopover({
      anchor,
      options: [
        { value: "food", label: "餐饮" },
        { value: "travel", label: "出行" },
        { value: "home", label: "居家" },
      ],
      selected,
      multiple: true,
      onChange: (next) => {
        selected = next;
      },
    });

    await popover.open();
    const search = document.querySelector<HTMLInputElement>(".orbita-searchable-select-input")!;
    search.value = "出";
    search.dispatchEvent(new Event("input"));

    const options = [...document.querySelectorAll<HTMLButtonElement>(".orbita-searchable-select-option")];
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("出行");

    options[0]?.click();
    expect(selected).toEqual(new Set(["travel"]));
    expect(document.querySelector(".orbita-searchable-select-option.is-selected")).not.toBeNull();
  });

  it("supports keyboard navigation and enter to select", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    let selected = new Set<string>();

    const popover = mountSearchableSelectPopover({
      anchor,
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      selected,
      multiple: true,
      onChange: (next) => {
        selected = next;
      },
    });

    await popover.open();
    const search = document.querySelector<HTMLInputElement>(".orbita-searchable-select-input")!;
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(selected).toEqual(new Set(["a"]));
    await popover.close();
  });
});
