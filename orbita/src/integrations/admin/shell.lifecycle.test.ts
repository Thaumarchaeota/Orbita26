import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightDestination, InsightDestinationId, InsightHostContext } from "./types";

vi.mock("./settings", () => ({
  mountAdminSettingsButton: () => {},
}));

vi.mock("../../core/settings", () => ({
  getSettings: () => ({ dataDir: "" }),
}));

type StubOpts = {
  canDispose?: () => boolean | Promise<boolean>;
  onEvent?: (event: string) => void;
};

function makeStub(id: InsightDestinationId, opts: StubOpts = {}) {
  const calls: string[] = [];
  const record = (event: string) => {
    calls.push(event);
    opts.onEvent?.(`${id}:${event}`);
  };
  const dest: InsightDestination = {
    id,
    kind: "domain",
    label: id,
    icon: id,
    mount(_root, _ctx: InsightHostContext) {
      record("mount");
      return {
        activate() {
          record("activate");
        },
        deactivate() {
          record("deactivate");
        },
        canDispose: opts.canDispose,
        dispose() {
          record("dispose");
        },
      };
    },
  };
  return { dest, calls };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function setup(stubs: ReturnType<typeof makeStub>[]) {
  const { registerInsightDestination } = await import("./registry");
  const { mountAdminShell } = await import("./shell");
  for (const stub of stubs) registerInsightDestination(stub.dest);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountAdminShell(root);
  await flush();
  return root;
}

function clickTab(root: HTMLElement, id: InsightDestinationId): void {
  root.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!.click();
}

function toggleSidebar(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("#adminSidebarToggle")!.click();
}

function countCachedRoots(root: HTMLElement): number {
  return root.querySelectorAll(".insight-dest-root").length;
}

function getActiveTab(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLButtonElement>(".admin-tab-btn.is-active")?.dataset.tab;
}

function getActiveDest(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLElement>(".insight-dest-root.is-active")?.dataset.dest;
}

type InteractiveFlags = { listener: boolean; timer: boolean; async: boolean };

function makeInteractiveStub(id: InsightDestinationId, opts: StubOpts = {}) {
  const calls: string[] = [];
  const flags: InteractiveFlags = { listener: false, timer: false, async: false };
  let listener: ((e: Event) => void) | null = null;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let mountGen = 0;
  let alive = true;

  const cleanup = () => {
    if (listener) {
      document.removeEventListener("insight-test-event", listener);
      listener = null;
    }
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const dest: InsightDestination = {
    id,
    kind: "domain",
    label: id,
    icon: id,
    mount(_root, ctx) {
      calls.push("mount");
      mountGen = ctx.generation;
      alive = true;
      listener = () => {
        flags.listener = true;
      };
      document.addEventListener("insight-test-event", listener);
      timerId = setInterval(() => {
        flags.timer = true;
      }, 100);
      setTimeout(() => {
        if (alive && ctx.generation === mountGen) flags.async = true;
      }, 100);
      opts.onEvent?.(`${id}:mount`);
      return {
        activate() {
          calls.push("activate");
          opts.onEvent?.(`${id}:activate`);
        },
        deactivate() {
          calls.push("deactivate");
          alive = false;
          cleanup();
          opts.onEvent?.(`${id}:deactivate`);
        },
        canDispose: opts.canDispose,
        dispose() {
          calls.push("dispose");
          alive = false;
          cleanup();
          opts.onEvent?.(`${id}:dispose`);
        },
      };
    },
  };
  return { dest, calls, flags };
}

function fireInteractiveTriggers(): void {
  document.dispatchEvent(new CustomEvent("insight-test-event"));
}

describe("admin shell destination lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("mounts each destination once across switches", async () => {
    const finance = makeStub("finance");
    const health = makeStub("health");
    const root = await setup([finance, health]);

    clickTab(root, "health");
    await flush();
    clickTab(root, "finance");
    await flush();
    clickTab(root, "health");
    await flush();
    clickTab(root, "finance");
    await flush();

    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
    expect(health.calls.filter((c) => c === "mount")).toHaveLength(1);
  });

  it("disposes cached destinations only after dataDir change is confirmed", async () => {
    let allowDispose = false;
    const finance = makeStub("finance", { canDispose: () => allowDispose });
    const health = makeStub("health", { canDispose: () => allowDispose });
    const root = await setup([finance, health]);

    clickTab(root, "health");
    await flush();

    const { notifyDataDirChanged } = await import("../../core/data/dir-sync");
    notifyDataDirChanged();
    await flush();

    expect(finance.calls).not.toContain("dispose");
    expect(health.calls).not.toContain("dispose");

    allowDispose = true;
    notifyDataDirChanged();
    await flush();

    expect(finance.calls).toContain("dispose");
    expect(health.calls).toContain("dispose");
  });

  it("does not remount or re-activate when clicking the active tab", async () => {
    const finance = makeStub("finance");
    const health = makeStub("health");
    const root = await setup([finance, health]);

    clickTab(root, "finance");
    await flush();

    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
    expect(finance.calls.filter((c) => c === "activate")).toHaveLength(1);
  });

  it("deactivates the current destination before activating the target", async () => {
    const order: string[] = [];
    const finance = makeStub("finance", { onEvent: (e) => order.push(e) });
    const health = makeStub("health", { onEvent: (e) => order.push(e) });
    const root = await setup([finance, health]);

    clickTab(root, "health");
    await flush();

    const deactivateIdx = order.indexOf("finance:deactivate");
    const activateIdx = order.indexOf("health:activate");
    expect(deactivateIdx).toBeGreaterThan(-1);
    expect(activateIdx).toBeGreaterThan(-1);
    expect(deactivateIdx).toBeLessThan(activateIdx);
  });

  it("stops listeners timers and async callbacks after deactivate", async () => {
    vi.useFakeTimers();
    const finance = makeInteractiveStub("finance");
    const health = makeInteractiveStub("health");
    const root = await setup([finance, health]);

    clickTab(root, "health");
    await flush();

    fireInteractiveTriggers();
    vi.advanceTimersByTime(200);

    expect(finance.flags.listener).toBe(false);
    expect(finance.flags.timer).toBe(false);
    expect(finance.flags.async).toBe(false);
    vi.useRealTimers();
  });

  it("stops listeners timers and async callbacks after dispose", async () => {
    vi.useFakeTimers();
    let allowDispose = true;
    const finance = makeInteractiveStub("finance", { canDispose: () => allowDispose });
    const health = makeInteractiveStub("health", { canDispose: () => allowDispose });
    const root = await setup([finance, health]);

    clickTab(root, "health");
    await flush();

    const { notifyDataDirChanged } = await import("../../core/data/dir-sync");
    notifyDataDirChanged();
    await flush();

    fireInteractiveTriggers();
    vi.advanceTimersByTime(200);

    expect(finance.flags.listener).toBe(false);
    expect(finance.flags.timer).toBe(false);
    expect(finance.flags.async).toBe(false);
    expect(health.flags.listener).toBe(false);
    expect(health.flags.timer).toBe(false);
    expect(health.flags.async).toBe(false);
    vi.useRealTimers();
  });

  it("keeps sidebar active state aligned with visible content root", async () => {
    const finance = makeStub("finance");
    const health = makeStub("health");
    const journal = makeStub("journal");
    const root = await setup([finance, health, journal]);

    clickTab(root, "health");
    await flush();
    expect(getActiveTab(root)).toBe("health");
    expect(getActiveDest(root)).toBe("health");

    clickTab(root, "journal");
    await flush();
    expect(getActiveTab(root)).toBe("journal");
    expect(getActiveDest(root)).toBe("journal");
    expect(root.querySelector(".insight-dest-root[data-dest='health'].is-active")).toBeNull();
  });

  it("sidebar collapse does not change cached destination count or active destination", async () => {
    const finance = makeStub("finance");
    const health = makeStub("health");
    const root = await setup([finance, health]);

    clickTab(root, "health");
    await flush();
    const before = countCachedRoots(root);
    expect(getActiveTab(root)).toBe("health");

    toggleSidebar(root);
    toggleSidebar(root);

    expect(countCachedRoots(root)).toBe(before);
    expect(getActiveTab(root)).toBe("health");
    expect(getActiveDest(root)).toBe("health");
  });
});
