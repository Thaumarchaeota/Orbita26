import { describe, expect, it } from "vitest";
import {
  contentTabKey,
  defaultTabTitle,
  destForIdentity,
  destStateForIdentity,
  identitiesEqual,
  newBlankIdentity,
  newTabInstanceKey,
} from "./identity";

describe("newTabInstanceKey", () => {
  it("returns tab: prefixed instance keys", () => {
    const key = newTabInstanceKey();
    expect(key.startsWith("tab:")).toBe(true);
    expect(key.length).toBeGreaterThan(4);
  });
});

describe("newBlankIdentity", () => {
  it("creates blank identity with non-empty id", () => {
    const identity = newBlankIdentity();
    expect(identity.kind).toBe("blank");
    expect(identity.id.length).toBeGreaterThan(0);
  });
});

describe("identitiesEqual", () => {
  it("compares identities by kind and fields", () => {
    expect(identitiesEqual({ kind: "blank", id: "a" }, { kind: "blank", id: "a" })).toBe(true);
    expect(identitiesEqual({ kind: "blank", id: "a" }, { kind: "blank", id: "b" })).toBe(false);
    expect(identitiesEqual({ kind: "fixed", dest: "work" }, { kind: "fixed", dest: "work" })).toBe(true);
    expect(identitiesEqual({ kind: "fixed", dest: "work" }, { kind: "fixed", dest: "health" })).toBe(false);
    expect(identitiesEqual({ kind: "task-view" }, { kind: "task-view" })).toBe(true);
    expect(identitiesEqual({ kind: "task-view" }, { kind: "list", id: "l1" })).toBe(false);
    expect(identitiesEqual({ kind: "project", id: "p1" }, { kind: "list", id: "p1" })).toBe(false);
    expect(identitiesEqual({ kind: "settings" }, { kind: "settings" })).toBe(true);
  });
});

describe("contentTabKey", () => {
  it("maps identities to dedup keys", () => {
    expect(contentTabKey({ kind: "blank", id: "b1" })).toBe("blank:b1");
    expect(contentTabKey({ kind: "fixed", dest: "timeline" })).toBe("fixed:timeline");
    expect(contentTabKey({ kind: "task-view" })).toBe("task-view");
    expect(contentTabKey({ kind: "project", id: "p1" })).toBe("project:p1");
    expect(contentTabKey({ kind: "list", id: "l1" })).toBe("task-view");
    expect(contentTabKey({ kind: "journal", id: "j1" })).toBe("journal:j1");
    expect(contentTabKey({ kind: "web", url: "https://example.com/" })).toBe("web:https://example.com/");
  });
});

describe("destForIdentity", () => {
  it("routes identities to destinations", () => {
    expect(destForIdentity({ kind: "blank", id: "b1" })).toBe("home");
    expect(destForIdentity({ kind: "fixed", dest: "health" })).toBe("health");
    expect(destForIdentity({ kind: "list", id: "l1" })).toBe("work");
    expect(destForIdentity({ kind: "task-view" })).toBe("work");
    expect(destForIdentity({ kind: "project", id: "p1" })).toBe("project");
    expect(destForIdentity({ kind: "settings" })).toBe("settings");
    expect(destForIdentity({ kind: "web", url: "https://example.com/" })).toBe("web");
  });
});

describe("destStateForIdentity", () => {
  it("builds destination state payloads", () => {
    expect(destStateForIdentity({ kind: "blank", id: "b1" })).toEqual({});
    expect(destStateForIdentity({ kind: "fixed", dest: "work" })).toEqual({});
    expect(destStateForIdentity({ kind: "project", id: "p1" })).toEqual({ projectId: "p1" });
    expect(destStateForIdentity({ kind: "list", id: "l1" })).toEqual({ view: "list", filter: "l1" });
    expect(destStateForIdentity({ kind: "task-view" })).toEqual({ view: "week" });
    expect(destStateForIdentity({ kind: "settings" })).toEqual({});
    expect(destStateForIdentity({ kind: "chat", id: "c1" })).toEqual({ conversationId: "c1" });
    expect(destStateForIdentity({ kind: "web", url: "https://example.com/" })).toEqual({
      url: "https://example.com/",
    });
  });
});

describe("defaultTabTitle", () => {
  it("returns localized default titles", () => {
    expect(defaultTabTitle({ kind: "blank", id: "b1" })).toBe("新标签页");
    expect(defaultTabTitle({ kind: "fixed", dest: "timeline" })).toBe("时间线");
    expect(defaultTabTitle({ kind: "fixed", dest: "work" })).toBe("安排");
    expect(defaultTabTitle({ kind: "task-view" })).toBe("安排");
    expect(defaultTabTitle({ kind: "fixed", dest: "health" })).toBe("健康");
    expect(defaultTabTitle({ kind: "fixed", dest: "finance" })).toBe("记账");
    expect(defaultTabTitle({ kind: "project", id: "p1" })).toBe("项目");
    expect(defaultTabTitle({ kind: "list", id: "l1" })).toBe("清单");
    expect(defaultTabTitle({ kind: "settings" })).toBe("设置");
    expect(defaultTabTitle({ kind: "chat", id: "c1" })).toBe("新对话");
    expect(defaultTabTitle({ kind: "journal", id: "j1" })).toBe("随记");
    expect(defaultTabTitle({ kind: "web", url: "https://example.com/path" })).toBe("example.com");
  });
});
