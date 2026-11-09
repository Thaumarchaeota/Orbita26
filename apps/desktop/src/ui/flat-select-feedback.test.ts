import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountFlatSelectPopover, type FlatSelectSection } from "./flat-select-popover";

vi.mock("./popover-portal", () => ({
  mountPopoverPortal: ({ popover }: { popover: HTMLElement }) => {
    let open = false;
    return {
      open: async () => {
        open = true;
        document.body.appendChild(popover);
      },
      close: async () => {
        open = false;
        popover.remove();
      },
      isOpen: () => open,
      dispose: () => {
        open = false;
        popover.remove();
      },
    };
  },
}));

function title(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "feedback-option-title";
  el.textContent = text;
  return el;
}

function mountMenu(options: Partial<Parameters<typeof mountFlatSelectPopover>[0]>) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onChange = vi.fn();
  const handle = mountFlatSelectPopover({
    anchor,
    options: [],
    sections: [],
    selected: new Set(),
    multiple: false,
    search: false,
    onChange,
    ...options,
  });
  return { handle, onChange };
}

describe("FlatSelect feedback labels", () => {
  beforeEach(() => document.body.replaceChildren());

  it("keeps two option titles in one section without adding a section", async () => {
    const providerHint = document.createElement("span");
    providerHint.className = "provider-hint";
    providerHint.textContent = "OpenAI";
    const sections: FlatSelectSection[] = [
      {
        title: title("模型"),
        options: [{ value: "model-a", label: "模型 A", hint: providerHint }],
      },
      {
        options: [
          { value: "effort", label: "思考程度", title: title("思考程度") },
          { value: "temperature", label: "温度", title: title("温度") },
        ],
      },
    ];
    const { handle } = mountMenu({ sections });
    await handle.open();

    const popover = document.querySelector<HTMLElement>(".orbita-flat-select")!;
    const blocks = [...popover.children].filter((child) => child.classList.contains("orbita-flat-select-section"));
    expect(blocks).toHaveLength(2);
    const optionTitles = [...document.querySelectorAll(".feedback-option-title")];
    expect(optionTitles).toHaveLength(3);
    expect(optionTitles[1]?.closest(".orbita-flat-select-section")).toBe(
      optionTitles[2]?.closest(".orbita-flat-select-section"),
    );
    expect(document.querySelector('[data-value="model-a"]')?.getAttribute("aria-describedby")).toBe(providerHint.id);
    expect(document.querySelector('[data-value="model-a"] .provider-hint')?.textContent).toBe("OpenAI");
  });

  it("updates parent text in place, preserves selection, slider focus, and repaint state", async () => {
    const slider = document.createElement("input");
    slider.type = "range";
    const sections: FlatSelectSection[] = [
      { options: [{ value: "model-a", label: "模型 A" }] },
      {
        options: [
          { value: "effort", label: "思考程度", title: title("思考程度"), children: [{ value: "effort-high", label: "高" }] },
          { value: "temperature", label: "温度", title: title("温度"), submenu: slider },
        ],
      },
    ];
    const { handle } = mountMenu({ sections, selected: new Set(["model-a"]), search: true });
    await handle.open();
    const modelBefore = document.querySelector<HTMLButtonElement>('[data-value="model-a"]')!;
    handle.setOptionLabel("effort", "高");
    expect(document.querySelector<HTMLButtonElement>('[data-value="effort"] .orbita-flat-select-label')?.textContent).toBe("高");
    expect(document.querySelector<HTMLButtonElement>('[data-value="model-a"]')).toBe(modelBefore);
    expect(modelBefore.classList.contains("is-selected")).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-value="temperature"]')!.click();
    await Promise.resolve();
    slider.focus();
    handle.setOptionLabel("temperature", "1.25");
    expect(document.querySelector<HTMLButtonElement>('[data-value="temperature"] .orbita-flat-select-label')?.textContent).toBe("1.25");
    expect(document.activeElement).toBe(slider);

    const search = document.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    search.value = "模型";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLButtonElement>('[data-value="effort"] .orbita-flat-select-label')?.textContent).toBe("高");
  });

  it("supports label updates in the flat branch", async () => {
    const { handle } = mountMenu({ options: [{ value: "model-a", label: "旧名称" }] });
    await handle.open();
    handle.setOptionLabel("model-a", "新名称");
    expect(document.querySelector('[data-value="model-a"] .orbita-flat-select-label')?.textContent).toBe("新名称");
  });
});
