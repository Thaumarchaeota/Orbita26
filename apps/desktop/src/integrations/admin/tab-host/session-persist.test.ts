import { afterEach, describe, expect, it } from "vitest";
import {
  clearTabSession,
  loadTabSession,
  saveTabSession,
  sanitizeTabSession,
} from "./session-persist";

afterEach(() => {
  localStorage.clear();
});

describe("tab session persist", () => {
  it("roundtrips a valid v2 session", () => {
    const session = {
      v: 2 as const,
      tabs: [
        {
          key: "project:p1",
          identity: { kind: "project" as const, id: "p1" },
          title: "Alpha",
          destId: "project" as const,
          destState: { projectId: "p1" },
        },
      ],
      panes: {
        left: { tabKeys: ["project:p1"], active: "project:p1", width: 0 },
      },
      focusedPane: "left" as const,
      style: "trap" as const,
    };
    saveTabSession(session);
    expect(loadTabSession()).toEqual(session);
  });

  it("restores the fixed finance1 destination after a restart", () => {
    const session = {
      v: 2 as const,
      tabs: [],
      panes: {
        left: { tabKeys: [], active: "fixed:finance1", width: 0 },
      },
      focusedPane: "left" as const,
      style: "rect" as const,
    };

    saveTabSession(session);

    expect(loadTabSession().panes.left.active).toBe("fixed:finance1");
  });

  it("migrates v1 session to v2", () => {
    const v1 = {
      v: 1 as const,
      tabs: [
        {
          key: "project:p1",
          identity: { kind: "project" as const, id: "p1" },
          title: "Alpha",
          destId: "project" as const,
          destState: { projectId: "p1" },
        },
      ],
      active: { type: "content" as const, key: "project:p1" },
      style: "rect" as const,
    };
    const loaded = sanitizeTabSession(v1);
    expect(loaded.v).toBe(2);
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.panes.left.tabKeys).toEqual(["project:p1"]);
    expect(loaded.panes.left.active).toBe("project:p1");
    expect(loaded.focusedPane).toBe("left");
  });

  it("accepts instance keys independent of identity dedup key", () => {
    const result = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "tab:abc-123",
          identity: { kind: "blank", id: "b1" },
          title: "新标签页",
          destId: "home",
          destState: {},
        },
        {
          key: "tab:def-456",
          identity: { kind: "fixed", dest: "timeline" },
          title: "时间线",
          destId: "timeline",
          destState: {},
        },
      ],
      active: { type: "content", key: "tab:abc-123" },
      style: "rect",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].key).toBe("tab:abc-123");
    expect(result.tabs[0].destId).toBe("home");
    expect(result.panes.left.active).toBe("tab:abc-123");
    expect(result.panes.left.tabKeys).toEqual(["tab:abc-123"]);
  });

  it("keeps fixed timeline active and drops fixed identity tabs", () => {
    const withExisting = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "tab:work-1",
          identity: { kind: "fixed", dest: "work" },
          title: "任务",
          destId: "work",
          destState: {},
        },
      ],
      active: { type: "fixed", dest: "work" },
      style: "rect",
    });
    expect(withExisting.panes.left.active).toBe("tab:work-1");
    expect(withExisting.tabs).toHaveLength(1);
    expect(withExisting.tabs[0].identity).toEqual({ kind: "task-view" });

    const synthesized = sanitizeTabSession({
      v: 1,
      tabs: [],
      active: { type: "fixed", dest: "health" },
      style: "rect",
    });
    expect(synthesized.tabs).toHaveLength(0);
    expect(synthesized.panes.left.active).toBe("fixed:health");

    const timelineActive = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "tab:timeline",
          identity: { kind: "fixed", dest: "timeline" },
          title: "时间线",
          destId: "timeline",
          destState: {},
        },
      ],
      active: { type: "fixed", dest: "timeline" },
      style: "rect",
    });
    expect(timelineActive.tabs).toHaveLength(0);
    expect(timelineActive.panes.left.active).toBe("timeline");
  });

  it("preserves the explicit week/list task-view state on sanitize", () => {
    const result = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "task-view",
          identity: { kind: "task-view" },
          title: "任务",
          destId: "work",
          destState: { view: "list", filter: "l1" },
        },
      ],
      active: { type: "content", key: "task-view" },
      style: "rect",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].destState).toEqual({ view: "list", filter: "l1" });
    saveTabSession(result);
    expect(loadTabSession().tabs[0].destState).toEqual({ view: "list", filter: "l1" });
  });

  it("maps an explicit all-list view to list/all and an empty legacy view to week", () => {
    const allList = sanitizeTabSession({
      v: 1,
      tabs: [
        { key: "task-all", identity: { kind: "task-view" }, title: "安排", destId: "work", destState: { view: "list", filter: "all" } },
      ],
      active: { type: "home" },
      style: "rect",
    });
    const legacy = sanitizeTabSession({
      v: 1,
      tabs: [{ key: "task-week", identity: { kind: "task-view" }, title: "安排", destId: "work", destState: {} }],
      active: { type: "home" },
      style: "rect",
    });
    expect(allList.tabs[0].destState).toEqual({ view: "list", filter: "all" });
    expect(legacy.tabs[0].destState).toEqual({ view: "week" });
  });

  it("merges legacy tabs without inheriting list filter when active is work", () => {
    const result = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "tab:work-1",
          identity: { kind: "fixed", dest: "work" },
          title: "任务",
          destId: "work",
          destState: {},
        },
        {
          key: "tab:list-l1",
          identity: { kind: "list", id: "l1" },
          title: "List 1",
          destId: "work",
          destState: { filter: "l1" },
        },
      ],
      active: { type: "fixed", dest: "work" },
      style: "rect",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].identity).toEqual({ kind: "task-view" });
    expect(result.tabs[0].destState).toEqual({ view: "week" });
    expect(result.panes.left.active).toBe("tab:work-1");
  });

  it("merges legacy list and work tabs into one task-view", () => {
    const result = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "tab:work-1",
          identity: { kind: "fixed", dest: "work" },
          title: "任务",
          destId: "work",
          destState: {},
        },
        {
          key: "tab:list-l1",
          identity: { kind: "list", id: "l1" },
          title: "List 1",
          destId: "work",
          destState: { filter: "l1" },
        },
      ],
      active: { type: "content", key: "tab:list-l1" },
      style: "rect",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].identity).toEqual({ kind: "task-view" });
    expect(result.tabs[0].destState).toEqual({ view: "list", filter: "l1" });
    expect(result.panes.left.active).toBe("tab:list-l1");
  });

  it("drops duplicate keys and duplicate identities", () => {
    const result = sanitizeTabSession({
      v: 1,
      tabs: [
        {
          key: "tab:dup",
          identity: { kind: "project", id: "p1" },
          title: "First",
          destId: "project",
          destState: { projectId: "p1" },
        },
        {
          key: "tab:dup",
          identity: { kind: "list", id: "l1" },
          title: "Dup key",
          destId: "work",
          destState: { listId: "l1" },
        },
        {
          key: "tab:other",
          identity: { kind: "project", id: "p1" },
          title: "Dup identity",
          destId: "project",
          destState: { projectId: "p1" },
        },
      ],
      active: { type: "home" },
      style: "rect",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].key).toBe("tab:dup");
    expect(result.tabs[0].title).toBe("First");
  });

  it("sanitizes unknown identities and dangling active keys", () => {
    const result = sanitizeTabSession({
      v: 1,
      tabs: [
        { key: "bad", identity: { kind: "journal" }, title: "X" },
        { key: "project:p1", identity: { kind: "project", id: "p1" }, title: "OK" },
        { key: "list:l1", identity: { kind: "list", id: "" }, title: "Empty" },
        { key: "tab:blank", identity: { kind: "blank", id: "" }, title: "Empty blank" },
      ],
      active: { type: "content", key: "bad" },
      style: "nope",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].key).toBe("project:p1");
    expect(result.panes.left.active).toBe("home");
    expect(result.style).toBe("rect");
  });

  it("clearTabSession resets tabs and panes but preserves style", () => {
    saveTabSession({
      v: 2,
      tabs: [
        {
          key: "settings",
          identity: { kind: "settings" },
          title: "设置",
          destId: "settings",
          destState: {},
        },
      ],
      panes: { left: { tabKeys: ["settings"], active: "settings", width: 0 } },
      focusedPane: "left",
      style: "trap",
    });
    clearTabSession();
    const loaded = loadTabSession();
    expect(loaded.tabs).toEqual([]);
    expect(loaded.panes.left).toEqual({ tabKeys: [], active: "home", width: 0 });
    expect(loaded.panes.right).toBeUndefined();
    expect(loaded.style).toBe("trap");
  });
});
