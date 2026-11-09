import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../../../productivity/types";

const { getProject, setPosition, dirtyState } = vi.hoisted(() => ({
  getProject: vi.fn(),
  setPosition: vi.fn(),
  dirtyState: vi.fn(),
}));

vi.mock("../../../productivity/client", () => ({
  productivityGetProject: getProject,
  productivitySetTaskCardPosition: setPosition,
  productivityAddTaskSequence: vi.fn(),
  productivityCreateTaskInProject: vi.fn(),
  productivityDeleteTaskSubtreeMvp: vi.fn(),
  productivityListActions: vi.fn(),
  productivityListCheckpoints: vi.fn(),
  productivityListDeletedTaskBatches: vi.fn(),
  productivityMoveTaskSameLevel: vi.fn(),
  productivityReorderTaskSiblings: vi.fn(),
  productivityRemoveTaskSequence: vi.fn(),
  productivityRestoreTaskSubtreeMvp: vi.fn(),
  productivitySetTaskStatusGuarded: vi.fn(),
  productivityUpdateTask: vi.fn(),
  productivityCommitThingLifecycle: vi.fn(),
}));

vi.mock("../../../../ui/inline-text-field", () => ({ mountInlineTextField: () => ({ dispose: vi.fn() }) }));
vi.mock("../../../../ui/select-field", () => ({ mountSelectField: () => ({ dispose: vi.fn(), setValue: vi.fn() }) }));
vi.mock("../../../../ui/command-menu-popover", () => ({ showCommandMenuAt: vi.fn() }));
vi.mock("../../../../ui/insight-dialog", () => ({ createInsightDialog: vi.fn() }));
vi.mock("../../../../ui/decoupled-date-picker", () => ({ mountDecoupledDatePicker: vi.fn() }));
vi.mock("../../../../ui/decoupled-datetime-picker", () => ({ mountDecoupledDateTimePicker: vi.fn() }));
vi.mock("../../../shell/dialog", () => ({ getConfirmDialog: vi.fn() }));
vi.mock("../../../../core/settings", () => ({ getSettings: () => ({ dataDir: "review-root" }) }));
vi.mock("../project-rail", () => ({ createProjectRail: vi.fn() }));
vi.mock("../../tab-host/dirty", () => ({ setDirtyStatus: dirtyState }));

import { mountProjectDestination } from "./project-page";

function project(revision: number): ProjectSnapshot {
  return {
    id: "project-a",
    revision,
    title: "Review project",
    status: "进行中",
    createdAtUtc: "2026-01-01T00:00:00Z",
    updatedAtUtc: "2026-01-01T00:00:00Z",
    tasks: [
      { id: "root", projectId: "project-a", title: "Root", status: "未做", siblingPosition: 0, createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z" },
      { id: "card", projectId: "project-a", parentTaskId: "root", title: "Card", status: "未做", siblingPosition: 0, createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z" },
    ],
    taskCardPositions: [{ taskId: "card", projectId: "project-a", parentTaskId: "root", x: 96, y: 96, updatedAtUtc: "2026-01-01T00:00:00Z" }],
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pointer(type: string, pointerId: number, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, clientX, clientY, button: 0 });
}

function mountPage() {
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mountProjectDestination({
    root,
    context: { generation: 7, dataDirKey: "review-root" },
    rail: { getSecondaryRailDescriptor: () => ({ kind: "project", title: "Projects", renderContent: () => undefined, selectedKey: "", onSelect: vi.fn() }), setSelectedProject: vi.fn(), getProjects: () => [], createProject: async () => null, refresh: vi.fn(), subscribe: () => () => {}, dispose: vi.fn() },
  });
  handle.restoreState?.({ projectId: "project-a" });
  return { root, handle };
}

const handles: Array<{ dispose: (reason: "host-dispose") => void }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose("host-dispose");
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Project page drag integration", () => {
  it("keeps a stale drag as a failed dirty draft and never writes it against a refreshed revision", async () => {
    getProject.mockResolvedValueOnce({ project: project(4) }).mockResolvedValueOnce({ project: project(5) });
    const { root, handle } = mountPage();
    handles.push(handle);
    await flush();

    const viewport = root.querySelector<HTMLElement>("[data-project-region='map-viewport']")!;
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 500, width: 700, height: 500, toJSON: () => ({}) });
    viewport.setPointerCapture = vi.fn();
    const card = root.querySelector<HTMLElement>("[data-task-id='card']")!;
    card.dispatchEvent(pointer("pointerdown", 11, 100, 100));
    expect(viewport.setPointerCapture).toHaveBeenCalledWith(11);
    viewport.dispatchEvent(pointer("pointermove", 11, 160, 148));

    await handle.activate();
    await flush();
    viewport.dispatchEvent(pointer("pointerup", 11, 160, 148));

    expect(setPosition).not.toHaveBeenCalled();
    expect(root.querySelector(".project-page-v2__discard-position-draft")?.textContent).toContain("放弃未保存的位置并重新读取");
    expect(dirtyState).toHaveBeenLastCalledWith(expect.any(String), { dirty: true, inFlight: false, failed: true });
  });

  it("submits one position write after multiple pointer moves", async () => {
    getProject.mockResolvedValueOnce({ project: project(4) });
    setPosition.mockImplementation(async (request: { project: { expectedRevision: number } }) => ({ project: project(request.project.expectedRevision + 1) }));
    const { root, handle } = mountPage();
    handles.push(handle);
    await flush();

    const viewport = root.querySelector<HTMLElement>("[data-project-region='map-viewport']")!;
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 500, width: 700, height: 500, toJSON: () => ({}) });
    viewport.setPointerCapture = vi.fn();
    const card = root.querySelector<HTMLElement>("[data-task-id='card']")!;
    card.dispatchEvent(pointer("pointerdown", 12, 100, 100));
    expect(viewport.setPointerCapture).toHaveBeenCalledWith(12);
    viewport.dispatchEvent(pointer("pointermove", 12, 130, 130));
    viewport.dispatchEvent(pointer("pointermove", 12, 160, 160));
    viewport.dispatchEvent(pointer("pointermove", 12, 190, 190));
    viewport.dispatchEvent(pointer("pointerup", 12, 190, 190));
    root.querySelector<HTMLElement>("[data-task-id='card']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(setPosition).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".project-page-v2__detail-dialog")).toBeNull();
  });
});
