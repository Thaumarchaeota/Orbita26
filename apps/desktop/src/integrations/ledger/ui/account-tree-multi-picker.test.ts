import { beforeEach, describe, expect, it } from "vitest";
import { mountAccountTreeMultiPicker } from "./account-tree-multi-picker";
import { setAccounts } from "../state/accounts";

function seedAccounts() {
  setAccounts({
    assets: [
      {
        name: "Assets:Cash",
        label: "现金",
        label_path: ["Assets", "Cash"],
        brief: "",
        open_date: "",
        extra: "",
        id: "1",
        source_file: "a.bean",
        source_line: 1,
      },
      {
        name: "Assets:Bank",
        label: "银行",
        label_path: ["Assets", "Bank"],
        brief: "",
        open_date: "",
        extra: "",
        id: "2",
        source_file: "a.bean",
        source_line: 2,
      },
    ],
    liabilities: [],
    expenses: [],
    income: [],
  });
}

describe("AccountTreeMultiPicker", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    seedAccounts();
  });

  it("filters tree by label and keeps ancestor rows", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountAccountTreeMultiPicker(host, {
      selected: new Set(),
      onChange: () => {},
    });

    await picker.open();
    const search = document.querySelector<HTMLInputElement>(".orbita-account-tree-search")!;
    search.value = "Cash";
    search.dispatchEvent(new Event("input"));

    const labels = [...document.querySelectorAll(".orbita-account-tree-label")].map((el) => el.textContent);
    expect(labels).toContain("Cash");
    expect(labels).toContain("Assets");
    expect(labels).not.toContain("Bank");
  });

  it("toggles only leaf account names on parent checkbox", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let selected = new Set<string>();

    mountAccountTreeMultiPicker(host, {
      selected,
      onChange: (next) => {
        selected = next;
      },
    });

    await host.querySelector<HTMLButtonElement>(".orbita-account-tree-picker-btn")!.click();
    const parentMarker = [...document.querySelectorAll<HTMLElement>(".orbita-account-tree-check")]
      .find((m) => m.dataset.name === "Assets");
    parentMarker!.click();

    expect(selected).toEqual(new Set(["Assets:Cash", "Assets:Bank"]));
    expect(selected.has("Assets")).toBe(false);
  });

  it("escapes malicious account labels", async () => {
    setAccounts({
      assets: [
        {
          name: "Assets:Evil",
          label: '<img onerror="window.__xss=1">',
          label_path: ["Assets", "Evil"],
          brief: "",
          open_date: "",
          extra: "",
          id: "x",
          source_file: "a.bean",
          source_line: 1,
        },
      ],
      liabilities: [],
      expenses: [],
      income: [],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const picker = mountAccountTreeMultiPicker(host, {
      selected: new Set(),
      onChange: () => {},
    });

    await picker.open();
    expect(document.querySelector("img")).toBeNull();
    expect((window as { __xss?: number }).__xss).toBeUndefined();
  });

  it("supports keyboard navigation and enter to toggle", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let selected = new Set<string>();

    mountAccountTreeMultiPicker(host, {
      selected,
      onChange: (next) => {
        selected = next;
      },
    });

    await host.querySelector<HTMLButtonElement>(".orbita-account-tree-picker-btn")!.click();
    const search = document.querySelector<HTMLInputElement>(".orbita-account-tree-search")!;
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(selected.size).toBeGreaterThan(0);
    expect([...selected].every((name) => name.includes(":"))).toBe(true);
  });
});
