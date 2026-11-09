import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSurface, ContentTabRecord } from "./identity";
import { mountTabStrip } from "./tab-strip";

function rect(left: number, right: number, top = 0, bottom = 40): DOMRect {
  return { x: left, y: top, left, right, top, bottom, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
}

async function frames(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

describe("tab strip overflow", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

  it("clips a selected tab to the scrolling viewport and releases the clip for an anchor", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const host = document.createElement("div");
    host.style.setProperty("--insight-tab-radius", "8px");
    document.body.append(host);
    const active: { current: ActiveSurface } = { current: { type: "content", key: "a" } };
    const tabs: ContentTabRecord[] = [{ key: "a", identity: { kind: "project", id: "a" }, title: "A", destId: "project", destState: { projectId: "a" } }];
    const handle = mountTabStrip(host, {
      getActive: () => active.current, getTabs: () => tabs, getStyle: () => "rect",
      onSelectHome: vi.fn(), onSelectTimeline: vi.fn(), onNewTab: vi.fn(),
      onSelectTab: vi.fn(), onCloseTab: vi.fn(), onReorder: vi.fn(),
    });
    const scroll = host.querySelector<HTMLElement>(".insight-tab-strip-scroll")!;
    const list = host.querySelector<HTMLElement>(".insight-tab-strip-list")!;
    const tab = host.querySelector<HTMLElement>(".insight-content-tab")!;
    const home = host.querySelector<HTMLElement>(".insight-tab-strip-home")!;
    const shape = host.querySelector<SVGElement>(".insight-tab-selected-shape")!;
    Object.defineProperty(list, "getAnimations", { configurable: true, value: () => [] });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(100, 900));
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(rect(200, 650));
    const tabRect = vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(rect(600, 760));
    vi.spyOn(home, "getBoundingClientRect").mockReturnValue(rect(110, 154));

    await frames();
    expect(shape.hasAttribute("hidden")).toBe(false);
    const clipRect = shape.querySelector("rect")!;
    expect(clipRect.getAttribute("x")).toBe("100");
    expect(clipRect.getAttribute("width")).toBe("450");
    expect(shape.style.clipPath).toBe("");

    tabRect.mockReturnValue(rect(700, 860));
    scroll.dispatchEvent(new Event("scroll"));
    await frames();
    expect(shape.hasAttribute("hidden")).toBe(true);

    active.current = { type: "home" };
    handle.refresh();
    await frames();
    expect(shape.hasAttribute("hidden")).toBe(false);
    expect(shape.getAttribute("clip-path")).toContain("url(#");

    Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 450 });
    Object.defineProperty(scroll, "scrollWidth", { configurable: true, value: 900 });
    scroll.scrollLeft = 0;
    active.current = { type: "content", key: "a" };
    handle.refresh();
    expect(scroll.scrollLeft).toBe(210);
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 });
    scroll.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(scroll.scrollLeft).toBe(290);
    handle.dispose();
  });
});
