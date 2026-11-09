import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FixedDestId } from "./tab-host/identity";
import { saveTabSession } from "./tab-host/session-persist";
import type { InsightDestination, InsightDestinationId, InsightHostContext } from "./types";

vi.mock("./settings", () => ({
  mountAdminSettingsButton: () => {},
}));

vi.mock("../../core/settings", () => ({
  getSettings: () => ({ dataDir: "" }),
}));

vi.mock("../productivity/client", () => ({
  productivityListProjects: vi.fn(() => Promise.resolve({ projects: [] })),
  productivityListLists: vi.fn(() => Promise.resolve({ lists: [] })),
  productivityCreateProject: vi.fn(),
  productivityGetProject: vi.fn(),
  productivityCreateList: vi.fn(),
  productivityListItems: vi.fn(() => Promise.resolve({ items: [] })),
}));

vi.mock("../shell/dialog", () => ({
  getNamePromptDialog: () => async () => null,
  getConfirmDialog: () => async () => true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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

async function openFixedDest(dest: FixedDestId): Promise<void> {
  const { openInsightContentTab } = await import("./tab-host/host-api");
  openInsightContentTab({ kind: "fixed", dest });
  await flush();
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

function getActiveSurface(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLElement>(".insight-dest-root.is-active")?.dataset.surface;
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

function makeProjectStub() {
  const calls: string[] = [];
  const dest: InsightDestination = {
    id: "project",
    kind: "workspace",
    label: "project",
    icon: "project",
    mount(root) {
      calls.push("mount");
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
        restoreState(s: unknown) {
          const pid = (s as { projectId?: string })?.projectId;
          if (pid) root.dataset.projectId = pid;
        },
      };
    },
  };
  return { dest, calls };
}

function makeWorkStub() {
  const calls: string[] = [];
  const dest: InsightDestination = {
    id: "work",
    kind: "domain",
    label: "work",
    icon: "work",
    mount() {
      calls.push("mount");
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
        restoreState(s: unknown) {
          calls.push("restoreState");
          void s;
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

  it("health→finance→timeline→finance keeps finance mounted and restores state", async () => {
    const health = makeBasicStub("health");
    const finance = makeStatefulFinanceStub();
    const timeline = makeBasicStub("timeline");
    const journal = makeBasicStub("journal");
    const root = await setup([health.dest, finance.dest, timeline.dest, journal.dest]);

    await openFixedDest("health");
    await openFixedDest("finance");
    finance.setState({ scrollY: 420, pending: true });

    await openFixedDest("timeline");
    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
    expect(finance.calls).not.toContain("dispose");

    await openFixedDest("finance");

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

    await openFixedDest("finance");
    await openFixedDest("health");
    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(2);
    expect(root.querySelectorAll('.insight-dest-root[data-dest="finance"]')).toHaveLength(1);
    expect(root.querySelectorAll('.insight-dest-root[data-dest="health"]')).toHaveLength(1);

    await openFixedDest("finance");

    expect(canDispose).not.toHaveBeenCalled();
    expect(finance.calls).not.toContain("dispose");
    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
    expect(getActiveDest(root)).toBe("finance");
  });

  it("cold start restores tab list but opens home", async () => {
    const health = makeBasicStub("health");
    const journal = makeBasicStub("journal");
    const finance = makeBasicStub("finance");

    saveTabSession({ v: 1, tabs: [], active: { type: "fixed", dest: "health" }, style: "rect" });
    const rootWithPersist = await setup([health.dest, journal.dest, finance.dest]);
    expect(getActiveTab(rootWithPersist)).toBeUndefined();
    expect(getActiveDest(rootWithPersist)).toBe("home");
    expect(getActiveSurface(rootWithPersist)).toBe("home");

    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();

    const rootFresh = await setup([health.dest, journal.dest, finance.dest]);
    expect(getActiveTab(rootFresh)).toBeUndefined();
    expect(getActiveDest(rootFresh)).toBe("home");
  });

  it("hide/show simulation keeps cached roots without dispose", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    await openFixedDest("health");
    await openFixedDest("finance");

    const cachedRoots = [...root.querySelectorAll(".insight-dest-root")];
    expect(cachedRoots.length).toBeGreaterThanOrEqual(2);

    const app = root.querySelector<HTMLElement>(".admin-app")!;
    app.style.display = "none";
    app.style.display = "";

    await openFixedDest("finance");

    const rootsAfter = [...root.querySelectorAll(".insight-dest-root")];
    expect(rootsAfter.length).toBeGreaterThanOrEqual(2);
    expect(finance.calls).not.toContain("dispose");
    expect(health.calls).not.toContain("dispose");
    expect(finance.calls.filter((c) => c === "mount")).toHaveLength(1);
  });

  it("finance loading error does not block switching to other domains", async () => {
    const finance = makeErrorFinanceStub();
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    expect(getActiveDest(root)).toBe("home");

    await openFixedDest("finance");
    expect(root.querySelector(".ledger-error")).not.toBeNull();

    await openFixedDest("health");

    expect(getActiveDest(root)).toBe("health");
    expect(getActiveSurface(root)).toBe("fixed:health");
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
    const timeline = makeBasicStub("timeline");
    const root = await setup([health.dest, journal.dest, finance.dest, work.dest, timeline.dest]);

    await openFixedDest("timeline");
    const cachedBefore = countCachedRoots(root);

    expect(root.querySelectorAll(".admin-tab-btn")).toHaveLength(0);
    expect(root.querySelectorAll(".admin-quick-btn")).toHaveLength(1);
    expect(root.querySelector("#adminWorkspace")).toBeNull();
    expect(root.querySelector(".admin-workspace-section")).toBeNull();

    const app = root.querySelector<HTMLElement>(".admin-app")!;
    expect(app.classList.contains("is-sidebar-collapsed")).toBe(false);
    expect(root.querySelector("#adminSidebarToggle")).toBeNull();
    expect(countCachedRoots(root)).toBe(cachedBefore);
    expect(getActiveDest(root)).toBe("timeline");
    expect(getActiveSurface(root)).toBe("fixed:timeline");
  });

  it("keeps multiple project tabs mounted when switching to fixed dest", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const project = makeProjectStub();
    const root = await setup([health.dest, finance.dest, project.dest]);

    const { openInsightContentTab } = await import("./tab-host/host-api");
    openInsightContentTab({ kind: "project", id: "p1" }, "P1");
    await flush();
    openInsightContentTab({ kind: "project", id: "p2" }, "P2");
    await flush();

    expect(root.querySelectorAll('.insight-dest-root[data-dest="project"]')).toHaveLength(2);
    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(2);

    await openFixedDest("finance");

    expect(root.querySelectorAll('.insight-dest-root[data-dest="project"]')).toHaveLength(2);
    expect(project.calls).not.toContain("dispose");
    expect(getActiveDest(root)).toBe("finance");
    expect(getActiveSurface(root)).toBe("fixed:finance");
  });

  it("closing last content tab returns to home", async () => {
    const finance = makeBasicStub("finance");
    const project = makeProjectStub();
    const root = await setup([finance.dest, project.dest]);

    const { openInsightContentTab } = await import("./tab-host/host-api");
    openInsightContentTab({ kind: "project", id: "p1" });
    await flush();

    root.querySelector<HTMLElement>(".insight-content-tab-close")!.click();
    await flush();

    expect(getActiveDest(root)).toBe("home");
    expect(getActiveSurface(root)).toBe("home");
    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(0);
  });

  it("list and fixed work share one task-view tab", async () => {
    const work = makeWorkStub();
    const finance = makeBasicStub("finance");
    const root = await setup([work.dest, finance.dest]);

    const { openInsightContentTab } = await import("./tab-host/host-api");
    openInsightContentTab({ kind: "list", id: "l1" });
    await flush();
    await openFixedDest("work");

    expect(getActiveSurface(root)).toBe("task-view");
    expect(root.querySelectorAll('.insight-dest-root[data-dest="work"]')).toHaveLength(1);
    expect(work.calls).toContain("restoreState");
  });
});

describe("insight settings page layout", () => {
  const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "./settings/insight-settings.css");

  it("uses scrollable body and bottom actions row", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/\.insight-settings-body\s*\{[^}]*overflow-y:\s*auto[^}]*\}/s);
    expect(css).toMatch(/\.insight-settings-actions\s*\{/);
    expect(css).not.toMatch(/\.insight-settings-footer\s*\{/);
    expect(css).not.toMatch(/\.insight-settings-btn-primary\s*\{/);
  });
});
