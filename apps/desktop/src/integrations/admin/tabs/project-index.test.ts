import { afterEach, describe, expect, it, vi } from "vitest";
import { productivityCreateProject, productivityDeleteProject, productivityListProjects } from "../../productivity/client";
import { projectIndexDestination } from "./project-index";
import type { ProjectSnapshot } from "../../productivity/types";

const projectMocks = vi.hoisted(() => ({ openTab: vi.fn(), list: vi.fn(), create: vi.fn(), delete: vi.fn(), menu: vi.fn(), confirm: vi.fn() }));

vi.mock("../../productivity/client", async () => {
  const actual = await vi.importActual<typeof import("../../productivity/client")>("../../productivity/client");
  return { ...actual, productivityListProjects: projectMocks.list, productivityCreateProject: projectMocks.create, productivityDeleteProject: projectMocks.delete };
});
vi.mock("../../../ui/command-menu-popover", () => ({ showCommandMenuAt: projectMocks.menu }));
vi.mock("../../shell/dialog", () => ({ getConfirmDialog: () => projectMocks.confirm }));
vi.mock("../tab-host/host-api", () => ({ openInsightContentTab: projectMocks.openTab }));
vi.mock("../../../core/settings", () => ({ getSettings: () => ({ dataDir: "root-open" }) }));

function project(id: string, title: string): ProjectSnapshot {
  return { id, revision: 1, title, status: "规划中", tasks: [], createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z" };
}

describe("Project index production destination", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("confirms and deletes the captured project revision using the captured data root", async () => {
    const existing = project("project-delete", "待删除");
    const deleted = { ...existing, revision: 2, deletedAtUtc: "2026-01-02T00:00:00Z" };
    vi.mocked(productivityListProjects).mockResolvedValueOnce({ projects: [existing] }).mockResolvedValue({ projects: [] });
    vi.mocked(productivityDeleteProject).mockResolvedValue({ project: deleted });
    projectMocks.confirm.mockResolvedValue(true);
    let select!: (value: string) => void;
    projectMocks.menu.mockImplementation((_x, _y, _items, callback) => { select = callback; return { close: async () => {}, dispose() {} }; });
    const deletedEvent = vi.fn();
    window.addEventListener("orbita-project-deleted", deletedEvent);
    const root = document.createElement("div"); document.body.append(root);
    const destination = projectIndexDestination.mount(root, { generation: 1, dataDirKey: "_default" });
    await destination.activate();
    root.querySelector<HTMLButtonElement>('[data-project-id="project-delete"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await vi.waitFor(() => expect(select).toBeTypeOf("function"));
    select("delete");
    await vi.waitFor(() => expect(productivityDeleteProject).toHaveBeenCalledWith({ expectedDataDir: "root-open", project: { id: existing.id, expectedRevision: 1 } }));
    await vi.waitFor(() => expect(deletedEvent).toHaveBeenCalledOnce());
    expect(projectMocks.confirm.mock.calls[0][1]).toContain("关联安排和检查点会保留");
    destination.dispose("host-dispose");
    window.removeEventListener("orbita-project-deleted", deletedEvent);
  });

  it("mounts a live Project list and opens the canonical Project identity from a card click", async () => {
    const existing = project("project-1", "可用项目");
    vi.mocked(productivityListProjects).mockResolvedValue({ projects: [existing] });
    const root = document.createElement("div");
    document.body.append(root);
    const destination = projectIndexDestination.mount(root, { generation: 1, dataDirKey: "_default" });
    await destination.activate();

    const card = root.querySelector<HTMLButtonElement>('[data-project-id="project-1"]');
    expect(card?.textContent).toContain("可用项目");
    card?.click();
    expect(projectMocks.openTab).toHaveBeenCalledOnce();
    expect(projectMocks.openTab).toHaveBeenCalledWith({ kind: "project", id: "project-1" }, "可用项目");
    destination.dispose("host-dispose");
  });

  it("opens the shared new-Project flow from the main pane and routes the created Project", async () => {
    const created = project("project-new", "新项目");
    vi.mocked(productivityListProjects)
      .mockResolvedValueOnce({ projects: [] })
      .mockResolvedValueOnce({ projects: [created] });
    vi.mocked(productivityCreateProject).mockResolvedValue({ project: created });
    const root = document.createElement("div");
    document.body.append(root);
    const destination = projectIndexDestination.mount(root, { generation: 2, dataDirKey: "_default" });
    await destination.activate();

    root.querySelector<HTMLButtonElement>("[data-project-index-create]")!.click();
    const form = document.body.querySelector<HTMLFormElement>(".insight-dialog-panel")!;
    form.querySelector<HTMLInputElement>('[name="title"]')!.value = "新项目";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(productivityCreateProject).toHaveBeenCalledWith({ title: "新项目", status: "规划中", expectedDataDir: "root-open" });
    expect(projectMocks.openTab).toHaveBeenCalledWith({ kind: "project", id: "project-new" }, "新项目");
    destination.dispose("host-dispose");
  });

  it("renders explicit empty and read-failure states instead of a placeholder", async () => {
    vi.mocked(productivityListProjects).mockResolvedValueOnce({ projects: [] }).mockRejectedValueOnce(new Error("offline"));
    const root = document.createElement("div");
    const destination = projectIndexDestination.mount(root, { generation: 3, dataDirKey: "_default" });
    await destination.activate();
    expect(root.querySelector('[data-project-index-message]')?.textContent).toContain("还没有项目");
    await destination.activate();
    expect(root.querySelector('[data-project-index-message]')?.textContent).toContain("offline");
    destination.dispose("host-dispose");
  });
});
