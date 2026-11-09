import { beforeEach, describe, expect, it, vi } from "vitest";

describe("host-api content tab handlers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("openInsightContentTab does not throw when opener unset", async () => {
    const { openInsightContentTab } = await import("./host-api");
    expect(() => openInsightContentTab({ kind: "project", id: "p1" })).not.toThrow();
    expect(() => openInsightContentTab({ kind: "settings" }, "Settings")).not.toThrow();
  });

  it("closeInsightContentTab does not throw when closer unset", async () => {
    const { closeInsightContentTab } = await import("./host-api");
    expect(() => closeInsightContentTab()).not.toThrow();
    expect(() => closeInsightContentTab("project:p1")).not.toThrow();
  });

  it("forwards list and fixed work to task-view", async () => {
    const {
      openInsightContentTab,
      setContentTabOpener,
      setTaskViewScopeSelector,
    } = await import("./host-api");
    const opener = vi.fn();
    const scope = vi.fn();
    setContentTabOpener(opener);
    setTaskViewScopeSelector(scope);

    openInsightContentTab({ kind: "list", id: "l1" }, "List 1");
    expect(opener).toHaveBeenCalledOnce();
    expect(opener).toHaveBeenCalledWith({ kind: "list", id: "l1" }, "List 1");
    expect(scope).not.toHaveBeenCalled();

    opener.mockClear();
    scope.mockClear();
    openInsightContentTab({ kind: "fixed", dest: "work" });
    expect(opener).toHaveBeenCalledOnce();
    expect(opener).toHaveBeenCalledWith({ kind: "task-view" }, "安排");
    expect(scope).not.toHaveBeenCalled();
  });

  it("forwards the explicit task view state, including all-list and week", async () => {
    const { selectTaskViewState, setTaskViewStateSelector } = await import("./host-api");
    const select = vi.fn();
    setTaskViewStateSelector(select);

    selectTaskViewState({ view: "list", filter: "all" });
    selectTaskViewState({ view: "week" });

    expect(select).toHaveBeenNthCalledWith(1, { view: "list", filter: "all" });
    expect(select).toHaveBeenNthCalledWith(2, { view: "week" });
  });

  it("activates timeline without opening a content tab", async () => {
    const { openInsightContentTab, setContentTabOpener, setTimelineActivator } = await import("./host-api");
    const opener = vi.fn();
    const timeline = vi.fn();
    setContentTabOpener(opener);
    setTimelineActivator(timeline);

    openInsightContentTab({ kind: "fixed", dest: "timeline" });
    expect(timeline).toHaveBeenCalledOnce();
    expect(opener).not.toHaveBeenCalled();
  });

  it("calls closer after setContentTabCloser", async () => {
    const { closeInsightContentTab, setContentTabCloser } = await import("./host-api");
    const closer = vi.fn();
    setContentTabCloser(closer);
    closeInsightContentTab("project:p1");
    closeInsightContentTab();
    expect(closer).toHaveBeenCalledTimes(2);
    expect(closer).toHaveBeenNthCalledWith(1, "project:p1");
    expect(closer).toHaveBeenNthCalledWith(2, undefined);
  });
});
