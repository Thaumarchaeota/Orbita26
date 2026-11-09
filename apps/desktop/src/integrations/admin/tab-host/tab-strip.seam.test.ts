import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveSurface, ContentTabRecord } from "./identity";
import { mountTabStrip } from "./tab-strip";

function rect(partial: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...partial,
  } as DOMRect;
}

async function frames(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function tab(key: string, title = key): ContentTabRecord {
  return {
    key,
    identity: { kind: "project", id: key },
    title,
    destId: "project",
    destState: { projectId: key },
  };
}

function mountFixture(
  active: { current: ActiveSurface },
  tabs: { current: ContentTabRecord[] },
  onSelectTab = vi.fn(),
  onReorder = vi.fn(),
) {
  const workspace = document.createElement("section");
  workspace.className = "admin-workspace";
  const host = document.createElement("div");
  workspace.append(host);
  document.body.append(workspace);
  vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue(rect({ left: 10, top: 100 }));
  const handle = mountTabStrip(host, {
    getActive: () => active.current,
    getTabs: () => tabs.current,
    getStyle: () => "rect",
    onSelectHome: vi.fn(),
    onSelectTimeline: vi.fn(),
    onNewTab: vi.fn(),
    onSelectTab,
    onCloseTab: vi.fn(),
    onReorder,
  });
  return { handle, host, workspace, onSelectTab, onReorder };
}

describe("tab strip active rail seam", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the home rail at the exact fractional tab bottom instead of CSS height rounding", async () => {
    const active = { current: { type: "home" } as ActiveSurface };
    const fixture = mountFixture(active, { current: [] });
    const home = fixture.host.querySelector<HTMLElement>(".insight-tab-strip-home")!;
    vi.spyOn(home, "getBoundingClientRect").mockReturnValue(
      rect({ left: 26.5, bottom: 141.25, width: 44.5, height: 41.25 }),
    );

    await frames();

    const rail = fixture.workspace.querySelector<HTMLElement>(".insight-tab-selected-rail")!;
    expect(rail.hidden).toBe(false);
    expect(rail.style.top).toBe("41.25px");
    expect(rail.style.left).toBe("16.5px");
    expect(rail.style.width).toBe("44.5px");
    fixture.handle.dispose();
  });

  it("recomputes the rail after switching home to a content tab and resizing", async () => {
    const active = { current: { type: "home" } as ActiveSurface };
    const tabs = { current: [tab("project:p1", "P1")] };
    const fixture = mountFixture(active, tabs);
    const home = fixture.host.querySelector<HTMLElement>(".insight-tab-strip-home")!;
    const content = fixture.host.querySelector<HTMLElement>(".insight-content-tab")!;
    vi.spyOn(home, "getBoundingClientRect").mockReturnValue(rect({ left: 18, bottom: 140, width: 40 }));
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue(rect({ left: 70, bottom: 141.25, width: 96 }));
    await frames();

    active.current = { type: "content", key: "project:p1" };
    fixture.handle.refresh();
    await frames();
    const rail = fixture.workspace.querySelector<HTMLElement>(".insight-tab-selected-rail")!;
    expect(rail.dataset.railKey).toBe("content:project:p1");
    expect(rail.style.top).toBe("41.25px");
    expect(rail.style.left).toBe("60px");

    vi.spyOn(fixture.workspace, "getBoundingClientRect").mockReturnValue(rect({ left: 25, top: 96 }));
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue(rect({ left: 90, bottom: 138.5, width: 96 }));
    window.dispatchEvent(new Event("resize"));
    await frames();
    expect(rail.style.top).toBe("42.5px");
    expect(rail.style.left).toBe("65px");
    fixture.handle.dispose();
  });

  it("keeps DOM click and drag behavior under the single Insight appearance", async () => {
    const active = { current: { type: "content", key: "a" } as ActiveSurface };
    const tabs = { current: [tab("a"), tab("b")] };
    const onSelectTab = vi.fn();
    const onReorder = vi.fn();
    const fixture = mountFixture(active, tabs, onSelectTab, onReorder);
    const first = fixture.host.querySelector<HTMLButtonElement>('[data-tab-key="a"]')!;
    const second = fixture.host.querySelector<HTMLButtonElement>('[data-tab-key="b"]')!;
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect({ left: 0, width: 40, bottom: 140 }));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect({ left: 100, width: 40, bottom: 140 }));
    Object.assign(first, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });

    first.click();
    expect(onSelectTab).toHaveBeenCalledWith("a");
    expect(first.getAttribute("aria-selected")).toBe("true");

    first.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 10 }));
    first.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 150 }));
    expect(first.classList.contains("is-dragging")).toBe(true);
    first.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 150 }));
    expect(onReorder).toHaveBeenCalledWith(["b", "a"]);
    fixture.handle.dispose();
  });
});
