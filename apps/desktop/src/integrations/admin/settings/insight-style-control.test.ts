import { beforeEach, describe, expect, it, vi } from "vitest";

const setTabStripStyle = vi.hoisted(() => vi.fn());
const setInsightLightTheme = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../tab-host/host-api", () => ({ setTabStripStyle }));
vi.mock("../tab-host/session-persist", () => ({ loadTabSession: () => ({ style: "trap" }) }));
vi.mock("../insight-theme", () => ({
  insightLightThemeFromSettings: () => "blue",
  setInsightLightTheme,
}));

describe("Insight settings palette and tab controls", () => {
  beforeEach(() => {
    vi.resetModules();
    setTabStripStyle.mockClear();
    setInsightLightTheme.mockClear();
  });

  it("keeps palette and tab appearance as separate accessible button groups", async () => {
    const { bindGlobalTab, globalTabHtml } = await import("./global-tab");
    const root = document.createElement("div");
    root.innerHTML = globalTabHtml;
    bindGlobalTab(root).fill("D:/orbita");

    expect(root.querySelectorAll('[role="group"]')).toHaveLength(3);
    expect(root.querySelector('[role="group"][aria-label="30套界面配色"]')).not.toBeNull();
    expect(root.querySelectorAll(".insight-settings-palette-group")).toHaveLength(5);
    expect(root.querySelectorAll(".insight-settings-palette-btn")).toHaveLength(30);
    expect(root.querySelector('[role="group"][aria-label="标签外观"]')).not.toBeNull();
    expect(root.querySelector('[data-insight-theme="blue"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelectorAll('[data-insight-theme]')).toHaveLength(33);
    expect(root.querySelector('[data-tab-style="trap"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector("[data-insight-style]")).toBeNull();
    expect([...root.querySelectorAll("button")].every((button) => button.type === "button")).toBe(true);
  });

  it("routes palette and tab controls to only their own setting binding", async () => {
    const { bindGlobalTab, globalTabHtml } = await import("./global-tab");
    const root = document.createElement("div");
    root.innerHTML = globalTabHtml;
    bindGlobalTab(root).fill("D:/orbita");

    root.querySelector<HTMLButtonElement>('[data-insight-theme="warm"]')!.click();
    expect(setInsightLightTheme).toHaveBeenCalledWith("warm");
    expect(setTabStripStyle).not.toHaveBeenCalled();

    root.querySelector<HTMLButtonElement>('[data-tab-style="rect"]')!.click();
    expect(setTabStripStyle).toHaveBeenCalledWith("rect");
    expect(setInsightLightTheme).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('[data-insight-theme="17"]')!.click();
    expect(setInsightLightTheme).toHaveBeenLastCalledWith("17");
  });

  it("updates theme state without changing independent tab appearance", async () => {
    const { bindGlobalTab, globalTabHtml } = await import("./global-tab");
    const root = document.createElement("div");
    root.innerHTML = globalTabHtml;
    bindGlobalTab(root).fill("D:/orbita");

    root.querySelector<HTMLButtonElement>('[data-insight-theme="cold"]')!.click();
    expect(root.querySelector('[data-insight-theme="cold"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-tab-style="trap"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector("[data-insight-style]")).toBeNull();
  });
});
