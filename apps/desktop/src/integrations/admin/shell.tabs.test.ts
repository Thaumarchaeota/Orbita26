import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedDestId } from "./tab-host/identity";
import { saveTabSession } from "./tab-host/session-persist";
import type { InsightDestination, InsightDestinationId } from "./types";

const dialogState = vi.hoisted(() => ({ confirmAnswer: true }));

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
  getConfirmDialog: () => async () => dialogState.confirmAnswer,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeBasicStub(id: InsightDestinationId) {
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

async function setup(stubs: InsightDestination[]) {
  const { registerInsightDestination } = await import("./registry");
  const { mountAdminShell } = await import("./shell");
  const { homeDestination } = await import("./tabs/home");
  registerInsightDestination(homeDestination);
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

function getActiveTab(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLButtonElement>(".admin-tab-btn.is-active")?.dataset.tab;
}

function getActiveDest(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLElement>(".insight-pane-viewport .insight-dest-root.is-active")?.dataset.dest;
}

function getActiveSurface(root: HTMLElement): string | undefined {
  return root.querySelector<HTMLElement>(".insight-pane-viewport .insight-dest-root.is-active")?.dataset.surface;
}

function surfaceKeyForDest(root: HTMLElement, dest: string): string | undefined {
  return root.querySelector<HTMLElement>(`.insight-dest-root[data-dest="${dest}"]`)?.dataset.surface;
}

describe("admin shell tab host", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();
    dialogState.confirmAnswer = true;
  });

  it("defaults to home with icon-only sidebar", async () => {
    const timeline = makeBasicStub("timeline");
    const work = makeBasicStub("work");
    const health = makeBasicStub("health");
    const finance = makeBasicStub("finance");
    const journal = makeBasicStub("journal");
    const project = makeProjectStub();
    const root = await setup([
      timeline.dest,
      work.dest,
      health.dest,
      finance.dest,
      journal.dest,
      project.dest,
    ]);

    expect(getActiveTab(root)).toBeUndefined();
    expect(getActiveDest(root)).toBe("home");
    expect(getActiveSurface(root)).toBe("home");
    expect(root.querySelectorAll(".admin-tab-btn")).toHaveLength(0);
    expect(root.querySelectorAll(".admin-quick-btn")).toHaveLength(1);
    expect(root.querySelector("#adminWorkspace")).toBeNull();
    expect(root.querySelector(".admin-workspace-section")).toBeNull();
    expect(root.querySelector(".admin-main")).toBeNull();
    const app = root.querySelector<HTMLElement>(".admin-app")!;
    const titlebar = app.querySelector(".admin-titlebar");
    const shell = app.querySelector(".admin-shell");
    const workspace = shell?.querySelector(".admin-workspace");
    const paneGroup = workspace?.querySelector("#insightPaneGroup");
    const leftViewport = workspace?.querySelector("#adminLeftViewport");
    expect(root.querySelector("#adminSidebar .admin-titlebar-title")?.textContent).toBe("Orbita");
    expect(root.querySelector("#adminSidebarToggle")).toBeNull();
    expect(root.querySelector("#adminChatRailToggle")).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(workspace).not.toBeNull();
    expect(paneGroup).not.toBeNull();
    expect(leftViewport).not.toBeNull();
    expect(app.firstElementChild).toBe(shell);
    expect(root.querySelector(".insight-pane-left .insight-tab-strip-new")).not.toBeNull();
    expect(root.querySelector(".insight-pane-right")).not.toBeNull();
  });

  it("new tab button opens blank tab and keeps existing content tabs", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const project = makeProjectStub();
    const root = await setup([finance.dest, health.dest, project.dest]);

    const { openInsightContentTab } = await import("./tab-host/host-api");
    openInsightContentTab({ kind: "project", id: "p1" }, "P1");
    await flush();

    root.querySelector<HTMLButtonElement>(".insight-tab-strip-new")!.click();
    await flush();

    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(2);
    const titles = [...root.querySelectorAll(".insight-content-tab-title")].map((el) => el.textContent);
    expect(titles).toContain("新标签页");
    expect(getActiveDest(root)).toBe("home");
    const surface = getActiveSurface(root);
    expect(surface?.startsWith("tab:")).toBe(true);
    expect(surface).not.toBe("home");
    expect(root.querySelector<HTMLButtonElement>(".insight-tab-strip-home")?.getAttribute("aria-current")).not.toBe(
      "page",
    );
    expect(getActiveTab(root)).toBeUndefined();
  });

  it("blank tab stays when opening a fixed dest", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    root.querySelector<HTMLButtonElement>(".insight-tab-strip-new")!.click();
    await flush();
    const tabCountBefore = root.querySelectorAll(".insight-content-tab").length;

    await openFixedDest("finance");

    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(tabCountBefore);
    expect(getActiveDest(root)).toBe("finance");
    expect(getActiveSurface(root)).toBe("fixed:finance");
  });

  it("blank tab stays when sidebar selects an existing content tab", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const project = makeProjectStub();
    const root = await setup([finance.dest, health.dest, project.dest]);

    const { openInsightContentTab } = await import("./tab-host/host-api");
    openInsightContentTab({ kind: "project", id: "p1" }, "P1");
    await flush();

    root.querySelector<HTMLButtonElement>(".insight-tab-strip-new")!.click();
    await flush();

    const tabCount = root.querySelectorAll(".insight-content-tab").length;
    expect(tabCount).toBe(2);
    expect(
      [...root.querySelectorAll(".insight-content-tab-title")].some((el) => el.textContent === "新标签页"),
    ).toBe(true);

    const projectTab = [...root.querySelectorAll<HTMLButtonElement>(".insight-content-tab")].find(
      (el) => el.querySelector(".insight-content-tab-title")?.textContent === "P1",
    )!;
    projectTab.click();
    await flush();

    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(tabCount);
    expect(getActiveDest(root)).toBe("project");
    expect(
      [...root.querySelectorAll(".insight-content-tab-title")].some((el) => el.textContent === "新标签页"),
    ).toBe(true);
  });

  it("keeps multiple project surfaces when switching to finance", async () => {
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

  it("closing last dirty content tab returns home when confirm accepts", async () => {
    const finance = makeBasicStub("finance");
    const project = makeProjectStub();
    const root = await setup([finance.dest, project.dest]);

    const { openInsightContentTab } = await import("./tab-host/host-api");
    const { setDirtyStatus } = await import("./tab-host/dirty");
    openInsightContentTab({ kind: "project", id: "p1" });
    await flush();
    const projectSurface =
      root.querySelector<HTMLElement>('.insight-dest-root[data-dest="project"]')!.dataset.surface!;
    setDirtyStatus(projectSurface, { dirty: true, inFlight: false, failed: false });

    root.querySelector<HTMLElement>(".insight-content-tab-close")!.click();
    await new Promise((r) => setTimeout(r, 320));
    await flush();

    expect(getActiveDest(root)).toBe("home");
    expect(getActiveSurface(root)).toBe("home");
    expect(root.querySelectorAll(".insight-content-tab")).toHaveLength(0);
    expect(project.calls).toContain("dispose");
  });

  it("shows home on mount and defers session tabs until restore", async () => {
    const health = makeBasicStub("health");
    const finance = makeBasicStub("finance");
    const project = makeProjectStub();
    saveTabSession({
      v: 2,
      tabs: [
        {
          key: "project:p1",
          identity: { kind: "project", id: "p1" },
          title: "P1",
          destId: "project",
          destState: { projectId: "p1" },
        },
      ],
      panes: { left: { tabKeys: ["project:p1"], active: "project:p1", width: 0 } },
      focusedPane: "left",
      style: "rect",
    });

    const root = await setup([health.dest, finance.dest, project.dest]);
    await flush();

    expect(getActiveTab(root)).toBeUndefined();
    expect(getActiveDest(root)).toBe("home");
    expect(getActiveSurface(root)).toBe("home");
    expect(root.querySelector(".insight-content-tab")).toBeNull();
    expect(root.querySelector<HTMLButtonElement>(".insight-tab-strip-home")?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(root.querySelector("[data-restore-layout]")).not.toBeNull();

    const { applyRestoredLayout } = await import("./shell");
    applyRestoredLayout();
    await flush();
    expect(root.querySelector(".insight-content-tab-title")?.textContent).toBe("P1");
    expect(getActiveDest(root)).toBe("project");
  });

  it("blocks dataDir dispose on dirty finance when confirm is false", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    await openFixedDest("finance");

    const { setDirtyStatus } = await import("./tab-host/dirty");
    const financeSurface = surfaceKeyForDest(root, "finance")!;
    setDirtyStatus(financeSurface, { dirty: true, inFlight: false, failed: false });

    dialogState.confirmAnswer = false;
    const { notifyDataDirChanged } = await import("../../core/data/dir-sync");
    notifyDataDirChanged();
    await flush();

    expect(finance.calls).not.toContain("dispose");
    expect(getActiveDest(root)).toBe("finance");
    expect(getActiveSurface(root)).toBe("fixed:finance");
  });

  it("disposes and returns home on dataDir change when confirm accepts dirty finance", async () => {
    const finance = makeBasicStub("finance");
    const health = makeBasicStub("health");
    const root = await setup([finance.dest, health.dest]);

    await openFixedDest("finance");
    const financeSurface = surfaceKeyForDest(root, "finance")!;
    await openFixedDest("health");

    const { setDirtyStatus } = await import("./tab-host/dirty");
    setDirtyStatus(financeSurface, { dirty: true, inFlight: false, failed: false });

    dialogState.confirmAnswer = true;
    const { notifyDataDirChanged } = await import("../../core/data/dir-sync");
    notifyDataDirChanged();
    await flush();
    await flush();
    await flush();
    await flush();

    expect(finance.calls).toContain("dispose");
    expect(health.calls).toContain("dispose");
    expect(getActiveDest(root)).toBe("home");
    expect(getActiveTab(root)).toBeUndefined();
    expect(getActiveSurface(root)).toBe("home");
  });
});
