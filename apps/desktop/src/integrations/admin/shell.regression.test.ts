import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { savePersistedDestination } from "./destination-persist";
import type { InsightDestination, InsightDestinationId, InsightHostContext } from "./types";

vi.mock("./settings", () => ({
  mountAdminSettingsButton: () => {},
}));

vi.mock("../../core/settings", () => ({
  getSettings: () => ({ dataDir: "" }),
}));

type StubOpts = {
  canDispose?: () => boolean | Promise<boolean>;
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function setup(stubs: InsightDestination[]) {
  const { registerInsightDestination } = await import("./registry");
  const { mountAdminShell } = await import("./shell");
  for (const dest of stubs) registerInsightDestination(dest);
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

function makeBasicStub(id: InsightDestinationId, opts: StubOpts = {}) {
  const calls: string[] = [];
  const dest: InsightDestination = {
    id,
    kind: "domain",
    label: id,
    icon: id,
    mount() {
      calls.push("mount");
      return {
        activate() {
          calls.push("activate");
        },
        deactivate() {
          calls.push("deactivate");
        },
        canDispose: opts.canDispose,
        dispose() {
          calls.push("dispose");
        },
      };
    },
  };
  return { dest, calls };
}

type FinanceState = { scrollY: number; pending: boolean };

function makeStatefulFinanceStub() {
  const calls: string[] = [];
  let state: FinanceState = { scrollY: 0, pending: false };

  const dest: InsightDestination = {
    id: "finance",
    kind: "domain",
    label: "finance",
    icon: "finance",
    mount(root) {
      calls.push("mount");
      root.dataset.scrollY = String(state.scrollY);
      return {
        activate() {
          calls.push("activate");
        },
        deactivate() {
          calls.push("deactivate");
        },
        getRestoreState() {
          calls.push("getRestoreState");
          return { ...state };
        },
        restoreState(s: unknown) {
          calls.push("restoreState");
          state = s as FinanceState;
        },
        dispose() {
          calls.push("dispose");
        },
      };
    },
  };

  return {
    dest,
    calls,
    setState(s: Partial<FinanceState>) {
      state = { ...state, ...s };
    },
    getState() {
      return { ...state };
    },
  };
}

function makeErrorFinanceStub() {
  const calls: string[] = [];
  const dest: InsightDestination = {
    id: "finance",
    kind: "domain",
    label: "finance",
    icon: "finance",
    mount(root, _ctx: InsightHostContext) {
      calls.push("mount");
      root.innerHTML = `
        <div class="ledger-error">
          <p class="ledger-error-title">无法连接财务服务</p>
          <p class="ledger-error-msg">stub error</p>
        </div>`;
      return {
        activate() {
          calls.push("activate");
        },
        deactivate() {
          calls.push("deactivate");
        },
        dispose() {
          calls.push("dispose");
        },
      };
    },
  };
  return { dest, calls };
}

describe("admin shell §7.2 regression", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("health→finance→journal→finance keeps finance mounted and restores state", async () => {
    const health = makeBasicStub("health");
    const finance = makeStatefulFinanceStub();
    const journal = makeBasicStub("journal");
    const root = await setup([health.dest, finance.dest, journal.dest]);

    clickTab(root, "health");
    await flush();
    clickTab(root, "finance");
    await flush();
    finance.setState({ scrollY: 420, pending: true });

    clickTab(root, "journal");
    await flush();
    expect(finance.calls).toContain("getRestoreState");
    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);

    clickTab(root, "finance");
    await flush();

    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
    expect(finance.calls).not.toContain("dispose");
    expect(getActiveDest(root)).toBe("finance");
    expect(finance.getState()).toEqual({ scrollY: 420, pending: true });
    expect(root.querySelector(".insight-dest-root[data-dest='finance']")).not.toBeNull();
  });

  it("finance pending: tab switch does not call canDispose or dispose", async () => {
    const canDispose = vi.fn(() => false);
    const finance = makeBasicStub("finance", { canDispose });
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    clickTab(root, "finance");
    await flush();
    clickTab(root, "health");
    await flush();
    clickTab(root, "finance");
    await flush();

    expect(canDispose).not.toHaveBeenCalled();
    expect(finance.calls).not.toContain("dispose");
    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
    expect(getActiveDest(root)).toBe("finance");
  });

  it("cold start restores persisted destination, otherwise falls back to finance", async () => {
    const health = makeBasicStub("health");
    const journal = makeBasicStub("journal");
    const finance = makeBasicStub("finance");

    savePersistedDestination({ destinationId: "journal" });
    const rootWithPersist = await setup([health.dest, journal.dest, finance.dest]);
    expect(getActiveTab(rootWithPersist)).toBe("journal");
    expect(getActiveDest(rootWithPersist)).toBe("journal");

    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();

    const rootFresh = await setup([health.dest, journal.dest, finance.dest]);
    expect(getActiveTab(rootFresh)).toBe("finance");
    expect(getActiveDest(rootFresh)).toBe("finance");
  });

  it("hide/show simulation keeps cached roots without dispose", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    clickTab(root, "health");
    await flush();
    clickTab(root, "finance");
    await flush();

    const cachedRoots = [...root.querySelectorAll(".insight-dest-root")];
    expect(cachedRoots).toHaveLength(2);

    const app = root.querySelector<HTMLElement>(".admin-app")!;
    app.style.display = "none";
    app.style.display = "";

    clickTab(root, "finance");
    await flush();

    const rootsAfter = [...root.querySelectorAll(".insight-dest-root")];
    expect(rootsAfter).toHaveLength(2);
    expect(rootsAfter[0]).toBe(cachedRoots[0]);
    expect(rootsAfter[1]).toBe(cachedRoots[1]);
    expect(finance.calls).not.toContain("dispose");
    expect(health.calls).not.toContain("dispose");
    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
  });

  it("finance loading error does not block switching to other domains", async () => {
    const finance = makeErrorFinanceStub();
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    expect(root.querySelector(".ledger-error")).not.toBeNull();
    expect(getActiveDest(root)).toBe("finance");

    clickTab(root, "health");
    await flush();

    expect(getActiveTab(root)).toBe("health");
    expect(getActiveDest(root)).toBe("health");
    expect(root.querySelector("#adminSidebar")).not.toBeNull();
    expect(root.querySelector("#adminTabs")).not.toBeNull();
    expect(finance.calls).not.toContain("dispose");
    expect(root.querySelector(".ledger-error")).not.toBeNull();
  });

  it("sidebar collapse toggles viewport class without extra nav items or cache loss", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const journal = makeBasicStub("journal");
    const work = makeBasicStub("work");
    const root = await setup([health.dest, journal.dest, finance.dest, work.dest]);

    clickTab(root, "journal");
    await flush();
    const cachedBefore = countCachedRoots(root);
    const navButtons = root.querySelectorAll(".admin-tab-btn");

    expect(navButtons).toHaveLength(4);
    expect(root.querySelector(".admin-workspace-section")).toBeNull();

    const app = root.querySelector<HTMLElement>(".admin-app")!;
    expect(app.classList.contains("is-sidebar-collapsed")).toBe(false);

    toggleSidebar(root);
    expect(app.classList.contains("is-sidebar-collapsed")).toBe(true);
    expect(countCachedRoots(root)).toBe(cachedBefore);
    expect(getActiveTab(root)).toBe("journal");

    toggleSidebar(root);
    expect(app.classList.contains("is-sidebar-collapsed")).toBe(false);
    expect(countCachedRoots(root)).toBe(cachedBefore);
    expect(navButtons).toHaveLength(4);
    expect(root.querySelectorAll(".admin-tab-btn")).toHaveLength(4);
  });
});

describe("insight settings page layout", () => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "./settings/insight-settings.css");

  it("uses scrollable body and fixed footer", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/\.insight-settings-body\s*\{[^}]+\}/s);
    expect(css).toMatch(/overflow-y:\s*auto/);
    expect(css).toMatch(/\.insight-settings-footer\s*\{[^}]+\}/s);
    expect(css).toMatch(/flex-shrink:\s*0/);
  });
});
