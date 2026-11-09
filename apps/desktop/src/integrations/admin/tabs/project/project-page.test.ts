import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, TaskSnapshot } from "../../../productivity/types";
import { consumeMapDragCommit, deletedBatchRestoreEdgeIds, deletedBatchRestoreRequest, isCurrentProjectFocusRequest, isMapDragIntentCurrent, liveTaskChildren, mapDragCaptureTarget, mountProjectPage, projectMapProgressLabel, renderProjectMap, updateProjectMapPositionInPlace, type MapDragCurrent, type MapDragIntent } from "./project-page";

function task(id: string, parentTaskId: string | null, siblingPosition: number, deletedAtUtc: string | null = null): TaskSnapshot {
  return {
    id, projectId: "p1", parentTaskId, siblingPosition, title: id, status: "未做",
    createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z", deletedAtUtc,
  };
}

describe("Project page layer selectors", () => {
  it("returns only living direct children in canonical sibling order without mutating the snapshot", () => {
    const tasks = [
      task("late", "root", 8), task("grandchild", "early", 0), task("early", "root", 2),
      task("deleted", "root", 1, "2026-01-02T00:00:00Z"), task("other-root", "elsewhere", 0),
    ];
    const project = { id: "p1", revision: 4, title: "Project", status: "进行中", tasks,
      createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z" } satisfies ProjectSnapshot;
    const before = structuredClone(project);

    expect(liveTaskChildren(project, "root").map((entry) => entry.id)).toEqual(["early", "late"]);
    expect(liveTaskChildren(project, "early").map((entry) => entry.id)).toEqual(["grandchild"]);
    expect(project).toEqual(before);
  });

  it("rejects a delayed one-shot focus request from another Project or host generation", () => {
    const request = { kind: "focus-project-task" as const, projectId: "p1", taskId: "task-3", generation: 12 };
    expect(isCurrentProjectFocusRequest(request, "p1", 12)).toBe(true);
    expect(isCurrentProjectFocusRequest(request, "p2", 12)).toBe(false);
    expect(isCurrentProjectFocusRequest(request, "p1", 13)).toBe(false);
    expect(isCurrentProjectFocusRequest(null, "p1", 12)).toBe(false);
  });

  it("does not rebase a card drag after refresh, reparent, root switch, or host-generation change", () => {
    const project: ProjectSnapshot = {
      id: "p1", revision: 7, title: "Project", status: "进行中",
      tasks: [task("card", "root-a", 0)],
      createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z",
    };
    const intent: MapDragIntent = {
      projectId: "p1", generation: 12, expectedDataDir: "root-a", projectRevision: 7,
      taskId: "card", parentTaskId: "root-a", originalPosition: { x: 48, y: 72 },
    };
    const current: MapDragCurrent = {
      projectId: "p1", generation: 12, expectedDataDir: "root-a", dataDirKey: "root-a",
      currentDataDir: "root-a", project,
    };
    expect(isMapDragIntentCurrent(intent, current)).toBe(true);
    expect(isMapDragIntentCurrent(intent, { ...current, project: { ...project, revision: 8 } })).toBe(false);
    expect(isMapDragIntentCurrent(intent, { ...current, project: { ...project, tasks: [task("card", "root-b", 0)] } })).toBe(false);
    expect(isMapDragIntentCurrent(intent, { ...current, projectId: "p2" })).toBe(false);
    expect(isMapDragIntentCurrent(intent, { ...current, generation: 13 })).toBe(false);
    expect(isMapDragIntentCurrent(intent, { ...current, currentDataDir: "root-b" })).toBe(false);
    expect(isMapDragIntentCurrent(intent, { ...current, project: { ...project, tasks: [task("card", "root-a", 0, "2026-01-02T00:00:00Z")] } })).toBe(false);
  });

  it("keeps drag capture on the stable viewport and moves the existing card and edge in place", () => {
    const host = document.createElement("div");
    const page = mountProjectPage(host);
    const nodes = [{ task: task("a", "root", 0), position: { x: 0, y: 0 } }, { task: task("b", "root", 1), position: { x: 320, y: 0 } }];
    renderProjectMap(page, nodes, [{ id: "edge", sourceTaskId: "a", targetTaskId: "b" }], { x: 0, y: 0, zoom: 1 }, null);
    const card = page.mapCards.querySelector<HTMLElement>('[data-task-id="a"]')!;
    const edgePath = page.mapEdges.querySelector<SVGPathElement>(".project-page-v2__edge")!;
    const oldPath = edgePath.getAttribute("d");
    expect(mapDragCaptureTarget(page)).toBe(page.mapViewport);
    expect(updateProjectMapPositionInPlace(page, nodes, "a", { x: 24, y: 48 })).toBe(true);
    expect(page.mapCards.querySelector('[data-task-id="a"]')).toBe(card);
    expect(card.style.left).toBe("24px");
    expect(edgePath.getAttribute("d")).not.toBe(oldPath);
    const release = { moved: true, committed: false };
    expect(consumeMapDragCommit(release)).toBe(true);
    expect(consumeMapDragCommit(release)).toBe(false);
  });

  it("shows direct-child progress with cancelled children excluded and restores only the batch edge scope", () => {
    const children = [{ ...task("done", "parent", 0), status: "完成" }, { ...task("cancelled", "parent", 1), status: "取消" }];
    expect(projectMapProgressLabel("parent", children)).toBe("1/1 完成");
    expect(projectMapProgressLabel("parent", [task("parent", null, 0)])).toBe("无直属任务");
    expect(projectMapProgressLabel("parent", [{ ...task("cancelled", "parent", 0), status: "取消" }])).toBe("直属任务均已取消 · 1");
    const batchScope = ["edge-deleted-in-batch"];
    expect(deletedBatchRestoreEdgeIds(batchScope)).toEqual(batchScope);
    expect(deletedBatchRestoreEdgeIds([])).toEqual([]);
    const response = { projectId: "p1", projectRevision: 19, batches: [] };
    const batch = { deletionBatchId: "batch-a", rootTaskId: "root", rootTitle: "Root", taskIds: ["root", "child"], edgeIds: batchScope, deletedAtUtc: "2026-01-01T00:00:00Z" };
    expect(deletedBatchRestoreRequest("data-root-a", response, batch)).toEqual({
      expectedDataDir: "data-root-a", project: { id: "p1", expectedRevision: 19 }, taskId: "root",
      expectedDeletionBatchId: "batch-a", expectedSubtreeTaskIds: ["root", "child"], expectedEdgeIds: batchScope,
    });
  });
});
