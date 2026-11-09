import { describe, expect, it } from "vitest";
import { NavigationChannel, NavigationHistory, sameNavigationRoute, type NavigationFrame } from "./navigation-history";

function frame(id: string, route = id, instance = "instance:1"): NavigationFrame {
  return { id, hostEpoch: 1, dataDirKey: "dir:A", surface: { type: "content", key: "task-view" }, tabInstanceId: instance,
    route: { version: 1, destination: "work", value: { view: route } }, context: { scroll: 0 } };
}

describe("Insight in-memory navigation history", () => {
  it("keeps the forward branch on repeat visits, then removes it on a different visit", () => {
    const history = new NavigationHistory();
    const a = frame("A"), b = frame("B"), c = frame("C");
    history.visit(a); history.visit(b); history.visit(c); history.commit(b);
    history.visit({ ...b, id: "B:repeat", context: { scroll: 92 } });
    expect(history.adjacent(1)?.id).toBe("C");
    history.visit(frame("D"));
    expect(history.adjacent(1)).toBeUndefined();
    expect(history.length).toBe(3);
  });

  it("includes host, directory, surface and tab instance in page identity", () => {
    const a = frame("A");
    expect(sameNavigationRoute(a, { ...a, context: { scroll: 40 } })).toBe(true);
    expect(sameNavigationRoute(a, { ...a, tabInstanceId: "instance:reopened" })).toBe(false);
    expect(sameNavigationRoute(a, { ...a, dataDirKey: "dir:B" })).toBe(false);
    expect(sameNavigationRoute(a, { ...a, hostEpoch: 2 })).toBe(false);
    expect(sameNavigationRoute(a, { ...a, surface: { type: "content", key: "other" } })).toBe(false);
  });

  it("normalizes object property order without merging distinct destination instances", () => {
    const a = frame("A");
    a.route.value = { view: "week", scope: { kind: "all" } };
    const b = { ...a, route: { ...a.route, value: { scope: { kind: "all" }, view: "week" } } };
    expect(sameNavigationRoute(a, b)).toBe(true);
  });

  it("bounds memory to 200 frames and preserves adjacent navigation at the trimmed end", () => {
    const history = new NavigationHistory();
    for (let index = 0; index < 201; index++) history.visit(frame(String(index)));
    expect(history.length).toBe(200);
    expect(history.position).toBe(199);
    expect(history.adjacent(-1)?.id).toBe("199");
    for (let index = 0; index < 199; index++) history.commit(history.adjacent(-1)!);
    expect(history.current?.id).toBe("1");
    expect(history.adjacent(-1)).toBeUndefined();
  });

  it("removes a closed instance's entire history and collapses its adjacent duplicates", () => {
    const history = new NavigationHistory();
    const a = frame("A", "same", "keep");
    history.visit(a); history.visit(frame("B", "detail", "close")); history.visit({ ...a, id: "A2" });
    history.remove((entry) => entry.tabInstanceId === "close");
    expect(history.length).toBe(1);
    expect(history.position).toBe(0);
    history.visit(frame("reopened", "detail", "reopened"));
    expect(history.adjacent(-1)?.tabInstanceId).toBe("keep");
  });

  it("only moves the cursor for an explicit detail close when its target is the previous frame", () => {
    const history = new NavigationHistory();
    history.visit(frame("parent")); history.visit(frame("detail"));
    history.visit(frame("parent:closed", "parent"), true);
    expect(history.length).toBe(2);
    expect(history.position).toBe(0);
    history.visit(frame("other-parent"), true);
    expect(history.position).toBe(1);
    expect(history.adjacent(1)).toBeUndefined();
  });

  it("resets to the actual restored surface without preserving visits", () => {
    const history = new NavigationHistory();
    history.visit(frame("A")); history.visit(frame("B"));
    history.reset({ ...frame("restored"), hostEpoch: 2 });
    expect(history.length).toBe(1);
    expect(history.adjacent(-1)).toBeUndefined();
    expect(history.adjacent(1)).toBeUndefined();
  });
});

describe("navigation serialization", () => {
  it("drops repeated direction input while retaining one later ordinary navigation", async () => {
    const channel = new NavigationChannel();
    let release!: () => void;
    const order: string[] = [];
    const first = channel.run(async () => { await new Promise<void>((resolve) => { release = resolve; }); order.push("restore"); }, true);
    await Promise.resolve();
    expect(await channel.run(async () => { order.push("repeated"); }, true)).toBeUndefined();
    const next = channel.run(async () => { order.push("new-visit"); });
    release();
    await Promise.all([first, next]);
    expect(order).toEqual(["restore", "new-visit"]);
  });

  it("continues after a failed restore without running requests concurrently", async () => {
    const channel = new NavigationChannel();
    const first = channel.run(async () => { throw new Error("temporary read failure"); });
    const next = channel.run(async () => "next");
    await expect(first).rejects.toThrow("temporary read failure");
    await expect(next).resolves.toBe("next");
  });
});
