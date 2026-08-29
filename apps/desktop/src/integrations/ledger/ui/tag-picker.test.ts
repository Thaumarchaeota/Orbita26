import { beforeEach, describe, expect, it } from "vitest";
import { mountTagPicker } from "./tag-picker";

describe("TagPicker", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("shows placeholder and chips with overflow summary", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let selected = new Set(["food", "travel", "home", "work"]);

    const picker = mountTagPicker(host, {
      tags: ["food", "travel", "home", "work", "fun"],
      selected,
      onChange: (next) => {
        selected = next;
      },
    });

    expect(picker.root.querySelector(".orbita-tag-picker-placeholder")?.textContent).toBe("");
    expect(picker.root.querySelectorAll(".orbita-tag-chip")).toHaveLength(3);
    expect(picker.root.querySelector(".orbita-tag-chip-more")?.textContent).toBe("+1");
  });

  it("removes chip and syncs selection", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let selected = new Set(["food", "travel"]);

    mountTagPicker(host, {
      tags: ["food", "travel", "home"],
      selected,
      onChange: (next) => {
        selected = next;
      },
    });

    const remove = document.querySelector<HTMLButtonElement>(".orbita-tag-chip-remove");
    remove?.click();

    expect(selected).toEqual(new Set(["travel"]));
    expect(document.querySelectorAll(".orbita-tag-chip")).toHaveLength(1);
  });

  it("selects tags from searchable popover", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let selected = new Set<string>();

    const picker = mountTagPicker(host, {
      tags: ["food", "travel"],
      selected,
      onChange: (next) => {
        selected = next;
      },
    });

    await picker.open();
    document.querySelector<HTMLButtonElement>('.orbita-searchable-select-option[data-value="food"]')?.click();

    expect(selected).toEqual(new Set(["food"]));
    expect(picker.root.querySelector(".orbita-tag-chip")?.textContent).toContain("food");
  });
});
