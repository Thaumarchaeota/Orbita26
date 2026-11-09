import { beforeEach, describe, expect, it } from "vitest";
import { mountCascadingMenuPopover } from "./cascading-menu-popover";

describe("CascadingMenuPopover", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("opens root menu and shows footer disabled row", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const popover = mountCascadingMenuPopover({
      anchor,
      items: [
        {
          kind: "submenu",
          id: "model",
          label: "模型",
          value: "gpt-4",
          panel: {
            kind: "search-list",
            options: [{ value: "a", label: "Alpha" }],
            selected: "a",
            onSelect: () => {},
          },
        },
      ],
      footerItems: [{ kind: "action", id: "settings", label: "设置", disabled: true }],
    });
    await popover.open();
    expect(document.querySelector(".orbita-cascading-menu-row[data-id='model']")).not.toBeNull();
    const footer = document.querySelector<HTMLButtonElement>(".orbita-cascading-menu-footer .orbita-cascading-menu-row");
    expect(footer?.disabled).toBe(true);
    await popover.close();
  });

  it("filters submenu options with keyboard enter", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    let picked = "";
    const popover = mountCascadingMenuPopover({
      anchor,
      items: [
        {
          kind: "submenu",
          id: "thinking",
          label: "思考强度",
          panel: {
            kind: "search-list",
            options: [
              { value: "off", label: "关" },
              { value: "low", label: "低" },
            ],
            selected: "off",
            onSelect: (v) => {
              picked = v;
            },
          },
        },
      ],
    });
    await popover.open();
    const row = document.querySelector<HTMLButtonElement>(".orbita-cascading-menu-row[data-id='thinking']")!;
    row.click();
    const option = document.querySelector<HTMLButtonElement>(".orbita-cascading-menu-submenu-option");
    option?.click();
    expect(picked).toBe("off");
    await popover.close();
  });
});
