import { afterEach, describe, expect, it, vi } from "vitest";
import { productivityCreateProject } from "../../productivity/client";
import { createProjectRail } from "./project-rail";
import type { ProjectSnapshot } from "../../productivity/types";

const settingsState = vi.hoisted(() => ({ dataDir: "root-open" }));
vi.mock("../../productivity/client", async () => {
  const actual = await vi.importActual<typeof import("../../productivity/client")>("../../productivity/client");
  return { ...actual, productivityCreateProject: vi.fn() };
});
vi.mock("../../../core/settings", () => ({ getSettings: () => ({ dataDir: settingsState.dataDir }) }));

function project(id: string, title: string): ProjectSnapshot {
  return { id, revision: 1, title, status: "规划中", tasks: [], createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z" };
}

describe("Project create dialog", () => {
  afterEach(() => {
    document.body.replaceChildren();
    settingsState.dataDir = "root-open";
    vi.clearAllMocks();
  });

  it("uses the shared dialog and cleans up its select field on cancel", async () => {
    const rail = createProjectRail({ generation: 1, dataDirKey: "_default" });
    const created = rail.createProject();
    const backdrop = document.body.querySelector<HTMLElement>(".insight-dialog-backdrop")!;
    expect(backdrop).not.toBeNull();
    backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    await expect(created).resolves.toBeNull();
    expect(document.body.querySelector(".insight-dialog-backdrop")).toBeNull();
    expect(document.body.querySelector(".orbita-select-field")).toBeNull();
    rail.dispose();
  });

  it("locks repeated submit events until the create request settles and preserves the default status", async () => {
    let complete!: (value: { project: ProjectSnapshot }) => void;
    vi.mocked(productivityCreateProject).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const rail = createProjectRail({ generation: 2, dataDirKey: "_default" });
    const created = rail.createProject();
    const form = document.body.querySelector<HTMLFormElement>(".insight-dialog-panel")!;
    form.querySelector<HTMLInputElement>('[name="title"]')!.value = "One project";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(productivityCreateProject).toHaveBeenCalledOnce();
    expect(form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    expect(productivityCreateProject).toHaveBeenCalledWith({ title: "One project", status: "规划中", expectedDataDir: "root-open" });
    complete({ project: project("p1", "One project") });
    await expect(created).resolves.toEqual(project("p1", "One project"));
    expect(document.body.querySelector(".insight-dialog-backdrop")).toBeNull();
    rail.dispose();
  });

  it("keeps entered text and shows an error after failure so the user can retry or close", async () => {
    vi.mocked(productivityCreateProject).mockRejectedValueOnce(new Error("write failed"));
    const rail = createProjectRail({ generation: 3, dataDirKey: "_default" });
    const created = rail.createProject();
    const form = document.body.querySelector<HTMLFormElement>(".insight-dialog-panel")!;
    const input = form.querySelector<HTMLInputElement>('[name="title"]')!;
    input.value = "Keep this title";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(form.querySelector('[role="alert"]')?.textContent).toContain("write failed");
    expect(input.value).toBe("Keep this title");
    expect(form.isConnected).toBe(true);
    form.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    await expect(created).resolves.toBeNull();
    rail.dispose();
  });

  it("does not submit an open draft after the application data root changes", async () => {
    const hostContext = { generation: 4, dataDirKey: "root-open" };
    const rail = createProjectRail(hostContext);
    const created = rail.createProject();
    const form = document.body.querySelector<HTMLFormElement>(".insight-dialog-panel")!;
    form.querySelector<HTMLInputElement>('[name="title"]')!.value = "Do not cross roots";
    settingsState.dataDir = "root-next";
    hostContext.generation = 5;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(productivityCreateProject).not.toHaveBeenCalled();
    expect(form.querySelector('[role="alert"]')?.textContent).toContain("数据目录已变化");
    form.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    await expect(created).resolves.toBeNull();
    rail.dispose();
  });
});
